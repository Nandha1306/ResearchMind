import assert from "node:assert";
import { describe, test } from "node:test";
import jwt from "jsonwebtoken";
import { setTestSecrets } from "./helpers/test-env";

/*
 * SEC-007 (user decision): access tokens live 5 minutes by default, so a
 * token that survives logout or reuse revocation is usable for at most 5
 * minutes. ACCESS_TOKEN_EXPIRES still overrides it.
 */

setTestSecrets();
delete process.env.ACCESS_TOKEN_EXPIRES;

describe("SEC-007: access-token lifetime", () => {
  test("default lifetime is 5 minutes (exp - iat = 300 s)", async () => {
    const { generateAccessToken } = await import("../services/auth-service/src/utils/jwt");
    const token = generateAccessToken({ userId: "665f1c2b9d3e4a00dddd0004" });
    const payload = jwt.decode(token) as { iat: number; exp: number };
    assert.strictEqual(payload.exp - payload.iat, 300);
  });

  test("the auth-service .env.example documents 5m", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const example = fs.readFileSync(path.join(__dirname, "..", "services", "auth-service", ".env.example"), "utf8");
    assert.match(example, /^ACCESS_TOKEN_EXPIRES=5m$/m);
  });
});
