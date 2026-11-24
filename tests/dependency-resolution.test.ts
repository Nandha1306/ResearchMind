import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { test, describe } from "node:test";

/*
 * Dependency declarations (Wave 4 lockfile batch):
 *  - RT-005: ai-service declares zod and resolves zod 4.x (the shared
 *    validation schemas are compiled into its dist and resolve from there);
 *  - RT-009: auth-service no longer declares the unused redis client (nor
 *    the unused cookie-parser);
 *  - SEC-022: build-only tools are devDependencies;
 *  - ISS-032: every package a service imports -- from its own src or from the
 *    shared code it compiles in -- is declared by that service.
 * Read-only: package.json files and module resolution, no install.
 */

const ROOT = path.join(__dirname, "..");
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const SERVICES = ["api-gateway", "auth-service", "workspace-service", "document-service", "task-service", "ai-service"];
const BUILTIN = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

const listTs = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? listTs(full) : /\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name) ? [full] : [];
      })
    : [];

const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;

const specifiersOf = (file: string) => {
  const source = fs.readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of source.matchAll(IMPORT)) {
    const spec = m[1] ?? m[2] ?? m[3];
    // `import type` is erased at compile time: no runtime dependency.
    if (spec && !/^\s*import\s+type\s/.test(m[0].trimStart())) out.push(spec);
  }
  return out;
};

const packageName = (spec: string) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

/** Runtime packages imported by a service's src and by the shared files it compiles in. */
const runtimeImportsOf = (service: string) => {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of specifiersOf(file)) {
      if (spec.startsWith(".")) {
        const base = path.resolve(path.dirname(file), spec);
        const target = [`${base}.ts`, path.join(base, "index.ts"), base].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
        if (target && /\.ts$/.test(target)) visit(target);
      } else if (!BUILTIN.has(spec)) {
        packages.add(packageName(spec));
      }
    }
  };
  listTs(path.join(ROOT, "services", service, "src")).forEach(visit);
  return packages;
};

describe("dependency declarations (RT-005, RT-009, SEC-022, ISS-032)", () => {
  test("RT-005: ai-service declares zod ^4 and resolves zod 4.x", () => {
    const pkg = readJson("services/ai-service/package.json");
    assert.match(pkg.dependencies?.zod ?? "", /^\^4\./);
    const resolved = require.resolve("zod/package.json", { paths: [path.join(ROOT, "services", "ai-service")] });
    assert.match(JSON.parse(fs.readFileSync(resolved, "utf8")).version, /^4\./, resolved);
  });

  test("RT-009: auth-service no longer declares redis or cookie-parser", () => {
    const deps = readJson("services/auth-service/package.json").dependencies ?? {};
    assert.strictEqual(deps.redis, undefined);
    assert.strictEqual(deps["cookie-parser"], undefined);
  });

  test("SEC-022: build-only packages are devDependencies", () => {
    const fe = readJson("frontend/package.json");
    for (const name of ["shadcn", "tailwindcss", "@tailwindcss/vite"]) {
      assert.strictEqual(fe.dependencies?.[name], undefined, `${name} in frontend dependencies`);
      assert.ok(fe.devDependencies?.[name], `${name} in frontend devDependencies`);
    }
    for (const service of ["document-service", "task-service"]) {
      const pkg = readJson(`services/${service}/package.json`);
      assert.strictEqual(pkg.dependencies?.["@types/swagger-ui-express"], undefined, service);
    }
  });

  for (const service of SERVICES) {
    test(`ISS-032: ${service} declares every package it imports at runtime`, () => {
      const pkg = readJson(`services/${service}/package.json`);
      const declared = new Set([...Object.keys(pkg.dependencies ?? {})]);
      const missing = [...runtimeImportsOf(service)].filter((name) => !declared.has(name)).sort();
      assert.deepStrictEqual(missing, [], `${service} imports undeclared packages`);
    });
  }
});

/*
 * Wave 6 (Wave 4 carry-over D3, W6-TEST-06, W6-CI-18): the root tests import
 * packages that only resolved through npm workspace hoisting (jszip and
 * mongodb only transitively). Every bare import under tests/ is now declared
 * by the root package.json, pinned to the version that was hoisted at
 * node_modules/<name>, so a lockfile re-layout cannot break test resolution.
 * vite is resolved through frontend/package.json (createRequire), never by a
 * literal node_modules path.
 */
describe("D3: the root declares every package the tests import", () => {
  const root = readJson("package.json");
  const declared = new Set([...Object.keys(root.dependencies ?? {}), ...Object.keys(root.devDependencies ?? {})]);
  const testFiles = listTs(path.join(ROOT, "tests"));

  test("every bare import in tests/ is a root dependency or devDependency", () => {
    const missing = new Map<string, string[]>();
    for (const file of testFiles) {
      for (const spec of specifiersOf(file)) {
        // node:test is only reachable with the prefix, so it is not in builtinModules.
        if (spec.startsWith(".") || spec.startsWith("node:") || BUILTIN.has(spec)) continue;
        const name = packageName(spec);
        if (!declared.has(name)) missing.set(name, [...(missing.get(name) ?? []), path.relative(ROOT, file)]);
      }
    }
    assert.deepStrictEqual(Object.fromEntries(missing), {});
  });

  test("root test devDependencies are exact versions equal to what resolves at the root", () => {
    for (const [name, range] of Object.entries<string>(root.devDependencies ?? {})) {
      if (name.startsWith("@types/") || ["concurrently", "tsx"].includes(name)) continue;
      assert.match(range, /^\d+\.\d+\.\d+$/, `${name} must be pinned to an exact version`);
      const installed = readJson(path.join("node_modules", name, "package.json")).version;
      assert.strictEqual(installed, range, `${name}: declared ${range}, hoisted ${installed}`);
    }
  });

  test("no test reaches into a package's node_modules folder by a literal path (vite, tsx internals aside)", () => {
    const offenders: string[] = [];
    for (const file of testFiles) {
      const text = fs.readFileSync(file, "utf8");
      if (/["']node_modules["'],\s*["']vite["']|node_modules[\\/]+vite[\\/]/.test(text)) offenders.push(path.relative(ROOT, file));
    }
    assert.deepStrictEqual(offenders, [], "resolve vite with createRequire(frontend/package.json)");
  });
});
