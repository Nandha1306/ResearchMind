import http from "node:http";
import net from "node:net";
import express from "express";
import { listen } from "./test-env";

/**
 * Helpers for tests that run the REAL api-gateway app.
 *
 * Path-variant requests must be sent with http.request or a raw socket:
 * fetch/WHATWG URL normalises `.`/`..` segments and backslashes before
 * sending, so it would test nothing.
 */

/**
 * Every non-canonical form of `route` (a canonical /api/<group>/<tail> path)
 * that the SEC-003 guard must reject: repeated slashes, dot segments, encoded
 * `/` `\` `.` and unreserved characters, NUL, malformed escapes, backslashes.
 */
export const variantsOf = (route: string) => {
  const [, api, group, ...rest] = route.split("/");
  const tail = rest.join("/");
  const lastChar = tail.charCodeAt(tail.length - 1).toString(16);
  return [
    // repeated slashes
    `/${api}/${group}//${tail}`,
    `/${api}/${group}///${tail}`,
    `//${api}/${group}/${tail}`,
    `/${api}//${group}/${tail}`,
    `${route}//`,
    // dot segments
    `/${api}/${group}/./${tail}`,
    `/${api}/./${group}/${tail}`,
    `/${api}/${group}/x/../${tail}`,
    `${route}/.`,
    `${route}/..`,
    `/${api}/x/../${group}/${tail}`,
    // encoded
    `/${api}/${group}/%2F${tail}`,
    `/${api}/${group}/%2f${tail}`,
    `/${api}/${group}%2F${tail}`,
    `/${api}/${group}/%2e/${tail}`,
    `/${api}/${group}/%2E%2E/${group}/${tail}`,
    `/${api}/${group}/${tail.slice(0, -1)}%${lastChar}`,
    `${route}%2F`,
    `/${api}/${group}/%5C${tail}`,
    `/${api}/${group}/%5c${tail}`,
    `${route}%00`,
    `${route}%zz`,
    // backslash
    `/${api}/${group}\\${tail}`,
    `/${api}\\${group}\\${tail}`,
  ];
};

export type RawResponse ={ status: number; body: string; ms: number };

/** Send one request with the path exactly as given (no client-side normalisation). */
export const rawRequest = (
  port: number,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}
): Promise<RawResponse> =>
  new Promise((resolve, reject) => {
    const started = performance.now();
    const body = options.body ?? (method === "GET" ? undefined : "{}");
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        agent: false,
        headers: {
          ...(body !== undefined
            ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) }
            : {}),
          ...options.headers,
        },
        timeout: options.timeoutMs ?? 5000,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text, ms: performance.now() - started }));
      }
    );
    req.on("timeout", () => req.destroy(new Error(`request to ${path} timed out`)));
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });

/** Send raw bytes as the request head (for request targets http.request refuses). */
export const rawSocketRequest = (port: number, head: string): Promise<{ status: number; raw: string }> =>
  new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(head));
    let raw = "";
    socket.setEncoding("latin1");
    socket.setTimeout(5000, () => socket.destroy(new Error("raw request timed out")));
    socket.on("data", (chunk) => (raw += chunk));
    socket.on("error", reject);
    socket.on("close", () => {
      const match = /^HTTP\/1\.[01] (\d{3})/.exec(raw);
      resolve({ status: match ? Number(match[1]) : 0, raw });
    });
  });

export type UpstreamHit = { route: string; rawUrl: string; requestId?: string; headers?: http.IncomingHttpHeaders };

/**
 * Upstream stubs that route like the real services do (Express 5: non-strict,
 * case-insensitive). `hits` records which real route handled each request,
 * so "how many requests reached login upstream" is measured, not inferred.
 *   auth:  POST /api/auth/login -> 401, POST /api/auth/register -> 201
 *   ai:    POST /api/ai/query | /search | /summarize-meeting -> 200
 *   generic (workspaces, documents, tasks): any GET/POST under /api/... -> 200
 */
export const startUpstreams = async () => {
  const hits: UpstreamHit[] = [];
  const record = (route: string) => (req: express.Request, res: express.Response) => {
    hits.push({ route, rawUrl: req.originalUrl, requestId: req.headers["x-request-id"] as string | undefined, headers: { ...req.headers } });
    const status = route === "login" ? 401 : route === "register" ? 201 : 200;
    res.status(status).json({ success: status < 400, route });
  };
  const notFound = (req: express.Request, res: express.Response) => {
    hits.push({ route: "404", rawUrl: req.originalUrl });
    res.status(404).json({ success: false });
  };

  const auth = express();
  auth.post("/api/auth/login", record("login"));
  auth.post("/api/auth/register", record("register"));
  auth.get("/api/auth/me", record("me"));
  auth.post("/api/auth/refresh", record("refresh"));
  auth.post("/api/auth/logout", record("logout"));
  auth.use(notFound);

  const ai = express();
  ai.post("/api/ai/query", record("ai-query"));
  ai.post("/api/ai/search", record("ai-search"));
  ai.post("/api/ai/summarize-meeting", record("ai-summarize"));
  ai.use(notFound);

  const generic = express();
  generic.all("/api/{*rest}", record("generic"));
  generic.use(notFound);

  const servers = {
    auth: await listen(auth),
    ai: await listen(ai),
    generic: await listen(generic),
  };

  return {
    hits,
    count: (route: string) => hits.filter((h) => h.route === route).length,
    reset: () => {
      hits.length = 0;
    },
    /** Point the gateway at the stubs (call BEFORE importing the gateway app). */
    applyEnv: () => {
      process.env.AUTH_SERVICE_URL = servers.auth.url;
      process.env.AI_SERVICE_URL = servers.ai.url;
      process.env.WORKSPACE_SERVICE_URL = servers.generic.url;
      process.env.DOCUMENT_SERVICE_URL = servers.generic.url;
      process.env.TASK_SERVICE_URL = servers.generic.url;
    },
    close: async () => {
      await Promise.all(Object.values(servers).map((s) => s.close()));
    },
  };
};

/** Start the real gateway app on an ephemeral port. Env must be set first. */
export const startGateway = async () => {
  const { default: app } = await import("../../services/api-gateway/src/app");
  const limiter = await import("../../services/api-gateway/src/middlewares/rate-limit.middleware");
  const server = await listen(app);
  return {
    url: server.url,
    port: Number(new URL(server.url).port),
    limiter,
    close: async () => {
      await server.close();
      limiter.rateLimitRedis.disconnect();
    },
  };
};
