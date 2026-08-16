import { Request, Response } from "express";
import { uploadDocument as uploadDocumentService } from "../services/document.service";

/** Handle document upload requests and run text extraction. */
export const uploadDocument = (req: Request, res: Response, next: any) => {
  return uploadDocumentService(req, res, next);
};