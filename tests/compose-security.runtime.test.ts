import assert from "node:assert";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import { describe, test, before, after } from "node:test";
import { infraDescribe } from "./helpers/infra";
import { MongoClient } from "mongodb";
import {
  COMPOSE_FILE,
  COMPOSE_TOOLS_FILE,
  REPO_ROOT,
  SERVICE_KEYS,
  assertThrowawayProject,
  cleanChildEnv,
  makeComposeEnv,
  runCompose,
  writeEnvFile,
} from "./helpers/compose";

/*
 * SEC-001 / SEC-014 / RT-009 (runtime part): the repository's compose files
 * started for real, as a THROWAWAY project, and attacked/used from the host.
 *
 * Opt-in (starts containers): TEST_COMPOSE_RUNTIME=1. Optional overrides:
 *   TEST_COMPOSE_PROJECT  (default rmstabtest; must look like rm*test*)
 *   TEST_COMPOSE_PORT_BASE (default 5940: mongo +0, redis +1, mongo-express +2,
 *                           auth-service +3, document-service +4)
 *
 * Safety: explicit `-p <throwaway project>`, a generated env file in the OS
 * temp dir (the root .env is never loaded), non-default host ports, and
 * `container_name: !reset null` so no container name can collide with the
 * developer's own containers. `down -v` removes only this project.
 */

const runtimeSkip =
  process.env.TEST_COMPOSE_RUNTIME === "1"
    ? false
    : "set TEST_COMPOSE_RUNTIME=1 to start the throwaway compose project (needs Docker)";

const PROJECT = process.env.TEST_COMPOSE_PROJECT || "rmstabtest";
const PORT_BASE = Number(process.env.TEST_COMPOSE_PORT_BASE || 5940);
const PORTS = {
  mongo: PORT_BASE,
  redis: PORT_BASE + 1,
  mongoExpress: PORT_BASE + 2,
  auth: PORT_BASE + 3,
  document: PORT_BASE + 4,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Reject after ms (a ref'd timer, so the event loop stays alive meanwhile). */
const withTimeout = <T>(promise: Promise<T>, ms: number, label: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

const waitFor = async (label: string, probe: () => Promise<boolean>, timeoutMs = 120000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      // The MongoDB driver unrefs its timers: without a ref'd timeout a probe
      // against a not-yet-listening server can leave nothing keeping Node alive.
      if (await withTimeout(probe(), 10000, label)) return;
    } catch {
      // not ready yet
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(1000);
  }
};

/** Resolves true if a TCP connection to host:port succeeds within 2 s. */
const canConnect = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(2000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });

const mongoUri = (user: string, password: string, db = "admin") =>
  `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${PORTS.mongo}/${db}?authSource=admin&directConnection=true`;

const withMongo = async <T>(uri: string, fn: (client: MongoClient) => Promise<T>): Promise<T> => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
};

const mongoErrorCode = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 0;
  } catch (error) {
    return (error as { code?: number }).code ?? -1;
  }
};

// ioredis 6 from the repository root (same major as gateway/document-service).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const IORedis = require("ioredis");
const RedisCtor = IORedis.default ?? IORedis.Redis ?? IORedis;

