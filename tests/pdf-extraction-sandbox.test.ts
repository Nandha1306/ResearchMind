import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, test, before, after } from "node:test";
import "./helpers/test-env"; // A-5: dead-port REDIS_URL/MONGO_URI defaults before any service code
import { AppError } from "../packages/shared/errors/AppError";
import { legitPdf, makePdf, textPage } from "./helpers/pdf-fixtures";

/*
 * Wave 6 WP-5 (SEC-002-PDF, lead decision D-1, scope amendment A-11 / R2):
 * PDF text extraction runs in the same child-process sandbox as DOCX.
 *  (a) the child gets the same minimal environment (no JWT_*,
 *      INTERNAL_SERVICE_TOKEN, CLOUDINARY_*, MONGO_URI, NODE_OPTIONS);
 *  (b) one shared concurrency gate for DOCX and PDF (asserted statically
 *      here and dynamically in pdf-extraction-limits.timing.ts);
 *  (c) the text cap is applied inside the child (413);
 *  (d) successful output is byte-identical to the former in-process
 *      extraction (differential over the PDF fixtures, page markers included);
 *  (e) unreadable, encrypted and corrupt PDFs keep their 422.
 * UNIT: real extractor, generated fixtures, no infrastructure.
 */

process.env.REDIS_URL = "redis://127.0.0.1:6599";
process.env.MONGO_URI = "mongodb://127.0.0.1:6598/rmtest_unused";

const DOC_SERVICE = path.join(__dirname, "..", "services", "document-service");
const docRequire = createRequire(path.join(DOC_SERVICE, "package.json"));

/** The former in-process implementation (pdf-extractor.ts before Wave 6), as the reference. */
const referenceExtract = async (bytes: Buffer): Promise<string> => {
  const { PDFParse } = docRequire("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  try {
    return (await parser.getText()).text.trim();
  } finally {
    await parser.destroy().catch(() => {});
  }
};

/** The minimal PDF used by document-lifecycle / document-file-stream ("Hello ResearchMind"). */
const minimalPdf = () => makePdf([{ content: "BT /F1 12 Tf 72 720 Td (Hello ResearchMind) Tj ET" }]);

