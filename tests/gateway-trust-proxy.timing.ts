import assert from "node:assert";
import { describe, test, before, after, beforeEach } from "node:test";
import Redis from "ioredis";
import { setTestSecrets } from "./helpers/test-env";
import { rawRequest, startGateway, startUpstreams } from "./helpers/gateway";
import path from "node:path";
import { REDIS_DB_OFFSETS, deleteKeys, redisSkip, testRedisUrlFor } from "./helpers/test-redis";
import { freePort, runServiceToExit } from "./helpers/spawn-service";
import { infraDescribe } from "./helpers/infra";
import { parseTrustProxy } from "../services/api-gateway/src/config/trust-proxy";

/*
 * RT-008: TRUST_PROXY. Off by default (X-Forwarded-For ignored, as before);
 * with a hop count the per-IP register limiter keys on the real client.
 * Real gateway, real Redis (TEST_REDIS_URL host, database index base + 2, see
 * helpers/test-redis.ts; only rl:* keys are deleted). Timing file: serialized
 * with the other Redis-backed suites.
 */

setTestSecrets();
process.env.TRUST_PROXY = "1";

describe("RT-008: TRUST_PROXY parser", () => {
  test("off by default; hop counts and address lists accepted; `true` and garbage refused", () => {
    for (const off of [undefined, "", "false", "0", " FALSE "]) {
      assert.deepStrictEqual(parseTrustProxy(off), { value: false }, String(off));
    }
    assert.deepStrictEqual(parseTrustProxy("2"), { value: 2 });
    assert.deepStrictEqual(parseTrustProxy("loopback, 10.0.0.0/8, ::1"), { value: ["loopback", "10.0.0.0/8", "::1"] });
    for (const bad of ["true", "TRUE", "11", "abc", "10.0.0.0/33", "1.2.3.4/x", "*"]) {
      const result = parseTrustProxy(bad);
      assert.strictEqual(result.value, false, bad);
      assert.ok(result.error, bad);
    }
  });

  /*
   * Wave 4 review L1: a CIDR wide enough to cover (almost) every client is
   * "trust everything" in disguise, just like `true`: any client could set
   * its own X-Forwarded-For and pick its rate-limit key. Minimum prefix: /8
   * for IPv4, /32 for IPv6; IPv6 ranges that contain the IPv4-mapped block
   * (::ffff:0:0/96) are refused, and ranges inside it count as IPv4
   * (prefix - 96 >= 8). The private ranges remain available as keywords.
   */
  test("L1: /0 and other over-broad CIDRs are refused (IPv4, IPv6 and IPv4-mapped)", () => {
    for (const bad of [
      "0.0.0.0/0",
      "::/0",
      "10.0.0.0/8, 0.0.0.0/0",
      "loopback, ::/0",
      "0.0.0.0/7",
      "128.0.0.0/1",
      "2000::/3",
      "2001::/31",
      "::/32",
      "::ffff:0:0/96",
      "::ffff:0.0.0.0/96",
      "::ffff:10.0.0.0/103",
      "::/8",
    ]) {
      const result = parseTrustProxy(bad);
      assert.strictEqual(result.value, false, bad);
      assert.match(result.error ?? "", /too wide|trust any client/i, bad);
    }
  });

  test("L1: ordinary proxy addresses, CIDRs and hop counts still work", () => {
    for (const good of [
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.1.10",
      "203.0.113.0/24",
      "2001:db8::/32",
      "2001:db8:1::/48",
      "fd00::1",
      "::ffff:10.0.0.0/104",
      "::ffff:192.168.0.0/112",
      "loopback, linklocal, uniquelocal",
    ]) {
      const result = parseTrustProxy(good);
      assert.strictEqual(result.error, undefined, good);
      assert.ok(Array.isArray(result.value), good);
    }
    assert.deepStrictEqual(parseTrustProxy("1"), { value: 1 });
    assert.deepStrictEqual(parseTrustProxy("10"), { value: 10 });
  });

  test("L1: the real gateway refuses to start with TRUST_PROXY=0.0.0.0/0 (same path as `true`)", async () => {
    // Wave 6 (W6-TEST-11/12): an ephemeral port instead of 5931 and a temp
    // working directory (no .env is loaded), via helpers/spawn-service.ts.
    for (const value of ["0.0.0.0/0", "::/0", "true"]) {
      const { code, output } = await runServiceToExit(
        path.join("services", "api-gateway", "src", "server.ts"),
        {
          PORT: String(await freePort()),
          TRUST_PROXY: value,
          REDIS_URL: "redis://127.0.0.1:6599",
          JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
        },
        20_000
      );
      assert.notStrictEqual(code, 0, `${value}: gateway exited 0`);
      assert.notStrictEqual(code, null, `${value}: gateway kept running: ${output}`);
      assert.match(output, /TRUST_PROXY/, value);
      assert.doesNotMatch(output, /running on/, value);
    }
  });
});

infraDescribe("RT-008: register limiter keys on the real client behind one proxy hop", redisSkip, () => {
  let upstreams: Awaited<ReturnType<typeof startUpstreams>>;
  let gateway: Awaited<ReturnType<typeof startGateway>>;
  let direct: Redis;

  before(async () => {
    // Wave 6 (W6-TEST-02): base + 2 of TEST_REDIS_URL's index (was a fixed /10).
    const url = new URL(testRedisUrlFor(REDIS_DB_OFFSETS.trustProxy));
    process.env.REDIS_URL = url.toString();
    direct = new Redis(url.toString(), { maxRetriesPerRequest: 1 });
    await deleteKeys(direct, "rl:*");
    upstreams = await startUpstreams();
    upstreams.applyEnv();
    gateway = await startGateway();
    const deadline = Date.now() + 10_000;
    while (gateway.limiter.rateLimitRedis.status !== "ready" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });

  after(async () => {
    await gateway?.close();
    await upstreams?.close();
    if (direct) {
      await deleteKeys(direct, "rl:*").catch(() => {});
      direct.disconnect();
    }
  });

  beforeEach(async () => {
    await deleteKeys(direct, "rl:*");
  });

  const register = (xff: string) =>
    rawRequest(gateway.port, "POST", "/api/auth/register", { headers: { "X-Forwarded-For": xff } });

  test("client A is limited after 3 registrations; client B behind the same proxy is not", async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await register("203.0.113.1")).status);
    assert.deepStrictEqual(statuses, [201, 201, 201, 429]);
    assert.strictEqual((await register("203.0.113.2")).status, 201);
    const keys = (await direct.keys("rl:register:*")).sort();
    assert.deepStrictEqual(keys, ["rl:register:203.0.113.1", "rl:register:203.0.113.2"]);
  });
});
