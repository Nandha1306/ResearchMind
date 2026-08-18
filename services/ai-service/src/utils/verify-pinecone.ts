import { pinecone, PINECONE_INDEX_NAME } from "../config/pinecone";

export const verifyPineconeIndex = async () => {
  const indexList = await pinecone.listIndexes();

    const index = indexList.indexes?.find(
      (item) =>
        item.name === PINECONE_INDEX_NAME
    );

    if (!index) {
      throw new Error(
        `Pinecone index "${PINECONE_INDEX_NAME}" was not found`
      );
    }

    console.log("Pinecone index verified:", {
      name: index.name,
      dimension: index.dimension,
      metric: index.metric,
      status: index.status,
    });

    if (index.dimension !== 1024) {
      throw new Error(
        `Pinecone dimension mismatch. Expected 1024, received ${index.dimension}`
      );
    }

    return index;
  };