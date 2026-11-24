import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import swaggerDocument from "./swagger.json";

import { errorMiddleware, notFoundHandler } from "../../../packages/shared/errors/error.middleware";
import { ACCESS_LOG_FORMAT } from "../../../packages/shared/http/access-log";
import { createHealthHandler } from "../../../packages/shared/health/healthCheck";

import boardRoutes from "./routes/board.routes";
import taskRoutes from "./routes/task.routes";
import internalRoutes from "./routes/internal.routes";

const app = express();

// SEC-015: no CORS here (it used to reflect ANY origin when CORS_ORIGIN was
// unset). Browsers only call the gateway, which applies the allow-list.
app.use(helmet());
app.use(express.json());
app.use(morgan(ACCESS_LOG_FORMAT));

// SEC-016: Swagger UI only when API_DOCS_ENABLED=true (off by default).
if (process.env.API_DOCS_ENABLED === "true") {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}

// Reports 503 while MongoDB is unavailable instead of a static 200.
app.get("/health", createHealthHandler("task-service"));

app.use("/api/tasks", boardRoutes);
app.use("/api/tasks", taskRoutes);

// Service-to-service surface (shared secret); never proxied by the gateway.
app.use("/internal", internalRoutes);

// ISS-041: unmatched routes get a JSON 404 (after every route).
app.use(notFoundHandler);
app.use(errorMiddleware);

export default app;