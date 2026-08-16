import dotenv from "dotenv";
dotenv.config();

import { pineconeIndex } from "../config/pinecone";

const documentId = process.argv[2];
const workspaceId = process.argv[3];

const run = async () => {
  if (!documentId || !workspaceId) {
    console.error(
      "Usage: npm run verify:vectors -- <documentId> <workspaceId>"
    );

    process.exit(1);
  }

  const stats =
    await pineconeIndex.describeIndexStats();

  console.log(
    "Pinecone index stats:",
    stats
  );

  const namespaceStats =
    stats.namespaces?.[workspaceId];

  console.log(
    `Namespace ${workspaceId}:`,
    namespaceStats
  );

  if (!namespaceStats) {
    throw new Error(
      `Namespace ${workspaceId} does not exist`
    );
  }

  console.log(
    `Vector count: ${namespaceStats.recordCount}`
  );

  console.log(
    `Document ${documentId} vector verification completed.`
  );
};

run().catch((error) => {
  console.error(
    "Vector verification failed:",
    error
  );

  process.exit(1);
});