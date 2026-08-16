import fs from "fs/promises";
import mongoose from "mongoose";
import { Document } from "../models/Document";
import { CreateDocumentDto } from "../types/document.types";
import { Request, Response } from "express";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";
import { extractPdfText } from "../utils/pdf-extractor";
import { extractDocxText } from "../utils/docx-extractor";
import { checkWorkspaceMembership } from "../utils/workspace-checker";

import cloudinary from "../config/cloudinary";
import { addEmbeddingJob } from "../queues/embedding.queue";

/** Upload a document file to Cloudinary. */
export const uploadToCloudinary = async (
  filePath: string,
  fileName: string,
  fileExtension?: string
) => {
  const resourceType = fileExtension === "pdf" ? "image" : "raw";

  const result = await cloudinary.uploader.upload(
    filePath,
    {
      resource_type: resourceType,
      folder: "researchmind/documents",
      public_id: fileName,
    }
  );

  return {
    url: result.secure_url,
    publicId: result.public_id,
  };
};

/** Save document metadata in MongoDB. */
export const createDocument = async (
  data: CreateDocumentDto
) => {
  return Document.create(data);
};

/** Upload, extract and persist a document. */
export const uploadDocument = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const { workspaceId } = req.body;

    if (!workspaceId) {
      await fs.unlink(req.file.path).catch(() => {});

      return res.status(400).json({
        success: false,
        message: "Workspace ID is required",
      });
    }

    const userId = (req as any).user?.userId || (req as any).user?.id;

    if (!userId) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const isMember = await checkWorkspaceMembership(
      workspaceId,
      userId,
      req.headers.authorization
    );

    if (!isMember) {
      await fs.unlink(req.file.path).catch(() => {});

      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this workspace.",
      });
    }

    try {
      const fileExtension = req.file.originalname
        .split(".")
        .pop()
        ?.toLowerCase();

      let extractedText = "";

      if (fileExtension === "pdf") {
        extractedText = await extractPdfText(
          req.file.path
        );
      } else if (fileExtension === "docx") {
        extractedText = await extractDocxText(
          req.file.path
        );
      } else {
        throw new Error(
          "Unsupported document type"
        );
      }

      const cloudinaryFile =
        await uploadToCloudinary(
          req.file.path,
          req.file.filename,
          fileExtension
        );

      const document =
        await createDocument({
          workspaceId,
          uploadedBy:
            (req as any).user?.userId ||
            (req as any).user?.id ||
            req.body.uploadedBy ||
            "unknown",
          originalName:
            req.file.originalname,
          fileType:
            fileExtension as "pdf" | "docx",
          fileSize: req.file.size,
          cloudinaryUrl:
            cloudinaryFile.url,
          cloudinaryPublicId:
            cloudinaryFile.publicId,
          extractedText,
          embeddingStatus: "indexed",
        });

      try {
        await addEmbeddingJob({
          documentId: document._id.toString(),
          workspaceId: document.workspaceId,
          uploadedBy: document.uploadedBy,
          extractedText: document.extractedText,
          fileType: document.fileType,
        });
      } catch (error) {
        console.error("Failed to enqueue embedding job:", error);
        await Document.findByIdAndUpdate(
          document._id,
          {
            embeddingStatus: "failed",
          }
        );
      }

      await fs.unlink(req.file.path);

      res.status(201).json({
        success: true,
        message:
          "Document uploaded successfully",
        data: document,
      });
    } catch (error) {
      await fs.unlink(req.file.path).catch(() => {});
      throw error;
    }
  }
);

/** Return all documents for a workspace. */
export const getWorkspaceDocuments = async (
  workspaceId: string
) => {
  return Document.find({
    workspaceId,
  }).sort({
    createdAt: -1,
  });
};

/** Find a document by id. */
export const getDocumentById = async (
  documentId: string
) => {
  if (!mongoose.Types.ObjectId.isValid(documentId)) {
    return null;
  }
  return Document.findById(documentId);
};
