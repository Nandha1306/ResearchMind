import dotenv from "dotenv";
dotenv.config();

import { assertRequiredSecrets } from "../../../packages/shared/config/secrets";

/*
 * Validate security-critical configuration BEFORE anything else is wired up.
 * Fails closed with the variable NAME only -- never the value.
 */
assertRequiredSecrets("task-service", ["JWT_ACCESS_SECRET"]);

import app from "./app";
import { connectDB } from "./config/db";
import { disconnectMongo } from "../../../packages/shared/lifecycle/mongo";
import { registerGracefulShutdown } from "../../../packages/shared/lifecycle/shutdown";

const PORT = process.env.PORT || 5004;

const startServer = async () => {
  await connectDB();

  const server = app.listen(PORT, () => {
    console.log(
      `Task Service running on port ${PORT}`
    );
  });

  registerGracefulShutdown({
    serviceName: "task-service",
    server,
    steps: [{ name: "mongodb", close: disconnectMongo }],
  });
};

startServer();