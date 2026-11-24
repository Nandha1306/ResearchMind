import assert from "node:assert";
import crypto from "node:crypto";
import { describe, test, before, after } from "node:test";
import { infraDescribe } from "./helpers/infra";
import { setTestSecrets, listen } from "./helpers/test-env";
import { connectTestDatabase, mongoSkip } from "./helpers/test-mongo";

/*
 * SEC-025 / SEC-009: a sign-in for an UNKNOWN e-mail must take about as long
 * as a wrong password for a real account (auth-service runs one bcrypt check
 * of the same cost against a fixed dummy hash), so response time does not
 * reveal whether an account exists. Real auth app over HTTP, real MongoDB.
 *
 * Timing-sensitive: run serialized by `npm run test:timing`. The threshold is
 * deliberately tolerant (medians, ratio >= 0.6): before the fix the unknown
 * e-mail answered about 10x faster (about 20 ms vs about 200 ms).
 */

setTestSecrets();
// Keep the account throttle out of the way: this test sends many failures.
process.env.LOGIN_THROTTLE_MAX_FAILURES = "1000";

let app: { url: string; close: () => Promise<void> };
let db: { cleanup: () => Promise<void> } | undefined;
let authService: typeof import("../services/auth-service/src/services/auth.service");

before(async () => {
  if (mongoSkip) return;
  db = await connectTestDatabase("logintiming");
  authService = await import("../services/auth-service/src/services/auth.service");
  const { default: authApp } = await import("../services/auth-service/src/app");
  app = await listen(authApp);
});

after(async () => {
  await app?.close();
  await db?.cleanup();
});

