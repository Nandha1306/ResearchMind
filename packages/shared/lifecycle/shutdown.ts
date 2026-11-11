import type { Server } from "http";

export interface ShutdownStep {
  name: string;
  close: () => unknown | Promise<unknown>;
}

export interface ShutdownOptions {
  serviceName: string;
  /** HTTP server to stop accepting connections first (omit for workers). */
  server?: Server;
  /** Run in order after the server stops (e.g. stop worker, then DB, then Redis). */
  steps?: ShutdownStep[];
  /** Hard limit before forcing exit(1). */
  timeoutMs?: number;
  /**
   * How long in-flight requests (including SSE streams) may keep running
   * after the server stops accepting new connections. Remaining connections
   * are then closed so the cleanup steps still run within `timeoutMs`.
   */
  serverGraceMs?: number;
  /** Injected for tests; defaults to process.exit. */
  exit?: (code: number) => void;
}

const closeServer = (server: Server, graceMs: number): Promise<void> =>
  new Promise((resolve) => {
    // Calling close() on a server that is not listening reports an error via
    // the callback; either way we are done waiting.
    server.close(() => {
      clearTimeout(forceTimer);
      resolve();
    });
    // Release idle keep-alive sockets immediately.
    server.closeIdleConnections?.();
    // Long-lived connections (e.g. an SSE answer still streaming) would
    // otherwise hold close() open until the hard timeout and skip cleanup.
    const forceTimer = setTimeout(() => server.closeAllConnections?.(), graceMs);
  });

/**
 * Build the shutdown routine. Returned separately from signal wiring so it can
 * be unit-tested without sending real signals.
 *
 * Order: stop accepting HTTP traffic (in-flight requests get `serverGraceMs`)
 * -> run steps in order -> exit(0). Every step runs even if an earlier one
 * fails; any failure, or exceeding `timeoutMs`, exits with code 1 so the
 * failure is visible to the supervisor. A second call while shutting down
 * forces exit(1) immediately.
 *
 * The timeout timer is intentionally NOT unref'd: if a step hangs on a
 * promise with nothing else keeping the event loop alive, the process must
 * still end with a visible exit(1) rather than silently exiting 0.
 */
export const createShutdownHandler = (options: ShutdownOptions) => {
  const {
    serviceName,
    server,
    steps = [],
    timeoutMs = 10_000,
    exit = (code: number) => process.exit(code),
  } = options;
  const serverGraceMs = Math.min(options.serverGraceMs ?? 5_000, timeoutMs / 2);

  let shuttingDown = false;

  return async (reason: string): Promise<void> => {
    if (shuttingDown) {
      console.warn(`[${serviceName}] ${reason} received again; forcing exit`);
      exit(1);
      return;
    }
    shuttingDown = true;
    console.log(`[${serviceName}] ${reason} received; shutting down gracefully`);

    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      console.error(`[${serviceName}] shutdown timed out after ${timeoutMs} ms; forcing exit`);
      exit(1);
    }, timeoutMs);

    let failed = false;

    if (server) {
      await closeServer(server, serverGraceMs);
    }

    for (const step of steps) {
      try {
        await step.close();
      } catch (error) {
        failed = true;
        console.error(
          `[${serviceName}] shutdown step "${step.name}" failed: ${(error as Error)?.message}`
        );
      }
    }

    finished = true;
    clearTimeout(timer);
    console.log(`[${serviceName}] shutdown complete`);
    exit(failed ? 1 : 0);
  };
};

/** Wire SIGINT/SIGTERM to a graceful shutdown. */
export const registerGracefulShutdown = (options: ShutdownOptions) => {
  const shutdown = createShutdownHandler(options);
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  return shutdown;
};
