import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createProxyMiddleware } from "http-proxy-middleware";
import swaggerUi from "swagger-ui-express";
import swaggerDocument from "./swagger.json";

import {
  apiRateLimiter,
  loginRateLimiter,
  registerRateLimiter,
  aiQueryRateLimiter,
  aiSummarizeRateLimiter,
  authApiRateLimiter,
  rateLimitRedis,
} from "./middlewares/rate-limit.middleware";
import { corsOriginAllowed } from "../../../packages/shared/http/cors-origins";
import { authenticate } from "./middlewares/auth.middleware";
import { rejectNonCanonicalPaths, underPrefix } from "./middlewares/path-guard.middleware";
import { assignRequestId } from "./middlewares/request-id.middleware";
import { ACCESS_LOG_FORMAT } from "../../../packages/shared/http/access-log";
import { readGatewayConfig } from "./config/gateway-config";
import { readBoundedIntEnv } from "../../../packages/shared/config/bounded-env";
import { notFoundHandler } from "../../../packages/shared/errors/error.middleware";

const app = express();

/*
 * TRUST_PROXY (RT-008): off by default. Set a hop count or the proxy
 * addresses when the gateway runs behind a reverse proxy, so the per-IP
 * limiters see the real client. `true` is refused (spoofable). An invalid
 * value stops the gateway at startup (variable name and rule only).
 */
/*
 * server.ts validates TRUST_PROXY and CORS_ORIGIN first and exits with one
 * clean line (W6-SEC-01). This module keeps its own fail-closed check, so an
 * app imported directly (tests, tooling) can never run with an invalid value.
 */
const gatewayConfig = readGatewayConfig(process.env);
if (!gatewayConfig.ok) {
  throw new Error(gatewayConfig.message);
}
try {
  app.set("trust proxy", gatewayConfig.config.trustProxy);
} catch {
  throw new Error("TRUST_PROXY could not be compiled by Express; use a hop count (1-10) or IP addresses/CIDRs");
}

/*
 * CORS_ORIGIN (SEC-015): unset = any loopback http origin (local dev and
 * preview on whatever port Vite picks); set = exactly those origins.
 * "*" or a malformed entry stops the gateway at startup (variable name only).
 */
const corsSetting = gatewayConfig.config.cors;
if (corsSetting.loopbackDefault) {
  console.log("[api-gateway] CORS_ORIGIN is not set: allowing loopback origins only (local development default)");
}
const isAllowedOrigin = corsOriginAllowed(corsSetting);

/** SEC-016: Swagger UI only when API_DOCS_ENABLED=true (off by default). */
const API_DOCS_ENABLED = process.env.API_DOCS_ENABLED === "true";

/**
 * Idle limit for a proxied request (RT-003): if the upstream sends nothing
 * for this long, the gateway answers 504 instead of waiting forever. It is an
 * idle (not total) limit, so a long SSE answer with heartbeats stays open.
 */
const UPSTREAM_IDLE_TIMEOUT_MS = readBoundedIntEnv("GATEWAY_UPSTREAM_IDLE_TIMEOUT_MS", 120_000, 1_000, 600_000);

// FIRST: every later middleware, limiter and proxy must see one canonical
// path. Non-canonical paths (`//`, `\`, dot segments, encoded `/` `\` `.` ...)
// are rejected with 400 before anything else runs (SEC-003).
app.use(rejectNonCanonicalPaths);

// Request id (ISS-044): kept if valid, generated otherwise; forwarded
// upstream, echoed back and logged.
app.use(assignRequestId);

// SEC-015: an allow-list, never "*"; a disallowed origin gets no CORS headers.
app.use(cors({ origin: (origin, callback) => callback(null, isAllowedOrigin(origin)) }));
// Helmet's default Content-Security-Policy (SEC-008). Swagger UI serves its
// scripts as files, so /api-docs works under it.
app.use(helmet());
app.use(morgan(ACCESS_LOG_FORMAT));

if (API_DOCS_ENABLED) {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}

const handleProxyError = (err: Error, req: any, res: any) => {
  const timedOut = Boolean(req.upstreamTimedOut);
  console.error(
    `[Gateway Proxy Error] ${req.method} ${req.url} rid=${req.headers?.["x-request-id"] ?? "-"}:`,
    timedOut ? "upstream idle timeout" : err.message
  );
  if (!res.headersSent) {
    if (timedOut) {
      res.status(504).json({
        success: false,
        message: "The service took too long to respond. Please try again.",
      });
      return;
    }
    res.status(503).json({
      success: false,
      message: "Service temporarily unavailable. Please try again.",
    });
    return;
  }
  // The upstream failed after the response started (e.g. ai-service died
  // mid-way through an SSE answer). End the client response so the client
  // sees the stream close without a terminal event -- and reports the answer
  // as incomplete -- instead of waiting on a connection that will never finish.
  if (!res.writableEnded) {
    res.end();
  }
};

/** RT-003: abort a proxied request whose upstream stays silent too long. */
const applyUpstreamIdleTimeout = (proxyReq: any, req: any) => {
  proxyReq.setTimeout(UPSTREAM_IDLE_TIMEOUT_MS, () => {
    req.upstreamTimedOut = true;
    proxyReq.destroy(new Error("upstream idle timeout"));
  });
};

