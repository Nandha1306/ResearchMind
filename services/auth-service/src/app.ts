import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import authRoutes from "./routes/auth.routes";
import internalRoutes from "./routes/internal.routes";
import { errorMiddleware, notFoundHandler } from "../../../packages/shared/errors/error.middleware";
import { ACCESS_LOG_FORMAT } from "../../../packages/shared/http/access-log";
import { createHealthHandler } from "../../../packages/shared/health/healthCheck";

const app = express();

// SEC-015: no CORS here. Browsers only call the gateway (which applies the
// CORS_ORIGIN allow-list); this service listens on 127.0.0.1 by default.
app.use(helmet());
app.use(morgan(ACCESS_LOG_FORMAT));
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/internal", internalRoutes);

// Reports 503 while MongoDB is unavailable instead of a static 200.
app.get("/health", createHealthHandler("auth-service"));

// ISS-041: unmatched routes get a JSON 404 (after every route).
app.use(notFoundHandler);
app.use(errorMiddleware);

export default app;