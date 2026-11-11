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
  const publicId = fileName.replace(/\.(pdf|docx)$/i, "");

  const result = await cloudinary.uploader.upload(
    filePath,
    {
      resource_type: resourceType,
      folder: "researchmind/documents",
      public_id: publicId,
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
          uploadedBy: userId,
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
          embeddingStatus: "pending",
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

/** Return all documents for a workspace (without full extracted text payload). */
export const getWorkspaceDocuments = async (
  workspaceId: string
) => {
  return Document.find({
    workspaceId,
  })
    .select("-extractedText")
    .sort({
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

/** Delete a document, its Cloudinary asset, and vector embeddings. */
export const deleteDocument = async (
  documentId: string,
  workspaceId: string
) => {
  if (!mongoose.Types.ObjectId.isValid(documentId)) {
    return null;
  }

  const document = await Document.findOne({
    _id: documentId,
    workspaceId,
  });

  if (!document) {
    return null;
  }

  // Destroy Cloudinary asset if public ID is present
  if (document.cloudinaryPublicId) {
    try {
      const resourceType = document.fileType === "pdf" ? "image" : "raw";
      await cloudinary.uploader.destroy(document.cloudinaryPublicId, {
        resource_type: resourceType,
      });
    } catch (err) {
      console.error("Failed to destroy Cloudinary asset:", err);
    }
  }

  await Document.deleteOne({ _id: document._id });

  return document;
};

/** Re-index a failed or pending document by re-enqueuing its embedding job. */
export const reindexDocument = async (
  documentId: string,
  workspaceId: string
) => {
  if (!mongoose.Types.ObjectId.isValid(documentId)) {
    return null;
  }

  const document = await Document.findOne({
    _id: documentId,
    workspaceId,
  });

  if (!document) {
    return null;
  }

  document.embeddingStatus = "pending";
  await document.save();

  try {
    await addEmbeddingJob({
      documentId: document._id.toString(),
      workspaceId: document.workspaceId,
      uploadedBy: document.uploadedBy,
      extractedText: document.extractedText,
      fileType: document.fileType,
    });
  } catch (error) {
    console.error("Failed to re-enqueue embedding job:", error);
    document.embeddingStatus = "failed";
    await document.save();
    throw new Error("Failed to re-enqueue embedding job.");
  }

  return document;
};

/** Re-enqueue all pending or failed documents on service startup to recover un-indexed files. */
export const syncPendingDocuments = async () => {
  try {
    const pendingDocs = await Document.find({
      embeddingStatus: { $in: ["pending", "failed"] },
    });

    if (pendingDocs.length === 0) return;

    console.log(`[Document Service] Found ${pendingDocs.length} pending/failed documents. Re-enqueuing for indexing...`);

    for (const doc of pendingDocs) {
      await addEmbeddingJob({
        documentId: doc._id.toString(),
        workspaceId: doc.workspaceId,
        uploadedBy: doc.uploadedBy,
        extractedText: doc.extractedText || "",
        fileType: doc.fileType,
      });
    }
  } catch (error) {
    console.error("[Document Service] Failed to sync pending documents:", error);
  }
};
