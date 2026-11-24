import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, describe, before, after } from "node:test";
import "./helpers/test-env"; // A-5: dead-port REDIS_URL/MONGO_URI defaults before any service code

/*
 * SEC-024 (a) with scope-review rule R2: uploads go to UPLOAD_TMP_DIR
 * (default: OS temp + researchmind-uploads) under random names, and a startup
 * sweep deletes ONLY top-level regular files that match the service's own
 * temp-name pattern and are older than 1 h. It uses lstat, never follows
 * links, never recurses, and refuses to sweep the repository (or anything in
 * it), the legacy services/document-service/uploads folder, a filesystem
 * root and the home directory. UNIT, in throwaway temp directories.
 */

const ROOT = path.resolve(__dirname, "..");
let tmp: typeof import("../services/document-service/src/utils/upload-tmp");
let base: string;

before(async () => {
  tmp = await import("../services/document-service/src/utils/upload-tmp");
  base = fs.mkdtempSync(path.join(os.tmpdir(), "rm-sweep-"));
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const HOUR = 60 * 60 * 1000;
const age = (file: string, ms: number) => {
  const when = new Date(Date.now() - ms);
  fs.utimesSync(file, when, when);
};
const tempName = (ext = ".pdf") => tmp.newUploadTempName(ext);

describe("SEC-024 (a): upload temp directory and startup sweep", () => {
  test("temp names are random and never contain the client file name", () => {
    const a = tempName(".pdf");
    const b = tempName(".docx");
    assert.notStrictEqual(a, tempName(".pdf"));
    assert.match(a, tmp.UPLOAD_TEMP_NAME);
    assert.match(b, tmp.UPLOAD_TEMP_NAME);
    assert.doesNotMatch("1712345678901-report.pdf", tmp.UPLOAD_TEMP_NAME);
  });

  test("the directory comes from UPLOAD_TMP_DIR, defaulting to OS temp + researchmind-uploads", () => {
    assert.strictEqual(tmp.resolveUploadTmpDir({}), path.join(os.tmpdir(), "researchmind-uploads"));
    assert.strictEqual(tmp.resolveUploadTmpDir({ UPLOAD_TMP_DIR: path.join(base, "x") }), path.join(base, "x"));
  });

  test("the sweep removes only old matching regular files at the top level", async () => {
    const dir = path.join(base, "sweep");
    fs.mkdirSync(dir);
    const oldMatching = path.join(dir, tempName());
    const newMatching = path.join(dir, tempName());
    const oldOther = path.join(dir, "notes-from-user.pdf");
    const sub = path.join(dir, "sub");
    fs.mkdirSync(sub);
    const nestedOld = path.join(sub, tempName());
    for (const f of [oldMatching, newMatching, oldOther, nestedOld]) fs.writeFileSync(f, "x");
    for (const f of [oldMatching, oldOther, nestedOld]) age(f, 2 * HOUR);

    // A link with a matching name, pointing at an old matching file elsewhere.
    const outside = path.join(base, "outside");
    fs.mkdirSync(outside);
    const target = path.join(outside, tempName());
    fs.writeFileSync(target, "keep me");
    age(target, 2 * HOUR);
    const link = path.join(dir, tempName());
    try {
      fs.symlinkSync(target, link, "file");
    } catch {
      // Windows without symlink privilege: a directory junction (also a link to lstat).
      fs.symlinkSync(outside, link, "junction");
    }

    const result = await tmp.sweepUploadTmpDir(dir, { log: () => {}, warn: () => {} });
    assert.strictEqual(result.removed, 1);
    assert.ok(!fs.existsSync(oldMatching), "old matching file removed");
    assert.ok(fs.existsSync(newMatching), "new matching file kept");
    assert.ok(fs.existsSync(oldOther), "non-matching file kept");
    assert.ok(fs.existsSync(nestedOld), "no recursion");
    assert.ok(fs.lstatSync(link).isSymbolicLink(), "link untouched");
    assert.ok(fs.existsSync(target), "link target untouched");
  });

  test("a missing directory is created by ensureUploadTmpDir", () => {
    const dir = path.join(base, "created", "deep");
    tmp.ensureUploadTmpDir(dir);
    assert.ok(fs.statSync(dir).isDirectory());
  });

  test("the sweep refuses the repository, folders inside it, the legacy uploads folder, a root and the home directory", async () => {
    const refused = [
      ROOT,
      path.join(ROOT, "services"),
      path.join(ROOT, "services", "document-service", "uploads"),
      path.parse(os.tmpdir()).root,
      os.homedir(),
    ];
    for (const dir of refused) {
      const warnings: string[] = [];
      const result = await tmp.sweepUploadTmpDir(dir, { log: () => {}, warn: (m) => warnings.push(m) });
      assert.strictEqual(result.removed, 0, dir);
      assert.ok(result.refused, `${dir} was not refused`);
      assert.ok(warnings.some((w) => /refus/i.test(w)), dir);
    }
  });

  test("the upload middleware writes to the temp directory with random names (no cwd-relative uploads/)", () => {
    const source = fs.readFileSync(path.join(ROOT, "services", "document-service", "src", "middlewares", "upload.middleware.ts"), "utf8");
    assert.doesNotMatch(source, /["']uploads\/?["']/);
    assert.doesNotMatch(source, /originalname\}/);
    assert.match(source, /newUploadTempName/);
  });
});

describe("SEC-024 (a): a temp name pattern is strict", () => {
  test("only rm-upload-<uuid>.pdf|.docx matches", () => {
    assert.match(`rm-upload-${crypto.randomUUID()}.pdf`, tmp.UPLOAD_TEMP_NAME);
    assert.doesNotMatch(`rm-upload-${crypto.randomUUID()}.exe`, tmp.UPLOAD_TEMP_NAME);
    assert.doesNotMatch(`x-rm-upload-${crypto.randomUUID()}.pdf`, tmp.UPLOAD_TEMP_NAME);
  });
});
