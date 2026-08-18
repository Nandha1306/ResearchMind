import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createProxyMiddleware } from "http-proxy-middleware";
import swaggerUi from "swagger-ui-express";
import swaggerDocument from "./swagger.json";

import { apiRateLimiter } from "./middlewares/rate-limit.middleware";
import { authenticate } from "./middlewares/auth.middleware";

const app = express();

app.use(cors());
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(morgan("dev"));

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use(apiRateLimiter);

app.use(
  createProxyMiddleware({
    pathFilter: "/api/auth",
    target: process.env.AUTH_SERVICE_URL || "http://localhost:5001",
    changeOrigin: true,
  })
);

app.use("/api/workspaces", authenticate);

app.use(
  createProxyMiddleware({
    pathFilter: "/api/workspaces",
    target: process.env.WORKSPACE_SERVICE_URL || "http://localhost:5002",
    changeOrigin: true,
  })
);

app.use("/api/documents", authenticate);

app.use(
  createProxyMiddleware({
    pathFilter: "/api/documents",
    target: process.env.DOCUMENT_SERVICE_URL || "http://localhost:5003",
    changeOrigin: true,
  })
);

app.use("/api/ai", authenticate);

app.use(
  createProxyMiddleware({
    pathFilter: "/api/ai",
    target: process.env.AI_SERVICE_URL || "http://localhost:5006",
    changeOrigin: true,
  })
);

app.get("/health", (_, res) => {
  res.json({
    success: true,
    service: "api-gateway",
  });
});

export default app;