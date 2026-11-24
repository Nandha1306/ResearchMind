import assert from "node:assert";
import { describe, test } from "node:test";
import crypto from "node:crypto";
import path from "node:path";
import jwt from "jsonwebtoken";
import "./helpers/test-env"; // A-5: dead-port REDIS_URL/MONGO_URI defaults before any service code
import { ROOT, freePort, runNodeToExit, runServiceToExit } from "./helpers/spawn-service";

/*
 * Wave 6 WP-4 (W6-SEC-05, scope amendment A-14 / R6): auth-service validates
 * ACCESS_TOKEN_EXPIRES and REFRESH_TOKEN_EXPIRES at startup with the same
 * parser jwt.sign uses (it signs a probe token and reads exp - iat):
 *  - access: valid, > 0 and at most 15 minutes (the user's 15m still boots);
 *  - refresh: valid, at most 30 days and longer than the access lifetime;
 *  - a value without a unit is refused: jsonwebtoken reads a string of digits
 *    as MILLISECONDS ("900" would be a 0-second token).
 * An invalid value stops auth-service with one line naming the variable and
 * the rule (never the value), exit 1, before MongoDB is contacted. Every
 * accepted value signs and gives the expected exp - iat.
 */

const secret = () => crypto.randomBytes(32).toString("hex");

const load = async () => import("../services/auth-service/src/config/token-lifetimes");

describe("W6-SEC-05: token lifetime parser", () => {
  test("unset values keep the defaults (5m access, 7d refresh)", async () => {
    const { readTokenLifetimes } = await load();
    const result = readTokenLifetimes({});
    assert.ok(result.ok);
    assert.strictEqual(result.access.seconds, 300);
    assert.strictEqual(result.refresh.seconds, 604_800);
    assert.ok(readTokenLifetimes({ ACCESS_TOKEN_EXPIRES: "", REFRESH_TOKEN_EXPIRES: "" }).ok);
  });

  const ACCEPTED: Array<[Record<string, string>, number, number]> = [
    [{ ACCESS_TOKEN_EXPIRES: "15m" }, 900, 604_800],
    [{ ACCESS_TOKEN_EXPIRES: "900s" }, 900, 604_800],
    [{ ACCESS_TOKEN_EXPIRES: "1m" }, 60, 604_800],
    [{ ACCESS_TOKEN_EXPIRES: "5m", REFRESH_TOKEN_EXPIRES: "30d" }, 300, 2_592_000],
    [{ ACCESS_TOKEN_EXPIRES: "5m", REFRESH_TOKEN_EXPIRES: "301s" }, 300, 301],
    [{ ACCESS_TOKEN_EXPIRES: "15m", REFRESH_TOKEN_EXPIRES: "1h" }, 900, 3_600],
    [{ REFRESH_TOKEN_EXPIRES: "720h" }, 300, 2_592_000],
  ];

  for (const [env, access, refresh] of ACCEPTED) {
    test(`accepted ${JSON.stringify(env)} -> ${access}s / ${refresh}s, and jwt.sign gives exactly that`, async () => {
      const { readTokenLifetimes } = await load();
      const result = readTokenLifetimes(env);
      assert.ok(result.ok, JSON.stringify(result));
      assert.strictEqual(result.access.seconds, access);
      assert.strictEqual(result.refresh.seconds, refresh);
      for (const [raw, seconds] of [[result.access.expiresIn, access], [result.refresh.expiresIn, refresh]] as const) {
        const token = jwt.sign({ userId: "665f1c2b9d3e4a00dddd0004" }, secret(), { algorithm: "HS256", expiresIn: raw as any });
        const payload = jwt.decode(token) as { iat: number; exp: number };
        assert.strictEqual(payload.exp - payload.iat, seconds, String(raw));
      }
    });
  }

  const REFUSED: Array<[Record<string, string>, string]> = [
    [{ ACCESS_TOKEN_EXPIRES: "abc" }, "ACCESS_TOKEN_EXPIRES"],
    [{ ACCESS_TOKEN_EXPIRES: "30d" }, "ACCESS_TOKEN_EXPIRES"],
    [{ ACCESS_TOKEN_EXPIRES: "16m" }, "ACCESS_TOKEN_EXPIRES"],
    [{ ACCESS_TOKEN_EXPIRES: "901s" }, "ACCESS_TOKEN_EXPIRES"],
    [{ ACCESS_TOKEN_EXPIRES: "0s" }, "ACCESS_TOKEN_EXPIRES"],
    [{ ACCESS_TOKEN_EXPIRES: "-5m" }, "ACCESS_TOKEN_EXPIRES"],
    [{ ACCESS_TOKEN_EXPIRES: "900" }, "ACCESS_TOKEN_EXPIRES"],
    [{ ACCESS_TOKEN_EXPIRES: " 5m" }, "ACCESS_TOKEN_EXPIRES"],
    [{ REFRESH_TOKEN_EXPIRES: "31d" }, "REFRESH_TOKEN_EXPIRES"],
    [{ REFRESH_TOKEN_EXPIRES: "604800" }, "REFRESH_TOKEN_EXPIRES"],
    [{ REFRESH_TOKEN_EXPIRES: "abc" }, "REFRESH_TOKEN_EXPIRES"],
    [{ REFRESH_TOKEN_EXPIRES: "5m" }, "REFRESH_TOKEN_EXPIRES"], // equal to the default access lifetime
    [{ ACCESS_TOKEN_EXPIRES: "15m", REFRESH_TOKEN_EXPIRES: "10m" }, "REFRESH_TOKEN_EXPIRES"],
  ];

  for (const [env, variable] of REFUSED) {
    test(`refused ${JSON.stringify(env)}: names ${variable}, not the value`, async () => {
      const { readTokenLifetimes } = await load();
      const result = readTokenLifetimes(env);
      assert.ok(!result.ok);
      assert.strictEqual(result.variable, variable);
      assert.match(result.message, new RegExp(`^${variable} `));
      const value = env[variable].trim();
      assert.ok(!result.message.includes(` ${value} `) && !result.message.endsWith(value), `value echoed: ${result.message}`);
    });
  }
});

