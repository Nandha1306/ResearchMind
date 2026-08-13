import { Request, Response } from "express";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";

/** Handle document upload requests. */
export const uploadDocument = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    res.status(201).json({
      success: true,
      message: "File uploaded successfully",
      data: {
        originalName: req.file.originalname,
        fileName: req.file.filename,
        mimeType: req.file.mimetype,
        size: req.file.size,
        path: req.file.path,
      },
    });
  }
);