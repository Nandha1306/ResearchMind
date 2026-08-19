import express from "express";
import cors from "cors";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import swaggerDocument from "./swagger.json";

import { errorMiddleware } from "../../../packages/shared/errors/error.middleware";

import boardRoutes from "./routes/board.routes";
import taskRoutes from "./routes/task.routes";

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use("/api/tasks", boardRoutes);
app.use("/api/tasks", taskRoutes);

app.use(errorMiddleware);

export default app;