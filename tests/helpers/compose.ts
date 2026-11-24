import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";

/**
 * Helpers for tests that inspect or run the repository's Docker Compose files.
 *
 * Safety rules (the developer's real containers belong to the DEFAULT compose
 * project of this directory):
 *  - every invocation passes an explicit `-p <project>` and `--env-file`, so
 *    the root `.env` (real secrets) is never loaded and the default project is
 *    never addressed;
 *  - the child environment is stripped of every variable compose could
 *    interpolate from (MONGO_*, REDIS_*, ME_CONFIG_*, COMPOSE_*);
 *  - compose output can contain the (generated) secrets: callers assert on it
 *    in memory and never print it.
 */

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const COMPOSE_FILE = path.join(REPO_ROOT, "docker-compose.yml");
export const COMPOSE_TOOLS_FILE = path.join(REPO_ROOT, "docker-compose.tools.yml");

/** Service keys used in the per-service MongoDB user variables. */
export const SERVICE_KEYS = ["AUTH", "WORKSPACE", "DOCUMENT", "TASK", "AI"] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

/** Variables docker-compose.yml must refuse to run without. */
export const REQUIRED_DEFAULT_VARS = [
  "MONGO_ROOT_USERNAME",
  "MONGO_ROOT_PASSWORD",
  "REDIS_PASSWORD",
  ...SERVICE_KEYS.flatMap((key) => [
    `MONGO_${key}_USERNAME`,
    `MONGO_${key}_PASSWORD`,
    `MONGO_${key}_DATABASE`,
  ]),
];

/** Additional variables docker-compose.tools.yml (mongo-express) requires. */
export const REQUIRED_TOOLS_VARS = ["MONGO_EXPRESS_USERNAME", "MONGO_EXPRESS_PASSWORD"];

export const randomHex = (bytes = 24) => crypto.randomBytes(bytes).toString("hex");

/** A complete, random (never default-looking) compose environment. */
export const makeComposeEnv = (
  options: { tools?: boolean; ports?: Partial<Record<"mongo" | "redis" | "mongoExpress", number>> } = {}
): Record<string, string> => {
  const tag = randomHex(3);
  const env: Record<string, string> = {
    MONGO_ROOT_USERNAME: `root_${tag}`,
    MONGO_ROOT_PASSWORD: randomHex(),
    REDIS_PASSWORD: randomHex(),
  };
  for (const key of SERVICE_KEYS) {
    const lower = key.toLowerCase();
    env[`MONGO_${key}_USERNAME`] = `svc_${lower}_${tag}`;
    env[`MONGO_${key}_PASSWORD`] = randomHex();
    env[`MONGO_${key}_DATABASE`] = `rmtest_${lower}_${tag}`;
  }
  if (options.tools) {
    env.MONGO_EXPRESS_USERNAME = `me_${tag}`;
    env.MONGO_EXPRESS_PASSWORD = randomHex();
  }
  if (options.ports?.mongo) env.MONGO_HOST_PORT = String(options.ports.mongo);
  if (options.ports?.redis) env.REDIS_HOST_PORT = String(options.ports.redis);
  if (options.ports?.mongoExpress) env.MONGO_EXPRESS_HOST_PORT = String(options.ports.mongoExpress);
  return env;
};

export const writeEnvFile = (file: string, vars: Record<string, string>) => {
  const body = Object.entries(vars)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
  fs.writeFileSync(file, `${body}\n`, { mode: 0o600 });
};

/** process.env without anything compose could interpolate from. */
export const cleanChildEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(MONGO_|REDIS_|ME_CONFIG_|COMPOSE_)/i.test(name)) continue;
    env[name] = value;
  }
  return env;
};

export const dockerComposeAvailable = (): boolean => {
  const result = spawnSync("docker", ["compose", "version"], { encoding: "utf8", timeout: 20000 });
  return result.status === 0;
};

/** A throwaway project name can never be the default project of this repo. */
export const assertThrowawayProject = (project: string) => {
  if (!/^rm[a-z0-9]*test[a-z0-9-]*$/.test(project) || project === "reserchmind") {
    throw new Error(`refusing to use compose project "${project}": not a throwaway test project`);
  }
};

/** Async variant of runCompose, for running independent `config` checks in parallel. */
export const runComposeAsync = (
  args: string[],
  options: { project: string; envFile: string; files: string[]; timeoutMs?: number }
): Promise<{ status: number | null; stdout: string; stderr: string }> => {
  assertThrowawayProject(options.project);
  return new Promise((resolve) => {
    const child = spawn(
      "docker",
      [
        "compose",
        "--env-file",
        options.envFile,
        "-p",
        options.project,
        ...options.files.flatMap((file) => ["-f", file]),
        ...args,
      ],
      { cwd: REPO_ROOT, env: cleanChildEnv(), timeout: options.timeoutMs ?? 60000 }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.on("error", (error) => resolve({ status: -1, stdout, stderr: stderr + String(error) }));
  });
};

export const runCompose = (
  args: string[],
  options: { project: string; envFile: string; files: string[]; timeoutMs?: number }
): SpawnSyncReturns<string> => {
  assertThrowawayProject(options.project);
  return spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      options.envFile,
      "-p",
      options.project,
      ...options.files.flatMap((file) => ["-f", file]),
      ...args,
    ],
    {
      cwd: REPO_ROOT,
      env: cleanChildEnv(),
      encoding: "utf8",
      timeout: options.timeoutMs ?? 60000,
      maxBuffer: 16 * 1024 * 1024,
    }
  );
};
