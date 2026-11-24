import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { test, describe } from "node:test";
import { buildClientCsp, cspMetaPlugin, cspPreviewHeaderPlugin, cspPlugins, apiOriginFor } from "../frontend/csp.ts";
import { freePort } from "./helpers/spawn-service";

/*
 * SEC-008 (SPA part): the production build carries a Content-Security-Policy
 * meta tag (build only: the dev server's React-refresh preamble is an inline
 * script), and `vite preview` sends the same policy as a header.
 * R1: connect-src includes blob: (the PDF viewer reads object URLs), and a
 * relative API URL counts as same-origin.
 */

const directives = (policy: string) =>
  Object.fromEntries(
    policy.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
      const [name, ...values] = d.split(/\s+/);
      return [name, values];
    })
  ) as Record<string, string[]>;

describe("SEC-008: client CSP", () => {
  test("an absolute API URL puts that origin (only) in connect-src, plus 'self' and blob:", () => {
    const d = directives(buildClientCsp("https://api.example.com/api"));
    assert.deepStrictEqual(d["connect-src"], ["'self'", "blob:", "https://api.example.com"]);
  });

  test("a relative API URL is same-origin: connect-src is 'self' and blob: only", () => {
    const d = directives(buildClientCsp("/api"));
    assert.deepStrictEqual(d["connect-src"], ["'self'", "blob:"]);
  });

  test("no API URL resolves like the client does (axios.ts default http://localhost:5000/api)", () => {
    assert.strictEqual(apiOriginFor(undefined), "http://localhost:5000");
    assert.strictEqual(apiOriginFor(""), "http://localhost:5000");
    assert.match(fs.readFileSync(path.join(__dirname, "..", "frontend", "src", "api", "axios.ts"), "utf8"), /"http:\/\/localhost:5000\/api"/);
    assert.deepStrictEqual(directives(buildClientCsp(undefined))["connect-src"], ["'self'", "blob:", "http://localhost:5000"]);
  });

  // ISS-050 (Wave 5): REWRITTEN. The pdf.js worker is self-hosted now, so the
  // policy names no third-party script or worker origin (was https://unpkg.com).
  test("scripts: no inline or eval; scripts and workers are same-origin only (no CDN)", () => {
    const d = directives(buildClientCsp("/api"));
    assert.deepStrictEqual(d["default-src"], ["'self'"]);
    assert.deepStrictEqual(d["script-src"], ["'self'"]);
    assert.deepStrictEqual(d["worker-src"], ["'self'", "blob:"]);
    assert.doesNotMatch(buildClientCsp("https://api.example.com/api"), /unpkg/);
    assert.deepStrictEqual(d["object-src"], ["'none'"]);
    assert.deepStrictEqual(d["base-uri"], ["'self'"]);
    assert.deepStrictEqual(d["form-action"], ["'self'"]);
    const policy = buildClientCsp("/api");
    assert.doesNotMatch(policy, /unsafe-eval/);
    assert.doesNotMatch(d["script-src"].join(" "), /unsafe-inline/);
  });

  /*
   * Rewritten for the Wave 4 review (L2): the meta-tag plugin is build-only,
   * and Vite drops build-only plugins for `vite preview`, so the preview
   * header now lives in a separate plugin that is not build-only.
   */
  test("the meta plugin injects exactly one CSP meta tag, in builds only", () => {
    const plugin = cspMetaPlugin("https://api.example.com/api") as any;
    assert.strictEqual(plugin.apply, "build");
    assert.strictEqual(plugin.configurePreviewServer, undefined);
    const html = fs.readFileSync(path.join(__dirname, "..", "frontend", "index.html"), "utf8");
    const out = plugin.transformIndexHtml(html);
    const out2 = typeof out === "string" ? out : out.html;
    assert.strictEqual(out2.match(/http-equiv="Content-Security-Policy"/g)?.length, 1);
    assert.ok(out2.indexOf("Content-Security-Policy") < out2.indexOf("<script"), "the meta tag precedes every script");
  });

  test("L2: the preview plugin is not build-only, touches nothing else, and sets the header with frame-ancestors", () => {
    const plugin = cspPreviewHeaderPlugin("https://api.example.com/api") as any;
    assert.strictEqual(plugin.apply, undefined, "a build-only plugin never runs under vite preview");
    assert.strictEqual(plugin.transformIndexHtml, undefined);
    assert.strictEqual(plugin.configureServer, undefined, "the dev server stays without a CSP");
    const headers: Record<string, string> = {};
    let nextCalled = false;
    const server = { middlewares: { use: (fn: any) => fn({}, { setHeader: (k: string, v: string) => (headers[k] = v) }, () => (nextCalled = true)) } };
    plugin.configurePreviewServer(server);
    assert.strictEqual(headers["Content-Security-Policy"], `${buildClientCsp("https://api.example.com/api")}; frame-ancestors 'none'`);
    assert.ok(nextCalled);
    assert.deepStrictEqual(cspPlugins("/api").map((p: any) => p.name), ["researchmind-csp", "researchmind-csp-preview"]);
  });

  test("L2: a real `vite preview` server (ephemeral port) sends the CSP header including frame-ancestors 'none'", async () => {
    // Wave 6 (W6-TEST-11): a free ephemeral port (strictPort) instead of the fixed 5932,
    // and the URL is read back from the running server.
    const port = await freePort();
    const frontend = path.join(__dirname, "..", "frontend");
    // Wave 6 (D3): resolve vite the way the frontend does, not by a literal node_modules path.
    const viteEntry = pathToFileURL(createRequire(path.join(frontend, "package.json")).resolve("vite")).href;
    const { preview } = await import(viteEntry);
    // A minimal output directory: preview only serves files, no build needed.
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-csp-preview-"));
    fs.writeFileSync(path.join(outDir, "index.html"), "<!doctype html><html><head></head><body>ok</body></html>");
    const server = await preview({
      root: frontend,
      configFile: path.join(frontend, "vite.config.ts"),
      logLevel: "silent",
      build: { outDir },
      preview: { port, strictPort: true, host: "127.0.0.1", open: false },
    });
    try {
      const address = server.httpServer.address() as { port: number };
      assert.strictEqual(address.port, port);
      const res = await fetch(`http://127.0.0.1:${address.port}/`);
      await res.text();
      assert.strictEqual(res.status, 200);
      const csp = res.headers.get("content-security-policy") ?? "";
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /connect-src 'self' blob:/);
    } finally {
      await server.close();
      fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("the Vite config uses both plugins with the configured API URL", () => {
    const config = fs.readFileSync(path.join(__dirname, "..", "frontend", "vite.config.ts"), "utf8");
    assert.match(config, /cspPlugins\(/);
    assert.match(config, /VITE_API_URL/);
  });
});
