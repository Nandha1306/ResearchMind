import http from "http";
import type { RequestListener } from "http";

/**
 * Start a service's HTTP server (SEC-004, RT-002).
 *
 * - Binds to HOST, default 127.0.0.1 for internal services: they are reached
 *   through the gateway and by each other on this machine, so they must not
 *   listen on every interface (where anyone on the network could bypass the
 *   gateway's limits). Set HOST=0.0.0.0 for container or remote use. The
 *   gateway passes its own default (all interfaces): it is the entry point.
 * - Logs "running" only once the socket is actually listening. On a listen
 *   error (EADDRINUSE, EACCES, ...) it logs the code and exits with status 1.
 *   Express 5's `app.listen(port, cb)` also registered the callback as the
 *   error handler, so services used to log "running on port N" on EADDRINUSE
 *   and stay alive without listening.
 */
export const DEFAULT_INTERNAL_HOST = "127.0.0.1";

export interface StartHttpServerOptions {
  serviceName: string;
  port: number | string;
  /** Default when HOST is unset or empty. */
  defaultHost?: string;
  /** Injectable for tests. */
  env?: Record<string, string | undefined>;
  exit?: (code: number) => void;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}

export const resolveListenHost = (
  env: Record<string, string | undefined> = process.env,
  defaultHost: string = DEFAULT_INTERNAL_HOST
): string => env.HOST?.trim() || defaultHost;

export const startHttpServer = (
  handler: RequestListener,
  {
    serviceName,
    port,
    defaultHost = DEFAULT_INTERNAL_HOST,
    env = process.env,
    exit = (code) => process.exit(code),
    log = (message) => console.log(message),
    logError = (message) => console.error(message),
  }: StartHttpServerOptions
): http.Server => {
  const host = resolveListenHost(env, defaultHost);
  const server = http.createServer(handler);

  server.once("listening", () => {
    log(`${serviceName} running on ${host}:${port}`);
  });
  server.once("error", (error: NodeJS.ErrnoException) => {
    logError(`[${serviceName}] cannot listen on ${host}:${port}: ${error.code ?? error.message}`);
    exit(1);
  });

  server.listen(Number(port), host);
  return server;
};
