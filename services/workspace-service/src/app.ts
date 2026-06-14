import express from "express";

import workspaceRoutes from "./routes/workspace.routes";
import { errorMiddleware } from "../../../packages/shared/errors/error.middleware";

const app = express();

app.use(express.json());

app.use("/api/workspaces", workspaceRoutes);

app.get("/health", (_, res) => {
  res.json({
    success: true,
    service: "workspace-service",
  });
});

app.use(errorMiddleware);

export default app;