/**
 * Redis reconnect policy shared by the ioredis clients.
 *
 * Deliberately has no ioredis import: services pin different ioredis versions
 * (ai-service has its own nested copy), so only the pure policy is shared.
 *
 * Previously the producer clients returned `null` after 3 attempts, which
 * tells ioredis to stop reconnecting for good -- a Redis restart longer than
 * about a second left document-service unable to enqueue until it was
 * restarted. This keeps reconnecting forever with a capped backoff; individual
 * commands still fail fast via the client's `maxRetriesPerRequest`.
 */
export const REDIS_RECONNECT_MAX_DELAY_MS = 5000;

export const redisReconnectDelay = (attempt: number): number =>
  Math.min(Math.max(attempt, 1) * 200, REDIS_RECONNECT_MAX_DELAY_MS);

/** Minimal surface of an ioredis client needed to close it. */
interface ClosableRedisClient {
  status: string;
  quit(): Promise<unknown>;
  disconnect(): void;
}

/**
 * Close an ioredis client during shutdown: a graceful QUIT when connected,
 * otherwise an immediate disconnect (QUIT on a reconnecting client can hang
 * or reject, which would turn a clean shutdown into a failed one).
 */
export const closeRedisClient = async (client: ClosableRedisClient): Promise<void> => {
  if (client.status === "end") return;
  if (client.status === "ready") {
    try {
      await client.quit();
      return;
    } catch {
      // fall through to a hard disconnect
    }
  }
  client.disconnect();
};

/** Minimal surface of an ioredis client used for lifecycle logging. */
interface RedisEventSource {
  on(event: string, listener: (...args: any[]) => void): unknown;
}

/** Log connection lifecycle events without dumping full stacks on every retry. */
export const attachRedisLogging = (client: RedisEventSource, label: string) => {
  client.on("ready", () => console.log(`[${label}] Redis ready`));
  client.on("reconnecting", (delay: number) =>
    console.warn(`[${label}] Redis reconnecting in ${delay} ms`)
  );
  client.on("end", () => console.warn(`[${label}] Redis connection closed`));
  client.on("error", (error: Error) =>
    console.error(`[${label}] Redis error: ${error?.message}`)
  );
};
