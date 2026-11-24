import express from "express";

import workspaceRoutes from "./routes/workspace.routes";
import { errorMiddleware, notFoundHandler } from "../../../packages/shared/errors/error.middleware";
import { createHealthHandler } from "../../../packages/shared/health/healthCheck";

const app = express();

// SEC-017: no "X-Powered-By: Express" fingerprint (this service has no helmet;
// the gateway's helmet adds the browser-facing headers).
app.disable("x-powered-by");

app.use(express.json());

app.use("/api/workspaces", workspaceRoutes);

// Reports 503 while MongoDB is unavailable instead of a static 200.
app.get("/health", createHealthHandler("workspace-service"));

// ISS-041: unmatched routes get a JSON 404 (after every route).
app.use(notFoundHandler);
app.use(errorMiddleware);

export default app;