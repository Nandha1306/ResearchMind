import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, describe, before, after } from "node:test";
import { extractPdfText } from "../services/document-service/src/utils/pdf-extractor";
import { extractDocxText } from "../services/document-service/src/utils/docx-extractor";
import { AppError } from "../packages/shared/errors/AppError";

/*
 * A corrupt upload used to surface as HTTP 500 because the parser's exception
 * escaped unchanged. The REAL extractors now report it as a 422 AppError,
 * while genuine server-side failures (e.g. the temp file missing) still
 * propagate as-is and remain 500s.
 */

let dir: string;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "rm-extract-"));
});

after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const writeFixture = async (name: string, content: string | Buffer) => {
  const file = path.join(dir, name);
  await fs.writeFile(file, content);
  return file;
};

const isUnreadableUpload = (err: unknown) => {
  assert.ok(err instanceof AppError, `expected AppError, got ${String(err)}`);
  assert.strictEqual((err as AppError).statusCode, 422);
  return true;
};

describe("Corrupt documents are client errors (422)", () => {
  test("corrupt PDF", async () => {
    const file = await writeFixture("corrupt.pdf", "this is not a pdf at all");
    await assert.rejects(extractPdfText(file), isUnreadableUpload);
  });

  test("empty (0-byte) PDF", async () => {
    const file = await writeFixture("empty.pdf", Buffer.alloc(0));
    await assert.rejects(extractPdfText(file), isUnreadableUpload);
  });

  test("corrupt DOCX (not a zip archive)", async () => {
    const file = await writeFixture("corrupt.docx", "plain text pretending to be docx");
    await assert.rejects(extractDocxText(file), isUnreadableUpload);
  });
});

describe("Server-side failures are not disguised as client errors", () => {
  test("missing temp file still rejects with the filesystem error (-> 500)", async () => {
    const missing = path.join(dir, "does-not-exist.pdf");
    for (const extract of [extractPdfText, extractDocxText]) {
      await assert.rejects(extract(missing), (err: any) => {
        assert.ok(!(err instanceof AppError));
        assert.strictEqual(err.code, "ENOENT");
        return true;
      });
    }
  });
});
