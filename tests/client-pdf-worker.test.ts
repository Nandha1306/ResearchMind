import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { test, describe } from "node:test";

/*
 * ISS-050: the PDF viewer loaded the pdf.js worker from https://unpkg.com
 * (a third-party script origin in the CSP, and no PDF viewing offline or
 * behind a firewall). The worker is now bundled from the SAME pdfjs-dist copy
 * react-pdf uses (react-pdf pins pdfjs-dist exactly, and pdf.js refuses a
 * worker of another version: "API version does not match Worker version").
 * The frontend used to declare an unrelated pdfjs-dist ^6 (removed in Wave 6),
 * so a plain `import "pdfjs-dist/..."` from frontend/src could pick the WRONG
 * copy; a Vite alias resolves pdfjs-dist from react-pdf's own location instead.
 */

const FRONTEND = path.join(__dirname, "..", "frontend");
const read = (rel: string) => fs.readFileSync(path.join(FRONTEND, rel), "utf8");

/** pdfjs-dist exactly as react-pdf resolves it (independent of the helper under test). */
const reactPdfDir = path.dirname(createRequire(path.join(FRONTEND, "package.json")).resolve("react-pdf/package.json"));
const reactPdfPin: string = JSON.parse(fs.readFileSync(path.join(reactPdfDir, "package.json"), "utf8")).dependencies["pdfjs-dist"];
const expectedPdfjsDir = path.dirname(createRequire(path.join(reactPdfDir, "package.json")).resolve("pdfjs-dist/package.json"));

const loadHelper = async () => {
  const file = path.join(FRONTEND, "pdf-worker.ts");
  assert.ok(fs.existsSync(file), "frontend/pdf-worker.ts must exist");
  return import(pathToFileURL(file).href) as Promise<{
    reactPdfPdfjsDir: () => string;
    reactPdfPdfjsVersion: () => string;
  }>;
};

describe("ISS-050: the pdf.js worker is self-hosted at react-pdf's exact version", () => {
  test("react-pdf pins an exact pdfjs-dist version, and that copy is installed", () => {
    assert.match(reactPdfPin, /^\d+\.\d+\.\d+$/, "react-pdf must pin pdfjs-dist exactly");
    const installed = JSON.parse(fs.readFileSync(path.join(expectedPdfjsDir, "package.json"), "utf8")).version;
    assert.strictEqual(installed, reactPdfPin);
  });

  test("the helper resolves pdfjs-dist from react-pdf's location (not the frontend's own declaration)", async () => {
    const helper = await loadHelper();
    assert.strictEqual(path.resolve(helper.reactPdfPdfjsDir()), path.resolve(expectedPdfjsDir));
    assert.strictEqual(helper.reactPdfPdfjsVersion(), reactPdfPin);
    const worker = fs.readFileSync(path.join(helper.reactPdfPdfjsDir(), "build", "pdf.worker.min.mjs"), "utf8");
    assert.ok(worker.includes(`pdfjsVersion = ${reactPdfPin}`), "the bundled worker is the pinned version");
  });

  test("vite.config.ts aliases pdfjs-dist to that copy", () => {
    const config = read("vite.config.ts");
    assert.match(config, /from "\.\/pdf-worker"/);
    assert.match(config, /"pdfjs-dist":\s*reactPdfPdfjsDir\(\)/);
  });

  test("PdfViewerModal uses the bundled worker URL, never a CDN", () => {
    const modal = read("src/components/documents/PdfViewerModal.tsx");
    assert.doesNotMatch(modal, /unpkg|jsdelivr|cdnjs|https?:\/\//);
    assert.match(modal, /import \w+ from "pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url";/);
    assert.match(modal, /GlobalWorkerOptions\.workerSrc = \w+;/);
  });

  test("nothing else in frontend/src imports pdfjs-dist (the alias changes no other import)", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && /from\s+["']pdfjs-dist/.test(fs.readFileSync(full, "utf8"))) {
          hits.push(path.relative(FRONTEND, full).replace(/\\/g, "/"));
        }
      }
    };
    walk(path.join(FRONTEND, "src"));
    assert.deepStrictEqual(hits, ["src/components/documents/PdfViewerModal.tsx"]);
  });

  test("the CSP no longer allows unpkg.com (scripts and workers are same-origin)", () => {
    assert.doesNotMatch(read("csp.ts").replace(/\/\*[\s\S]*?\*\//g, ""), /unpkg/);
  });
});
