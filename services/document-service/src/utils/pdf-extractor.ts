import fs from "fs/promises";
import { PDFParse } from "pdf-parse";
import { AppError } from "../../../../packages/shared/errors/AppError";

/**
 * pdf.js exception names that mean "this upload is not a readable PDF"
 * (corrupt/empty file, encrypted file, malformed structure). Anything else is
 * treated as a server-side failure and propagates unchanged (-> 500).
 */
const UNREADABLE_PDF_ERRORS = new Set([
  "InvalidPDFException",
  "PasswordException",
  "FormatError",
]);

/** Extract readable text from a PDF file. */
export const extractPdfText = async (
  filePath: string
) => {
  const fileBuffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: fileBuffer });

  try {
    const textResult = await parser.getText();
    return textResult.text.trim();
  } catch (error) {
    if (UNREADABLE_PDF_ERRORS.has((error as Error)?.name)) {
      throw new AppError(
        "Could not read the PDF file. It may be corrupted or password-protected.",
        422
      );
    }
    throw error;
  } finally {
    await parser.destroy().catch(() => {
      // Cleanup failure must not mask the extraction result or error.
    });
  }
};
