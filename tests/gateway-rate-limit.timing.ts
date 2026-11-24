import assert from "node:assert";
import { describe, test, before, after, beforeEach } from "node:test";
import { infraDescribe } from "./helpers/infra";
import jwt from "jsonwebtoken";
import Redis from "ioredis";
import { setTestSecrets } from "./helpers/test-env";
import { rawRequest, startGateway, startUpstreams, variantsOf, type RawResponse } from "./helpers/gateway";
import { REDIS_DB_OFFSETS, createRedisProxy, deleteKeys, redisSkip, testRedisUrlFor } from "./helpers/test-redis";

/*
 * SEC-003 + RT-001 + RT-001b with a REAL Redis (TEST_REDIS_URL, disposable).
 *
 * The real gateway app runs in front of upstream stubs that route like the
 * services. Its limiter Redis client connects through an in-test TCP proxy
 * that can refuse connections (Redis down) or freeze them (Redis hung /
 * blackholed), so outages are simulated without touching the Redis server.
 *
 *  - The gateway is STARTED WHILE REDIS IS DOWN (proxy refusing): limited
 *    routes must fail open fast, and limits must resume once Redis is back
 *    (RT-001b: they never did).
 *  - Path variants and canonical requests share one limit; the number of
 *    requests that reach the upstream as login/register/AI is never above the
 *    limit (SEC-003).
 *  - Down and frozen Redis: every limited request answers in < 1 s and is
 *    forwarded (fail-open policy); one log line per outage (RT-001).
 *
 * Timing-sensitive: run serialized by `npm run test:timing`. Under heavy CPU
 * contention a limiter command can exceed its 300 ms timeout, and the limiter
 * then fails open by design.
 */

setTestSecrets();

const LIMITS = { login: 5, register: 3, aiQuery: 30, aiSummarize: 20, api: 100 };
const MAX_LATENCY_MS = 1000;
const RECOVERY_DEADLINE_MS = 10_000;
const USER = "665f1c2b9d3e4a00dddd0005";
const token = jwt.sign({ userId: USER }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "10m" });
const auth = { Authorization: `Bearer ${token}` };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

