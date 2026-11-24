import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { test, describe } from "node:test";
import ts from "typescript";

/*
 * ISS-051: the frontend TypeScript projects are split (src is checked once,
 * by the app project, with `strict`; vite.config.ts and csp.ts by the node
 * project) and lint is a gate (`npm run lint` with a suppression baseline
 * that can only shrink, and a warning ceiling).
 */

const FRONTEND = path.join(__dirname, "..", "frontend");
const readTsconfig = (name: string) => {
  const file = path.join(FRONTEND, name);
  const { config, error } = ts.readConfigFile(file, ts.sys.readFile);
  assert.ok(!error, `${name}: ${error && ts.flattenDiagnosticMessageText(error.messageText, "\n")}`);
  return config;
};

describe("ISS-051: frontend TypeScript and lint configuration", () => {
  test("the node project checks only the Vite config files, with node types", () => {
    const node = readTsconfig("tsconfig.node.json");
    // ISS-050 (Wave 5): REWRITTEN to add pdf-worker.ts, the node-side helper
    // vite.config.ts uses to resolve react-pdf's pdfjs-dist for the worker.
    assert.deepStrictEqual(node.include, ["vite.config.ts", "csp.ts", "pdf-worker.ts"]);
    assert.deepStrictEqual(node.compilerOptions.types, ["node"]);
    assert.ok(!node.compilerOptions.lib.includes("DOM"), "no DOM lib in the node project");
    assert.strictEqual(node.compilerOptions.strict, true);
  });

  test("each project has its own build-info file", () => {
    const app = readTsconfig("tsconfig.app.json");
    const node = readTsconfig("tsconfig.node.json");
    assert.notStrictEqual(app.compilerOptions.tsBuildInfoFile, node.compilerOptions.tsBuildInfoFile);
  });

  test("the app project checks src with strict and the unused-code checks", () => {
    const app = readTsconfig("tsconfig.app.json");
    assert.deepStrictEqual(app.include, ["src"]);
    for (const flag of ["strict", "noUnusedLocals", "noUnusedParameters", "noFallthroughCasesInSwitch"]) {
      assert.strictEqual(app.compilerOptions[flag], true, flag);
    }
  });

  test("lint is a gate: a warning ceiling and a committed suppression baseline", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(FRONTEND, "package.json"), "utf8"));
    assert.match(pkg.scripts.lint, /^eslint \. --max-warnings \d+$/);
    assert.ok(fs.existsSync(path.join(FRONTEND, "eslint-suppressions.json")), "eslint-suppressions.json");
    const root = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    assert.match(root.scripts.lint, /npm run lint -w frontend/);
  });
});
