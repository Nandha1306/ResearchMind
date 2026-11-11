import dotenv from "dotenv";
dotenv.config();

import { assertRequiredSecrets } from "../../../packages/shared/config/secrets";

/*
 * The worker serves no HTTP traffic, so it needs no JWT secret -- but it does
 * call document-service's /internal surface, so the shared token is required.
 */
assertRequiredSecrets("ai-service:worker", ["INTERNAL_SERVICE_TOKEN"]);

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