import { test } from "node:test";
import { infraDescribe } from "../helpers/infra";
import { mongoSkip } from "../helpers/test-mongo";

/*
 * Fixture for skip-visibility.test.ts (ARC-006). Not matched by the
 * tests/*.test.ts or tests/*.timing.ts globs: it runs only as a child process.
 */
infraDescribe("needs MongoDB", mongoSkip, () => {
  test("never runs without TEST_MONGO_URI", () => {
    throw new Error("must not run");
  });
});
