import assert from "node:assert";
import { describe, test, before, after } from "node:test";
import express from "express";
import mongoose from "mongoose";
import { setTestSecrets, listen } from "./helpers/test-env";
import { registerSchema, loginSchema } from "../packages/validation/schemas/auth.schema";
import { registerSchema as clientRegisterSchema } from "../frontend/src/lib/validations/auth.schema.ts";

/*
 * Wave 6 WP-4 (W6-SEC-04, scope amendment A-13 / R5): registration fields
 * have upper bounds -- name 100 characters after trimming, e-mail 254,
 * password 128 -- on the server's registerSchema and, with the same verdicts,
 * on the client form. loginSchema gets no password maximum below 1024, so no
 * existing account can be locked out. The User model also caps name and
 * e-mail (User.create is the only write path to users; nothing re-saves an
 * existing user, so legacy rows are never re-validated).
 * UNIT: the real auth router + shared error middleware; the User and
 * RefreshToken models are stubbed at the method level (no MongoDB).
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599";
process.env.MONGO_URI = "mongodb://127.0.0.1:6598/rmtest_unused";

const PASSWORD_OK = "a".repeat(127) + "1"; // 128
const PASSWORD_LONG = "a".repeat(128) + "1"; // 129
const NAME_OK = "N".repeat(100);
const NAME_LONG = "N".repeat(101);
// 64 + 1 + 189 = 254 characters
const EMAIL_OK = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}.com`;
const EMAIL_LONG = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(58)}.com`;

const VALID = { name: "Ada", email: "ada@example.test", password: "abcdefg1" };

describe("W6-SEC-04: registerSchema bounds (server)", () => {
  test("fixtures have the intended lengths", () => {
    assert.strictEqual(EMAIL_OK.length, 254);
    assert.strictEqual(EMAIL_LONG.length, 255);
    assert.strictEqual(PASSWORD_OK.length, 128);
    assert.strictEqual(PASSWORD_LONG.length, 129);
  });

  test("name: 100 accepted, 101 refused, surrounding spaces trimmed first", () => {
    assert.ok(registerSchema.safeParse({ ...VALID, name: NAME_OK }).success);
    assert.ok(!registerSchema.safeParse({ ...VALID, name: NAME_LONG }).success);
    const padded = registerSchema.safeParse({ ...VALID, name: `  ${NAME_OK}  ` });
    assert.ok(padded.success);
    assert.strictEqual(padded.data.name, NAME_OK);
    assert.ok(!registerSchema.safeParse({ ...VALID, name: "  A  " }).success, "min 2 applies after trimming");
  });

  test("e-mail: 254 accepted, 255 refused", () => {
    assert.ok(registerSchema.safeParse({ ...VALID, email: EMAIL_OK }).success);
    assert.ok(!registerSchema.safeParse({ ...VALID, email: EMAIL_LONG }).success);
  });

  test("password: 128 accepted, 129 refused (with a message naming the limit)", () => {
    assert.ok(registerSchema.safeParse({ ...VALID, password: PASSWORD_OK }).success);
    const long = registerSchema.safeParse({ ...VALID, password: PASSWORD_LONG });
    assert.ok(!long.success);
    assert.match(long.error.issues.map((i) => i.message).join(" "), /128/);
  });

  test("loginSchema keeps accepting long passwords (no maximum below 1024)", () => {
    assert.ok(loginSchema.safeParse({ email: "ada@example.test", password: "x".repeat(1024) }).success);
  });
});

describe("W6-SEC-04: the client form reaches the same verdicts", () => {
  const cases: Array<[string, Partial<typeof VALID>]> = [
    ["name 100", { name: NAME_OK }],
    ["name 101", { name: NAME_LONG }],
    ["padded name 100", { name: `  ${NAME_OK}  ` }],
    ["padded one-letter name", { name: "  A  " }],
    ["e-mail 254", { email: EMAIL_OK }],
    ["e-mail 255", { email: EMAIL_LONG }],
    ["password 128", { password: PASSWORD_OK }],
    ["password 129", { password: PASSWORD_LONG }],
  ];
  for (const [label, override] of cases) {
    test(label, () => {
      const input = { ...VALID, ...override };
      const server = registerSchema.safeParse(input).success;
      const client = clientRegisterSchema.safeParse({ ...input, confirmPassword: input.password }).success;
      assert.strictEqual(client, server, label);
    });
  }
});

describe("W6-SEC-04: POST /api/auth/register through the real router", () => {
  let server: { url: string; close: () => Promise<void> };
  let User: any;
  let RefreshToken: any;
  const created: any[] = [];
  const originals: Record<string, any> = {};

  before(async () => {
    ({ User } = await import("../services/auth-service/src/models/User"));
    ({ RefreshToken } = await import("../services/auth-service/src/models/RefreshToken"));
    originals.findOne = User.findOne;
    originals.create = User.create;
    originals.rtCreate = RefreshToken.create;
    User.findOne = async () => null;
    User.create = async (doc: any) => {
      created.push(doc);
      return { _id: new mongoose.Types.ObjectId(), name: doc.name, email: doc.email };
    };
    RefreshToken.create = async () => ({});
    const { default: authRoutes } = await import("../services/auth-service/src/routes/auth.routes");
    const { errorMiddleware } = await import("../packages/shared/errors/error.middleware");
    const app = express();
    app.use(express.json({ limit: "100kb" }));
    app.use("/api/auth", authRoutes);
    app.use(errorMiddleware);
    server = await listen(app);
  });

  after(async () => {
    User.findOne = originals.findOne;
    User.create = originals.create;
    RefreshToken.create = originals.rtCreate;
    await server?.close();
  });

  const register = async (body: object) => {
    const res = await fetch(`${server.url}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  test("exactly 100 / 254 / 128 characters: 201", async () => {
    const res = await register({ name: NAME_OK, email: EMAIL_OK, password: PASSWORD_OK });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body).slice(0, 300));
    assert.strictEqual(created.at(-1).name, NAME_OK);
  });

  for (const [label, override] of [
    ["name 101", { name: NAME_LONG }],
    ["e-mail 255", { email: EMAIL_LONG }],
    ["password 129", { password: PASSWORD_LONG }],
  ] as const) {
    test(`${label}: 400 and nothing created`, async () => {
      const before = created.length;
      const res = await register({ name: NAME_OK, email: EMAIL_OK, password: PASSWORD_OK, ...override });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(created.length, before);
    });
  }

  test("a 90,000-character name (the Wave 6 probe) is refused with 400", async () => {
    const res = await register({ ...VALID, name: "x".repeat(90_000) });
    assert.strictEqual(res.status, 400);
  });
});

describe("W6-SEC-04: the User model caps name and e-mail", () => {
  test("validateSync refuses a 101-character name and a 255-character e-mail", async () => {
    const { User } = await import("../services/auth-service/src/models/User");
    const ok = new User({ name: NAME_OK, email: EMAIL_OK, password: "hash" });
    assert.strictEqual(ok.validateSync(), undefined);
    const bad = new User({ name: NAME_LONG, email: EMAIL_LONG, password: "hash" });
    const errors = Object.keys(bad.validateSync()?.errors ?? {}).sort();
    assert.deepStrictEqual(errors, ["email", "name"]);
  });
});
