import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import swaggerDocument from "./swagger.json";

import { errorMiddleware } from "../../../packages/shared/errors/error.middleware";
import { createHealthHandler } from "../../../packages/shared/health/healthCheck";

import boardRoutes from "./routes/board.routes";
import taskRoutes from "./routes/task.routes";

const app = express();

const corsOrigin = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true;
app.use(cors({ origin: corsOrigin }));
app.use(helmet());
app.use(express.json());
app.use(morgan("dev"));

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Reports 503 while MongoDB is unavailable instead of a static 200.
app.get("/health", createHealthHandler("task-service"));

app.use("/api/tasks", boardRoutes);
app.use("/api/tasks", taskRoutes);

app.use(errorMiddleware);

export default app;