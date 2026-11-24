import { Request, Response } from "express";
import mongoose from "mongoose";

export interface HealthOptions {
  /**
   * Whether Redis being down makes the service unhealthy (503). Default true.
   * ARC-008: ai-service's HTTP API does not use Redis (only its embedding
   * worker does), so its liveness check passes `false`: Redis down then
   * answers 200 with `status: "degraded"` and `redis: "down"`.
   */
  redisRequired?: boolean;
}

export const createHealthHandler = (
  serviceName: string,
  checkRedis?: () => Promise<boolean> | boolean,
  { redisRequired = true }: HealthOptions = {}
) => {
  return async (_req: Request, res: Response) => {
    const mongoConnected = mongoose.connection.readyState === 1;
    let redisConnected = true;

    if (checkRedis) {
      try {
        redisConnected = await checkRedis();
      } catch {
        redisConnected = false;
      }
    }

    const healthy = mongoConnected && (redisConnected || !redisRequired);
    const degraded = healthy && !redisConnected;
    const status = healthy ? 200 : 503;

    res.status(status).json({
      success: healthy,
      service: serviceName,
      status: !healthy ? "unhealthy" : degraded ? "degraded" : "healthy",
      uptime: Math.floor(process.uptime()),
      dependencies: {
        mongo: mongoConnected ? "up" : "down",
        ...(checkRedis ? { redis: redisConnected ? "up" : "down" } : {}),
      },
    });
  };
};
