import mammoth from "mammoth";

/** Extract readable text from a DOCX file. */
export const extractDocxText = async (
  filePath: string
) => {
  const result = await mammoth.extractRawText({
    path: filePath,
  });

  return result.value.trim();
};