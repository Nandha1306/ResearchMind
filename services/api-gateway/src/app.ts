import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createProxyMiddleware } from "http-proxy-middleware";
import swaggerUi from "swagger-ui-express";
import swaggerDocument from "./swagger.json";

import {
  apiRateLimiter,
  loginRateLimiter,
  registerRateLimiter,
  aiQueryRateLimiter,
  aiSummarizeRateLimiter,
} from "./middlewares/rate-limit.middleware";
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

const handleProxyError = (err: Error, req: any, res: any) => {
  console.error(`[Gateway Proxy Error] ${req.method} ${req.url}:`, err.message);
  if (!res.headersSent) {
    res.status(503).json({
      success: false,
      message: "Service temporarily unavailable. Please try again.",
    });
  }
};

/*
 * Rate limiting.
 *
 * Ordering matters twice over:
 *   - the strict per-IP auth limiters must sit BEFORE the auth proxy, since
 *     those routes are unauthenticated and there is no user to key on;
 *   - the per-user limiters must sit AFTER `authenticate`, because they key on
 *     req.user.userId, which does not exist until the token is verified.
 *
 * The general limiter is mounted last of the three groups so the tighter,
 * more specific limits get first refusal on their own routes.
 */
app.post("/api/auth/login", loginRateLimiter);
app.post("/api/auth/register", registerRateLimiter);

app.use(
  createProxyMiddleware({
    pathFilter: "/api/auth",
    target: process.env.AUTH_SERVICE_URL || "http://localhost:5001",
    changeOrigin: true,
    on: {
      error: handleProxyError,
    },
  })
);

app.use("/api/workspaces", authenticate, apiRateLimiter);

app.use(
  createProxyMiddleware({
    pathFilter: "/api/workspaces",
    target: process.env.WORKSPACE_SERVICE_URL || "http://localhost:5002",
    changeOrigin: true,
    on: {
      error: handleProxyError,
    },
  })
);

app.use("/api/documents", authenticate, apiRateLimiter);

app.use(
  createProxyMiddleware({
    pathFilter: "/api/documents",
    target: process.env.DOCUMENT_SERVICE_URL || "http://localhost:5003",
    changeOrigin: true,
    on: {
      error: handleProxyError,
    },
  })
);

app.use("/api/tasks", authenticate, apiRateLimiter);

app.use(
  createProxyMiddleware({
    pathFilter: "/api/tasks",
    target: process.env.TASK_SERVICE_URL || "http://localhost:5004",
    changeOrigin: true,
    on: {
      error: handleProxyError,
    },
  })
);

/*
 * AI routes carry a real cost per call (Voyage embeddings + Groq/xAI tokens),
 * so they get their own tighter per-user caps ahead of the general limiter.
 */
app.use("/api/ai", authenticate);
app.post("/api/ai/query", aiQueryRateLimiter);
app.post("/api/ai/search", aiQueryRateLimiter);
app.post("/api/ai/summarize-meeting", aiSummarizeRateLimiter);
app.use("/api/ai", apiRateLimiter);

app.use(
  createProxyMiddleware({
    pathFilter: "/api/ai",
    target: process.env.AI_SERVICE_URL || "http://localhost:5006",
    changeOrigin: true,
    on: {
      error: handleProxyError,
    },
  })
);

app.get("/health", (_, res) => {
  res.json({
    success: true,
    service: "api-gateway",
  });
});

export default app;