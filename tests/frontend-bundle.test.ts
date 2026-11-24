import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { test, describe, before, after } from "node:test";

/*
 * ARC-011: the SPA shipped as ONE 1.58 MB JavaScript chunk (pdf.js, KaTeX,
 * react-pdf and every page loaded up front; Vite warned about chunks over
 * 500 kB). The Documents, Q&A, Meeting and Kanban pages and the PDF viewer
 * are now lazy-loaded route chunks. Also guards ISS-050 in the real build:
 * the pdf.js worker is a same-origin asset of react-pdf's exact pdfjs-dist
 * version, and no CDN URL remains.
 *
 * A REAL production build (the repository's vite.config.ts, so the CSP and
 * alias plugins run) into a temporary folder; frontend/dist is not touched.
 */

const FRONTEND = path.join(__dirname, "..", "frontend");
const CHUNK_LIMIT = 500_000;

type OutputChunk = {
  type: "chunk";
  fileName: string;
  code: string;
  isEntry: boolean;
  isDynamicEntry: boolean;
  moduleIds?: string[];
  modules?: Record<string, unknown>;
};
type OutputAsset = { type: "asset"; fileName: string; source: string | Uint8Array };

let outDir: string;
let chunks: OutputChunk[] = [];
let assets: OutputAsset[] = [];
let html = "";

const idsOf = (chunk: OutputChunk) => (chunk.moduleIds ?? Object.keys(chunk.modules ?? {})).map((id) => id.replace(/\\/g, "/"));

before(async () => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-bundle-"));
  // Wave 6 (D3): resolve vite the way the frontend does, not by a literal node_modules path.
  const viteEntry = createRequire(path.join(FRONTEND, "package.json")).resolve("vite");
  const { build } = await import(pathToFileURL(viteEntry).href);
  const result = await build({
    root: FRONTEND,
    configFile: path.join(FRONTEND, "vite.config.ts"),
    logLevel: "silent",
    build: { outDir, emptyOutDir: true, write: true },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r: { output: Array<OutputChunk | OutputAsset> }) => r.output);
  chunks = outputs.filter((o): o is OutputChunk => o.type === "chunk");
  assets = outputs.filter((o): o is OutputAsset => o.type === "asset");
  html = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
});

after(() => {
  if (outDir) fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("ARC-011: route-level code splitting", () => {
  test("no JavaScript chunk is over 500 kB (assets such as the pdf.js worker excluded)", () => {
    const tooBig = chunks
      .filter((chunk) => Buffer.byteLength(chunk.code) >= CHUNK_LIMIT)
      .map((chunk) => `${chunk.fileName}: ${Buffer.byteLength(chunk.code)} B`);
    assert.deepStrictEqual(tooBig, []);
  });

  test("pdf.js, react-pdf and KaTeX are not in the entry chunk", () => {
    const entries = chunks.filter((chunk) => chunk.isEntry);
    assert.strictEqual(entries.length, 1);
    const heavy = idsOf(entries[0]).filter((id) => /\/node_modules\/(pdfjs-dist|react-pdf|katex)\//.test(id));
    assert.deepStrictEqual(heavy, []);
  });

  test("the four heavy pages and the PDF viewer are dynamic chunks", () => {
    for (const name of ["DocumentsPage", "SemanticSearchPage", "MeetingSummarizerPage", "KanbanPage", "PdfViewerModal"]) {
      const owner = chunks.filter((chunk) => idsOf(chunk).some((id) => id.endsWith(`/${name}.tsx`)));
      assert.strictEqual(owner.length, 1, name);
      assert.strictEqual(owner[0].isEntry, false, `${name} must not be in the entry chunk`);
      assert.strictEqual(owner[0].isDynamicEntry, true, `${name} is loaded on demand`);
    }
  });

  test("index.html: one module entry script, no inline script, and the CSP meta tag", () => {
    assert.match(html, /http-equiv="Content-Security-Policy"/);
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    assert.strictEqual(scripts.length, 1, scripts.join("\n"));
    assert.match(scripts[0], /type="module"[^>]*src="\/assets\/index-[^"]+\.js"/);
    assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/, "no inline script");
  });
});

describe("ISS-050: the built app self-hosts the pdf.js worker", () => {
  test("the worker is an emitted same-origin asset of react-pdf's exact pdfjs-dist version", async () => {
    const workers = assets.filter((asset) => /^assets\/pdf\.worker\.min-[^/]+\.mjs$/.test(asset.fileName));
    assert.strictEqual(workers.length, 1, assets.map((a) => a.fileName).join(", "));
    const { reactPdfPdfjsVersion } = await import(pathToFileURL(path.join(FRONTEND, "pdf-worker.ts")).href);
    assert.ok(String(workers[0].source).includes(`pdfjsVersion = ${reactPdfPdfjsVersion()}`));
    const viewer = chunks.find((chunk) => idsOf(chunk).some((id) => id.endsWith("/PdfViewerModal.tsx")));
    assert.ok(viewer?.code.includes(workers[0].fileName.replace(/^assets\//, "")), "the viewer references the bundled worker");
  });

  test("no CDN URL remains anywhere in the build (scripts, workers or the CSP)", () => {
    assert.doesNotMatch(html, /unpkg/);
    for (const chunk of chunks) assert.doesNotMatch(chunk.code, /unpkg\.com/, chunk.fileName);
  });
});
