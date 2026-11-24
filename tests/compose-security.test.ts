import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test, before, after } from "node:test";
import { infraDescribe } from "./helpers/infra";
import {
  COMPOSE_FILE,
  COMPOSE_TOOLS_FILE,
  REPO_ROOT,
  REQUIRED_DEFAULT_VARS,
  REQUIRED_TOOLS_VARS,
  SERVICE_KEYS,
  dockerComposeAvailable,
  makeComposeEnv,
  runCompose,
  runComposeAsync,
  writeEnvFile,
} from "./helpers/compose";

/*
 * SEC-001 / SEC-014 / RT-009 (static part): the infrastructure configuration
 * that ships in the repository.
 *
 *  - Compose files: localhost-only port bindings, no fallback credentials,
 *    Redis password, mongo-express only in the opt-in tools file, per-service
 *    MongoDB users provisioned on a fresh volume. Checked through
 *    `docker compose config` (the authoritative interpolation/merge), with a
 *    throwaway project name and a generated env file -- never the real `.env`.
 *  - Example env files: per-service MongoDB users and authenticated Redis URLs.
 *  - Redis URL format `redis://:<password>@host:port` understood by both
 *    ioredis majors in use (5 in ai-service, 6 in gateway/document-service).
 *  - auth-service no longer creates an (unused) Redis client.
 *
 * The runtime counterpart (real containers) is compose-security.runtime.test.ts.
 */

const read = (relative: string) => fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");

/** `${VAR<op><word>}` references in a compose file, comments excluded. */
const variableRefs = (text: string) => {
  const uncommented = text
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, ""))
    .join("\n");
  const refs: { name: string; op: string }[] = [];
  for (const match of uncommented.matchAll(/\$\{([A-Za-z0-9_]+)(:?[-?+])?[^}]*\}/g)) {
    refs.push({ name: match[1], op: match[2] ?? "" });
  }
  return refs;
};

describe("compose files (text)", () => {
  for (const file of [COMPOSE_FILE, COMPOSE_TOOLS_FILE]) {
    const label = path.basename(file);

    test(`${label}: only host ports may have a fallback; everything else is required (:?)`, () => {
      const refs = variableRefs(fs.readFileSync(file, "utf8"));
      assert.ok(refs.length > 0, `${label} references no variables`);
      for (const { name, op } of refs) {
        if (/_HOST_PORT$/.test(name)) {
          assert.strictEqual(op, ":-", `${name} should be optional with a default port`);
        } else {
          assert.strictEqual(op, ":?", `${name} must be required with \${${name}:?message} (no fallback)`);
        }
      }
    });
  }

  test("docker-compose.yml does not define mongo-express (opt-in tools file only)", () => {
    const text = fs.readFileSync(COMPOSE_FILE, "utf8");
    assert.doesNotMatch(text, /^\s{2}mongo-express:/m);
    assert.match(fs.readFileSync(COMPOSE_TOOLS_FILE, "utf8"), /^\s{2}mongo-express:/m);
  });

  test("docker-compose.yml has no obsolete version key", () => {
    assert.doesNotMatch(fs.readFileSync(COMPOSE_FILE, "utf8"), /^version\s*:/m);
  });
});

const composeAvailable = dockerComposeAvailable();
const composeSkip = composeAvailable
  ? false
  : process.env.CI
    ? false // CI must have docker compose: run and fail loudly instead of skipping
    : "docker compose is not available on this machine";

