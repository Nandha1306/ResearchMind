import { Response } from "express";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";
import { getWorkspaceDocuments, getDocumentById, createDocument } from "../services/document.service";
import { checkWorkspaceMembership } from "../utils/workspace-checker";
import { Document } from "../models/Document";
import { AppError } from "../../../../packages/shared/errors/AppError";

/** Return all documents for a workspace. */
export const getDocuments = asyncHandler(
  async (req: any, res: Response) => {
    const { workspaceId } = req.params;
    const userId = req.user?.userId || req.user?.id;

    if (!userId) {
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
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this workspace.",
      });
    }

    const documents =
      await getWorkspaceDocuments(
        workspaceId
      );

    res.status(200).json({
      success: true,
      data: documents,
    });
  }
);

/** Return a single document. */
export const getDocument = asyncHandler(
  async (req: any, res: Response) => {
    const document =
      await getDocumentById(
        req.params.id
      );

    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document not found",
      });
    }

    const userId = req.user?.userId || req.user?.id;
    if (userId) {
      const isMember = await checkWorkspaceMembership(
        document.workspaceId,
        userId,
        req.headers.authorization
      );

      if (!isMember) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You are not a member of this workspace.",
        });
      }
    }

    res.status(200).json({
      success: true,
      data: document,
    });
  }
);

/** Create document metadata and store in MongoDB. */
export const createDocumentHandler = asyncHandler(
  async (req: any, res: Response) => {
    const userId = req.user?.userId || req.user?.id;
    const { workspaceId } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (workspaceId) {
      const isMember = await checkWorkspaceMembership(
        workspaceId,
        userId,
        req.headers.authorization
      );

      if (!isMember) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You are not a member of this workspace.",
        });
      }
    }

    const document = await createDocument({
      ...req.body,
      uploadedBy: userId,
    });
    res.status(201).json({
      success: true,
      data: document,
    });
  }
);

/** Update the embedding processing status for a document. */
export const updateEmbeddingStatus = async (
  req: any,
  res: Response
) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowedStatuses = [
    "pending",
    "indexing",
    "indexed",
    "failed",
  ];

  if (!allowedStatuses.includes(status)) {
    throw new AppError(
      "Invalid embedding status",
      400
    );
  }

  const document =
    await Document.findByIdAndUpdate(
      id,
      {
        embeddingStatus: status,
      },
      {
        new: true,
      }
    );

  if (!document) {
    throw new AppError(
      "Document not found",
      404
    );
  }

  return res.status(200).json({
    success: true,
    data: {
      documentId: document._id,
      embeddingStatus:
        document.embeddingStatus,
    },
  });
};