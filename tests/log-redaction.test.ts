import assert from "node:assert";
import { test, describe, before, after } from "node:test";
import express from "express";
import { listen } from "./helpers/test-env";
import { errorMiddleware } from "../packages/shared/errors/error.middleware";
import { AppError } from "../packages/shared/errors/AppError";
import { redactSecrets, describeErrorForLog } from "../packages/shared/errors/safe-error";
import { logLlmFailure, LlmUnavailableError } from "../services/ai-service/src/errors/llm.error";

/*
 * Wave 6 WP-1 (W5-L3, W6-SEC-02, scope amendment A-1).
 * - redactSecrets / describeErrorForLog strip user:password from any
 *   scheme://user:pass@host URL (mongodb, mongodb+srv, redis, rediss, amqp, http(s)).
 * - The shared error middleware logs AppErrors with status >= 500 and the
 *   Mongo-unavailable branch through describeErrorForLog (one bounded string,
 *   no raw object, no query string, no attached secrets).
 * - logLlmFailure logs a redacted, bounded description of the provider error.
 * UNIT: no infrastructure. The connection variables point at dead ports so
 * nothing imported here could reach a real server.
 */

process.env.REDIS_URL = "redis://127.0.0.1:6599";
process.env.MONGO_URI = "mongodb://127.0.0.1:6598/rmtest_unused";

const CREDENTIALED_URIS: Array<{ uri: string; secret: string; keep: string }> = [
  { uri: "mongodb://root:S3cretPw@127.0.0.1:27017/admin", secret: "S3cretPw", keep: "127.0.0.1:27017/admin" },
  { uri: "mongodb+srv://u:p4ssw0rdXY@cluster0.example.net/db", secret: "p4ssw0rdXY", keep: "cluster0.example.net/db" },
  { uri: "redis://:R3disPassw0rd@127.0.0.1:6379/0", secret: "R3disPassw0rd", keep: "127.0.0.1:6379/0" },
  { uri: "rediss://default:abcDEF123456@cache.example.net:6380", secret: "abcDEF123456", keep: "cache.example.net:6380" },
  { uri: "amqp://guest:Gu3stPassWord@mq.example.net:5672/vhost", secret: "Gu3stPassWord", keep: "mq.example.net:5672/vhost" },
  { uri: "https://svc-user:HttpPw998877@api.example.net/v1/x", secret: "HttpPw998877", keep: "api.example.net/v1/x" },
];

describe("A-1: credentials inside connection URIs are redacted", () => {
  for (const { uri, secret, keep } of CREDENTIALED_URIS) {
    test(`${uri.split(":")[0]}: the user:password part is removed, scheme and host are kept`, () => {
      const out = redactSecrets(`connect failed for ${uri} (timeout)`);
      assert.ok(!out.includes(secret), `credential leaked: ${out}`);
      assert.ok(out.includes(`${uri.split("://")[0]}://<redacted>@`), out);
      assert.ok(out.includes(keep), `host part lost: ${out}`);
    });
  }

  test("a password containing an unescaped @ does not leak its tail", () => {
    const out = redactSecrets("mongodb://admin:pa@ss@db.example.net:27017/x");
    assert.ok(!out.includes("pa@ss") && !out.includes("ss@db"), out);
    assert.ok(out.includes("db.example.net:27017/x"), out);
  });

  test("URIs without userinfo are unchanged", () => {
    for (const uri of [
      "mongodb://127.0.0.1:27095/rmtest_x",
      "redis://127.0.0.1:6395/7",
      "mongodb+srv://cluster0.example.net/db",
      "https://api.example.net/v1/embed",
    ]) {
      assert.strictEqual(redactSecrets(uri), uri);
    }
  });

  test("describeErrorForLog applies the same rule (Mongo server-selection error)", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED mongodb://root:S3cretPw@db.internal:27017/?authSource=admin"), {
      name: "MongoServerSelectionError",
    });
    const line = describeErrorForLog(err);
    assert.match(line, /^MongoServerSelectionError: /);
    assert.ok(!line.includes("S3cretPw"), line);
  });
});

// ---------------------------------------------------------------------------
// W5-L3: the shared error middleware
// ---------------------------------------------------------------------------

const MW_SECRETS = ["sk-live-ABCDEFGHIJKL1234", "zzzSECRETzzz", "eyJhbGciOiJIUzI1NiJ9.e30.SIGNATUREpart", "S3cretPw", "QUERYTOKEN123"];

