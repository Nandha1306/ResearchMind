import assert from "node:assert";
import { describe, test } from "node:test";
import crypto from "node:crypto";
import path from "node:path";
import express from "express";
import "./helpers/test-env"; // A-5: dead-port REDIS_URL/MONGO_URI defaults before any service code
import { parseTrustProxy } from "../services/api-gateway/src/config/trust-proxy";
import { ROOT, freePort, runNodeToExit, runServiceToExit } from "./helpers/spawn-service";

/*
 * Wave 6 WP-3 (W6-SEC-01, Wave 4 carry-over "TRUST_PROXY clean message",
 * scope amendment A-12 / R3).
 * - The TRUST_PROXY parser only accepts values that Express (proxy-addr) can
 *   compile: IPv4-compatible IPv6 forms such as ::0.0.0.0/96 used to pass the
 *   parser and then crash the gateway with a proxy-addr stack trace.
 * - The cross-check only ADDS rejections: every value refused in the Wave 4
 *   43-value corpus is still refused, and every other accepted value still is.
 * - The real gateway refuses an invalid TRUST_PROXY / CORS_ORIGIN with
 *   exactly one line "[api-gateway] refusing to start: <VAR> ..." (variable
 *   and rule, never the value), no stack trace, exit code 1.
 * - app.ts keeps its own fail-closed check when imported directly.
 * Spawned processes run in a temp cwd (no .env) with dead-port Redis/Mongo.
 */

/** The Wave 4 review corpus (stab/rv4b-trust.ts, 43 values). */
const W4_REFUSED = [
  "0.0.0.0/0", "::/0", "0.0.0.0/1, 128.0.0.0/1", "0.0.0.0/7", "010.0.0.0/8", "10.0.0.0/255.0.0.0", "0x0a.0.0.0/8",
  "::/1", "::/31", "::/32", "8000::/1", "::ffff:0:0/96", "::ffff:0:0/80", "::ffff:0.0.0.0/97", "::FFFF:0:0/96",
  "0:0:0:0:0:FFFF:0:0/96", "10.0.0.0/8,0.0.0.0/1", "LOOPBACK", "11", "10.0.0.0 /8", "10.0.0.0/8/8", "*", "all",
];
const W4_ACCEPTED = [
  "0.0.0.0/8", "10.0.0.0/8", "10.0.0.0/08", "::ffff:0.0.0.0/104", "::ffff:10.0.0.0/104", "::0.0.0.0/96", "::/96",
  "64:ff9b::/96", "fe80::1%eth0/64", " 10.0.0.0/8 ,  loopback ", "loopback", "uniquelocal", "linklocal", "1.2.3.4",
  "::ffff:1.2.3.4", "1", "10", "01", "0.0.0.0", "::",
];
/** Accepted by the Wave 4 parser, but proxy-addr cannot compile them. */
const PROXY_ADDR_INCOMPATIBLE = ["::0.0.0.0/96", "::1.2.3.4/104", "::0.0.0.0/120", "::127.0.0.1"];

/** What the gateway does with the parsed value: Express compiles it with proxy-addr. */
const expressCompiles = (value: unknown): boolean => {
  try {
    express().set("trust proxy", value);
    return true;
  } catch {
    return false;
  }
};

