import express from "express";

import workspaceRoutes from "./routes/workspace.routes";

const app = express();

app.use(express.json());

app.use("/api/workspaces", workspaceRoutes);

app.get("/health", (_, res) => {
  res.json({
    success: true,
    service: "workspace-service",
  });
});

export default app;