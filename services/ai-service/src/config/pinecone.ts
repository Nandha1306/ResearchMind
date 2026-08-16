import { Pinecone } from "@pinecone-database/pinecone";

const apiKey = process.env.PINECONE_API_KEY;
const indexName = process.env.PINECONE_INDEX;

if (!apiKey) {
  throw new Error(
    "PINECONE_API_KEY is not configured"
  );
}

if (!indexName) {
  throw new Error(
    "PINECONE_INDEX is not configured"
  );
}

export const pinecone = new Pinecone({
  apiKey,
});

export const pineconeIndex =
  pinecone.index(indexName);

export const PINECONE_INDEX_NAME = indexName;