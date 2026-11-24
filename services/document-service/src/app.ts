import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import swaggerDocument from "./swagger.json";

import healthRoutes from "./routes/health.routes";
import documentRoutes from "./routes/document.routes";
import internalRoutes from "./routes/internal.routes";
import { errorMiddleware, notFoundHandler } from "../../../packages/shared/errors/error.middleware";
import { ACCESS_LOG_FORMAT } from "../../../packages/shared/http/access-log";

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

app.use("/health", healthRoutes);
app.use(
  "/api/documents",
  documentRoutes
);

/*
 * Service-to-service surface. Mounted at /internal, NOT under /api/documents,
 * so the gateway's "/api/documents" proxy filter can never route to it.
 */
app.use(
  "/internal",
  internalRoutes
);

// ISS-041: unmatched routes get a JSON 404 (after every route).
app.use(notFoundHandler);
app.use(errorMiddleware);

export default app;