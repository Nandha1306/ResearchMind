import dotenv from "dotenv";
dotenv.config();

import { assertRequiredSecrets } from "../../../packages/shared/config/secrets";

/*
 * Validate security-critical configuration BEFORE anything else is wired up.
 * Fails closed with the variable NAME only -- never the value.
 * INTERNAL_SERVICE_TOKEN is required (SEC-018): without it member names could
 * not be loaded from auth-service and the member list silently degraded.
 */
assertRequiredSecrets("workspace-service", ["JWT_ACCESS_SECRET", "INTERNAL_SERVICE_TOKEN"]);

import app from "./app";
import { connectDB } from "./config/db";
import { disconnectMongo } from "../../../packages/shared/lifecycle/mongo";
import { registerGracefulShutdown } from "../../../packages/shared/lifecycle/shutdown";
import { startHttpServer } from "../../../packages/shared/lifecycle/listen";

const PORT = process.env.PORT || 5002;

const startServer = async () => {
  await connectDB();

  // HOST (default 127.0.0.1); exits 1 if the port cannot be bound (SEC-004, RT-002).
  const server = startHttpServer(app, { serviceName: "Workspace Service", port: PORT });

  registerGracefulShutdown({
    serviceName: "workspace-service",
    server,
    steps: [{ name: "mongodb", close: disconnectMongo }],
  });
};

startServer();