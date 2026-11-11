import dotenv from "dotenv";
dotenv.config();

import { assertRequiredSecrets } from "../../../packages/shared/config/secrets";

/*
 * Validate security-critical configuration BEFORE anything else is wired up.
 * Fails closed with the variable NAME only -- never the value.
 */
assertRequiredSecrets("ai-service", ["JWT_ACCESS_SECRET", "INTERNAL_SERVICE_TOKEN"]);

import app from "./app";
import redis from "./config/redis";
import redisWorker from "./config/redis-worker";
import { connectDB } from "./config/db";
import { startEmbeddingWorker, stopEmbeddingWorker } from "./workers/embedding.worker";
import { disconnectMongo } from "../../../packages/shared/lifecycle/mongo";
import { registerGracefulShutdown } from "../../../packages/shared/lifecycle/shutdown";
import { closeRedisClient } from "../../../packages/shared/lifecycle/redis";

const PORT = process.env.PORT || 5006;

/**
 * Start the AI service.
 *
 * MongoDB is required (Q&A sessions are persisted), so a connection failure
 * stops startup. Redis is only needed by the in-process embedding worker, not
 * by the HTTP routes, so a Redis outage no longer aborts startup: the worker
 * waits for Redis to come back (its client reconnects indefinitely) and
 * /health reports Redis as down meanwhile.
 */
const startServer = async () => {
  try {
    await connectDB();
  } catch (error) {
    console.error("Failed to start AI Service:", (error as Error)?.message);
    process.exit(1);
  }

  try {
    await redis.ping();
  } catch (error) {
    console.warn(
      "AI Service: Redis is not reachable at startup; the embedding worker will wait for it:",
      (error as Error)?.message
    );
  }

  // Start background embedding worker for vector queue processing
  startEmbeddingWorker().catch((error) => {
    console.error("Embedding background worker error:", error);
  });

  const server = app.listen(PORT, () => {
    console.log(`AI Service running on port ${PORT}`);
  });

  registerGracefulShutdown({
    serviceName: "ai-service",
    server,
    // An embedding job in progress may legitimately take tens of seconds
    // (Voyage rate-limit backoff), so allow longer than the 10 s default.
    // Supervisors (e.g. `docker stop -t`) must allow at least this long.
    timeoutMs: 30_000,
    steps: [
      // Let the job in progress finish before closing its connections.
      { name: "embedding worker", close: stopEmbeddingWorker },
      { name: "mongodb", close: disconnectMongo },
      { name: "redis", close: () => closeRedisClient(redis) },
      { name: "redis (worker)", close: () => closeRedisClient(redisWorker) },
    ],
  });
};

startServer();
