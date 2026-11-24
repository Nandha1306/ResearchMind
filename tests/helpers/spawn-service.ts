import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/*
 * One way to start a real service entry point (server.ts) from a test
 * (Wave 6, W6-TEST-12 / W6-TEST-13 / scope amendment A-5):
 *  - a fresh temporary working directory, so dotenv never loads the
 *    repository's (or a service's) real .env file;
 *  - a minimal environment: PATH and the OS basics only, plus explicit
 *    dead-port REDIS_URL / MONGO_URI defaults, so a service that forgets its
 *    own URL fails instead of reaching a real server on 6379 / 27017;
 *  - one Node process: tsx is loaded with --import (no cli.mjs wrapper chain).
 */

import { DEAD_MONGO_URI, DEAD_REDIS_URL } from "./infra-guard";

export { DEAD_MONGO_URI, DEAD_REDIS_URL };

export const ROOT = path.resolve(__dirname, "..", "..");
const LOADER = pathToFileURL(path.join(ROOT, "node_modules", "tsx", "dist", "loader.mjs")).href;

const PASS_THROUGH = ["PATH", "SystemRoot", "TEMP", "TMP", "TMPDIR", "HOME"];

/** The child environment: OS basics, dead-port defaults, then `extra`. */
export const childEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { REDIS_URL: DEAD_REDIS_URL, MONGO_URI: DEAD_MONGO_URI };
  for (const name of PASS_THROUGH) if (process.env[name] !== undefined) env[name] = process.env[name];
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
};

/** A TCP port that was free a moment ago (bind 0, read, close). */
export const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });

export interface SpawnedService {
  child: ChildProcess;
  cwd: string;
  output: () => string;
  stderr: () => string;
  /** Kill (if still running) and remove the temporary working directory. */
  stop: () => Promise<void>;
}

/** Start `entry` (path relative to the repository root) in a temp cwd. */
export const spawnService = (entry: string, extraEnv: NodeJS.ProcessEnv = {}): SpawnedService =>
  spawnNode([path.join(ROOT, entry)], extraEnv);

/** `node --import <tsx loader> ...args` in a temp cwd with childEnv(extraEnv). */
export const spawnNode = (args: string[], extraEnv: NodeJS.ProcessEnv = {}): SpawnedService => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "rm-spawn-"));
  const child = spawn(process.execPath, ["--import", LOADER, ...args], {
    cwd,
    env: childEnv(extraEnv),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let out = "";
  let err = "";
  child.stdout!.on("data", (c) => (out += c));
  child.stderr!.on("data", (c) => {
    out += c;
    err += c;
  });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      await exited;
      clearTimeout(timer);
    }
    fs.rmSync(cwd, { recursive: true, force: true });
  };
  return { child, cwd, output: () => out, stderr: () => err, stop };
};

/**
 * Run `entry` until it exits (or `timeoutMs` passes: code null, the child is
 * killed). Returns the exit code and the combined output.
 */
export const runServiceToExit = (
  entry: string,
  extraEnv: NodeJS.ProcessEnv = {},
  timeoutMs = 90_000
): Promise<{ code: number | null; output: string; stderr: string; ms: number }> =>
  runNodeToExit([path.join(ROOT, entry)], extraEnv, timeoutMs);

/** Like runServiceToExit, for arbitrary node arguments (e.g. -e "require(...)"). */
export const runNodeToExit = async (
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
  timeoutMs = 90_000
): Promise<{ code: number | null; output: string; stderr: string; ms: number }> => {
  const started = Date.now();
  const service = spawnNode(args, extraEnv);
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    service.child.once("exit", (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
  await service.stop();
  return { code, output: service.output(), stderr: service.stderr(), ms: Date.now() - started };
};
