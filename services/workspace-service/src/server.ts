import dotenv from "dotenv";
dotenv.config();

import { assertRequiredSecrets } from "../../../packages/shared/config/secrets";

/*
 * Validate security-critical configuration BEFORE anything else is wired up.
 * Fails closed with the variable NAME only -- never the value.
 */
assertRequiredSecrets("workspace-service", ["JWT_ACCESS_SECRET"]);

import app from "./app";
import { connectDB } from "./config/db";

const PORT = process.env.PORT || 5002;

const startServer = async () => {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`Workspace Service running on port ${PORT}`);
  });
};

startServer();