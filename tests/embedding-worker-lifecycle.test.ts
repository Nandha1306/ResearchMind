import assert from "node:assert";
import { test, describe, before, after } from "node:test";
import { setTestSecrets } from "./helpers/test-env";

/*
 * Exercises the REAL embedding worker start/stop logic with Redis
 * UNREACHABLE (nothing listens on the port below): the scenario in which a
 * pending BLPOP never settles and shutdown used to hang until its timeout.
 *
 * The AI provider configs only validate that keys exist at import time; the
 * dummy values below are never used for a network call in this test.
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599";
process.env.VOYAGE_API_KEY ||= "test-voyage-key";
process.env.PINECONE_API_KEY ||= "test-pinecone-key";
process.env.PINECONE_INDEX ||= "test-index";

let worker: typeof import("../services/ai-service/src/workers/embedding.worker");
let redisWorker: any;
let closeRedisClient: typeof import("../packages/shared/lifecycle/redis").closeRedisClient;

before(async () => {
  worker = await import("../services/ai-service/src/workers/embedding.worker");
  ({ default: redisWorker } = await import("../services/ai-service/src/config/redis-worker"));
  ({ closeRedisClient } = await import("../packages/shared/lifecycle/redis"));
});

after(() => {
  redisWorker?.disconnect();
});

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} did not finish within ${ms} ms`)), ms)),
  ]);

describe("Embedding worker lifecycle (ai-service/src/workers/embedding.worker.ts)", () => {
  test("a duplicate start in the same process reuses the running loop", () => {
    const first = worker.startEmbeddingWorker();
    const second = worker.startEmbeddingWorker();
    assert.strictEqual(second, first);
  });

  test("stop does not wait on a BLPOP that can never settle (Redis down)", async () => {
    const loop = worker.startEmbeddingWorker(); // already running from the previous test
    assert.notStrictEqual(redisWorker.status, "ready", "precondition: Redis must be unreachable");
    // No job in progress and Redis down: the pending BLPOP is abandoned and
    // the loop itself has finished by the time stop resolves.
    await withTimeout(worker.stopEmbeddingWorker(), 2000, "stopEmbeddingWorker");
    await withTimeout(loop, 200, "worker loop");
  });

  test("the worker can be started again after a stop", async () => {
    // A new loop is created (not the finished one); stop it straight away.
    const loop = worker.startEmbeddingWorker();
    await withTimeout(worker.stopEmbeddingWorker(), 2000, "stopEmbeddingWorker (restart)");
    await withTimeout(loop, 200, "restarted worker loop");
    // Shutdown's next step: closing the client must not throw either.
    await closeRedisClient(redisWorker);
  });
});