/** A PDF whose /Encrypt dictionary needs a user password pdf.js does not have. */
const encryptedPdf = () => {
  const plain = minimalPdf().toString("latin1");
  const hex = (n: number) => Array.from({ length: n }, (_, i) => ((i * 37 + 11) % 256).toString(16).padStart(2, "0")).join("");
  const encryptObj = `<< /Filter /Standard /V 1 /R 2 /O <${hex(32)}> /U <${hex(32)}> /P -44 >>`;
  // Append object 6 and a new trailer that references it (incremental update).
  const xrefStart = plain.length + `6 0 obj\n${encryptObj}\nendobj\n`.length;
  const prevXref = /startxref\n(\d+)/.exec(plain)![1];
  const body = `6 0 obj\n${encryptObj}\nendobj\n`;
  const tail =
    `xref\n0 1\n0000000000 65535 f \n6 1\n${String(plain.length).padStart(10, "0")} 00000 n \n` +
    `trailer\n<< /Size 7 /Root 1 0 R /Encrypt 6 0 R /ID [<${hex(16)}><${hex(16)}>] /Prev ${prevXref} >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(plain + body + tail, "latin1");
};

const FIXTURES: Array<[string, () => Buffer]> = [
  ["minimal single page", minimalPdf],
  ["three pages (page markers)", () => legitPdf(3, 20)],
  ["forty pages", () => legitPdf(40, 5)],
  ["compressed content streams", () => makePdf([textPage(["Compressed line one", "Compressed line two"], true), textPage(["Second page"], true)])],
  ["escaped characters", () => makePdf([textPage(["Parens (a) and \\ backslash", "Tabs\tand  spaces  "])])],
  ["no text at all (scanned-like page)", () => makePdf([{ content: "0 0 m 100 100 l S" }])],
  ["empty content stream", () => makePdf([{ content: "" }])],
];

let dir: string;
let pdf: typeof import("../services/document-service/src/utils/pdf-extractor");

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-pdf-sandbox-"));
  pdf = await import("../services/document-service/src/utils/pdf-extractor");
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, bytes: Buffer) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
};

describe("SEC-002-PDF (d): sandboxed output is byte-identical to the in-process extraction", () => {
  for (const [label, make] of FIXTURES) {
    test(label, async () => {
      const bytes = make();
      const expected = await referenceExtract(bytes);
      const actual = await pdf.extractPdfText(write(`${label.replace(/\W+/g, "-")}.pdf`, bytes));
      assert.strictEqual(actual, expected);
    });
  }
});

describe("SEC-002-PDF (e): unreadable PDFs keep their 422", () => {
  const isUnreadable = (err: unknown) => {
    assert.ok(err instanceof AppError, `expected AppError, got ${String(err)}`);
    assert.strictEqual((err as AppError).statusCode, 422);
    assert.match((err as AppError).message, /Could not read the PDF file/);
    return true;
  };
  test("corrupt bytes", async () => {
    await assert.rejects(pdf.extractPdfText(write("corrupt.pdf", Buffer.from("this is not a pdf at all"))), isUnreadable);
  });
  test("empty file", async () => {
    await assert.rejects(pdf.extractPdfText(write("empty.pdf", Buffer.alloc(0))), isUnreadable);
  });
  test("password-protected (encrypted)", async () => {
    await assert.rejects(pdf.extractPdfText(write("encrypted.pdf", encryptedPdf())), isUnreadable);
  });
  test("a missing temp file is still a server-side error (not 422)", async () => {
    await assert.rejects(pdf.extractPdfText(path.join(dir, "missing.pdf")), (err: any) => {
      assert.ok(!(err instanceof AppError));
      assert.strictEqual(err.code, "ENOENT");
      return true;
    });
  });
});

describe("SEC-002-PDF (c): the text cap is applied inside the sandbox", () => {
  test("more text than maxTextChars: 413 naming the limit", async () => {
    const file = write("long.pdf", legitPdf(3, 20));
    await assert.rejects(pdf.extractPdfText(file, { maxTextChars: 100 }), (err: any) => {
      assert.ok(err instanceof AppError);
      assert.strictEqual(err.statusCode, 413);
      assert.match(err.message, /more than 100 characters/);
      return true;
    });
  });
});

describe("SEC-002-PDF (a)/(b): minimal child environment, one shared gate", () => {
  test("a secret in the parent environment is invisible in the sandbox child", async () => {
    const sandbox = await import("../services/document-service/src/utils/extraction-sandbox");
    const names = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "INTERNAL_SERVICE_TOKEN", "CLOUDINARY_API_SECRET", "MONGO_URI", "REDIS_URL", "NODE_OPTIONS", "RM_W6_SENTINEL"];
    const saved: Record<string, string | undefined> = {};
    for (const name of names) saved[name] = process.env[name];
    const sentinel = `sentinel-${Date.now()}-value`;
    for (const name of names.filter((n) => n !== "NODE_OPTIONS")) process.env[name] = sentinel;
    try {
      const report = await sandbox.runSandboxedChild<{ keys: string[]; values: string; execArgv: string[] }>(
        `process.once("message", () => process.send({ keys: Object.keys(process.env), values: Object.values(process.env).join("|"), execArgv: process.execArgv }, () => process.exit(0)));`,
        {},
        { timeoutMs: 20_000, heapLimitMb: 64, timeoutMessage: "t", tooComplexMessage: "c", label: "probe" }
      );
      for (const name of names) assert.ok(!report.keys.includes(name), `${name} reached the child`);
      assert.ok(!report.values.includes(sentinel), "a secret value reached the child");
      assert.ok(!report.execArgv.some((a) => /--import|--require|loader/.test(a)), `loader inherited: ${report.execArgv}`);
    } finally {
      for (const name of names) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    }
  });

  test("PDF and DOCX extraction use the same sandbox module and gate (no second gate)", () => {
    const utils = path.join(DOC_SERVICE, "src", "utils");
    const pdfSource = fs.readFileSync(path.join(utils, "pdf-extractor.ts"), "utf8");
    const docxSource = fs.readFileSync(path.join(utils, "docx-extractor.ts"), "utf8");
    for (const source of [pdfSource, docxSource]) {
      assert.match(source, /from "\.\/extraction-sandbox"/);
      assert.match(source, /acquireExtractionSlot\(\)/);
      assert.match(source, /releaseExtractionSlot\(\)/);
      assert.match(source, /runSandboxedChild/);
      assert.doesNotMatch(source, /\bspawn\(/, "an extractor spawns its own process outside the shared sandbox");
      assert.doesNotMatch(source, /let active\b|const waiting\b/, "an extractor keeps its own gate");
    }
    // The service process never loads pdf-parse (only resolves its path for the child).
    assert.doesNotMatch(pdfSource, /from "pdf-parse"|require\("pdf-parse"\)/, "PDF parsing must not run in the service process");
  });
});
