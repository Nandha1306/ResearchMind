import assert from "node:assert";
import http from "node:http";
import { test, describe, after } from "node:test";
import mongoose from "mongoose";
import { listen } from "./helpers/test-env";
import {
  redisReconnectDelay,
  closeRedisClient,
  REDIS_RECONNECT_MAX_DELAY_MS,
} from "../packages/shared/lifecycle/redis";
import { createShutdownHandler } from "../packages/shared/lifecycle/shutdown";
import { connectMongo, resolveMongoUri } from "../packages/shared/lifecycle/mongo";
import { createHealthHandler } from "../packages/shared/health/healthCheck";

/* Unit tests for the shared connection / readiness / shutdown lifecycle. */

describe("Redis reconnect policy", () => {
  test("never gives up (never returns null) and backs off up to a cap", () => {
    let previous = 0;
    for (let attempt = 1; attempt <= 1000; attempt++) {
      const delay = redisReconnectDelay(attempt);
      assert.strictEqual(typeof delay, "number");
      assert.ok(delay > 0 && delay <= REDIS_RECONNECT_MAX_DELAY_MS);
      assert.ok(delay >= previous, "backoff must not decrease");
      previous = delay;
    }
    assert.strictEqual(redisReconnectDelay(1000), REDIS_RECONNECT_MAX_DELAY_MS);
  });
});

describe("closeRedisClient", () => {
  const fakeClient = (status: string, quitFails = false) => {
    const calls: string[] = [];
    return {
      calls,
      client: {
        status,
        quit: async () => {
          calls.push("quit");
          if (quitFails) throw new Error("quit failed");
        },
        disconnect: () => {
          calls.push("disconnect");
        },
      },
    };
  };

  test("connected client is closed gracefully with QUIT", async () => {
    const { client, calls } = fakeClient("ready");
    await closeRedisClient(client);
    assert.deepStrictEqual(calls, ["quit"]);
  });

  test("reconnecting client is disconnected immediately (QUIT could hang)", async () => {
    const { client, calls } = fakeClient("reconnecting");
    await closeRedisClient(client);
    assert.deepStrictEqual(calls, ["disconnect"]);
  });

  test("a failed QUIT falls back to disconnect and does not throw", async () => {
    const { client, calls } = fakeClient("ready", true);
    await closeRedisClient(client);
    assert.deepStrictEqual(calls, ["quit", "disconnect"]);
  });

  test("an already-ended client is left alone", async () => {
    const { client, calls } = fakeClient("end");
    await closeRedisClient(client);
    assert.deepStrictEqual(calls, []);
  });
});

describe("Graceful shutdown", () => {
  const exitPromise = () => {
    let resolveExit!: (code: number) => void;
    const exited = new Promise<number>((resolve) => (resolveExit = resolve));
    return { exited, exit: (code: number) => resolveExit(code) };
  };

  test("stops the HTTP server, runs every step in order, exits 0", async () => {
    const server = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const order: string[] = [];
    const { exited, exit } = exitPromise();

    const shutdown = createShutdownHandler({
      serviceName: "test",
      server,
      steps: [
        { name: "worker", close: async () => void order.push("worker") },
        { name: "mongodb", close: async () => void order.push("mongodb") },
        { name: "redis", close: () => void order.push("redis") },
      ],
      exit,
    });

    await shutdown("SIGTERM");
    assert.strictEqual(await exited, 0);
    assert.deepStrictEqual(order, ["worker", "mongodb", "redis"]);
    assert.strictEqual(server.listening, false);
  });

  // Bounded so a regression (connections never cut) fails instead of hanging CI.
  test("an open long-lived connection (e.g. SSE) is cut after the grace period; steps still run", { timeout: 10_000 }, async () => {
    // A handler that never finishes its response, like a streaming answer.
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: started\n\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    let markOpen!: () => void;
    const streamOpen = new Promise<void>((resolve) => (markOpen = resolve));
    const streamClosed = new Promise<void>((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
        res.once("data", () => markOpen()); // first event received: stream is live
        res.on("close", () => resolve());
        res.on("error", () => resolve());
      });
      req.on("error", () => resolve());
    });
    await streamOpen;

    const order: string[] = [];
    const { exited, exit } = exitPromise();
    const shutdown = createShutdownHandler({
      serviceName: "test",
      server,
      serverGraceMs: 200,
      timeoutMs: 5000,
      steps: [{ name: "mongodb", close: () => void order.push("mongodb") }],
      exit,
    });
    await shutdown("SIGTERM");

    // Hitting the hard timeout would exit 1, so 0 proves the grace path worked.
    assert.strictEqual(await exited, 0, "must complete cleanly, not via the hard timeout");
    assert.deepStrictEqual(order, ["mongodb"]);
    await streamClosed; // the open stream was actually cut
  });

  test("a failing step does not skip later steps, and the exit code is 1", async () => {
    const order: string[] = [];
    const { exited, exit } = exitPromise();
    const shutdown = createShutdownHandler({
      serviceName: "test",
      steps: [
        { name: "a", close: () => { order.push("a"); throw new Error("boom"); } },
        { name: "b", close: () => void order.push("b") },
      ],
      exit,
    });
    await shutdown("SIGINT");
    assert.strictEqual(await exited, 1);
    assert.deepStrictEqual(order, ["a", "b"]);
  });

  test("a step that never finishes is cut off by the timeout with exit code 1", async () => {
    const { exited, exit } = exitPromise();
    const shutdown = createShutdownHandler({
      serviceName: "test",
      steps: [{ name: "stuck", close: () => new Promise(() => {}) }],
      timeoutMs: 50,
      exit,
    });
    void shutdown("SIGTERM");
    assert.strictEqual(await exited, 1);
  });

  test("a second signal during shutdown forces exit(1)", async () => {
    const codes: number[] = [];
    const shutdown = createShutdownHandler({
      serviceName: "test",
      steps: [{ name: "slow", close: () => new Promise((r) => setTimeout(r, 30)) }],
      exit: (code) => codes.push(code),
    });
    const first = shutdown("SIGTERM");
    await shutdown("SIGTERM");
    assert.deepStrictEqual(codes, [1]);
    await first;
    assert.deepStrictEqual(codes, [1, 0]);
  });
});

