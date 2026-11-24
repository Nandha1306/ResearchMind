import assert from "node:assert";
import crypto from "node:crypto";
import { describe, test, before, after, beforeEach } from "node:test";
import { infraDescribe } from "./helpers/infra";
import { setTestSecrets, listen } from "./helpers/test-env";
import { connectTestDatabase, mongoSkip } from "./helpers/test-mongo";

/*
 * SEC-025: per-account sign-in throttle in auth-service, through the REAL auth
 * app (HTTP) against a disposable MongoDB. No Redis is involved: the throttle
 * holds while the gateway's per-IP limiter fails open.
 */

setTestSecrets();

const PASSWORD = "password123";
let app: { url: string; close: () => Promise<void> };
let db: { cleanup: () => Promise<void> } | undefined;
let authService: typeof import("../services/auth-service/src/services/auth.service");
let LoginThrottle: typeof import("../services/auth-service/src/models/LoginThrottle").LoginThrottle;

before(async () => {
  if (mongoSkip) return;
  db = await connectTestDatabase("throttle");
  authService = await import("../services/auth-service/src/services/auth.service");
  ({ LoginThrottle } = await import("../services/auth-service/src/models/LoginThrottle"));
  await LoginThrottle.init();
  const { default: authApp } = await import("../services/auth-service/src/app");
  app = await listen(authApp);
});

after(async () => {
  await app?.close();
  await db?.cleanup();
});

const newEmail = () => `user-${crypto.randomBytes(5).toString("hex")}@example.test`;
const newUser = async () => {
  const email = newEmail();
  await authService.registerUser({ name: "Throttle Test", email, password: PASSWORD });
  return email;
};

