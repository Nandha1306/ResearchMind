import dotenv from "dotenv";

dotenv.config();

/*
 * Validate security-critical configuration BEFORE anything else is wired up
 * (secrets, INTERNAL_SERVICE_TOKEN, distinct JWT secrets, token lifetimes;
 * see preflight.ts). Fails closed with the variable NAME only -- never the
 * value. Keep this the first import after dotenv so it runs before app.ts
 * under every loader.
 */
import "./preflight";

import app from "./app";
import { connectDB } from "./config/db";
import { disconnectMongo } from "../../../packages/shared/lifecycle/mongo";
import { registerGracefulShutdown } from "../../../packages/shared/lifecycle/shutdown";
import { startHttpServer } from "../../../packages/shared/lifecycle/listen";

const PORT = process.env.PORT || 5001;

const startServer = async () => {
  await connectDB();

  // auth-service does not use Redis. Its former client was never used by any
  // route and only flooded the log during Redis outages (RT-009), so it was
  // removed.

  // HOST (default 127.0.0.1); exits 1 if the port cannot be bound (SEC-004, RT-002).
  const server = startHttpServer(app, { serviceName: "Auth Service", port: PORT });

  registerGracefulShutdown({
    serviceName: "auth-service",
    server,
    steps: [{ name: "mongodb", close: disconnectMongo }],
  });
};

startServer();