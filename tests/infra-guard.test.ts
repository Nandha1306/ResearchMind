import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { assertDisposableMongoUri, assertDisposableRedisUrl, DEAD_MONGO_URI, DEAD_REDIS_URL } from "./helpers/infra-guard";
import { runNodeToExit } from "./helpers/spawn-service";

/*
 * Wave 6 WP-9 (W6-TEST-19, W6-CI-05, W6-CI-06; scope amendments A-4, A-5,
 * R9, R10): tests may only ever reach DISPOSABLE MongoDB/Redis servers.
 * One guard (helpers/infra-guard.ts) is applied to TEST_MONGO_URI and
 * TEST_REDIS_URL (helpers/test-mongo.ts, helpers/test-redis.ts) and to the
 * test process's own MONGO_URI / REDIS_URL (helpers/test-env.ts), locally
 * AND in CI. Error messages name the variable and the rule, never the URI.
 */

const ROOT = path.resolve(__dirname, "..");
const HELPERS = path.join(ROOT, "tests", "helpers");

const refusedMessage = (fn: () => void): string => {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  assert.fail("expected the guard to refuse");
};

describe("A-4: the target guard (unit)", () => {
  const MONGO_REFUSED: Array<[string, RegExp]> = [
    ["mongodb://127.0.0.1:27017", /non-default port/],
    ["mongodb://127.0.0.1", /non-default port/],
    ["mongodb://localhost/rmtest", /non-default port/],
    ["mongodb://10.0.0.5:27018", /loopback/],
    ["mongodb://0.0.0.0:27018", /loopback/],
    ["mongodb://db.example.net:27018/x", /loopback/],
    ["mongodb://127.0.0.1:27018,db.example.net:27018/x?replicaSet=rs", /loopback/],
    ["mongodb://127.0.0.1:27018,127.0.0.1:27017/x", /non-default port/],
    ["mongodb+srv://u:pw-SECRET-123@cluster0.example.net/x", /mongodb\+srv/],
    ["mongodb://ci_root:pw-SECRET-123@127.0.0.1:27018/rmtest_x", /authSource/],
    ["mongodb://ci_root:pw-SECRET-123@127.0.0.1:27018/", /authSource/],
    ["postgres://127.0.0.1:5432/x", /mongodb:\/\//],
    // Wave 6 Stage E (W6-R5-03): non-canonical ports that drivers read as 27017
    ["mongodb://127.0.0.1:027017", /canonical|non-default port/],
    ["mongodb://localhost:0027017/x", /canonical|non-default port/],
    ["mongodb://127.0.0.1:027018", /canonical/],
    ["mongodb://127.0.0.1:65915", /invalid port/],
  ];
  const REDIS_REFUSED: Array<[string, RegExp]> = [
    ["redis://127.0.0.1:6379", /non-default port/],
    ["redis://127.0.0.1", /non-default port/],
    ["redis://:pw-SECRET-123@localhost:6379/7", /non-default port/],
    ["redis://10.0.0.5:6395", /loopback/],
    ["redis://0.0.0.0:6395/1", /loopback/],
    ["rediss://cache.example.net:6380", /loopback/],
    ["redis://127.0.0.1:6395/x", /database index/],
    ["http://127.0.0.1:6395", /redis:\/\//],
    // Wave 6 Stage E (W6-R5-03): ioredis parses these as 6379
    ["redis://127.0.0.1:06379", /canonical|non-default port/],
    ["redis://127.0.0.1:0006379/7", /canonical|non-default port/],
    ["redis://[::1]:06379", /canonical|non-default port/],
    ["redis://127.0.0.1:65915", /invalid port/],
    ["redis://127.0.0.1:0", /invalid port/],
  ];

  for (const [uri, rule] of MONGO_REFUSED) {
    test(`TEST_MONGO_URI refused: ${uri.replace(/pw-SECRET-123/, "***")}`, () => {
      const message = refusedMessage(() => assertDisposableMongoUri("TEST_MONGO_URI", uri));
      assert.match(message, /^TEST_MONGO_URI: /);
      assert.match(message, rule);
      assert.ok(!message.includes("SECRET") && !message.includes("example.net") && !message.includes("10.0.0.5") && !message.includes(uri), `URI echoed: ${message}`);
    });
  }
  for (const [uri, rule] of REDIS_REFUSED) {
    test(`TEST_REDIS_URL refused: ${uri.replace(/pw-SECRET-123/, "***")}`, () => {
      const message = refusedMessage(() => assertDisposableRedisUrl("TEST_REDIS_URL", uri));
      assert.match(message, /^TEST_REDIS_URL: /);
      assert.match(message, rule);
      assert.ok(!message.includes("SECRET") && !message.includes("example.net") && !message.includes("10.0.0.5"), `URI echoed: ${message}`);
    });
  }

  test("disposable loopback targets on other ports are accepted (incl. the CI URI shapes)", () => {
    for (const uri of [
      "mongodb://127.0.0.1:27095",
      "mongodb://localhost:27018/rmtest_x",
      "mongodb://[::1]:27018",
      "mongodb://ci_root:0123456789abcdef@127.0.0.1:27018/?authSource=admin",
      DEAD_MONGO_URI,
    ]) {
      assertDisposableMongoUri("TEST_MONGO_URI", uri);
    }
    for (const uri of ["redis://127.0.0.1:6395", "redis://:0123456789abcdef@127.0.0.1:6380/7", "rediss://localhost:6380/2", "redis://[::1]:6395/3", DEAD_REDIS_URL]) {
      assertDisposableRedisUrl("TEST_REDIS_URL", uri);
    }
  });
});

const TEST_ENV = path.join(HELPERS, "test-env.ts");
const TEST_MONGO = path.join(HELPERS, "test-mongo.ts");
const TEST_REDIS = path.join(HELPERS, "test-redis.ts");

/** Import a helper in a fresh process with exactly these connection variables. */
const importIn = (helper: string, env: NodeJS.ProcessEnv) =>
  runNodeToExit(
    ["-e", `require(${JSON.stringify(helper)}); console.log("ENV " + JSON.stringify({ r: process.env.REDIS_URL, m: process.env.MONGO_URI }));`],
    { REDIS_URL: undefined, MONGO_URI: undefined, TEST_MONGO_URI: undefined, TEST_REDIS_URL: undefined, CI: undefined, ...env },
    60_000
  );

describe("A-5 / R10: the test process never falls back to 6379 / 27017", () => {
  test("test-env sets dead-port REDIS_URL and MONGO_URI when they are unset", async () => {
    const result = await importIn(TEST_ENV, {});
    assert.strictEqual(result.code, 0, result.output);
    const line = /ENV (.*)/.exec(result.output)?.[1];
    assert.deepStrictEqual(JSON.parse(line!), { r: DEAD_REDIS_URL, m: DEAD_MONGO_URI });
  });

  for (const [variable, value] of [
    ["REDIS_URL", "redis://127.0.0.1:6379"],
    ["REDIS_URL", "redis://localhost"],
    ["MONGO_URI", "mongodb://127.0.0.1:27017/researchmind"],
    ["MONGO_URI", "mongodb://db.example.net:27018/x"],
  ] as const) {
    test(`test-env refuses ${variable} on a real-server target (exit != 0, variable named, URI not printed)`, async () => {
      const result = await importIn(TEST_ENV, { [variable]: value });
      assert.notStrictEqual(result.code, 0, result.output);
      assert.match(result.output, new RegExp(`${variable}: `));
      assert.doesNotMatch(result.output, /^ENV /m);
      assert.ok(!result.output.includes("example.net"), "the URI was printed");
    });
  }

  test("TEST_MONGO_URI on 27017 is refused at import -- also with CI=true", async () => {
    for (const ci of [undefined, "true"]) {
      const result = await importIn(TEST_MONGO, { TEST_MONGO_URI: "mongodb://127.0.0.1:27017", CI: ci });
      assert.notStrictEqual(result.code, 0, result.output);
      assert.match(result.output, /TEST_MONGO_URI: must use a non-default port/);
    }
  });

  test("TEST_MONGO_URI with credentials but no authSource is refused with a clear message (W6-CI-06)", async () => {
    const result = await importIn(TEST_MONGO, { TEST_MONGO_URI: "mongodb://ci_root:pw-SECRET-123@127.0.0.1:27018/" });
    assert.notStrictEqual(result.code, 0);
    assert.match(result.output, /TEST_MONGO_URI: has credentials but no authSource/);
    assert.ok(!result.output.includes("pw-SECRET-123"), "the password was printed");
  });

  test("TEST_REDIS_URL on 6379 is refused at import -- also with CI=true (the old CI exemption is gone)", async () => {
    for (const ci of [undefined, "true"]) {
      const result = await importIn(TEST_REDIS, { TEST_REDIS_URL: "redis://127.0.0.1:6379/7", CI: ci });
      assert.notStrictEqual(result.code, 0, result.output);
      assert.match(result.output, /TEST_REDIS_URL: must use a non-default port/);
    }
  });

  test("TEST_REDIS_URL database base above 13 is refused (the tests use base, base+1, base+2)", async () => {
    const result = await importIn(TEST_REDIS, { TEST_REDIS_URL: "redis://127.0.0.1:6395/14" });
    assert.notStrictEqual(result.code, 0);
    assert.match(result.output, /TEST_REDIS_URL: the database index must be at most 13/);
  });

  test("every test file that loads service or shared code imports the defaults helper first", () => {
    const offenders: string[] = [];
    for (const name of fs.readdirSync(path.join(ROOT, "tests"))) {
      if (!/\.(test|timing)\.ts$/.test(name)) continue;
      const text = fs.readFileSync(path.join(ROOT, "tests", name), "utf8");
      const firstServiceImport = text.search(/from "\.\.\/(services|packages)\/|import\("\.\.\/(services|packages)\//);
      if (firstServiceImport === -1) continue;
      const helperImport = text.search(/from "\.\/helpers\/(test-env|gateway)"|import "\.\/helpers\/test-env"/);
      if (helperImport === -1 || helperImport > firstServiceImport) offenders.push(name);
    }
    assert.deepStrictEqual(offenders, []);
  });

  test("every test file that spawns a process sets both connection variables or uses a safe spawn helper", () => {
    const offenders: string[] = [];
    for (const name of fs.readdirSync(path.join(ROOT, "tests"))) {
      if (!/\.(test|timing)\.ts$/.test(name)) continue;
      const text = fs.readFileSync(path.join(ROOT, "tests", name), "utf8");
      if (!/\bspawn(Sync)?\(\s*process\.execPath/.test(text)) continue; // Node processes (services), not git or docker
      const safeHelper = /helpers\/(spawn-service|compose)"/.test(text);
      if (!safeHelper && !(/\bREDIS_URL\b/.test(text) && /\bMONGO_URI\b/.test(text))) offenders.push(name);
    }
    assert.deepStrictEqual(offenders, []);
  });
});
