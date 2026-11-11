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
import { connectRedis } from "./config/redis";

const PORT = process.env.PORT || 5001;

const startServer = async () => {
  await connectDB();

  await connectRedis();

  app.listen(PORT, () => {
    console.log(`Auth Service running on port ${PORT}`);
  });
};

startServer();