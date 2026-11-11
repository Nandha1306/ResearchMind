import mammoth from "mammoth";
import fs from "fs/promises";
import { AppError } from "../../../../packages/shared/errors/AppError";

/**
 * mammoth/JSZip messages that mean "this upload is not a readable DOCX"
 * (not a zip archive, truncated/corrupt zip, or a zip without a Word
 * document part). Anything else is treated as a server-side failure and
 * propagates unchanged (-> 500).
 */
const UNREADABLE_DOCX_MESSAGE =
  /end of central directory|corrupted zip|end of data reached|is this a zip file|main document part/i;

/** Extract readable text from a DOCX file buffer. */
export const extractDocxText = async (
  filePath: string
) => {
  const buffer = await fs.readFile(filePath);

  try {
    const result = await mammoth.extractRawText({
      buffer,
    });
    return result.value.trim();
  } catch (error) {
    if (UNREADABLE_DOCX_MESSAGE.test(String((error as Error)?.message))) {
      throw new AppError(
        "Could not read the DOCX file. It may be corrupted or not a valid Word document.",
        422
      );
    }
    throw error;
  }
};
