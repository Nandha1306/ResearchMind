import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import healthRoutes from "./routes/health.routes";
import aiRoutes from "./routes/ai.routes";
import { errorMiddleware } from "../../../packages/shared/errors/error.middleware";

const app = express();

app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(morgan("dev"));

app.use("/health", healthRoutes);
app.use("/api/ai", aiRoutes);

app.use(errorMiddleware);

export default app;