infraDescribe("docker compose config (interpolated)", composeSkip, () => {
  let tmpDir: string;
  const project = "rmstabtest-config";

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-compose-cfg-"));
  });
  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const config = (vars: Record<string, string>, files: string[], name: string) => {
    const envFile = path.join(tmpDir, `${name}.env`);
    writeEnvFile(envFile, vars);
    // Output holds generated test secrets only; never printed.
    return runCompose(["config", "--format", "json"], { project, envFile, files });
  };

  test("with every required variable set: only mongodb and redis, all ports on 127.0.0.1", () => {
    const env = makeComposeEnv({ ports: { mongo: 47017, redis: 46379 } });
    const result = config(env, [COMPOSE_FILE], "full");
    assert.strictEqual(result.status, 0, "compose config failed with a complete env");
    const parsed = JSON.parse(result.stdout);

    assert.deepStrictEqual(Object.keys(parsed.services).sort(), ["mongodb", "redis"]);
    for (const [name, service] of Object.entries<any>(parsed.services)) {
      assert.ok(Array.isArray(service.ports) && service.ports.length > 0, `${name} publishes no port`);
      for (const port of service.ports) {
        assert.strictEqual(port.host_ip, "127.0.0.1", `${name} publishes ${port.target} beyond localhost`);
      }
    }
    assert.strictEqual(parsed.services.mongodb.ports[0].published, "47017");
    assert.strictEqual(parsed.services.redis.ports[0].published, "46379");

    // Credentials come from the env file, never from a literal default.
    const mongoEnv = parsed.services.mongodb.environment;
    assert.strictEqual(mongoEnv.MONGO_INITDB_ROOT_USERNAME, env.MONGO_ROOT_USERNAME);
    assert.strictEqual(mongoEnv.MONGO_INITDB_ROOT_PASSWORD, env.MONGO_ROOT_PASSWORD);
    for (const key of SERVICE_KEYS) {
      for (const field of ["USERNAME", "PASSWORD", "DATABASE"]) {
        const name = `MONGO_${key}_${field}`;
        assert.strictEqual(mongoEnv[name], env[name], `${name} not passed to the mongodb container`);
      }
    }

    // Per-service users are provisioned on a fresh volume by the init script.
    const initMount = (parsed.services.mongodb.volumes as any[]).find((v) =>
      String(v.target).startsWith("/docker-entrypoint-initdb.d/")
    );
    assert.ok(initMount, "provisioning script is not mounted into /docker-entrypoint-initdb.d");
    assert.strictEqual(initMount.read_only, true);
    assert.ok(
      path.resolve(initMount.source) === path.join(REPO_ROOT, "docker", "mongo", "provision-service-users.js"),
      "init mount does not point at docker/mongo/provision-service-users.js"
    );

    // Redis requires a password and keeps protected mode on.
    const command: string[] = parsed.services.redis.command;
    const pw = command.indexOf("--requirepass");
    assert.ok(pw >= 0, "redis has no --requirepass");
    assert.strictEqual(command[pw + 1], env.REDIS_PASSWORD);
    const pm = command.indexOf("--protected-mode");
    assert.ok(pm >= 0 && command[pm + 1] === "yes", "redis protected mode is not explicitly on");
  });

  test("host ports keep the previous defaults when not overridden", () => {
    const result = config(makeComposeEnv(), [COMPOSE_FILE], "defaults");
    assert.strictEqual(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.services.mongodb.ports[0].published, "27017");
    assert.strictEqual(parsed.services.redis.ports[0].published, "6379");
  });

  /** Run `config` once per variable, each with that variable left out, in parallel. */
  const assertEachRequired = async (required: string[], files: string[], tools: boolean) => {
    const results = await Promise.all(
      required.map((missing) => {
        const env = makeComposeEnv({ tools });
        delete env[missing];
        const envFile = path.join(tmpDir, `missing-${tools ? "tools-" : ""}${missing}.env`);
        writeEnvFile(envFile, env);
        return runComposeAsync(["config", "--quiet"], { project, envFile, files }).then((r) => ({ missing, ...r }));
      })
    );
    for (const { missing, status, stderr } of results) {
      assert.notStrictEqual(status, 0, `compose accepted a config without ${missing}`);
      assert.match(stderr, new RegExp(`\\b${missing}\\b`), `error does not name ${missing}`);
    }
  };

  // The root .env is not loaded (--env-file), and it does define
  // MONGO_ROOT_PASSWORD, so this also proves the real .env is never read.
  test("refuses to run without any one of the required variables", () =>
    assertEachRequired(REQUIRED_DEFAULT_VARS, [COMPOSE_FILE], false));

  test("an empty value is rejected like a missing one", () => {
    const env = makeComposeEnv();
    env.MONGO_ROOT_PASSWORD = "";
    const result = config(env, [COMPOSE_FILE], "empty-root-pw");
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /MONGO_ROOT_PASSWORD/);
  });

  test("the tools file adds mongo-express on 127.0.0.1 with required basic auth", () => {
    const env = makeComposeEnv({ tools: true, ports: { mongoExpress: 48081 } });
    const result = config(env, [COMPOSE_FILE, COMPOSE_TOOLS_FILE], "tools");
    assert.strictEqual(result.status, 0, "compose config failed for the tools file");
    const me = JSON.parse(result.stdout).services["mongo-express"];
    assert.ok(me, "mongo-express missing from the tools file");
    // Basic auth depends on the image's env-variable semantics: pin the version.
    assert.match(String(me.image), /^mongo-express:\d+\.\d+\.\d+$|@sha256:[0-9a-f]{64}$/, "mongo-express image is not pinned");
    for (const port of me.ports) assert.strictEqual(port.host_ip, "127.0.0.1");
    assert.strictEqual(me.ports[0].published, "48081");
    assert.strictEqual(me.environment.ME_CONFIG_BASICAUTH, "true");
    assert.strictEqual(me.environment.ME_CONFIG_BASICAUTH_USERNAME, env.MONGO_EXPRESS_USERNAME);
    assert.strictEqual(me.environment.ME_CONFIG_BASICAUTH_PASSWORD, env.MONGO_EXPRESS_PASSWORD);
    assert.strictEqual(me.environment.ME_CONFIG_MONGODB_ADMINPASSWORD, env.MONGO_ROOT_PASSWORD);
  });

  test("the tools file refuses to run without its basic-auth credentials", () =>
    assertEachRequired(REQUIRED_TOOLS_VARS, [COMPOSE_FILE, COMPOSE_TOOLS_FILE], true));
});

