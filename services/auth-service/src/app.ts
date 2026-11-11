import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import authRoutes from "./routes/auth.routes";
import internalRoutes from "./routes/internal.routes";
import { errorMiddleware } from "../../../packages/shared/errors/error.middleware";
import { createHealthHandler } from "../../../packages/shared/health/healthCheck";

const app = express();

app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/internal", internalRoutes);

// Reports 503 while MongoDB is unavailable instead of a static 200.
app.get("/health", createHealthHandler("auth-service"));

app.use(errorMiddleware);

export default app;