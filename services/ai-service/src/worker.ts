import dotenv from "dotenv";
dotenv.config();

import { assertRequiredSecrets } from "../../../packages/shared/config/secrets";

/*
 * The worker serves no HTTP traffic, so it needs no JWT secret -- but it does
 * call document-service's /internal surface, so the shared token is required.
 */
assertRequiredSecrets("ai-service:worker", ["INTERNAL_SERVICE_TOKEN"]);

import redisWorker from "./config/redis-worker";
import { startEmbeddingWorker, stopEmbeddingWorker } from "./workers/embedding.worker";
import { registerGracefulShutdown } from "../../../packages/shared/lifecycle/shutdown";
import { closeRedisClient } from "../../../packages/shared/lifecycle/redis";
import { validateVectorIndexAtStartup } from "./utils/verify-pinecone";

/**
 * Standalone embedding worker process (`npm run dev:worker` / `start:worker`).
 *
 * Note: `npm run dev` already runs a worker inside the AI HTTP service. Running
 * this as well adds a second competing consumer on the same Redis list, which
 * is safe (each job is popped by exactly one consumer) but not required.
 */
const startWorker = async () => {
  registerGracefulShutdown({
    serviceName: "ai-service:worker",
    // Allow an in-progress embedding job (possibly in rate-limit backoff) to finish.
    timeoutMs: 30_000,
    steps: [
      { name: "embedding worker", close: stopEmbeddingWorker },
      { name: "redis (worker)", close: () => closeRedisClient(redisWorker) },
    ],
  });

  // The worker writes vectors: refuse to start against an index whose
  // dimension does not match the configured embedding model.
  try {
    await validateVectorIndexAtStartup();
  } catch (error) {
    console.error("Failed to start embedding worker: vector index check failed:", (error as Error)?.message);
    process.exit(1);
  }

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
