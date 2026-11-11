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
import { syncPendingDocuments } from "./services/document.service";
import redis from "./config/redis";
import { disconnectMongo } from "../../../packages/shared/lifecycle/mongo";
import { registerGracefulShutdown } from "../../../packages/shared/lifecycle/shutdown";
import { closeRedisClient } from "../../../packages/shared/lifecycle/redis";

const PORT =
  process.env.PORT || 5003;

/** Start document service. */
const startServer = async () => {
  await connectDB();

  // Re-enqueue un-indexed pending/failed documents to Redis queue
  syncPendingDocuments();

  const server = app.listen(PORT, () => {
    logger.info(
      `Document Service running on port ${PORT}`
    );
  });

  registerGracefulShutdown({
    serviceName: "document-service",
    server,
    steps: [
      { name: "mongodb", close: disconnectMongo },
      { name: "redis", close: () => closeRedisClient(redis) },
    ],
  });
};

startServer();