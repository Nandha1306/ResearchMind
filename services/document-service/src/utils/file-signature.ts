import fs from "fs/promises";
import { AppError } from "../../../../packages/shared/errors/AppError";

export type SupportedDocumentType = "pdf" | "docx";

/**
 * PDF header (SEC-020). PDF readers tolerate the "%PDF-" header anywhere in
 * the first 1024 bytes, which lets an HTML/PDF polyglot pass. Only an
 * optional UTF-8 byte-order mark and/or ASCII whitespace may precede it
 * (some generators emit those); anything else -- HTML, text -- is refused.
 */
const PDF_HEADER = Buffer.from("%PDF-");
const PDF_HEADER_SEARCH_BYTES = 1024;
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const ASCII_WHITESPACE = new Set([0x09, 0x0a, 0x0c, 0x0d, 0x20]);

const pdfHeaderOffset = (head: Buffer): number => {
  let offset = head.subarray(0, UTF8_BOM.length).equals(UTF8_BOM) ? UTF8_BOM.length : 0;
  while (offset < head.length && ASCII_WHITESPACE.has(head[offset])) offset++;
  return offset;
};

/** DOCX files are ZIP archives; every ZIP local file header starts "PK\x03\x04". */
const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Check a file's leading bytes against the claimed document type.
 * Pure function (no I/O) so it can be unit-tested directly.
 */
export const matchesDocumentSignature = (
  head: Buffer,
  type: SupportedDocumentType
): boolean => {
  if (type === "pdf") {
    const window = head.subarray(0, PDF_HEADER_SEARCH_BYTES);
    const offset = pdfHeaderOffset(window);
    return window.subarray(offset, offset + PDF_HEADER.length).equals(PDF_HEADER);
  }
  return head.subarray(0, ZIP_LOCAL_HEADER.length).equals(ZIP_LOCAL_HEADER);
};

/**
 * Validate an uploaded temp file before parsing it.
 *
 * The extension and MIME type both come from the client, so they only say
 * what the file claims to be. This reads the actual bytes:
 *  - an empty file is rejected (422);
 *  - content that is not a PDF / ZIP-based DOCX is rejected (415).
 * A ZIP that is not a Word document still fails later in the DOCX extractor
 * (422), which checks for the document part.
 */
export const assertFileMatchesType = async (
  filePath: string,
  type: SupportedDocumentType
): Promise<void> => {
  const handle = await fs.open(filePath, "r");
  try {
    const { size } = await handle.stat();
    if (size === 0) {
      throw new AppError("The uploaded file is empty.", 422);
    }

    const head = Buffer.alloc(Math.min(size, PDF_HEADER_SEARCH_BYTES));
    await handle.read(head, 0, head.length, 0);

    if (!matchesDocumentSignature(head, type)) {
      throw new AppError(
        `The file content is not a valid ${type.toUpperCase()} document.`,
        415
      );
    }
  } finally {
    await handle.close();
  }
};