let server: { url: string; close: () => Promise<void> };

before(async () => {
  const app = express();
  app.get("/app-error-503", () => {
    throw Object.assign(new AppError("Workspace check failed token=eyJhbGciOiJIUzI1NiJ9.e30.SIGNATUREpart", 503), {
      apiKey: "sk-live-ABCDEFGHIJKL1234",
      config: { headers: { authorization: "Bearer zzzSECRETzzz" } },
    });
  });
  app.get("/llm-502", () => {
    throw new LlmUnavailableError("request_failed", {
      cause: Object.assign(new Error("401 Incorrect API key provided: sk-live-ABCDEFGHIJKL1234"), {
        headers: { authorization: "Bearer zzzSECRETzzz" },
      }),
    });
  });
  app.get("/app-error-404", () => {
    throw new AppError("Workspace not found", 404);
  });
  app.get("/db-down", () => {
    throw Object.assign(
      new Error("Server selection timed out: mongodb://root:S3cretPw@db.internal:27017/?authSource=admin " + "x".repeat(2000)),
      { name: "MongoServerSelectionError" }
    );
  });
  // Wave 6 Stage E (W6-R5-02): V8 puts the WHOLE message on the first stack
  // lines, so the lines after the first message line are message text, not frames.
  app.get("/multiline-app-error", () => {
    throw new AppError("Provider error\nmongodb://svc:Qx7Hv92Lmn4K@db.internal:27017/app\nthird line", 503);
  });
  app.get("/multiline-unhandled", () => {
    throw new Error("Unexpected failure\nredis://:Qx7Hv92Lmn4K@cache.internal:6379/0\nmore");
  });
  app.use(errorMiddleware);
  server = await listen(app);
});

after(async () => {
  await server?.close();
});

const captureConsoleError = (t: any) => {
  const calls: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    calls.push(args);
  });
  return calls;
};

const assertOneSafeLine = (calls: unknown[][]): string => {
  assert.strictEqual(calls.length, 1, `expected one console.error call, got ${calls.length}`);
  assert.strictEqual(calls[0].length, 1, "expected a single argument (no raw object)");
  assert.strictEqual(typeof calls[0][0], "string", "expected a string, not an error object");
  const line = calls[0][0] as string;
  for (const secret of MW_SECRETS) assert.ok(!line.includes(secret), `${secret} logged: ${line}`);
  assert.ok(!line.includes("QUERYTOKEN"), `query string logged: ${line}`);
  return line;
};

