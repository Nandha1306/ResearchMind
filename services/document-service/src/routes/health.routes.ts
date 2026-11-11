import { Router } from "express";
import redis from "../config/redis";
import { createHealthHandler } from "../../../../packages/shared/health/healthCheck";

const router = Router();

/**
 * Health check endpoint.
 *
 * MongoDB and Redis (the embedding queue) are both required for uploads, so
 * either being down reports 503 instead of a static 200.
 */
router.get(
  "/",
  createHealthHandler("document-service", () => redis.status === "ready")
);

export default router;
