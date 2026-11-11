import mammoth from "mammoth";
import fs from "fs/promises";

/** Extract readable text from a DOCX file buffer. */
export const extractDocxText = async (
  filePath: string
) => {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({
    buffer,
  });

  return result.value.trim();
};