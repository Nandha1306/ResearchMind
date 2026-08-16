import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { TextChunk } from "../types/chunk.types";

export const CHUNK_SIZE = 400;
export const CHUNK_OVERLAP = 60;

/** Remove common PDF extraction artifacts and normalize document text. */
const normalizeText = (text: string): string => {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\f/g, "\n")
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

/** Estimate token count until the exact embedding-model tokenizer is integrated. */
const estimateTokenCount = (text: string): number => {
  return Math.ceil(text.trim().length / 4);
};

/** Create the LangChain text splitter using ResearchMind chunking settings. */
const createTextSplitter = () => {
  return new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
    lengthFunction: estimateTokenCount,
    separators: [
      "\n\n",
      "\n",
      ". ",
      "! ",
      "? ",
      " ",
      "",
    ],
  });
};

/** Split extracted document text into clean overlapping chunks. */
export const chunkText = async (
  text: string
): Promise<TextChunk[]> => {
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    return [];
  }

  const splitter = createTextSplitter();

  const documents = await splitter.createDocuments([
    normalizedText,
  ]);

  return documents
    .map((document, index) => {
      const chunkTextValue =
        document.pageContent.trim();

      return {
        index,
        text: chunkTextValue,
        tokenCount: estimateTokenCount(
          chunkTextValue
        ),
      };
    })
    .filter((chunk) => chunk.text.length > 0)
    .map((chunk, index) => ({
      ...chunk,
      index,
    }));
};