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
// Disable helmet's Content Security Policy (CSP) for swagger docs if needed, or configure helmet properly.
// Swagger UI uses inline styles and scripts, which helmet blocks by default.
// Let's configure helmet to allow or disable CSP, or just let helmet exclude /api-docs, or disable CSP for helmet.
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(morgan("dev"));

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use(apiRateLimiter);

app.use(
  createProxyMiddleware({
    pathFilter: "/api/auth",
    target: process.env.AUTH_SERVICE_URL,
    changeOrigin: true,
  })
);

app.use(
  "/api/workspaces",
  authenticate
);

app.use(
  createProxyMiddleware({
    pathFilter: "/api/workspaces",
    target: process.env.WORKSPACE_SERVICE_URL,
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