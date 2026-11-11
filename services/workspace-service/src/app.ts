import express from "express";

import workspaceRoutes from "./routes/workspace.routes";
import { errorMiddleware } from "../../../packages/shared/errors/error.middleware";
import { createHealthHandler } from "../../../packages/shared/health/healthCheck";

const app = express();

app.use(express.json());

app.use("/api/workspaces", workspaceRoutes);

// Reports 503 while MongoDB is unavailable instead of a static 200.
app.get("/health", createHealthHandler("workspace-service"));

app.use(errorMiddleware);

export default app;