describe("example env files", () => {
  test("root .env.example lists every compose variable, with credentials left empty", () => {
    const example = read(".env.example");
    const assigned = new Map<string, string>();
    for (const line of example.split(/\r?\n/)) {
      const match = /^\s*#?\s*([A-Z0-9_]+)=(.*)$/.exec(line);
      if (match) assigned.set(match[1], match[2].trim());
    }
    const composeVars = new Set(
      [COMPOSE_FILE, COMPOSE_TOOLS_FILE].flatMap((file) =>
        variableRefs(fs.readFileSync(file, "utf8")).map((ref) => ref.name)
      )
    );
    for (const name of composeVars) {
      assert.ok(assigned.has(name), `.env.example does not mention ${name}`);
    }
    // Passwords are empty so an unedited copy fails closed (compose :? rejects empty).
    for (const name of [...REQUIRED_DEFAULT_VARS, ...REQUIRED_TOOLS_VARS].filter((n) => /PASSWORD$/.test(n))) {
      assert.strictEqual(assigned.get(name), "", `${name} must be empty in .env.example`);
    }
    assert.ok(!assigned.has("MONGO_ROOT_USER"), "stale MONGO_ROOT_USER name in .env.example");
  });

  const mongoServices: [string, string][] = [
    ["auth-service", "auth"],
    ["workspace-service", "workspace"],
    ["document-service", "document"],
    ["task-service", "task"],
    ["ai-service", "ai"],
  ];
  for (const [service, short] of mongoServices) {
    test(`${service}/.env.example connects with its own MongoDB user on 127.0.0.1`, () => {
      const uri = /^MONGO_URI=(.*)$/m.exec(read(`services/${service}/.env.example`))?.[1] ?? "";
      assert.match(uri, new RegExp(`^mongodb://<${short}-service-user>:<${short}-service-password>@127\\.0\\.0\\.1:27017/`));
      assert.match(uri, /authSource=admin/);
      assert.doesNotMatch(uri, /root/i);
    });
  }

  for (const service of ["api-gateway", "document-service", "ai-service"]) {
    test(`${service}/.env.example uses an authenticated REDIS_URL`, () => {
      const url = /^REDIS_URL=(.*)$/m.exec(read(`services/${service}/.env.example`))?.[1] ?? "";
      assert.strictEqual(url, "redis://:<redis-password>@127.0.0.1:6379");
    });
  }

  test("auth-service/.env.example no longer lists Redis settings", () => {
    assert.doesNotMatch(read("services/auth-service/.env.example"), /^\s*REDIS_/m);
  });
});

describe("Redis URL with a password (redis://:<password>@host:port)", () => {
  const url = "redis://:3f9c0a2b7d@127.0.0.1:6380/2";
  const clients: [string, string][] = [
    ["ioredis 6 (api-gateway, document-service)", path.join(REPO_ROOT, "node_modules", "ioredis")],
    ["ioredis 5 (ai-service)", path.join(REPO_ROOT, "services", "ai-service", "node_modules", "ioredis")],
  ];
  for (const [label, modulePath] of clients) {
    test(`${label} takes the password from the URL`, () => {
      const loaded = require(modulePath);
      const Redis = loaded.default ?? loaded.Redis ?? loaded;
      const client = new Redis(url, { lazyConnect: true });
      try {
        assert.strictEqual(client.options.password, "3f9c0a2b7d");
        assert.ok(!client.options.username, "an empty URL username must not become a username");
        assert.strictEqual(client.options.host, "127.0.0.1");
        assert.strictEqual(client.options.port, 6380);
        assert.strictEqual(client.options.db, 2);
      } finally {
        client.disconnect();
      }
    });
  }
});

describe("RT-009: auth-service has no Redis client", () => {
  const authSrc = path.join(REPO_ROOT, "services", "auth-service", "src");
  const sources = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? sources(full) : entry.name.endsWith(".ts") ? [full] : [];
    });

  test("no source file imports a Redis client", () => {
    for (const file of sources(authSrc)) {
      const text = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(
        text,
        /from\s+["'](redis|ioredis)["']|require\(\s*["'](redis|ioredis)["']\s*\)|config\/redis/,
        `${path.relative(REPO_ROOT, file)} still uses Redis`
      );
    }
    assert.ok(!fs.existsSync(path.join(authSrc, "config", "redis.ts")), "config/redis.ts still exists");
  });
});
