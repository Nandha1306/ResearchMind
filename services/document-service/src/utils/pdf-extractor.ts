import fs from "fs/promises";
import { PDFParse } from "pdf-parse";

/** Extract readable text from a PDF file. */
export const extractPdfText = async (
  filePath: string
) => {
  const fileBuffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: fileBuffer });
  const textResult = await parser.getText();
  await parser.destroy();

  return textResult.text.trim();
};