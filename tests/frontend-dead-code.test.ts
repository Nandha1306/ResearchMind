import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { test, describe } from "node:test";

/*
 * ARC-009: dead code with maintenance risk. The abandoned 5-step workspace
 * wizard (which collected invite e-mails that were never sent), three mock
 * dashboard cards, App.css and unused assets were never imported, and
 * ai-service kept an unused verifyPineconeIndex. Every frontend source module
 * must now be reachable from src/main.tsx (static imports, export-from,
 * dynamic import() and the "@/" alias), except two shadcn primitives kept on
 * purpose.
 */

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "frontend", "src");
const rel = (file: string) => path.relative(SRC, file).replace(/\\/g, "/");

/** Kept deliberately (shadcn primitives for future forms). */
const ALLOWED_UNREACHABLE = ["components/ui/input.tsx", "components/ui/label.tsx"];

const SPECIFIER = /(?:import|export)\s[^"';]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

const resolveImport = (fromFile: string, specifier: string): string | null => {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null; // a package
  const bare = base.replace(/\?[a-z]+$/, "");
  for (const candidate of [bare, `${bare}.ts`, `${bare}.tsx`, path.join(bare, "index.ts"), path.join(bare, "index.tsx")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
};

const reachableFrom = (entry: string) => {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(ts|tsx|css)$/.test(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(SPECIFIER)) {
      const target = resolveImport(file, match[1] ?? match[2] ?? match[3]);
      if (target) queue.push(target);
    }
  }
  return seen;
};

const listFiles = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? listFiles(full) : [full];
      })
    : [];

describe("ARC-009: no dead frontend modules, styles or assets", () => {
  const reachable = reachableFrom(path.join(SRC, "main.tsx"));

  test("the walker sees the app (sanity: pages, stores and the PDF viewer are reachable)", () => {
    for (const file of ["App.tsx", "routes/AppRouter.tsx", "pages/DocumentsPage.tsx", "components/documents/PdfViewerModal.tsx", "store/auth.store.ts"]) {
      assert.ok(reachable.has(path.join(SRC, file)), file);
    }
  });

  test("every .ts/.tsx module is reachable from main.tsx (except the allow-listed primitives)", () => {
    const unreachable = listFiles(SRC)
      .filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith(".d.ts") && !reachable.has(file))
      .map(rel)
      .sort();
    assert.deepStrictEqual(unreachable, ALLOWED_UNREACHABLE);
  });

  test("no unused stylesheet or asset is left in src", () => {
    assert.strictEqual(fs.existsSync(path.join(SRC, "App.css")), false, "src/App.css");
    const unusedAssets = listFiles(path.join(SRC, "assets"))
      .filter((file) => !reachable.has(file))
      .map(rel);
    assert.deepStrictEqual(unusedAssets, []);
  });

  test("the abandoned wizard's client schema is gone (the live form uses utils/workspace-name.ts)", () => {
    assert.strictEqual(fs.existsSync(path.join(SRC, "lib", "validations", "workspace.schema.ts")), false);
  });
});

describe("ARC-009: unused server code", () => {
  test("ai-service no longer carries the unused verifyPineconeIndex", () => {
    const source = fs.readFileSync(path.join(ROOT, "services", "ai-service", "src", "utils", "verify-pinecone.ts"), "utf8");
    assert.doesNotMatch(source, /verifyPineconeIndex/);
    // The startup check that IS used stays.
    assert.match(source, /export const validateVectorIndexAtStartup/);
    assert.match(source, /export const checkIndexCompatibility/);
  });

  test("the unused metadata-only createDocumentSchema (route removed in Wave 4) is gone and unreferenced", () => {
    assert.strictEqual(fs.existsSync(path.join(ROOT, "packages", "validation", "schemas", "document.schema.ts")), false);
  });
});
