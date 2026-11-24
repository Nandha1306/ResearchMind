import net from "node:net";
import type { AddressInfo } from "node:net";
import Redis from "ioredis";
import { assertDisposableRedisUrl } from "./infra-guard";

/**
 * Redis-backed tests need a real, DISPOSABLE Redis, given as TEST_REDIS_URL
 * (for example redis://127.0.0.1:6395/7). Use a database index of your own:
 * the helpers only ever delete keys matching the pattern a test names (SCAN +
 * DEL), never FLUSHDB/FLUSHALL.
 *
 * Without TEST_REDIS_URL the suites are SKIPPED with this reason; under CI a
 * missing TEST_REDIS_URL fails loudly instead. Only a loopback Redis on a
 * non-default port is accepted (6379, a developer's real Redis, is refused),
 * locally and in CI (helpers/infra-guard.ts).
 */
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL;

if (process.env.CI && !TEST_REDIS_URL) {
  throw new Error("CI is set but TEST_REDIS_URL is not: Redis-backed tests would be skipped");
}
// Wave 6 (W6-CI-05, A-4): a disposable loopback Redis on a non-default port
// only -- locally AND in CI (the former check skipped CI, where the job's
// Redis used 6379). The database-index range is checked by redisDbBase below.
if (TEST_REDIS_URL) {
  assertDisposableRedisUrl("TEST_REDIS_URL", TEST_REDIS_URL);
}

export const redisSkip: string | false = TEST_REDIS_URL
  ? false
  : "TEST_REDIS_URL is not set (test needs a disposable Redis)";

/**
 * Wave 6 (W6-TEST-02): every Redis-backed file uses its own database index,
 * derived from the index in TEST_REDIS_URL (the "base", 0 when absent):
 *   base     gateway-rate-limit.timing.ts
 *   base + 1 embedding-pointer-jobs.integration.test.ts
 *   base + 2 gateway-trust-proxy.timing.ts
 * One test run per range base..base+2; a second concurrent run must use
 * another base. Redis has 16 databases by default, so the base must be at
 * most 13. Messages name the variable and the rule, never the URL.
 */
export const REDIS_DB_OFFSETS = { rateLimit: 0, embeddingJobs: 1, trustProxy: 2 } as const;
export const MAX_REDIS_DB_BASE = 13;

export const redisDbBase = (url: string | undefined = TEST_REDIS_URL): number => {
  if (!url) throw new Error("TEST_REDIS_URL is not set");
  const segment = new URL(url).pathname.replace(/^\//, "");
  if (segment === "") return 0;
  if (!/^\d+$/.test(segment)) throw new Error("TEST_REDIS_URL: the database index must be a number");
  const base = Number(segment);
  if (base > MAX_REDIS_DB_BASE) {
    throw new Error(`TEST_REDIS_URL: the database index must be at most ${MAX_REDIS_DB_BASE} (the tests use it and the next two)`);
  }
  return base;
};

/** TEST_REDIS_URL with its database index set to base + `offset`. */
export const testRedisUrlFor = (offset: number, url: string | undefined = TEST_REDIS_URL): string => {
  const base = redisDbBase(url);
  const target = new URL(url!);
  target.pathname = `/${base + offset}`;
  return target.toString();
};

// Fail at import (not inside a suite) when the base leaves no room for base + 2.
if (TEST_REDIS_URL) redisDbBase(TEST_REDIS_URL);

/** Delete keys matching `pattern` in the test database (SCAN + DEL only). */
export const deleteKeys = async (client: Redis, pattern: string) => {
  let cursor = "0";
  do {
    const [next, keys] = await client.scan(cursor, "MATCH", pattern, "COUNT", 500);
    cursor = next;
    if (keys.length > 0) await client.del(...keys);
  } while (cursor !== "0");
};

export type ProxyMode = "open" | "refuse" | "freeze";

/**
 * A TCP proxy in front of the test Redis that can simulate outages:
 *  - open:   forwards both ways;
 *  - refuse: the listener is closed and every connection destroyed, so
 *            clients get ECONNREFUSED (Redis down);
 *  - freeze: connections stay open (and new ones are accepted) but no byte
 *            moves in either direction (a hung Redis, or a blackhole for new
 *            connections). Bytes are held, not dropped, so the protocol stays
 *            in sync when the proxy is opened again.
 */
export const createRedisProxy = async (target: { host: string; port: number }, initial: ProxyMode) => {
  let mode: ProxyMode = initial;
  type Pair = { client: net.Socket; upstream: net.Socket; flush: () => void };
  const pairs = new Set<Pair>();
  let port = 0;

  /** Forward `from` -> `to`; while frozen, hold chunks (in order) instead. */
  const forward = (from: net.Socket, to: net.Socket) => {
    const held: Buffer[] = [];
    from.on("data", (chunk: Buffer) => {
      if (mode === "freeze") held.push(chunk);
      else to.write(chunk);
    });
    return () => {
      for (const chunk of held.splice(0)) to.write(chunk);
    };
  };

  const server = net.createServer((client) => {
    const upstream = net.connect(target.port, target.host);
    const flushUp = forward(client, upstream);
    const flushDown = forward(upstream, client);
    const pair: Pair = {
      client,
      upstream,
      flush: () => {
        flushUp();
        flushDown();
      },
    };
    pairs.add(pair);
    const drop = () => {
      pairs.delete(pair);
      client.destroy();
      upstream.destroy();
    };
    client.on("error", drop).on("close", drop);
    upstream.on("error", drop).on("close", drop);
  });

  const listen = () =>
    new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        port = (server.address() as AddressInfo).port;
        resolve();
      });
    });

  // Reserve a port even when starting in "refuse" mode.
  await listen();
  if (initial === "refuse") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const setMode = async (next: ProxyMode) => {
    if (next === mode) return;
    const previous = mode;
    mode = next;
    if (next === "refuse") {
      for (const { client, upstream } of pairs) {
        client.destroy();
        upstream.destroy();
      }
      pairs.clear();
      await new Promise<void>((resolve) => (server.listening ? server.close(() => resolve()) : resolve()));
      return;
    }
    if (previous === "refuse") await listen();
    if (next === "open") for (const pair of pairs) pair.flush();
  };

  return {
    get port() {
      return port;
    },
    setMode,
    close: async () => {
      for (const { client, upstream } of pairs) {
        client.destroy();
        upstream.destroy();
      }
      pairs.clear();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};