const timedLogin = async (email: string) => {
  const started = performance.now();
  const res = await fetch(`${app.url}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "wrong-password" }),
  });
  await res.arrayBuffer();
  return { status: res.status, ms: performance.now() - started };
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

infraDescribe("SEC-025: sign-in timing does not reveal whether an account exists (real MongoDB)", mongoSkip, () => {
  test("unknown e-mail and wrong password take about the same time", async () => {
    const known = `known-${crypto.randomBytes(5).toString("hex")}@example.test`;
    await authService.registerUser({ name: "Timing Test", email: known, password: "password123" });

    // Warm up both paths (JIT, connection pool).
    await timedLogin(known);
    await timedLogin(`warm-${crypto.randomBytes(5).toString("hex")}@example.test`);

    /*
     * Wave 6 (W6-TEST-03, D-4 / A-2): 31 pairs in ABBA order -- pair i sends
     * the known e-mail first when i mod 4 is 0 or 3 and the unknown one first
     * otherwise -- which cancels drift and order effects. Both former median
     * assertions are kept unchanged, and the median of the per-pair ratios
     * u_i/k_i must meet the SAME thresholds. No retry.
     */
    const PAIRS = 31;
    const knownMs: number[] = [];
    const unknownMs: number[] = [];
    const ratios: number[] = [];
    for (let i = 0; i < PAIRS; i++) {
      const unknown = `nobody-${crypto.randomBytes(5).toString("hex")}@example.test`;
      const knownFirst = i % 4 === 0 || i % 4 === 3;
      let kr: Awaited<ReturnType<typeof timedLogin>>;
      let ur: Awaited<ReturnType<typeof timedLogin>>;
      if (knownFirst) {
        kr = await timedLogin(known);
        ur = await timedLogin(unknown);
      } else {
        ur = await timedLogin(unknown);
        kr = await timedLogin(known);
      }
      assert.strictEqual(kr.status, 401);
      assert.strictEqual(ur.status, 401);
      knownMs.push(kr.ms);
      unknownMs.push(ur.ms);
      ratios.push(ur.ms / kr.ms);
    }
    const k = median(knownMs);
    const u = median(unknownMs);
    const r = median(ratios);
    console.log(`median wrong-password ${k.toFixed(1)} ms, unknown e-mail ${u.toFixed(1)} ms, median paired ratio ${r.toFixed(3)} (${PAIRS} ABBA pairs)`);
    assert.ok(u >= 0.6 * k, `unknown e-mail answers much faster (${u.toFixed(1)} vs ${k.toFixed(1)} ms)`);
    assert.ok(u <= 1.6 * k + 20, `unknown e-mail answers much slower (${u.toFixed(1)} vs ${k.toFixed(1)} ms)`);
    assert.ok(r >= 0.6, `paired: unknown e-mail answers much faster (median ratio ${r.toFixed(3)})`);
    assert.ok(r <= 1.6 + 20 / k, `paired: unknown e-mail answers much slower (median ratio ${r.toFixed(3)}, limit ${(1.6 + 20 / k).toFixed(3)})`);
  });

  /*
   * Wave 6 (W6-TEST-03): the security property itself, deterministically. A
   * sign-in for an unknown e-mail runs exactly ONE bcrypt comparison (against
   * the dummy hash of the real cost) and waits for it before answering; a
   * wrong password for a real account runs exactly one against that account.
   */
  test("structural: exactly one awaited bcrypt compare for an unknown e-mail, and for a wrong password", async (t) => {
    const hashSource = (await import("node:fs")).readFileSync(require.resolve("../services/auth-service/src/utils/hash.ts"), "utf8");
    const bcryptName = /from "(bcrypt[a-z]*)"/.exec(hashSource)?.[1];
    assert.ok(bcryptName, "bcrypt import not found in hash.ts");
    const { createRequire } = await import("node:module");
    const bcrypt = createRequire(require.resolve("../services/auth-service/src/utils/hash.ts"))(bcryptName!);
    const original = bcrypt.compare;
    const calls: Array<{ hash: string; settled: boolean }> = [];
    t.mock.method(bcrypt, "compare", (password: string, hash: string) => {
      const call = { hash, settled: false };
      calls.push(call);
      return new Promise((resolve, reject) =>
        setTimeout(() => {
          (original.call(bcrypt, password, hash) as Promise<boolean>).then(
            (value) => {
              call.settled = true;
              resolve(value);
            },
            reject
          );
        }, 30)
      );
    });

    const known = `struct-${crypto.randomBytes(5).toString("hex")}@example.test`;
    await authService.registerUser({ name: "Structural Test", email: known, password: "password123" });

    calls.length = 0;
    await assert.rejects(authService.loginUser({ email: `nobody-${crypto.randomBytes(5).toString("hex")}@example.test`, password: "wrong-password" }), (err: any) => err.statusCode === 401);
    assert.strictEqual(calls.length, 1, "unknown e-mail: expected exactly one bcrypt compare");
    const dummyHash = /DUMMY_PASSWORD_HASH = "([^"]+)"/.exec(hashSource)?.[1];
    assert.strictEqual(calls[0].hash, dummyHash, "unknown e-mail: compared against the dummy hash");
    assert.strictEqual(calls[0].settled, true, "unknown e-mail: the compare was not awaited before answering");

    calls.length = 0;
    await assert.rejects(authService.loginUser({ email: known, password: "wrong-password" }), (err: any) => err.statusCode === 401);
    assert.strictEqual(calls.length, 1, "wrong password: expected exactly one bcrypt compare");
    assert.strictEqual(calls[0].settled, true);
    assert.notStrictEqual(calls[0].hash, undefined);
  });

  test("the dummy hash has the same bcrypt cost as real password hashes", async () => {
    const source = (await import("node:fs")).readFileSync(
      require.resolve("../services/auth-service/src/utils/hash.ts"),
      "utf8"
    );
    const rounds = /const SALT_ROUNDS = (\d+);/.exec(source)?.[1];
    const dummy = /DUMMY_PASSWORD_HASH = "(\$2[aby]\$(\d\d)\$[^"]+)"/.exec(source);
    assert.ok(rounds && dummy, "constants not found");
    assert.strictEqual(Number(dummy![2]), Number(rounds));
  });
});
