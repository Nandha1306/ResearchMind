import dotenv from "dotenv";

dotenv.config();

import { assertRequiredSecrets } from "../../../packages/shared/config/secrets";

/*
 * Validate security-critical configuration BEFORE anything else is wired up.
 * Fails closed with the variable NAME only -- never the value.
 */
assertRequiredSecrets("auth-service", ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"]);

import app from "./app";
import { connectDB } from "./config/db";
import { connectRedis, closeRedis } from "./config/redis";
import { disconnectMongo } from "../../../packages/shared/lifecycle/mongo";
import { registerGracefulShutdown } from "../../../packages/shared/lifecycle/shutdown";

const PORT = process.env.PORT || 5001;

const startServer = async () => {
  await connectDB();

  // No auth-service route uses Redis today, so it must not block startup:
  // node-redis's connect() waits (retrying) until Redis is reachable, which
  // left the service unable to listen whenever Redis was down. The client
  // connects in the background and logs its own success or failure.
  void connectRedis();

  const server = app.listen(PORT, () => {
    console.log(`Auth Service running on port ${PORT}`);
  });

  registerGracefulShutdown({
    serviceName: "auth-service",
    server,
    steps: [
      { name: "mongodb", close: disconnectMongo },
      { name: "redis", close: closeRedis },
    ],
  });
};

startServer();