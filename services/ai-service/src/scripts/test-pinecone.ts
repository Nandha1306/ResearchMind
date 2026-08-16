import dotenv from "dotenv";
dotenv.config();

import {
  pineconeIndex,
  PINECONE_INDEX_NAME,
} from "../config/pinecone";

const TEST_NAMESPACE =
  "researchmind-test-workspace";

const TEST_VECTOR_ID =
  "researchmind-test-vector";

const run = async () => {
  try {
    console.log(
      `Testing Pinecone index: ${PINECONE_INDEX_NAME}`
    );

    const indexDescription =
      await pineconeIndex.describeIndexStats();

    console.log(
      "Initial index stats:",
      indexDescription
    );

    const testVector = Array.from(
      { length: 1024 },
      (_, index) =>
        index === 0 ? 1 : 0
    );

    await pineconeIndex
      .namespace(TEST_NAMESPACE)
      .upsert([
        {
          id: TEST_VECTOR_ID,
          values: testVector,
          metadata: {
            documentId:
              "test-document",
            workspaceId:
              TEST_NAMESPACE,
            uploadedBy:
              "test-user",
            chunkIndex: 0,
            text: "ResearchMind Pinecone connectivity test",
            fileType: "pdf",
          },
        },
      ]);

    console.log(
      "Test vector successfully upserted."
    );

    const stats =
      await pineconeIndex.describeIndexStats();

    console.log(
      "Updated index stats:",
      stats
    );

    await pineconeIndex
      .namespace(TEST_NAMESPACE)
      .deleteOne(TEST_VECTOR_ID);

    console.log(
      "Test vector successfully deleted."
    );

    console.log(
      "Pinecone connectivity test PASSED."
    );
  } catch (error) {
    console.error(
      "Pinecone connectivity test FAILED:",
      error
    );

    process.exit(1);
  }
};

run();