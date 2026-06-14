import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import authRoutes from "./routes/auth.routes";
import { errorMiddleware } from "../../../packages/shared/errors/error.middleware";


const app = express();

app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());

app.use("/api/auth", authRoutes);

app.get("/health", (_, res) => {
  res.status(200).json({
    success: true,
    service: "auth-service",
  });
});

app.use(errorMiddleware);

export default app;