import { Response } from "express";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";
import {
  getWorkspaceDocuments,
  getDocumentById,
  createDocument,
} from "../services/document.service";

/** Return all documents for a workspace. */
export const getDocuments = asyncHandler(
  async (req: any, res: Response) => {
    const { workspaceId } = req.params;

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

    res.status(200).json({
      success: true,
      data: document,
    });
  }
);

/** Create document metadata and store in MongoDB. */
export const createDocumentHandler = asyncHandler(
  async (req: any, res: Response) => {
    const document = await createDocument(req.body);
    res.status(201).json({
      success: true,
      data: document,
    });
  }
);