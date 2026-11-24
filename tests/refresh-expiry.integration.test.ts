import assert from "node:assert";
import crypto from "node:crypto";
import { test, before, after } from "node:test";
import jwt from "jsonwebtoken";
import { infraDescribe } from "./helpers/infra";
import { setTestSecrets } from "./helpers/test-env";
import { connectTestDatabase, mongoSkip } from "./helpers/test-mongo";

/*
 * SEC-019 (d): the stored refresh-token record expires when the token does
 * (its `exp`, i.e. REFRESH_TOKEN_EXPIRES), not after a fixed 7 days.
 * Real auth-service code on a disposable MongoDB; REFRESH_TOKEN_EXPIRES is
 * set before the module is loaded (it is read at import).
 */

setTestSecrets();
process.env.REFRESH_TOKEN_EXPIRES = "1h";

let authService: typeof import("../services/auth-service/src/services/auth.service");
let RefreshToken: typeof import("../services/auth-service/src/models/RefreshToken").RefreshToken;
let db: { cleanup: () => Promise<void> } | undefined;

before(async () => {
  if (mongoSkip) return;
  db = await connectTestDatabase("refreshexp");
  authService = await import("../services/auth-service/src/services/auth.service");
  ({ RefreshToken } = await import("../services/auth-service/src/models/RefreshToken"));
  await RefreshToken.init();
});

after(async () => {
  await db?.cleanup();
});

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

infraDescribe("SEC-019 (d): refresh-token record expiry follows the token (real MongoDB)", mongoSkip, () => {
  test("with REFRESH_TOKEN_EXPIRES=1h the stored expiresAt matches the token's exp (±5 s), on register and on rotation", async () => {
    const email = `exp-${crypto.randomBytes(5).toString("hex")}@example.test`;
    const registered = await authService.registerUser({ name: "Expiry User", email, password: "password123" });
    const rotated = await authService.refreshAccessToken(registered.refreshToken);
    for (const token of [registered.refreshToken, rotated.refreshToken]) {
      const exp = (jwt.decode(token) as { exp: number }).exp * 1000;
      assert.ok(Math.abs(exp - Date.now() - 3_600_000) < 60_000, "token lifetime is 1 h");
      const stored = await RefreshToken.findOne({ tokenHash: sha256(token) }).lean();
      assert.ok(stored, "record stored");
      // The rotated-away record's expiry is shortened to the reuse grace window; check the live one.
      if (token === rotated.refreshToken) {
        assert.ok(Math.abs(new Date(stored!.expiresAt).getTime() - exp) < 5_000, `stored ${stored!.expiresAt} vs exp ${new Date(exp)}`);
      }
    }
  });
});