describe("W6-SEC-05: auth-service applies the validated lifetimes", () => {
  const mint = async (env: NodeJS.ProcessEnv) => {
    const jwtPath = path.join(ROOT, "services", "auth-service", "src", "utils", "jwt.ts");
    const script =
      `const j = require(${JSON.stringify(jwtPath)});` +
      `const d = (t) => { const p = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()); return p.exp - p.iat; };` +
      `console.log("LIFETIMES " + d(j.generateAccessToken({ userId: "665f1c2b9d3e4a00dddd0004" })) + " " + d(j.generateRefreshToken({ userId: "665f1c2b9d3e4a00dddd0004" })));`;
    return runNodeToExit(["-e", script], { JWT_ACCESS_SECRET: secret(), JWT_REFRESH_SECRET: secret(), ...env });
  };

  test("15m / 30d (the upper bounds) mint 900 s and 2,592,000 s tokens", async () => {
    const result = await mint({ ACCESS_TOKEN_EXPIRES: "15m", REFRESH_TOKEN_EXPIRES: "30d" });
    assert.strictEqual(result.code, 0, result.output);
    assert.match(result.output, /LIFETIMES 900 2592000/);
  });

  test("importing jwt.ts with an invalid lifetime fails closed (no token is ever minted)", async () => {
    const result = await mint({ ACCESS_TOKEN_EXPIRES: "30d" });
    assert.notStrictEqual(result.code, 0);
    assert.doesNotMatch(result.output, /LIFETIMES/);
    assert.match(result.output, /ACCESS_TOKEN_EXPIRES/);
  });
});

describe("W6-SEC-05: the real auth-service refuses to start", () => {
  const AUTH = path.join("services", "auth-service", "src", "server.ts");
  for (const [env, variable] of [
    [{ ACCESS_TOKEN_EXPIRES: "abc" }, "ACCESS_TOKEN_EXPIRES"],
    [{ ACCESS_TOKEN_EXPIRES: "30d" }, "ACCESS_TOKEN_EXPIRES"],
    [{ REFRESH_TOKEN_EXPIRES: "31d" }, "REFRESH_TOKEN_EXPIRES"],
    [{ ACCESS_TOKEN_EXPIRES: "15m", REFRESH_TOKEN_EXPIRES: "15m" }, "REFRESH_TOKEN_EXPIRES"],
  ] as const) {
    test(`${JSON.stringify(env)}: exit 1, one line naming ${variable}, no stack, no value`, async () => {
      const result = await runServiceToExit(AUTH, {
        PORT: String(await freePort()),
        JWT_ACCESS_SECRET: secret(),
        JWT_REFRESH_SECRET: secret(),
        INTERNAL_SERVICE_TOKEN: secret(),
        ...env,
      });
      assert.strictEqual(result.code, 1, result.output);
      const refusals = result.output.split(/\r?\n/).filter((line) => line.includes("refusing to start"));
      assert.strictEqual(refusals.length, 1, result.output);
      assert.match(refusals[0], new RegExp(`^\\[auth-service\\] refusing to start: ${variable} `));
      assert.doesNotMatch(result.output, /^\s+at /m);
      assert.doesNotMatch(result.output, /running on|MongoDB/i);
    });
  }
});
