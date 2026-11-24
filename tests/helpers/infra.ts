import { describe, test } from "node:test";

/**
 * A suite that needs disposable infrastructure (MongoDB, Redis, Docker).
 *
 * `describe(name, { skip }, fn)` skips at SUITE level, and the Node test
 * runner counts only tests: a skipped suite left `# skipped 0` in the summary,
 * so missing infrastructure was invisible (ARC-006). When `skip` is a reason,
 * this registers the suite with ONE visibly skipped test carrying that reason;
 * the suite body (and its hooks) never runs. Otherwise it is a plain describe.
 */
export const infraDescribe = (name: string, skip: string | false, fn: () => void) => {
  if (skip) {
    describe(name, () => {
      test(`(skipped: ${skip})`, { skip }, () => {});
    });
    return;
  }
  describe(name, fn);
};
