import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import "./helpers/test-env"; // A-5: dead-port REDIS_URL/MONGO_URI defaults before any service code
import { startHttpServer, resolveListenHost } from "../packages/shared/lifecycle/listen";
import { infraDescribe } from "./helpers/infra";
import { TEST_MONGO_URI, mongoSkip } from "./helpers/test-mongo";

/*
 * SEC-004: internal services listen on HOST, default 127.0.0.1 (not every
 * interface); the gateway keeps all interfaces by default (entry point).
 * RT-002: a service that cannot bind its port exits 1 instead of logging
 * "running on port N" and staying alive without listening.
 */

const ROOT = path.resolve(__dirname, "..");
/*
 * Services are spawned as ONE node process with the tsx loader (not the tsx
 * CLI, which starts a second node process): on Windows killing the CLI does
 * not kill its child, which would leak a listening service and keep the temp
 * directory locked.
 */
const TSX_LOADER = pathToFileURL(path.join(ROOT, "node_modules", "tsx", "dist", "loader.mjs")).href;
const serviceArgs = (service: string) => ["--import", TSX_LOADER, path.join(ROOT, "services", service, "src", "server.ts")];

/** Remove a temp directory; a leftover is reported, not a test failure. */
const removeDir = (dir: string) => {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    console.warn(`Could not remove temp dir ${dir}: ${(error as Error).message}`);
  }
};

const occupy = (host: string) =>
  new Promise<net.Server>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => resolve(server));
  });
const portOf = (server: net.Server) => (server.address() as net.AddressInfo).port;
const close = (server: { close: (cb: () => void) => void }) => new Promise<void>((resolve) => server.close(() => resolve()));

describe("SEC-004 / RT-002: startHttpServer (packages/shared/lifecycle/listen.ts)", () => {
  test("default host is 127.0.0.1; HOST overrides it; the gateway passes its own default", async () => {
    assert.strictEqual(resolveListenHost({}), "127.0.0.1");
    assert.strictEqual(resolveListenHost({ HOST: "  " }), "127.0.0.1");
    assert.strictEqual(resolveListenHost({ HOST: "0.0.0.0" }), "0.0.0.0");
    assert.strictEqual(resolveListenHost({}, "0.0.0.0"), "0.0.0.0");

    const logs: string[] = [];
    const server = startHttpServer((_req, res) => res.end("ok"), {
      serviceName: "Test Service",
      port: 0,
      env: {},
      log: (m) => logs.push(m),
      exit: () => assert.fail("must not exit"),
    });
    await new Promise((resolve) => server.once("listening", resolve));
    assert.strictEqual((server.address() as net.AddressInfo).address, "127.0.0.1");
    assert.match(logs[0], /^Test Service running on 127\.0\.0\.1:/);
    await close(server);
  });

  test("an occupied port: exit(1) with the error code, and no 'running' line", async () => {
    const occupier = await occupy("127.0.0.1");
    const logs: string[] = [];
    const errors: string[] = [];
    const exited = new Promise<number>((resolve) => {
      startHttpServer((_req, res) => res.end("ok"), {
        serviceName: "Test Service",
        port: portOf(occupier),
        env: {},
        log: (m) => logs.push(m),
        logError: (m) => errors.push(m),
        exit: (code) => resolve(code),
      });
    });
    assert.strictEqual(await exited, 1);
    assert.deepStrictEqual(logs, []);
    assert.match(errors[0], /cannot listen on 127\.0\.0\.1:\d+: EADDRINUSE/);
    await close(occupier);
  });

  test("the real gateway process exits 1 on EADDRINUSE instead of pretending to run", async () => {
    const occupier = await occupy("0.0.0.0");
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "rm-listen-"));
    try {
      const env: NodeJS.ProcessEnv = {
        PORT: String(portOf(occupier)),
        REDIS_URL: "redis://127.0.0.1:6599",
        JWT_ACCESS_SECRET: crypto.randomBytes(32).toString("hex"),
      };
      for (const name of ["PATH", "SystemRoot", "TEMP", "TMP"]) if (process.env[name]) env[name] = process.env[name];
      const child = spawn(process.execPath, serviceArgs("api-gateway"), {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let output = "";
      child.stdout.on("data", (c) => (output += c));
      child.stderr.on("data", (c) => (output += c));
      const code = await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve(null);
        }, 20_000);
        child.once("exit", (exitCode) => {
          clearTimeout(timer);
          resolve(exitCode);
        });
      });
      assert.strictEqual(code, 1, `gateway did not exit 1: ${output}`);
      assert.match(output, /EADDRINUSE/);
      assert.doesNotMatch(output, /running on/);
    } finally {
      await close(occupier);
      removeDir(cwd);
    }
  });

  test("every service starts through the helper (no bare app.listen)", () => {
    for (const service of ["api-gateway", "auth-service", "workspace-service", "document-service", "task-service", "ai-service"]) {
      const source = fs.readFileSync(path.join(ROOT, "services", service, "src", "server.ts"), "utf8");
      assert.match(source, /startHttpServer\(/, service);
      assert.doesNotMatch(source, /app\.listen\(/, service);
    }
  });
});

const lanIPv4 = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .find((a) => a && a.family === "IPv4" && !a.internal)?.address;

infraDescribe("SEC-004: a real internal service is reachable on 127.0.0.1 only", mongoSkip, () => {
  test("workspace-service answers on 127.0.0.1 and refuses the LAN address", async (t) => {
    const lan = lanIPv4();
    if (!lan) {
      t.skip("no non-loopback IPv4 address on this machine");
      return;
    }
    const probe = await occupy("127.0.0.1");
    const port = portOf(probe);
    await close(probe);
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "rm-listen-ws-"));
    const uri = new URL(TEST_MONGO_URI!);
    uri.pathname = `/rmtest_listen_${crypto.randomBytes(4).toString("hex")}`;
    const env: NodeJS.ProcessEnv = {
      PORT: String(port),
      MONGO_URI: uri.toString(),
      JWT_ACCESS_SECRET: crypto.randomBytes(32).toString("hex"),
      // Required at startup since Wave 5 (SEC-018).
      INTERNAL_SERVICE_TOKEN: crypto.randomBytes(32).toString("hex"),
      REDIS_URL: "redis://127.0.0.1:6599",
    };
    for (const name of ["PATH", "SystemRoot", "TEMP", "TMP"]) if (process.env[name]) env[name] = process.env[name];
    const child = spawn(process.execPath, serviceArgs("workspace-service"), {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    try {
      const deadline = Date.now() + 40_000;
      for (;;) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
          await res.arrayBuffer();
          break;
        } catch {
          if (Date.now() > deadline) assert.fail(`workspace-service did not start: ${output}`);
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      assert.match(output, new RegExp(`running on 127\\.0\\.0\\.1:${port}`));
      await assert.rejects(
        fetch(`http://${lan}:${port}/health`, { signal: AbortSignal.timeout(3000) }),
        "the service is reachable on the LAN address"
      );
    } finally {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
      }
      removeDir(cwd);
      // Drop the throwaway database the service created (indexes).
      const { default: mongoose } = await import("mongoose");
      const admin = await mongoose
        .createConnection(TEST_MONGO_URI!, { dbName: uri.pathname.slice(1), serverSelectionTimeoutMS: 5000 })
        .asPromise();
      try {
        await admin.dropDatabase();
      } finally {
        await admin.close();
      }
    }
  });
});