infraDescribe("Gateway rate limits with a real Redis (SEC-003, RT-001, RT-001b)", redisSkip, () => {
  let proxy: Awaited<ReturnType<typeof createRedisProxy>>;
  let upstreams: Awaited<ReturnType<typeof startUpstreams>>;
  let gateway: Awaited<ReturnType<typeof startGateway>>;
  let direct: Redis;
  const outageLines: string[] = [];
  const originalError = console.error;

  before(async () => {
    // Wave 6 (W6-TEST-02): the base index of TEST_REDIS_URL (helpers/test-redis.ts).
    const ownDb = testRedisUrlFor(REDIS_DB_OFFSETS.rateLimit);
    const target = new URL(ownDb);
    proxy = await createRedisProxy({ host: target.hostname, port: Number(target.port) }, "refuse");
    const viaProxy = new URL(ownDb);
    viaProxy.hostname = "127.0.0.1";
    viaProxy.port = String(proxy.port);
    process.env.REDIS_URL = viaProxy.toString();

    direct = new Redis(ownDb, { maxRetriesPerRequest: 1 });
    await deleteKeys(direct, "rl:*");

    console.error = (...args: unknown[]) => {
      if (args.some((a) => typeof a === "string" && a.includes("rate-limit Redis unavailable"))) {
        outageLines.push(String(args[0]));
      }
      originalError(...args);
    };

    upstreams = await startUpstreams();
    upstreams.applyEnv();
    gateway = await startGateway(); // Redis is DOWN at this point
  });

  after(async () => {
    console.error = originalError;
    await gateway?.close();
    await upstreams?.close();
    await proxy?.close();
    if (direct) {
      await deleteKeys(direct, "rl:*").catch(() => {});
      direct.disconnect();
    }
  });

  beforeEach(() => upstreams.reset());

  const login = (path = "/api/auth/login") => rawRequest(gateway.port, "POST", path);
  const aiQuery = (path = "/api/ai/query") => rawRequest(gateway.port, "POST", path, { headers: auth });

  /** 20 sequential + 20 concurrent requests per limited route: all fast, all forwarded. */
  const assertFailOpenFast = async (label: string) => {
    const routes: [string, () => Promise<RawResponse>, number, string][] = [
      ["login", () => login(), 401, "login"],
      ["register", () => rawRequest(gateway.port, "POST", "/api/auth/register"), 201, "register"],
      ["ai/query (two limiters)", () => aiQuery(), 200, "ai-query"],
      ["workspaces", () => rawRequest(gateway.port, "GET", "/api/workspaces", { headers: auth }), 200, "generic"],
    ];
    for (const [name, send, expected, route] of routes) {
      upstreams.reset();
      const sequential: RawResponse[] = [];
      for (let i = 0; i < 20; i++) sequential.push(await send());
      const concurrent = await Promise.all(Array.from({ length: 20 }, send));
      const all = [...sequential, ...concurrent];
      const max = Math.max(...all.map((r) => r.ms));
      console.log(`[${label}] ${name}: max ${max.toFixed(0)} ms over ${all.length} requests`);
      assert.ok(max < MAX_LATENCY_MS, `${label}: ${name} took ${max.toFixed(0)} ms`);
      assert.deepStrictEqual([...new Set(all.map((r) => r.status))], [expected], `${label}: ${name} not forwarded`);
      assert.strictEqual(upstreams.count(route), 40, `${label}: fail-open must forward every ${name} request`);
    }
  };

  /** Wait until a 6th failed login inside the window is refused again. */
  const waitForLimitsToResume = async (label: string) => {
    const started = Date.now();
    while (Date.now() - started < RECOVERY_DEADLINE_MS) {
      await deleteKeys(direct, "rl:login:*");
      // SEC-021: logins also count against the per-IP auth bucket (60/min);
      // reset it too so repeated probes measure only the login limiter.
      await deleteKeys(direct, "rl:auth-api:*");
      const statuses: number[] = [];
      for (let i = 0; i <= LIMITS.login; i++) statuses.push((await login()).status);
      if (statuses[LIMITS.login] === 429) {
        assert.deepStrictEqual(statuses.slice(0, LIMITS.login), Array(LIMITS.login).fill(401));
        const elapsed = Date.now() - started;
        console.log(`[${label}] limits active again after ${elapsed} ms`);
        return elapsed;
      }
      await sleep(250);
    }
    assert.fail(`${label}: limits did not resume within ${RECOVERY_DEADLINE_MS} ms`);
  };

  test("started while Redis is down: limited routes fail open in < 1 s", async () => {
    assert.notStrictEqual(gateway.limiter.rateLimitRedis.status, "ready");
    await assertFailOpenFast("down at startup");
  });

  test("RT-001b: limits resume after Redis comes up, although the gateway started without it", async () => {
    await proxy.setMode("open");
    await waitForLimitsToResume("start-while-down recovery");
  });

  test("SEC-003: login variants and canonical requests share the 5-attempt limit", async () => {
    await deleteKeys(direct, "rl:*");
    // Accepted forms that the limiter must count (trailing slash, query, case)
    // and forms the upstream does not route as login (`;x`) mixed with every
    // rejected variant.
    const accepted = ["/api/auth/login", "/api/auth/login/", "/api/auth/login?x=1", "/api/auth/Login", "/api/auth/login;x=1"];
    const sequence = variantsOf("/api/auth/login").flatMap((v, i) => [v, accepted[i % accepted.length]]);
    const results: { path: string; status: number }[] = [];
    for (const path of sequence) results.push({ path, status: (await login(path)).status });

    assert.ok(upstreams.count("login") <= LIMITS.login, `login reached upstream ${upstreams.count("login")} times`);
    assert.strictEqual(upstreams.count("login"), LIMITS.login, "the limit must be reachable through canonical forms");
    let lastCounted = -1;
    results.forEach((r, i) => {
      if (r.status === 401) lastCounted = i;
    });
    for (const r of results.slice(lastCounted + 1)) {
      assert.ok([400, 404, 429].includes(r.status), `${r.path} -> ${r.status} after the limit`);
    }
    for (const r of results) {
      if (variantsOf("/api/auth/login").includes(r.path)) assert.strictEqual(r.status, 400, r.path);
    }
    // Once limited, the canonical path stays limited.
    assert.strictEqual((await login()).status, 429);
  });

  test("SEC-003: variants alone never get more than the limit through", async () => {
    await deleteKeys(direct, "rl:*");
    for (let round = 0; round < 3; round++) {
      for (const v of [...variantsOf("/api/auth/login"), "/api/auth/login/", "/API/AUTH/LOGIN"]) await login(v);
      for (const v of variantsOf("/api/auth/register")) await rawRequest(gateway.port, "POST", v);
      for (const v of variantsOf("/api/ai/query")) await aiQuery(v);
    }
    assert.ok(upstreams.count("login") <= LIMITS.login);
    assert.strictEqual(upstreams.count("register"), 0);
    assert.strictEqual(upstreams.count("ai-query"), 0);
  });

  test("SEC-003: register (3/h) and AI query+search (30/h shared) hold across variants", async () => {
    await deleteKeys(direct, "rl:*");
    const registerPaths = variantsOf("/api/auth/register").flatMap((v) => [v, "/api/auth/register", "/api/auth/register/"]);
    for (const path of registerPaths) await rawRequest(gateway.port, "POST", path);
    assert.strictEqual(upstreams.count("register"), LIMITS.register);

    const aiPaths = variantsOf("/api/ai/query").flatMap((v, i) => [v, i % 2 ? "/api/ai/query" : "/api/ai/search/"]);
    while (aiPaths.length < 2 * LIMITS.aiQuery) aiPaths.push("/api/ai/search");
    for (const path of aiPaths) await aiQuery(path);
    assert.strictEqual(upstreams.count("ai-query") + upstreams.count("ai-search"), LIMITS.aiQuery);

    const summarizePaths = variantsOf("/api/ai/summarize-meeting").flatMap((v) => [v, "/api/ai/summarize-meeting"]);
    for (const path of summarizePaths) await aiQuery(path);
    assert.strictEqual(upstreams.count("ai-summarize"), LIMITS.aiSummarize);
  });

  /*
   * SEC-021: /api/auth/refresh, /me and /logout had no limit at all. They now
   * share a per-IP bucket of 60 per minute (path variants count the same).
   */
  test("SEC-021: refresh, me and logout share a 60/min per-IP limit; the 61st request is 429", async () => {
    await deleteKeys(direct, "rl:*");
    const statuses: number[] = [];
    for (let i = 0; i < 58; i++) statuses.push((await rawRequest(gateway.port, "POST", "/api/auth/refresh")).status);
    statuses.push((await rawRequest(gateway.port, "POST", "/api/auth/refresh/")).status);
    statuses.push((await rawRequest(gateway.port, "GET", "/api/auth/me")).status);
    assert.deepStrictEqual([...new Set(statuses)], [200], "the first 60 are forwarded");
    assert.strictEqual(upstreams.count("refresh") + upstreams.count("me"), 60);
    for (const [method, path] of [["POST", "/api/auth/refresh"], ["GET", "/api/auth/me"], ["POST", "/api/auth/logout"]] as const) {
      const res = await rawRequest(gateway.port, method, path);
      assert.strictEqual(res.status, 429, `${method} ${path}`);
    }
    assert.strictEqual(upstreams.count("logout"), 0);
    await deleteKeys(direct, "rl:*");
  });

  test("concurrency: 40 simultaneous AI queries, exactly 30 forwarded and 10 refused", async () => {
    await deleteKeys(direct, "rl:*");
    const results = await Promise.all(Array.from({ length: 40 }, () => aiQuery()));
    assert.strictEqual(results.filter((r) => r.status === 200).length, LIMITS.aiQuery);
    assert.strictEqual(results.filter((r) => r.status === 429).length, 40 - LIMITS.aiQuery);
    assert.strictEqual(upstreams.count("ai-query"), LIMITS.aiQuery);
  });

  test("RT-001: Redis goes down: fail open in < 1 s, one log line for the outage", async () => {
    await deleteKeys(direct, "rl:*");
    const linesBefore = outageLines.length;
    await proxy.setMode("refuse");
    await sleep(200);
    await assertFailOpenFast("down");
    assert.ok(outageLines.length - linesBefore <= 1, `${outageLines.length - linesBefore} outage lines`);
  });

  test("RT-001: limits resume within 10 s of Redis returning", async () => {
    await proxy.setMode("open");
    await waitForLimitsToResume("recovery");
  });

  test("RT-001: Redis frozen (connection open, no replies): fail open in < 1 s", async () => {
    await deleteKeys(direct, "rl:*");
    const linesBefore = outageLines.length;
    await proxy.setMode("freeze");
    await assertFailOpenFast("frozen");
    assert.ok(outageLines.length - linesBefore <= 1, `${outageLines.length - linesBefore} outage lines`);
  });

  test("RT-001: limits resume within 10 s of the freeze ending", async () => {
    await proxy.setMode("open");
    await waitForLimitsToResume("unfreeze");
  });
});