/**
 * When ai-service dies part-way through a streamed (SSE) answer, the proxy
 * stops piping but never ends the client response, so the browser waits on a
 * connection that will not finish. End it as soon as the upstream response
 * closes incomplete: the client then sees the stream end without a terminal
 * event and reports the answer as incomplete (P1-A21).
 */
const endClientResponseIfUpstreamAborts = (proxyRes: any, _req: any, res: any) => {
  proxyRes.on("close", () => {
    if (!proxyRes.complete && !res.writableEnded) {
      res.end();
    }
  });
};

/**
 * SEC-017: drop upstream fingerprinting headers (Express's X-Powered-By).
 * helmet removes the gateway's own, but the proxy copies upstream headers.
 */
const stripUpstreamFingerprint = (proxyRes: any) => {
  delete proxyRes.headers["x-powered-by"];
};

/**
 * W6-SEC-03: headers a client must never be able to hand to a service.
 * x-internal-token is the service-to-service credential; the forwarding
 * headers would be client-chosen (the gateway sets none of them itself:
 * xfwd is off, and req.ip / TRUST_PROXY are evaluated on the incoming request
 * before this runs). The validated x-request-id is kept.
 */
const CLIENT_HEADERS_NEVER_FORWARDED = [
  "x-internal-token",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "forwarded",
];

const stripClientInternalHeaders = (proxyReq: any) => {
  for (const name of CLIENT_HEADERS_NEVER_FORWARDED) proxyReq.removeHeader(name);
};

/** One proxy per service prefix, all with the same error and timeout handling. */
const proxyTo = (
  prefix: string,
  target: string,
  { proxyRes: extraProxyRes }: { proxyRes?: (proxyRes: any, req: any, res: any) => void } = {}
) =>
  createProxyMiddleware({
    pathFilter: underPrefix(prefix),
    target,
    changeOrigin: true,
    on: {
      error: handleProxyError,
      // Composed for every proxy, the AI/SSE one included.
      proxyReq: (proxyReq: any, req: any) => {
        stripClientInternalHeaders(proxyReq);
        applyUpstreamIdleTimeout(proxyReq, req);
      },
      // Composed, not replaced: every upstream is stripped, and the AI proxy
      // keeps its stream-abort handler (P1-A21).
      proxyRes: (proxyRes: any, req: any, res: any) => {
        stripUpstreamFingerprint(proxyRes);
        extraProxyRes?.(proxyRes, req, res);
      },
    },
  });

/*
 * Rate limiting.
 *
 * Ordering matters twice over:
 *   - the strict per-IP auth limiters must sit BEFORE the auth proxy, since
 *     those routes are unauthenticated and there is no user to key on;
 *   - the per-user limiters must sit AFTER `authenticate`, because they key on
 *     req.user.userId, which does not exist until the token is verified.
 *
 * The general limiter is mounted last of the three groups so the tighter,
 * more specific limits get first refusal on their own routes.
 */
app.post("/api/auth/login", loginRateLimiter);
app.post("/api/auth/register", registerRateLimiter);
// SEC-021: refresh, /me and /logout (and every other auth route) share a
// per-IP 60/min bucket. Behind a reverse proxy TRUST_PROXY must be set, or
// every user shares the proxy's bucket.
app.use("/api/auth", authApiRateLimiter);

app.use(proxyTo("/api/auth", process.env.AUTH_SERVICE_URL || "http://localhost:5001"));

app.use("/api/workspaces", authenticate, apiRateLimiter);
app.use(proxyTo("/api/workspaces", process.env.WORKSPACE_SERVICE_URL || "http://localhost:5002"));

app.use("/api/documents", authenticate, apiRateLimiter);
app.use(proxyTo("/api/documents", process.env.DOCUMENT_SERVICE_URL || "http://localhost:5003"));

app.use("/api/tasks", authenticate, apiRateLimiter);
app.use(proxyTo("/api/tasks", process.env.TASK_SERVICE_URL || "http://localhost:5004"));

/*
 * AI routes carry a real cost per call (Voyage embeddings + Groq/xAI tokens),
 * so they get their own tighter per-user caps ahead of the general limiter.
 */
app.use("/api/ai", authenticate);
app.post("/api/ai/query", aiQueryRateLimiter);
app.post("/api/ai/search", aiQueryRateLimiter);
app.post("/api/ai/summarize-meeting", aiSummarizeRateLimiter);
app.use("/api/ai", apiRateLimiter);

app.use(
  proxyTo("/api/ai", process.env.AI_SERVICE_URL || "http://localhost:5006", {
    proxyRes: endClientResponseIfUpstreamAborts,
  })
);

/*
 * Liveness (ISS-044): always 200 -- the gateway serves traffic while the
 * rate-limit store is down (fail-open policy, RT-001) -- but the body now
 * reports it: status "degraded" and dependencies.rateLimitStore "down".
 */
app.get("/health", (_, res) => {
  const rateLimitStore = rateLimitRedis.status === "ready" ? "up" : "down";
  res.json({
    success: true,
    service: "api-gateway",
    status: rateLimitStore === "up" ? "healthy" : "degraded",
    dependencies: { rateLimitStore },
  });
});

/*
 * ISS-041: anything no proxy, /health or /api-docs handled gets the JSON
 * error envelope instead of Express's HTML page. Must stay the LAST app.use:
 * mounted before a proxy it would swallow that proxy's routes.
 */
app.use(notFoundHandler);

export default app;