describe("W5-L3: error middleware logs 5xx AppErrors and DB outages through describeErrorForLog", () => {
  test("AppError 503 with a token-like message and attached apiKey/authorization: one redacted line", async (t) => {
    const calls = captureConsoleError(t);
    const res = await fetch(`${server.url}/app-error-503?access_token=QUERYTOKEN123`);
    assert.strictEqual(res.status, 503);
    const line = assertOneSafeLine(calls);
    assert.match(line, /^\[GET \/app-error-503\] AppError status=503: Workspace check failed token=<redacted>/);
    const firstLine = line.split("\n")[0];
    assert.ok(firstLine.length <= 400, `first line too long: ${firstLine.length}`);
  });

  test("LlmUnavailableError 502: the provider cause is not logged", async (t) => {
    const calls = captureConsoleError(t);
    const res = await fetch(`${server.url}/llm-502`);
    assert.strictEqual(res.status, 502);
    const line = assertOneSafeLine(calls);
    assert.match(line, /^\[GET \/llm-502\] LlmUnavailableError status=502: AI service is temporarily unavailable/);
  });

  test("AppError below 500 is not logged", async (t) => {
    const calls = captureConsoleError(t);
    const res = await fetch(`${server.url}/app-error-404`);
    assert.strictEqual(res.status, 404);
    assert.strictEqual(calls.length, 0);
  });

  test("Mongo-unavailable branch: credentialed URI and query string removed, message bounded", async (t) => {
    const calls = captureConsoleError(t);
    const res = await fetch(`${server.url}/db-down?token=QUERYTOKEN123`);
    assert.strictEqual(res.status, 503);
    const line = assertOneSafeLine(calls);
    assert.match(line, /^\[GET \/db-down\] Database unavailable: MongoServerSelectionError: Server selection timed out: mongodb:\/\/<redacted>@db\.internal/);
    assert.ok(line.length <= 400, `line too long: ${line.length}`);
  });

  for (const [route, branch] of [
    ["/multiline-app-error", "AppError >= 500"],
    ["/multiline-unhandled", "catch-all"],
  ] as const) {
    test(`W6-R5-02 (${branch}): a multi-line message never reaches the log through the stack lines`, async (t) => {
      const calls = captureConsoleError(t);
      const res = await fetch(`${server.url}${route}`);
      assert.ok(res.status >= 500);
      assert.strictEqual(calls.length, 1);
      const line = String(calls[0][0]);
      assert.ok(!line.includes("Qx7Hv92Lmn4K"), `secret logged: ${line}`);
      // The (redacted) message stays on the first line; every further line is a frame.
      const [first, ...rest] = line.split("\n");
      assert.match(first, /(third line|more)$/, `message not kept on one line: ${first}`);
      assert.ok(rest.length > 0 && rest.length <= 8, `frames: ${rest.length}`);
      for (const frame of rest) {
        assert.match(frame, /^\s+at /, `not a stack frame: ${frame}`);
        assert.ok(frame.length <= 300, `frame too long: ${frame.length}`);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// W6-R5-05: pattern gaps found by the independent review
// ---------------------------------------------------------------------------

describe("W6-R5-05: JSON-quoted keys, bare JWTs, name/code/status are redacted and bounded", () => {
  const S = "Qx7Hv92Lmn4K";
  for (const text of [`{"apiKey":"${S}"}`, `{"password":"${S}"}`, `"secret": "${S}"`, `{'token': '${S}'}`, `{"access_key" : "${S}"}`]) {
    test(`quoted key/value: ${text}`, () => {
      const out = redactSecrets(text);
      assert.ok(!out.includes(S), out);
      assert.match(out, /<redacted>/);
    });
  }

  test("a bare JWT (no Bearer) is redacted", () => {
    const jwtLike = `eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiI${S}In0.c2lnbmF0dXJlLXBhcnQ`;
    const out = redactSecrets(`session ${jwtLike} rejected`);
    assert.ok(!out.includes(S) && !out.includes("c2lnbmF0dXJlLXBhcnQ"), out);
    assert.match(out, /<redacted-jwt>/);
  });

  test("name, code and status are redacted and capped at 100 characters each", () => {
    const err = Object.assign(new Error("short"), {
      name: `Err${"N".repeat(5000)}`,
      code: `api_key=${S}${"C".repeat(5000)}`,
      status: `token ${S}`,
    });
    const line = describeErrorForLog(err);
    assert.ok(!line.includes(S), line.slice(0, 300));
    assert.ok(line.length <= 100 + 100 + 100 + 300 + 30, `line too long: ${line.length}`);
  });
});

// ---------------------------------------------------------------------------
// W6-SEC-02: logLlmFailure
// ---------------------------------------------------------------------------

describe("W6-SEC-02: logLlmFailure redacts and bounds the provider error", () => {
  test("a gsk_ key in the provider message is redacted; the line is at most 400 characters", (t) => {
    const calls = captureConsoleError(t);
    logLlmFailure("stream", "request_failed", new Error("Incorrect API key provided: gsk_abcdefghijklmnop"));
    assert.strictEqual(calls.length, 1);
    const line = String(calls[0][0]);
    assert.ok(line.includes("<redacted"), line);
    assert.ok(!line.includes("gsk_abcdefghijklmnop"), line);
    assert.ok(line.length <= 400, `line too long: ${line.length}`);
    assert.match(line, /^\[ai-service\] LLM stream failed \(reason=request_failed\) :: Error: /);
  });

  test("sk- keys, bearer tokens and very long messages are redacted and bounded", (t) => {
    const calls = captureConsoleError(t);
    const err = Object.assign(new Error(`401 sk-proj-ABCDEFGHIJKLMNOP Authorization: Bearer zzzSECRETzzz ${"y".repeat(10_000)}`), {
      status: 401,
    });
    logLlmFailure("completion", "request_failed", err);
    const line = String(calls[0][0]);
    assert.ok(!line.includes("sk-proj-ABCDEFGHIJKLMNOP") && !line.includes("zzzSECRETzzz"), line);
    assert.ok(line.length <= 400, `line too long: ${line.length}`);
    assert.match(line, /status=401/);
  });

  test("a non-Error value is redacted too; no error means no detail", (t) => {
    const calls = captureConsoleError(t);
    logLlmFailure("meeting summary", "request_failed", "provider said: api_key=pa-STUBKEY123456");
    logLlmFailure("stream", "empty_content");
    assert.ok(!String(calls[0][0]).includes("pa-STUBKEY123456"), String(calls[0][0]));
    assert.strictEqual(String(calls[1][0]), "[ai-service] LLM stream failed (reason=empty_content)");
  });
});

// ---------------------------------------------------------------------------
// Stage E round 2 (W6-R5-08): redaction is linear-time on crafted input
// ---------------------------------------------------------------------------

describe("W6-R5-08: crafted 100 KB messages are redacted in well under 100 ms", () => {
  const SHAPES: Array<[string, string]> = [
    ["eyJaaaaa- repeated (JWT rule)", "eyJaaaaa-"],
    ["ab- repeated (URI scheme rule)", "ab-"],
    ["a:// repeated (URI userinfo rule)", "a://"],
    ["http:// repeated (query rule)", "http://"],
    ["sk- repeated (provider key rule)", "sk-a"],
  ];
  const timeOf = (fn: () => unknown) => {
    const runs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const started = performance.now();
      fn();
      runs.push(performance.now() - started);
    }
    return runs.sort((a, b) => a - b)[1]; // median of 3
  };
  for (const [label, unit] of SHAPES) {
    test(label, () => {
      const message = unit.repeat(Math.ceil(100_000 / unit.length));
      const redactMs = timeOf(() => redactSecrets(message));
      const describeMs = timeOf(() => describeErrorForLog(new Error(message)));
      assert.ok(redactMs < 100, `redactSecrets took ${redactMs.toFixed(1)} ms`);
      assert.ok(describeMs < 100, `describeErrorForLog took ${describeMs.toFixed(1)} ms`);
      assert.ok(describeErrorForLog(new Error(message)).length <= 320);
    });
  }

  test("a secret after the first 4 KB is not echoed (input is bounded before the rules run)", () => {
    const out = redactSecrets(`${"x".repeat(5000)} mongodb://u:Qx7Hv92Lmn4K@h/db`);
    assert.ok(!out.includes("Qx7Hv92Lmn4K"));
    assert.ok(out.length <= 4096, `output ${out.length} characters`);
  });
});

// ---------------------------------------------------------------------------
// Stage E round 2 (W6-R5-10): message lines shaped like frames are redacted
// ---------------------------------------------------------------------------

describe("W6-R5-10: retained stack-frame lines pass through redaction", () => {
  let frameServer: { url: string; close: () => Promise<void> };

  before(async () => {
    const app = express();
    app.get("/frames-app-error", () => {
      throw new AppError("Provider error\n    at mongodb://svc:Qx7Hv92Lmn4K@db.internal:27017/app\n    at token=Qx7Hv92Lmn4K", 503);
    });
    app.get("/frames-wrapped", () => {
      throw new Error("wrapped: inner\n    at Object.connect (redis://:Qx7Hv92Lmn4K@cache:6379)");
    });
    app.get("/frames-crlf", () => {
      throw new AppError("x\r\n    at api_key=Qx7Hv92Lmn4K", 500);
    });
    app.use(errorMiddleware);
    frameServer = await listen(app);
  });

  after(async () => {
    await frameServer?.close();
  });

  for (const [route, branch] of [
    ["/frames-app-error", "AppError >= 500"],
    ["/frames-wrapped", "catch-all, wrapped error"],
    ["/frames-crlf", "AppError, CRLF"],
  ] as const) {
    test(`${branch}: no secret in any logged line; frame lines still capped`, async (t) => {
      const calls = captureConsoleError(t);
      const res = await fetch(`${frameServer.url}${route}`);
      assert.ok(res.status >= 500);
      assert.strictEqual(calls.length, 1);
      const line = String(calls[0][0]);
      assert.ok(!line.includes("Qx7Hv92Lmn4K"), `secret logged: ${line}`);
      for (const frame of line.split("\n").slice(1)) {
        assert.match(frame, /^\s+at /);
        assert.ok(frame.length <= 300, `frame too long: ${frame.length}`);
      }
    });
  }
});
