import dotenv from "dotenv";
dotenv.config();

import { assertRequiredSecrets } from "../../../packages/shared/config/secrets";

/*
 * Validate security-critical configuration BEFORE anything else is wired up.
 * Fails closed with the variable NAME only -- never the value.
 */
assertRequiredSecrets("api-gateway", ["JWT_ACCESS_SECRET"]);

import app from "./app";
import { rateLimitRedis } from "./middlewares/rate-limit.middleware";
import { registerGracefulShutdown } from "../../../packages/shared/lifecycle/shutdown";
import { closeRedisClient } from "../../../packages/shared/lifecycle/redis";

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});

registerGracefulShutdown({
  serviceName: "api-gateway",
  server,
  steps: [{ name: "redis (rate limiter)", close: () => closeRedisClient(rateLimitRedis) }],
});