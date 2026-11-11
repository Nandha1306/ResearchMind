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
import { connectDB } from "./config/db";
import { startEmbeddingWorker } from "./workers/embedding.worker";

const PORT = process.env.PORT || 5006;

/** Start the AI service HTTP server after connecting DB and verifying Redis. */
const startServer = async () => {
  try {
    await connectDB();
    await redis.ping();

    // Start background embedding worker for vector queue processing
    startEmbeddingWorker().catch((error) => {
      console.error("Embedding background worker error:", error);
    });

    app.listen(PORT, () => {
      console.log(`AI Service running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start AI Service:", error);
    process.exit(1);
  }
};

startServer();