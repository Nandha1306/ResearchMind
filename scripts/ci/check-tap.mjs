#!/usr/bin/env node
/*
 * Wave 6 CI gate (W6-CI-04, W6-TEST-17, scope amendment A-6): judge a
 * node:test TAP report so that a silently dropped or skipped test turns the
 * build red.
 *
 *   node scripts/ci/check-tap.mjs <report.tap> --min-tests N --skips K [--allow-skip "<reason prefix>"]
 *
 * Fails (exit 1) when:
 *   - the report has no summary (the run did not finish);
 *   - fail, cancelled or todo is not 0;
 *   - tests is below N (the floor: Wave 6 final local counts, recorded in
 *     docs/testing.md -- a count that falls needs a logged reason);
 *   - skipped is not exactly K;
 *   - any skipped test's reason does not start with an --allow-skip prefix.
 * Prints counts and reasons only (never environment values).
 */
import fs from "node:fs";

const args = process.argv.slice(2);
const file = args[0];
const option = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const allowSkips = args.flatMap((a, i) => (a === "--allow-skip" ? [args[i + 1]] : []));
// Wave 6 Stage E (W6-R6-04): strict integers; Number("") would be 0 and an
// unset floor variable would silently disable the count gate.
const minTestsArg = option("--min-tests");
const skipsArg = option("--skips");
const minTests = /^\d+$/.test(minTestsArg ?? "") ? Number(minTestsArg) : NaN;
const expectedSkips = /^\d+$/.test(skipsArg ?? "") ? Number(skipsArg) : NaN;

if (!file || !Number.isInteger(minTests) || minTests < 1 || !Number.isInteger(expectedSkips)) {
  console.error("usage: check-tap.mjs <report.tap> --min-tests N (N >= 1) --skips K (K >= 0) [--allow-skip <reason prefix>]...");
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.error(`check-tap: ${file} does not exist (the stage did not run)`);
  process.exit(1);
}

const text = fs.readFileSync(file, "utf8");
const summary = {};
for (const name of ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"]) {
  // The top-level summary lines are not indented.
  const matches = [...text.matchAll(new RegExp(`^# ${name} (\\d+)$`, "gm"))];
  summary[name] = matches.length ? Number(matches[matches.length - 1][1]) : undefined;
}
const skipReasons = [...text.matchAll(/^\s*ok \d+ - .*# SKIP ?(.*)$/gm)].map((m) => m[1].trim());

const problems = [];
if (summary.tests === undefined) problems.push("no '# tests' summary: the run did not complete");
for (const name of ["fail", "cancelled", "todo"]) {
  if (summary[name] !== 0) problems.push(`${name} is ${summary[name]} (must be 0)`);
}
if (summary.tests !== undefined && summary.tests < minTests) {
  problems.push(`tests is ${summary.tests}, below the floor ${minTests}`);
}
if (summary.skipped !== expectedSkips) problems.push(`skipped is ${summary.skipped} (must be exactly ${expectedSkips})`);
for (const reason of skipReasons) {
  if (!allowSkips.some((prefix) => reason.startsWith(prefix))) problems.push(`skip not allowed: "${reason}"`);
}

console.log(`check-tap ${file}: ${JSON.stringify(summary)}; skip reasons: ${JSON.stringify(skipReasons)}`);
if (problems.length) {
  for (const p of problems) console.error(`check-tap: ${p}`);
  process.exit(1);
}
console.log("check-tap: OK");
