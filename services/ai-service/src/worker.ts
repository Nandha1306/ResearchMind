import dotenv from "dotenv";
dotenv.config();

import { startEmbeddingWorker } from "./workers/embedding.worker";

/** Start the AI embedding worker process. */
const startWorker = async () => {
  try {
    await startEmbeddingWorker();
  } catch (error) {
    console.error(
      "Failed to start embedding worker:",
      error
    );

    process.exit(1);
  }
};

startWorker();