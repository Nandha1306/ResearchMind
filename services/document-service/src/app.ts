import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import swaggerDocument from "./swagger.json";

import healthRoutes from "./routes/health.routes";
import documentRoutes from "./routes/document.routes";
import internalRoutes from "./routes/internal.routes";
import { errorMiddleware } from "../../../packages/shared/errors/error.middleware";

const app = express();

const corsOrigin = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true;
app.use(cors({ origin: corsOrigin }));
app.use(helmet());
app.use(express.json());
app.use(morgan("dev"));

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

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

app.use(errorMiddleware);

export default app;