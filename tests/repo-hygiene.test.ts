import assert from "node:assert";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test, describe } from "node:test";

/*
 * ISS-008: new files under docs/ must not be git-ignored (existing docs had
 * been force-added). Read-only: `git check-ignore --no-index` on a path that
 * does not exist; no file is created and nothing is written to git.
 */

const ROOT = path.join(__dirname, "..");
const gitAvailable = spawnSync("git", ["--version"], { cwd: ROOT }).status === 0;

describe("ISS-008: repository hygiene", () => {
  test("a new file under docs/ is not git-ignored", { skip: gitAvailable ? false : "git is not available" }, () => {
    const result = spawnSync("git", ["check-ignore", "-q", "--no-index", "docs/__probe__.md"], { cwd: ROOT });
    // check-ignore exits 0 when the path IS ignored, 1 when it is not.
    assert.strictEqual(result.status, 1, "docs/ is ignored by .gitignore");
  });

  test("uploads and env files stay ignored", { skip: gitAvailable ? false : "git is not available" }, () => {
    for (const probe of ["uploads/__probe__.pdf", ".env", "services/auth-service/.env"]) {
      const result = spawnSync("git", ["check-ignore", "-q", "--no-index", probe], { cwd: ROOT });
      assert.strictEqual(result.status, 0, `${probe} should stay ignored`);
    }
  });
});