const redisCommand = async (password: string | undefined, args: string[]) => {
  const client = new RedisCtor({
    host: "127.0.0.1",
    port: PORTS.redis,
    password,
    lazyConnect: true,
    enableReadyCheck: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  client.on("error", () => undefined);
  try {
    await client.connect();
    return await client.call(args[0], ...args.slice(1));
  } finally {
    client.disconnect();
  }
};

/**
 * Send raw RESP commands on one fresh connection and return the raw replies.
 * Used for the unauthenticated/wrong-password checks so no client library
 * behaviour (handshakes, reconnects) can blur what the server answers.
 */
const rawRedis = (commands: string[][]) =>
  new Promise<string>((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port: PORTS.redis });
    let data = "";
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(data);
    }, 1500);
    const CRLF = "\r\n";
    socket.on("connect", () => {
      for (const args of commands) {
        const parts = [`*${args.length}`, ...args.flatMap((a) => [`$${Buffer.byteLength(a)}`, a])];
        socket.write(parts.join(CRLF) + CRLF);
      }
    });
    socket.on("data", (chunk) => {
      data += chunk;
      if (data.split(CRLF).filter(Boolean).length >= commands.length) {
        clearTimeout(timer);
        socket.destroy();
        resolve(data);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

infraDescribe("throwaway compose project (SEC-001, SEC-014, RT-009)", runtimeSkip, () => {
  let tmpDir = "";
  let envFile = "";
  let overrideFile = "";
  let env: Record<string, string> = {};
  const files = () => [COMPOSE_FILE, COMPOSE_TOOLS_FILE, overrideFile];
  const children: { name: string; proc: ChildProcess; log: string[] }[] = [];
  let keepAlive: NodeJS.Timeout | undefined;
  let tornDown = false;

  /** Remove this project's containers, network and volumes (never anything else). */
  const teardown = () => {
    if (tornDown || !envFile) return;
    tornDown = true;
    runCompose(["down", "-v", "--remove-orphans"], {
      project: PROJECT,
      envFile,
      files: files(),
      timeoutMs: 180000,
    });
  };

  const secrets = () =>
    Object.entries(env)
      .filter(([name]) => /PASSWORD$/.test(name))
      .map(([, value]) => value);

  /** Assert a text contains none of the generated passwords. */
  const assertNoSecrets = (text: string, where: string) => {
    for (const secret of secrets()) {
      assert.ok(!text.includes(secret), `a password appears in ${where}`);
    }
  };

  before(async () => {
    assertThrowawayProject(PROJECT);
    for (const port of [PORTS.mongo, PORTS.redis, PORTS.mongoExpress]) {
      assert.ok(![27017, 6379, 8081].includes(port), "refusing to use the default host ports");
      assert.strictEqual(await canConnect("127.0.0.1", port), false, `port ${port} is already in use`);
    }

    keepAlive = setInterval(() => undefined, 1000);
    // Last resort if the run dies before after() (synchronous, so it works in 'exit').
    process.once("exit", teardown);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-compose-rt-"));
    envFile = path.join(tmpDir, "compose.env");
    overrideFile = path.join(tmpDir, "override.yml");
    env = makeComposeEnv({
      tools: true,
      ports: { mongo: PORTS.mongo, redis: PORTS.redis, mongoExpress: PORTS.mongoExpress },
    });
    writeEnvFile(envFile, env);
    fs.writeFileSync(
      overrideFile,
      [
        "services:",
        "  mongodb:",
        "    container_name: !reset null",
        "  redis:",
        "    container_name: !reset null",
        "  mongo-express:",
        "    container_name: !reset null",
        "",
      ].join("\n")
    );

    const up = runCompose(["up", "-d", "--wait", "--wait-timeout", "180"], {
      project: PROJECT,
      envFile,
      files: files(),
      timeoutMs: 300000,
    });
    assert.strictEqual(up.status, 0, `compose up failed: ${up.stderr.slice(-2000)}`);

    await waitFor("mongodb (root)", () =>
      withMongo(mongoUri(env.MONGO_ROOT_USERNAME, env.MONGO_ROOT_PASSWORD), async (c) => {
        await c.db("admin").command({ ping: 1 });
        return true;
      })
    );
    await waitFor("redis", async () => (await redisCommand(env.REDIS_PASSWORD, ["PING"])) === "PONG");
    await waitFor("mongo-express", async () => {
      const res = await fetch(`http://127.0.0.1:${PORTS.mongoExpress}/`);
      return res.status === 401;
    });
  });

  after(async () => {
    for (const child of children) {
      if (child.proc.exitCode === null) child.proc.kill();
    }
    await sleep(500);
    teardown();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (keepAlive) clearInterval(keepAlive);
  });

  test("every published port of the project is bound to 127.0.0.1 only", () => {
    const ps = spawnSync(
      "docker",
      ["ps", "--filter", `label=com.docker.compose.project=${PROJECT}`, "--format", "{{.Names}}\t{{.Ports}}"],
      { encoding: "utf8", env: cleanChildEnv() }
    );
    assert.strictEqual(ps.status, 0);
    const lines = ps.stdout.trim().split(/\r?\n/).filter(Boolean);
    assert.strictEqual(lines.length, 3, "expected mongodb, redis and mongo-express");
    for (const line of lines) {
      const [name, ports] = line.split("\t");
      assert.ok(name.startsWith(`${PROJECT}-`), `${name} is not a project-scoped container name`);
      assert.match(ports, /127\.0\.0\.1:\d+->/);
      assert.doesNotMatch(ports, /0\.0\.0\.0|\[::\]|:::/, `${name} is published beyond localhost`);
    }
  });

  test("published ports are not reachable on the host's LAN addresses", async (t) => {
    const lanAddresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((a): a is os.NetworkInterfaceInfo => Boolean(a && a.family === "IPv4" && !a.internal))
      .map((a) => a.address);
    if (lanAddresses.length === 0) {
      // Wave 6 Stage E (W6-R6-02): never a silent pass. In CI the check is
      // required, so it fails; elsewhere it is a counted skip, which the CI
      // compose gate (0 skips) would also reject.
      if (process.env.CI) assert.fail("no non-loopback IPv4 interface: the SEC-001 LAN check is impossible in CI");
      t.skip("no non-loopback IPv4 interface: LAN check not possible on this host");
      return;
    }
    for (const port of [PORTS.mongo, PORTS.redis, PORTS.mongoExpress]) {
      assert.strictEqual(await canConnect("127.0.0.1", port), true, `127.0.0.1:${port} not reachable`);
      for (const address of lanAddresses) {
        assert.strictEqual(await canConnect(address, port), false, `${address}:${port} is reachable`);
      }
    }
  });

  test("Redis: no password -> NOAUTH, wrong/default password -> WRONGPASS, right one -> PONG", async () => {
    assert.match(await rawRedis([["PING"]]), /^-NOAUTH/);
    assert.match(await rawRedis([["KEYS", "*"]]), /^-NOAUTH/);
    for (const wrong of ["password", "redis", "admin", ""]) {
      assert.match(await rawRedis([["AUTH", wrong]]), /^-(WRONGPASS|ERR)/, `AUTH with a default password was accepted`);
    }
    assert.strictEqual(await redisCommand(env.REDIS_PASSWORD, ["PING"]), "PONG");
    const protectedMode = (await redisCommand(env.REDIS_PASSWORD, ["CONFIG", "GET", "protected-mode"])) as string[];
    assert.deepStrictEqual(protectedMode, ["protected-mode", "yes"]);
  });

  test("Redis clients of gateway, document-service and ai-service authenticate from REDIS_URL", async () => {
    process.env.REDIS_URL = `redis://:${env.REDIS_PASSWORD}@127.0.0.1:${PORTS.redis}`;
    const modules = [
      "../services/api-gateway/src/middlewares/rate-limit.middleware",
      "../services/document-service/src/config/redis",
      "../services/ai-service/src/config/redis",
      "../services/ai-service/src/config/redis-worker",
    ];
    for (const modulePath of modules) {
      const loaded = await import(modulePath);
      const client = loaded.rateLimitRedis ?? loaded.default?.default ?? loaded.default;
      try {
        assert.strictEqual(await client.ping(), "PONG", `${modulePath} could not PING`);
      } finally {
        client.disconnect();
      }
    }
  });

  test("MongoDB: default and unauthenticated access fail; root credentials work", async () => {
    for (const [user, password] of [
      ["admin", "password"],
      ["admin", "pass"],
      ["root", "example"],
    ]) {
      const code = await mongoErrorCode(() =>
        withMongo(mongoUri(user, password), (c) => c.db("admin").command({ ping: 1 }))
      );
      assert.strictEqual(code, 18, `${user}/<default> was not rejected with AuthenticationFailed`);
    }
    const anonymous = await mongoErrorCode(() =>
      withMongo(`mongodb://127.0.0.1:${PORTS.mongo}/?directConnection=true`, (c) =>
        c.db("admin").admin().listDatabases()
      )
    );
    assert.strictEqual(anonymous, 13, "unauthenticated listDatabases was not Unauthorized");
    await withMongo(mongoUri(env.MONGO_ROOT_USERNAME, env.MONGO_ROOT_PASSWORD), async (c) => {
      assert.strictEqual((await c.db("admin").command({ ping: 1 })).ok, 1);
    });
  });

  test("SEC-014: each service user reads/writes its own database and nothing else", async () => {
    for (const key of SERVICE_KEYS) {
      const own = env[`MONGO_${key}_DATABASE`];
      const uri = mongoUri(env[`MONGO_${key}_USERNAME`], env[`MONGO_${key}_PASSWORD`], own);
      await withMongo(uri, async (client) => {
        const marker = crypto.randomUUID();
        await client.db(own).collection("probe").insertOne({ marker });
        assert.ok(await client.db(own).collection("probe").findOne({ marker }), `${key}: own read failed`);
        await client.db(own).collection("probe").createIndex({ marker: 1 });

        for (const other of SERVICE_KEYS.filter((k) => k !== key)) {
          const otherDb = env[`MONGO_${other}_DATABASE`];
          assert.strictEqual(
            await mongoErrorCode(() => client.db(otherDb).collection("probe").findOne({})),
            13,
            `${key} can read ${other}'s database`
          );
          assert.strictEqual(
            await mongoErrorCode(() => client.db(otherDb).collection("probe").insertOne({ x: 1 })),
            13,
            `${key} can write ${other}'s database`
          );
        }
        assert.strictEqual(
          await mongoErrorCode(() => client.db("admin").collection("system.users").findOne({})),
          13,
          `${key} can read admin.system.users`
        );
        const listed = await client.db("admin").admin().listDatabases({ nameOnly: true });
        for (const db of listed.databases) {
          assert.strictEqual(db.name, own, `${key} can list database ${db.name}`);
        }
      });
    }
  });

  test("the init script logged each created user and never a password", () => {
    const logs = runCompose(["logs", "--no-color", "mongodb"], { project: PROJECT, envFile, files: files() });
    assert.strictEqual(logs.status, 0);
    const text = logs.stdout + logs.stderr;
    for (const key of SERVICE_KEYS) {
      assert.ok(
        text.includes(`provision-service-users: created ${env[`MONGO_${key}_USERNAME`]} `),
        `init did not create the ${key} user`
      );
    }
    assertNoSecrets(text, "the mongodb logs");
  });

  const provision = (extraEnv: string[] = []) =>
    runCompose(
      [
        "exec",
        "-T",
        ...extraEnv.flatMap((e) => ["-e", e]),
        "mongodb",
        "sh",
        "-c",
        'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin /docker-entrypoint-initdb.d/10-provision-service-users.js',
      ],
      { project: PROJECT, envFile, files: files(), timeoutMs: 60000 }
    );

  test("re-running the provisioning script is idempotent and prints no password", async () => {
    const result = provision();
    assert.strictEqual(result.status, 0, `re-run failed: ${result.stdout.slice(-500)}${result.stderr.slice(-500)}`);
    for (const key of SERVICE_KEYS) {
      assert.ok(result.stdout.includes(`updated ${env[`MONGO_${key}_USERNAME`]} `), `${key} not updated`);
    }
    assertNoSecrets(result.stdout + result.stderr, "the provisioning output");
    await withMongo(
      mongoUri(env.MONGO_AUTH_USERNAME, env.MONGO_AUTH_PASSWORD, env.MONGO_AUTH_DATABASE),
      async (c) => {
        assert.ok(await c.db(env.MONGO_AUTH_DATABASE).collection("probe").findOne({}));
      }
    );
  });

  test("the provisioning script fails closed: missing variable, weak password, root user", async () => {
    const missing = provision(["MONGO_TASK_PASSWORD="]);
    assert.notStrictEqual(missing.status, 0);
    assert.match(missing.stdout + missing.stderr, /MONGO_TASK_PASSWORD is not set/);

    const weak = provision(["MONGO_AI_PASSWORD=short"]);
    assert.notStrictEqual(weak.status, 0);
    assert.match(weak.stdout + weak.stderr, /MONGO_AI_PASSWORD must be/);

    const rootTarget = provision([`MONGO_AUTH_USERNAME=${env.MONGO_ROOT_USERNAME}`]);
    assert.notStrictEqual(rootTarget.status, 0);
    assert.match(rootTarget.stdout + rootTarget.stderr, /MONGO_AUTH_USERNAME names the user running this script/);
    for (const result of [missing, weak, rootTarget]) {
      assertNoSecrets(result.stdout + result.stderr, "a failed provisioning run");
    }

    // Nothing was changed: root and the service users still work.
    await withMongo(mongoUri(env.MONGO_ROOT_USERNAME, env.MONGO_ROOT_PASSWORD), async (c) => {
      const info = await c.db("admin").command({ usersInfo: env.MONGO_ROOT_USERNAME });
      assert.ok(info.users[0].roles.some((r: { role: string }) => r.role === "root"), "root lost its role");
    });
    await withMongo(
      mongoUri(env.MONGO_AI_USERNAME, env.MONGO_AI_PASSWORD, env.MONGO_AI_DATABASE),
      (c) => c.db(env.MONGO_AI_DATABASE).command({ ping: 1 })
    );
  });

  test("mongo-express: bound to localhost, basic auth required, defaults rejected", async () => {
    const url = `http://127.0.0.1:${PORTS.mongoExpress}/`;
    const basic = (user: string, password: string) =>
      ({ authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` });
    assert.strictEqual((await fetch(url)).status, 401);
    for (const [user, password] of [
      ["admin", "pass"],
      ["admin", "password"],
    ]) {
      assert.strictEqual((await fetch(url, { headers: basic(user, password) })).status, 401);
    }
    const ok = await fetch(url, { headers: basic(env.MONGO_EXPRESS_USERNAME, env.MONGO_EXPRESS_PASSWORD) });
    assert.strictEqual(ok.status, 200);
    await ok.text();
  });

  const startService = async (name: string, entry: string, serviceEnv: Record<string, string>) => {
    const log: string[] = [];
    // tsx loader by absolute URL: the working directory is a temp dir.
    const tsxLoader = pathToFileURL(path.join(REPO_ROOT, "node_modules", "tsx", "dist", "loader.mjs")).href;
    const proc = spawn(process.execPath, ["--import", tsxLoader, path.join(REPO_ROOT, entry)], {
      // A temp working directory: dotenv must not find any real .env file.
      cwd: tmpDir,
      env: { ...cleanChildEnv(), NODE_PATH: path.join(REPO_ROOT, "node_modules"), ...serviceEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stdout?.on("data", (chunk) => log.push(String(chunk)));
    proc.stderr?.on("data", (chunk) => log.push(String(chunk)));
    children.push({ name, proc, log });
    return { proc, log };
  };

  const redacted = (text: string) =>
    secrets().reduce((acc, secret) => acc.split(secret).join("<redacted>"), text).slice(-3000);

  const waitHealthy = async (name: string, port: number, log: string[]) => {
    try {
      await waitFor(`${name} /health`, async () => (await health(port)).status === 200, 60000);
    } catch (error) {
      throw new Error(`${(error as Error).message}; log tail:
${redacted(log.join(""))}`);
    }
  };

  const health = async (port: number) => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    return { status: res.status, body: (await res.json()) as any };
  };

  test("auth-service (own Mongo user, no Redis) boots, registers a user, logs no Redis line", async () => {
    const svc = await startService("auth-service", "services/auth-service/src/server.ts", {
      PORT: String(PORTS.auth),
      MONGO_URI: mongoUri(env.MONGO_AUTH_USERNAME, env.MONGO_AUTH_PASSWORD, env.MONGO_AUTH_DATABASE),
      JWT_ACCESS_SECRET: crypto.randomBytes(32).toString("hex"),
      JWT_REFRESH_SECRET: crypto.randomBytes(32).toString("hex"),
      INTERNAL_SERVICE_TOKEN: crypto.randomBytes(32).toString("hex"),
    });
    await waitHealthy("auth-service", PORTS.auth, svc.log);

    const register = await fetch(`http://127.0.0.1:${PORTS.auth}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Compose Probe", email: `probe-${Date.now()}@example.test`, password: "probe1234" }),
    });
    assert.ok(register.status === 201 || register.status === 200, `register answered ${register.status}`);
    await register.text();

    await sleep(1000);
    const output = svc.log.join("");
    assert.doesNotMatch(output, /redis/i, "auth-service still talks about Redis");
    assertNoSecrets(output, "the auth-service log");
  });

  test("document-service (own Mongo user, Redis with password) reports healthy", async () => {
    const svc = await startService("document-service", "services/document-service/src/server.ts", {
      PORT: String(PORTS.document),
      NODE_ENV: "test",
      MONGO_URI: mongoUri(env.MONGO_DOCUMENT_USERNAME, env.MONGO_DOCUMENT_PASSWORD, env.MONGO_DOCUMENT_DATABASE),
      REDIS_URL: `redis://:${env.REDIS_PASSWORD}@127.0.0.1:${PORTS.redis}`,
      JWT_ACCESS_SECRET: crypto.randomBytes(32).toString("hex"),
      INTERNAL_SERVICE_TOKEN: crypto.randomBytes(32).toString("hex"),
      CLOUDINARY_CLOUD_NAME: "dummy-not-used",
      CLOUDINARY_API_KEY: "dummy-not-used",
      CLOUDINARY_API_SECRET: "dummy-not-used",
      // Never reached in this test; must not default to a real local service.
      WORKSPACE_SERVICE_URL: "http://127.0.0.1:9",
      AI_SERVICE_URL: "http://127.0.0.1:9",
    });
    await waitHealthy("document-service", PORTS.document, svc.log);
    const { body } = await health(PORTS.document);
    assert.deepStrictEqual(body.dependencies, { mongo: "up", redis: "up" });
    assertNoSecrets(svc.log.join(""), "the document-service log");
  });
});
