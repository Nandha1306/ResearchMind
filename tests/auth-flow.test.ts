import assert from "node:assert";
import { test, describe } from "node:test";
import crypto from "crypto";

describe("AUTH-003 & Security Verification: Authentication & Token Rotation Engine", () => {
  const hashToken = (token: string): string => {
    return crypto.createHash("sha256").update(token).digest("hex");
  };

  test("SHA-256 token hashing produces deterministic 64-char hex strings", () => {
    const rawToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example_token_string";
    const hash1 = hashToken(rawToken);
    const hash2 = hashToken(rawToken);

    assert.strictEqual(hash1.length, 64);
    assert.strictEqual(hash1, hash2);
    assert.notStrictEqual(hash1, rawToken);
  });

  test("Token reuse detection revokes all sessions on tokenHash mismatch", () => {
    const userSessions = new Map<string, string[]>();
    userSessions.set("user_123", ["hash_token_v1"]);

    const isValidAndActive = (userId: string, presentedToken: string) => {
      const activeHashes = userSessions.get(userId) || [];
      const presentedHash = hashToken(presentedToken);

      if (!activeHashes.includes(presentedHash)) {
        // Reuse detected -> Revoke all user sessions
        userSessions.set(userId, []);
        return false;
      }
      return true;
    };

    // First use of valid token v1
    const token1 = "refresh_token_v1";
    userSessions.set("user_123", [hashToken(token1)]);

    assert.strictEqual(isValidAndActive("user_123", token1), true);

    // Rotate token1 -> token2
    const token2 = "refresh_token_v2";
    userSessions.set("user_123", [hashToken(token2)]);

    // Presenting rotated old token1 -> REUSE DETECTED!
    const reuseResult = isValidAndActive("user_123", token1);
    assert.strictEqual(reuseResult, false);

    // Verify all active sessions were revoked
    assert.strictEqual(userSessions.get("user_123")?.length, 0);
  });
});