describe("W6-SEC-01: TRUST_PROXY parser agrees with proxy-addr", () => {
  test("the corpus has 43 values", () => {
    assert.strictEqual(W4_REFUSED.length + W4_ACCEPTED.length, 43);
  });

  test("IPv4-compatible IPv6 forms that proxy-addr cannot compile are refused", () => {
    for (const bad of PROXY_ADDR_INCOMPATIBLE) {
      const result = parseTrustProxy(bad);
      assert.strictEqual(result.value, false, bad);
      assert.match(result.error ?? "", /^TRUST_PROXY /, bad);
      assert.ok(!(result.error ?? "").includes(bad), `the value is echoed: ${result.error}`);
    }
    // also inside a list
    assert.strictEqual(parseTrustProxy("10.0.0.0/8, ::0.0.0.0/96").value, false);
  });

  test("every value refused in the Wave 4 corpus is still refused", () => {
    for (const bad of W4_REFUSED) {
      const result = parseTrustProxy(bad);
      assert.strictEqual(result.value, false, bad);
      assert.ok(result.error, bad);
    }
  });

  test("every value the parser accepts compiles in Express; only the incompatible ones were newly refused", () => {
    const accepted = W4_ACCEPTED.filter((v) => !parseTrustProxy(v).error);
    assert.deepStrictEqual(
      W4_ACCEPTED.filter((v) => !accepted.includes(v)),
      ["::0.0.0.0/96"],
      "the cross-check may only add the proxy-addr-incompatible rejections"
    );
    for (const value of [...accepted, "2001:db8::/32", "::ffff:192.168.0.0/112", "fd00::1", "loopback, linklocal, uniquelocal"]) {
      const parsed = parseTrustProxy(value);
      assert.strictEqual(parsed.error, undefined, value);
      assert.ok(expressCompiles(parsed.value), `${value}: accepted but Express cannot compile it`);
    }
  });
});

const GATEWAY = path.join("services", "api-gateway", "src", "server.ts");

const bootEnv = async (extra: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> => ({
  PORT: String(await freePort()),
  JWT_ACCESS_SECRET: crypto.randomBytes(32).toString("hex"),
  ...extra,
});

const assertCleanRefusal = (result: { code: number | null; output: string; stderr: string }, variable: string, value: string) => {
  assert.strictEqual(result.code, 1, `expected exit 1, got ${result.code}: ${result.output}`);
  const refusals = result.output.split(/\r?\n/).filter((line) => line.includes("refusing to start"));
  assert.strictEqual(refusals.length, 1, result.output);
  assert.match(refusals[0], new RegExp(`^\\[api-gateway\\] refusing to start: ${variable} `));
  const stderrLines = result.stderr.split(/\r?\n/).filter((line) => line.trim() !== "");
  assert.deepStrictEqual(stderrLines, [refusals[0]], "stderr must be exactly the refusal line");
  assert.doesNotMatch(result.output, /^\s+at /m, "a stack frame was printed");
  assert.doesNotMatch(result.output, /running on/);
  if (value.length > 1) assert.ok(!result.output.includes(value), `the value is echoed: ${result.output}`);
};

describe("W6-SEC-01: the real gateway refuses invalid configuration with one clean line", () => {
  for (const value of ["::0.0.0.0/96", "true", "0.0.0.0/0", "::ffff:0:0/100x"]) {
    test(`TRUST_PROXY=${value}: exit 1, one line naming TRUST_PROXY, no stack`, async () => {
      const result = await runServiceToExit(GATEWAY, await bootEnv({ TRUST_PROXY: value }));
      assertCleanRefusal(result, "TRUST_PROXY", value);
    });
  }

  for (const value of ["*", "https://app.example.net/some/path"]) {
    test(`CORS_ORIGIN=${value}: exit 1, one line naming CORS_ORIGIN, no stack`, async () => {
      const result = await runServiceToExit(GATEWAY, await bootEnv({ CORS_ORIGIN: value }));
      assertCleanRefusal(result, "CORS_ORIGIN", value);
    });
  }

  test("app.ts keeps its own fail-closed check when imported directly (no server.ts)", async () => {
    const appPath = path.join(ROOT, "services", "api-gateway", "src", "app.ts");
    for (const extra of [{ TRUST_PROXY: "::0.0.0.0/96" }, { TRUST_PROXY: "true" }, { CORS_ORIGIN: "*" }]) {
      const result = await runNodeToExit(
        ["-e", `require(${JSON.stringify(appPath)}); console.log("APP LOADED");`],
        await bootEnv(extra)
      );
      assert.notStrictEqual(result.code, 0, `${JSON.stringify(extra)}: app.ts loaded: ${result.output}`);
      assert.doesNotMatch(result.output, /APP LOADED/);
      assert.match(result.output, new RegExp(Object.keys(extra)[0]));
    }
  });
});
