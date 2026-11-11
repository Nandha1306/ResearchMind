import dotenv from "dotenv";
dotenv.config();

import { assertRequiredSecrets } from "../../../packages/shared/config/secrets";

/*
 * Validate security-critical configuration BEFORE anything else is wired up.
 * Fails closed with the variable NAME only -- never the value.
 */
assertRequiredSecrets("document-service", ["JWT_ACCESS_SECRET", "INTERNAL_SERVICE_TOKEN"]);

import app from "./app";
import { connectDB } from "./config/db";
import logger from "./utils/logger";
import { recoverEmbeddingWork } from "./services/document.service";
import redis from "./config/redis";
import { disconnectMongo } from "../../../packages/shared/lifecycle/mongo";
import { registerGracefulShutdown } from "../../../packages/shared/lifecycle/shutdown";
import { closeRedisClient } from "../../../packages/shared/lifecycle/redis";

const PORT =
  process.env.PORT || 5003;

const RECOVERY_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Start document service. */
const startServer = async () => {
  await connectDB();

  /*
   * Embedding recovery sweep: re-queues work lost to worker crashes or queue
   * loss (bounded retries), and finishes interrupted deletions. Replaces the
   * old startup resync, which re-queued every pending/failed document on each
   * restart with no dedupe or retry limit. Runs at startup and periodically;
   * a run never overlaps the previous one.
   */
  let sweepRunning = false;
  const runSweep = async () => {
    if (sweepRunning) return;
    sweepRunning = true;
    try {
      await recoverEmbeddingWork();
    } catch (error) {
      logger.error(`Embedding recovery sweep failed: ${(error as Error)?.message}`);
    } finally {
      sweepRunning = false;
    }
  };
  void runSweep();
  const sweepTimer = setInterval(() => void runSweep(), RECOVERY_SWEEP_INTERVAL_MS);

  const server = app.listen(PORT, () => {
    logger.info(
      `Document Service running on port ${PORT}`
    );
  });

  registerGracefulShutdown({
    serviceName: "document-service",
    server,
    steps: [
      { name: "recovery sweep timer", close: () => clearInterval(sweepTimer) },
      { name: "mongodb", close: disconnectMongo },
      { name: "redis", close: () => closeRedisClient(redis) },
    ],
  });
};

startServer();