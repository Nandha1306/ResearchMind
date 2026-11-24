import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import healthRoutes from "./routes/health.routes";
import aiRoutes from "./routes/ai.routes";
import internalRoutes from "./routes/internal.routes";
import { errorMiddleware, notFoundHandler } from "../../../packages/shared/errors/error.middleware";
import { ACCESS_LOG_FORMAT } from "../../../packages/shared/http/access-log";

const app = express();

// SEC-015: no CORS here. Browsers only call the gateway (which applies the
// CORS_ORIGIN allow-list); this service listens on 127.0.0.1 by default.
app.use(helmet());
/*
 * REQ-082: meeting notes may hold 50,000 characters of any script. As JSON
 * that is up to ~150 KB (3-byte UTF-8) or ~300 KB (characters JSON escapes as
 * \uXXXX), over the 100 KB default; 320 KB makes the schema's 50,000-character
 * limit the binding one. Only this route; every other route keeps 100 KB (the
 * global parser below skips a body that was already read).
 */
app.use("/api/ai/summarize-meeting", express.json({ limit: "320kb" }));
app.use(express.json());
app.use(morgan(ACCESS_LOG_FORMAT));

app.use("/health", healthRoutes);
app.use("/api/ai", aiRoutes);
// Service-to-service only (not proxied by the gateway; shared-token auth).
app.use("/internal", internalRoutes);

// ISS-041: unmatched routes get a JSON 404 (after every route).
app.use(notFoundHandler);
app.use(errorMiddleware);

export default app;