import express from "express";
import cors from "cors";
import morgan from "morgan";

import healthRoutes from "./routes/health.routes";
import documentRoutes from "./routes/document.routes";
import { errorMiddleware } from "../../../packages/shared/errors/error.middleware";

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

app.use("/health", healthRoutes);
app.use(
  "/api/documents",
  documentRoutes
);

app.use(errorMiddleware);

export default app;