describe("MongoDB connection configuration", () => {
  test("a missing URI fails loudly, naming the variables and not connecting", async () => {
    await assert.rejects(connectMongo("test-service", undefined, ["MONGODB_URI", "MONGO_URI"]), (err: any) => {
      assert.match(err.message, /MONGODB_URI or MONGO_URI/);
      return true;
    });
    assert.strictEqual(mongoose.connection.readyState, 0);
  });

  test("resolveMongoUri honours variable precedence and ignores blanks", () => {
    const saved = { a: process.env.RM_TEST_A, b: process.env.RM_TEST_B };
    try {
      process.env.RM_TEST_A = "  ";
      process.env.RM_TEST_B = "mongodb://second";
      assert.deepStrictEqual(resolveMongoUri("RM_TEST_A", "RM_TEST_B"), { name: "RM_TEST_B", uri: "mongodb://second" });
      delete process.env.RM_TEST_B;
      assert.strictEqual(resolveMongoUri("RM_TEST_A", "RM_TEST_B"), undefined);
    } finally {
      if (saved.a === undefined) delete process.env.RM_TEST_A; else process.env.RM_TEST_A = saved.a;
      if (saved.b === undefined) delete process.env.RM_TEST_B; else process.env.RM_TEST_B = saved.b;
    }
  });
});

describe("Health / readiness (shared createHealthHandler)", () => {
  let server: { url: string; close: () => Promise<void> } | undefined;
  let redisUp = true;

  after(async () => {
    await server?.close();
  });

  const start = async () => {
    const express = (await import("express")).default;
    const app = express();
    app.get("/health", createHealthHandler("test-service", () => redisUp));
    server = await listen(app);
  };

  test("reports 503 and mongo 'down' when MongoDB is not connected", async () => {
    await start();
    redisUp = true;
    const res = await fetch(`${server!.url}/health`);
    assert.strictEqual(res.status, 503);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.status, "unhealthy");
    assert.strictEqual(body.dependencies.mongo, "down");
  });

  test("reports 200 only when every required dependency is up", async () => {
    const connection = mongoose.connection as any;
    Object.defineProperty(connection, "readyState", { get: () => 1, configurable: true });
    try {
      redisUp = true;
      let res = await fetch(`${server!.url}/health`);
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual((await res.json()).dependencies, { mongo: "up", redis: "up" });

      redisUp = false;
      res = await fetch(`${server!.url}/health`);
      assert.strictEqual(res.status, 503);
      assert.strictEqual((await res.json()).dependencies.redis, "down");
    } finally {
      delete connection.readyState;
    }
  });
});
