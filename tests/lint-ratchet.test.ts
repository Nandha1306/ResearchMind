import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

/*
 * Wave 6 (W5-L2, W6-CI-02, scope amendment A-9): the frontend lint gate.
 *  - `npm run lint` allows at most 3 warnings (the 3 that exist today).
 *  - The ESLint bulk-suppression baseline (frontend/eslint-suppressions.json)
 *    may only SHRINK: this snapshot is the ceiling per file and rule. A new
 *    file, a new rule or a higher count fails this test, so growing the
 *    baseline is a visible edit here, not a silent `--suppress-all`.
 *    (ESLint itself fails on stale, no-longer-needed entries.)
 * When an entry is fixed, lower or delete it here too.
 */

const ROOT = path.resolve(__dirname, "..");

/** Snapshot taken in Wave 6: 30 suppressed problems in 12 files. */
const ALLOWED: Record<string, Record<string, number>> = {
  "src/components/auth/LoginForm.tsx": { "@typescript-eslint/no-explicit-any": 1 },
  "src/components/auth/RegisterForm.tsx": { "@typescript-eslint/no-explicit-any": 1 },
  "src/components/documents/UploadDocumentModal.tsx": { "@typescript-eslint/no-explicit-any": 1 },
  "src/components/kanban/TaskDetailModal.tsx": {
    "@typescript-eslint/no-explicit-any": 4,
    "react-hooks/immutability": 1,
    "react-hooks/set-state-in-effect": 1,
  },
  "src/components/workspace/CreateWorkspaceModal.tsx": { "@typescript-eslint/no-explicit-any": 1 },
  "src/components/workspace/JoinWorkspaceModal.tsx": { "react-hooks/set-state-in-effect": 1 },
  "src/hooks/useAiQuery.ts": { "@typescript-eslint/no-explicit-any": 1, "react-hooks/set-state-in-effect": 1 },
  "src/pages/CreateWorkspacePage.tsx": { "@typescript-eslint/no-explicit-any": 2 },
  "src/pages/KanbanPage.tsx": { "@typescript-eslint/no-explicit-any": 4, "react-hooks/set-state-in-effect": 2 },
  "src/pages/MeetingSummarizerPage.tsx": { "@typescript-eslint/no-explicit-any": 4, "react-hooks/set-state-in-effect": 1 },
  "src/store/workspace.store.ts": { "@typescript-eslint/no-explicit-any": 3 },
  "src/types/task.types.ts": { "@typescript-eslint/no-explicit-any": 1 },
};

const total = (map: Record<string, Record<string, number>>) =>
  Object.values(map).reduce((sum, rules) => sum + Object.values(rules).reduce((a, b) => a + b, 0), 0);

describe("W5-L2 / A-9: the lint baseline may only shrink", () => {
  test("the snapshot itself is 30 suppressions in 12 files", () => {
    assert.strictEqual(total(ALLOWED), 30);
    assert.strictEqual(Object.keys(ALLOWED).length, 12);
  });

  test("frontend/eslint-suppressions.json has no new file, no new rule and no higher count", () => {
    const actual = JSON.parse(fs.readFileSync(path.join(ROOT, "frontend", "eslint-suppressions.json"), "utf8")) as Record<
      string,
      Record<string, { count: number }>
    >;
    const problems: string[] = [];
    for (const [file, rules] of Object.entries(actual)) {
      for (const [rule, { count }] of Object.entries(rules)) {
        const allowed = ALLOWED[file]?.[rule];
        if (allowed === undefined) problems.push(`${file} ${rule}: new suppression (${count})`);
        else if (count > allowed) problems.push(`${file} ${rule}: ${count} > ${allowed}`);
      }
    }
    assert.deepStrictEqual(problems, []);
  });

  test("the lint script caps warnings at 3 and does not tolerate stale or new suppressions", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "frontend", "package.json"), "utf8"));
    const lint: string = pkg.scripts.lint;
    assert.match(lint, /--max-warnings 3(\s|$)/);
    assert.doesNotMatch(lint, /--pass-on-unpruned-suppressions|--suppress-all|--suppress-rule|--prune-suppressions/);
  });
});
