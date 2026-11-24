import { Router } from "express";
import redis from "../config/redis";
import { createHealthHandler } from "../../../../packages/shared/health/healthCheck";

const router = Router();

const redisReady = () => redis.status === "ready";

/**
 * GET /health -- liveness (ARC-008). The HTTP API (Q&A, search, summaries,
 * history) needs MongoDB but not Redis: with Redis down it answers 200
 * `status: "degraded"`, `redis: "down"`, so an orchestrator does not restart
 * a working API during a Redis blip. MongoDB down is still 503.
 */
router.get("/", createHealthHandler("ai-service", redisReady, { redisRequired: false }));

/**
 * GET /health/ready -- strict readiness: 503 unless MongoDB AND Redis are up
 * (the embedding worker consumes its queue from Redis). Monitors that should
 * alert on the worker use this one.
 */
router.get("/ready", createHealthHandler("ai-service", redisReady));

export default router;
