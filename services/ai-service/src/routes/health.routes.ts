import { Router } from "express";
import redis from "../config/redis";

const router = Router();

/** Check whether the AI service and Redis connection are healthy. */
router.get("/", async (_req, res) => {
  try {
    const redisStatus = await redis.ping();

    return res.status(200).json({
      success: true,
      service: "ai-service",
      status: "healthy",
      redis: redisStatus === "PONG" ? "connected" : "unhealthy",
    });
  } catch {
    return res.status(503).json({
      success: false,
      service: "ai-service",
      status: "unhealthy",
      redis: "disconnected",
    });
  }
});

export default router;