import { AppError } from "../../../../packages/shared/errors/AppError";

/**
 * Upper bound for the text extracted from one document (SEC-002). Two million
 * characters is several hundred pages; it keeps the stored document far below
 * MongoDB's 16 MB limit and bounds the embedding job built from it.
 */
export const MAX_EXTRACTED_TEXT_CHARS = 2_000_000;

export const tooMuchTextError = (limit = MAX_EXTRACTED_TEXT_CHARS) =>
  new AppError(
    `The document contains too much text (more than ${limit.toLocaleString("en-US")} characters).`,
    413
  );

/** Throw 413 when extracted text exceeds the cap (used for PDF and DOCX). */
export const assertExtractedTextWithinLimit = (text: string, limit = MAX_EXTRACTED_TEXT_CHARS) => {
  if (text.length > limit) throw tooMuchTextError(limit);
};
