import { Router } from "express";
import redis from "../config/redis";
import { createHealthHandler } from "../../../../packages/shared/health/healthCheck";

const router = Router();

/**
 * Check whether the AI service and its dependencies are healthy.
 *
 * MongoDB (session persistence) and Redis (embedding worker queue) are both
 * reported; previously MongoDB was not checked at all.
 */
router.get(
  "/",
  createHealthHandler("ai-service", () => redis.status === "ready")
);

export default router;
