import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, test } from "node:test";
import { REPO_ROOT, SERVICE_KEYS, randomHex } from "./helpers/compose";

/*
 * SEC-014: input validation of docker/mongo/provision-service-users.js.
 *
 * The script normally runs in mongosh. Here it runs in a Node vm context with
 * the only globals it uses (process.env, db, print) stubbed, so the validation
 * rules are checked without a MongoDB server. The real-server behaviour
 * (users, roles, idempotence) is covered by compose-security.runtime.test.ts.
 *
 * Validation matters most on a fresh volume: a rejected input makes the
 * container exit, and the next start skips init and leaves MongoDB with the
 * root user only (see docs/deployment/docker-process.md). Every bad input must
 * therefore be rejected up front, before anything is written, naming the
 * variable and never the value.
 */

const SCRIPT = fs.readFileSync(path.join(REPO_ROOT, "docker", "mongo", "provision-service-users.js"), "utf8");
const OPERATOR = "rmtest-root";

type Call = { op: "create" | "update"; user: string; roles: unknown };

const validEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const key of SERVICE_KEYS) {
    const lower = key.toLowerCase();
    env[`MONGO_${key}_USERNAME`] = `rm-${lower}-svc`;
    env[`MONGO_${key}_PASSWORD`] = randomHex();
    env[`MONGO_${key}_DATABASE`] = `researchmind-${lower}`;
  }
  return env;
};

const run = (env: Record<string, string>) => {
  const calls: Call[] = [];
  const output: string[] = [];
  const admin = {
    runCommand: () => ({ ok: 1, authInfo: { authenticatedUsers: [{ user: OPERATOR, db: "admin" }] } }),
    getUser: () => null,
    createUser: (spec: { user: string; roles: unknown }) => calls.push({ op: "create", user: spec.user, roles: spec.roles }),
    updateUser: (user: string, spec: { roles: unknown }) => calls.push({ op: "update", user, roles: spec.roles }),
  };
  const context = {
    process: { env },
    db: { getSiblingDB: (name: string) => (name === "admin" ? admin : assert.fail(`unexpected database ${name}`)) },
    print: (...args: unknown[]) => output.push(args.join(" ")),
  };
  let error: Error | undefined;
  try {
    vm.runInNewContext(SCRIPT, context, { filename: "provision-service-users.js" });
  } catch (err) {
    error = err as Error;
  }
  // Plain copies: values created inside the vm realm fail deepStrictEqual's prototype check.
  return { calls: JSON.parse(JSON.stringify(calls)) as Call[], output: output.join("\n"), error };
};

const assertRejected = (env: Record<string, string>, variable: string, badValue: string) => {
  const { calls, output, error } = run(env);
  assert.ok(error, `the script accepted ${variable}=${JSON.stringify(badValue)}`);
  assert.match(error.message, /^provision-service-users: /);
  assert.match(error.message, new RegExp(`\\b${variable}\\b`), "the error does not name the variable");
  assert.ok(!error.message.includes(badValue), "the error message contains the rejected value");
  assert.deepStrictEqual(calls, [], "the script wrote users before validating every input");
  assert.strictEqual(output, "");
};

describe("provision-service-users.js input validation", () => {
  test("valid input: one user per service, readWrite on its own database only, no password printed", () => {
    const env = validEnv();
    const { calls, output, error } = run(env);
    assert.ifError(error);
    assert.deepStrictEqual(
      calls,
      SERVICE_KEYS.map((key) => ({
        op: "create",
        user: env[`MONGO_${key}_USERNAME`],
        roles: [{ role: "readWrite", db: env[`MONGO_${key}_DATABASE`] }],
      }))
    );
    for (const key of SERVICE_KEYS) {
      assert.ok(output.includes(`created ${env[`MONGO_${key}_USERNAME`]} (readWrite on ${env[`MONGO_${key}_DATABASE`]})`));
      assert.ok(!output.includes(env[`MONGO_${key}_PASSWORD`]), "a password was printed");
    }
  });

  for (const badDatabase of ["researchmind.document", "a/b", "a\\b", "a b", "a$b", 'a"b', "-leading", "x".repeat(64)]) {
    test(`rejects database name ${JSON.stringify(badDatabase.length > 20 ? `${badDatabase.slice(0, 8)}... (${badDatabase.length} chars)` : badDatabase)}`, () => {
      const env = validEnv();
      env.MONGO_DOCUMENT_DATABASE = badDatabase;
      assertRejected(env, "MONGO_DOCUMENT_DATABASE", badDatabase);
    });
  }

  for (const reserved of ["admin", "Local", "config"]) {
    test(`rejects system database ${reserved}`, () => {
      const env = validEnv();
      env.MONGO_TASK_DATABASE = reserved;
      assertRejected(env, "MONGO_TASK_DATABASE", "\u0000"); // value may appear in the reserved-list text
    });
  }

  const badPasswords: [string, string][] = [
    ["15 characters (too short)", "a1b2c3d4e5f6g7h"],
    ["base64 '+'", "abcdefghijklmnop+qrs"],
    ["base64 '/'", "abcdefghijklmnop/qrs"],
    ["base64 '=' padding", "abcdefghijklmnopqrs="],
    ["'@' (breaks the connection string)", "abcdefghijklmnop@qrs"],
    ["':'", "abcdefghijklmnop:qrs"],
    ["a space", "abcdefghijklmnop qrs"],
  ];
  for (const [label, password] of badPasswords) {
    test(`rejects a password with ${label}`, () => {
      const env = validEnv();
      env.MONGO_AI_PASSWORD = password;
      assertRejected(env, "MONGO_AI_PASSWORD", password);
    });
  }

  test("rejects a missing or blank variable", () => {
    const env = validEnv();
    delete env.MONGO_WORKSPACE_USERNAME;
    assertRejected(env, "MONGO_WORKSPACE_USERNAME", "\u0000");
    const blank = validEnv();
    blank.MONGO_AUTH_PASSWORD = "   ";
    assertRejected(blank, "MONGO_AUTH_PASSWORD", "\u0000");
  });

  test("refuses to provision the user running the script", () => {
    const env = validEnv();
    env.MONGO_AUTH_USERNAME = OPERATOR;
    const { calls, error } = run(env);
    assert.match(String(error?.message), /MONGO_AUTH_USERNAME names the user running this script/);
    assert.deepStrictEqual(calls, []);
  });
});
