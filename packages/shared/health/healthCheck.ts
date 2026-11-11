import { Request, Response } from "express";
import mongoose from "mongoose";

export const createHealthHandler = (
  serviceName: string,
  checkRedis?: () => Promise<boolean> | boolean
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

    const healthy = mongoConnected && redisConnected;
    const status = healthy ? 200 : 503;

    res.status(status).json({
      success: healthy,
      service: serviceName,
      uptime: Math.floor(process.uptime()),
      dependencies: {
        mongo: mongoConnected ? "up" : "down",
        ...(checkRedis ? { redis: redisConnected ? "up" : "down" } : {}),
      },
    });
  };
};
