import dotenv from "dotenv";
dotenv.config();

/*
 * Validate security-critical configuration BEFORE anything else is wired up:
 * JWT_ACCESS_SECRET, TRUST_PROXY and CORS_ORIGIN (see preflight.ts). Fails
 * closed with the variable NAME only -- never the value. Keep this the first
 * import after dotenv so it runs before app.ts under every loader.
 */
import "./preflight";

import app from "./app";
import { rateLimitRedis } from "./middlewares/rate-limit.middleware";
import { registerGracefulShutdown } from "../../../packages/shared/lifecycle/shutdown";
import { startHttpServer } from "../../../packages/shared/lifecycle/listen";
import { closeRedisClient } from "../../../packages/shared/lifecycle/redis";

const PORT = process.env.PORT || 5000;

// The gateway is the public entry point: it listens on all interfaces unless
// HOST is set. Exits 1 if the port cannot be bound (RT-002).
const server = startHttpServer(app, { serviceName: "API Gateway", port: PORT, defaultHost: "0.0.0.0" });

registerGracefulShutdown({
  serviceName: "api-gateway",
  server,
  steps: [{ name: "redis (rate limiter)", close: () => closeRedisClient(rateLimitRedis) }],
});
