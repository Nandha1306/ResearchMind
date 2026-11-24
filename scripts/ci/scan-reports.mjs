#!/usr/bin/env node
/*
 * Wave 6 CI check (scope review R8 / A-16): the files about to be uploaded as
 * artifacts (TAP reports, lcov, audit JSON) must not contain
 *   - the generated database passwords (read from the userinfo of
 *     TEST_MONGO_URI / TEST_REDIS_URL when they are set), or
 *   - any scheme://user:password@ URI (the same rule as redactSecrets, A-1).
 * Prints file names and rule names only, never a match.
 *
 *   node scripts/ci/scan-reports.mjs <dir-or-file>...
 */
import fs from "node:fs";
import path from "node:path";

const secrets = [];
for (const name of ["TEST_MONGO_URI", "TEST_REDIS_URL"]) {
  const value = process.env[name];
  if (!value) continue;
  try {
    const url = new URL(value);
    if (url.password) secrets.push(decodeURIComponent(url.password));
  } catch {
    /* not a URL: nothing to look for */
  }
}

// userinfo with a password part: scheme://user:secret@ or scheme://:secret@
const CREDENTIALED_URI = /\b[a-z][a-z0-9+.-]*:\/\/[^\s\/?#@:]*:([^\s\/?#@]+)@/gi;
// Test titles document URI shapes with obvious placeholders; those are not credentials.
const PLACEHOLDER = /^(\*+|<[^<>]*>|x+|\.\.\.)$/i;
const hasCredentialedUri = (text) => [...text.matchAll(CREDENTIALED_URI)].some((m) => !PLACEHOLDER.test(m[1]));

const files = [];
const collect = (target) => {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) for (const entry of fs.readdirSync(target)) collect(path.join(target, entry));
  else files.push(target);
};
for (const target of process.argv.slice(2)) collect(target);

const problems = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  if (secrets.some((s) => s && text.includes(s))) problems.push(`${file}: contains a generated database password`);
  if (hasCredentialedUri(text)) problems.push(`${file}: contains a URI with credentials`);
}

console.log(`scan-reports: ${files.length} file(s) scanned`);
if (problems.length) {
  for (const p of problems) console.error(`scan-reports: ${p}`);
  process.exit(1);
}
console.log("scan-reports: OK");
