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
import { startHttpServer } from "../../../packages/shared/lifecycle/listen";
import { closeRedisClient } from "../../../packages/shared/lifecycle/redis";
import { sweepUploadTmpDir } from "./utils/upload-tmp";
import { UPLOAD_TMP_DIR } from "./middlewares/upload.middleware";

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

  // SEC-024 (a): remove upload temp files left behind by a crash (only this
  // service's own temp files older than 1 h, in UPLOAD_TMP_DIR; see upload-tmp.ts).
  void sweepUploadTmpDir(UPLOAD_TMP_DIR, {
    log: (message) => logger.info(message),
    warn: (message) => logger.warn(message),
  });

  // HOST (default 127.0.0.1); exits 1 if the port cannot be bound (SEC-004, RT-002).
  const server = startHttpServer(app, {
    serviceName: "Document Service",
    port: PORT,
    log: (message) => logger.info(message),
    logError: (message) => logger.error(message),
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