const login = async (email: string, password: string) => {
  const res = await fetch(`${app.url}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json() };
};

const failTimes = async (email: string, n: number) => {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) statuses.push((await login(email, "wrong-password")).status);
  return statuses;
};

infraDescribe("SEC-025: per-account sign-in throttle (real MongoDB)", mongoSkip, () => {
  beforeEach(() => {
    delete process.env.LOGIN_THROTTLE_MAX_FAILURES;
    delete process.env.LOGIN_THROTTLE_WINDOW_MS;
    delete process.env.LOGIN_THROTTLE_LOCK_MS;
  });

  test("defaults: 10 failures lock the account; the 11th attempt is 429 even with the right password", async () => {
    const email = await newUser();
    assert.deepStrictEqual(await failTimes(email, 10), Array(10).fill(401));
    const locked = await login(email, PASSWORD);
    assert.strictEqual(locked.status, 429);
    assert.deepStrictEqual(locked.body, {
      success: false,
      message: "Too many failed sign-in attempts for this account. Please try again later.",
    });
    const lockedBody = locked.body as Record<string, unknown>;
    assert.ok(!lockedBody.accessToken && !lockedBody.data, "no token while locked");

    // The collection stores a hash, never the address.
    const records = await LoginThrottle.find({}).lean();
    assert.ok(records.length > 0);
    assert.ok(!JSON.stringify(records).includes(email));
  });

  test("an unknown e-mail gets exactly the same status sequence and bodies (no enumeration)", async () => {
    const known = await newUser();
    const unknown = newEmail();
    const run = async (email: string) => {
      const out: { status: number; body: unknown }[] = [];
      for (let i = 0; i < 10; i++) out.push(await login(email, "wrong-password"));
      out.push(await login(email, PASSWORD));
      return out;
    };
    assert.deepStrictEqual(await run(unknown), await run(known));
  });

  test("a successful sign-in resets the count", async () => {
    const email = await newUser();
    assert.deepStrictEqual(await failTimes(email, 9), Array(9).fill(401));
    assert.strictEqual((await login(email, PASSWORD)).status, 200);
    assert.deepStrictEqual(await failTimes(email, 9), Array(9).fill(401));
    assert.strictEqual((await login(email, PASSWORD)).status, 200);
  });

  test("accounts are throttled independently; the e-mail is normalised (case)", async () => {
    const a = await newUser();
    const b = await newUser();
    await failTimes(a.toUpperCase(), 10);
    assert.strictEqual((await login(a, PASSWORD)).status, 429, "upper-case attempts count for the account");
    assert.strictEqual((await login(b, PASSWORD)).status, 200);
  });

  test("the lock ends after LOGIN_THROTTLE_LOCK_MS; settings are configurable", async () => {
    process.env.LOGIN_THROTTLE_MAX_FAILURES = "3";
    // Wave 5: the window was 1000 ms, but three bcrypt sign-ins take ~0.5 s
    // each in a full parallel `npm test` run, so the failures fell out of the
    // window before the lock (load flake, 2 of 2 full runs). The window only
    // has to hold the three failures.
    process.env.LOGIN_THROTTLE_WINDOW_MS = "30000";
    // Wave 6 (W6-TEST-04): the lock is 5000 ms and its end is read from the
    // stored lockedUntil instead of a fixed 1.2 s sleep, so a slow request
    // under load can no longer land after the lock. The duration is still
    // proven: lockedUntil is LOCK_MS after the third failure, the account is
    // still locked after the old 1.2 s, and it opens only after lockedUntil.
    const LOCK_MS = 5000;
    process.env.LOGIN_THROTTLE_LOCK_MS = String(LOCK_MS);
    const email = await newUser();
    assert.deepStrictEqual(await failTimes(email, 2), [401, 401]);
    const t0 = Date.now();
    assert.strictEqual((await login(email, "wrong-password")).status, 401);
    const t1 = Date.now();

    const { loginThrottleKey } = await import("../services/auth-service/src/services/login-throttle");
    const record = await LoginThrottle.findOne({ key: loginThrottleKey(email) }).lean();
    const lockedUntil = new Date(record?.lockedUntil as Date).getTime();
    const TOLERANCE_MS = 50; // database round trip / Date precision only
    assert.ok(
      lockedUntil >= t0 + LOCK_MS - TOLERANCE_MS && lockedUntil <= t1 + LOCK_MS + TOLERANCE_MS,
      `lockedUntil is ${lockedUntil - t0} ms after the third failure started (expected ${LOCK_MS}..${LOCK_MS + (t1 - t0)})`
    );

    assert.strictEqual((await login(email, PASSWORD)).status, 429);
    const oldWait = t1 + 1200 - Date.now();
    if (oldWait > 0) await new Promise((resolve) => setTimeout(resolve, oldWait));
    assert.strictEqual((await login(email, PASSWORD)).status, 429, "the lock must outlive the old 1 s value");

    const deadline = t1 + LOCK_MS + 10_000;
    while (Date.now() <= lockedUntil + 100) {
      assert.ok(Date.now() <= deadline, "the stored lock did not end in time");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.strictEqual((await login(email, PASSWORD)).status, 200);
  });

  test("failures outside the window do not add up", async () => {
    process.env.LOGIN_THROTTLE_MAX_FAILURES = "3";
    process.env.LOGIN_THROTTLE_WINDOW_MS = "1000";
    const email = await newUser();
    await failTimes(email, 2);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.deepStrictEqual(await failTimes(email, 2), [401, 401], "a new window started");
    assert.strictEqual((await login(email, PASSWORD)).status, 200);
  });

  test("invalid settings fall back to the defaults", async () => {
    process.env.LOGIN_THROTTLE_MAX_FAILURES = "zero";
    const { loginThrottleSettings } = await import("../services/auth-service/src/services/login-throttle");
    assert.strictEqual(loginThrottleSettings().maxFailures, 10);
  });

  test("a concurrent burst of failures still locks the account", async () => {
    const email = await newUser();
    const results = await Promise.all(Array.from({ length: 20 }, () => login(email, "wrong-password")));
    assert.ok(results.every((r) => r.status === 401 || r.status === 429));
    assert.strictEqual((await login(email, PASSWORD)).status, 429);
    const record = await LoginThrottle.findOne({}).sort({ failures: -1 }).lean();
    assert.ok(record && record.failures >= 10);
  });
});
