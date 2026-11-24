#!/usr/bin/env node
/*
 * Wave 6 CI readiness check (W6-CI-07): the disposable MongoDB and Redis of
 * the test job are ready only when
 *   - an AUTHENTICATED ping works through the published loopback port, and
 *   - ANONYMOUS access is refused (Mongo listDatabases -> code 13
 *     Unauthorized; Redis PING -> NOAUTH),
 * proving the authentication path the tests rely on. Retries until
 * --timeout seconds (default 90). Uses the repository's own mongodb and
 * ioredis (root devDependencies). Never prints a URI or a password.
 *
 *   TEST_MONGO_URI=... TEST_REDIS_URL=... node scripts/ci/wait-infra.cjs --timeout 90
 */
const net = require("node:net");
const { MongoClient } = require("mongodb");
const Redis = require("ioredis");

const timeoutArg = process.argv.indexOf("--timeout");
const timeoutS = timeoutArg === -1 ? 90 : Number(process.argv[timeoutArg + 1]);
const deadline = Date.now() + timeoutS * 1000;

const mongoUri = process.env.TEST_MONGO_URI;
const redisUrl = process.env.TEST_REDIS_URL;
if (!mongoUri || !redisUrl) {
  console.error("wait-infra: TEST_MONGO_URI and TEST_REDIS_URL must be set");
  process.exit(1);
}

const withoutCredentials = (value) => {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  return url.toString();
};

const mongoAuthenticated = async () => {
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    const result = await client.db("admin").command({ ping: 1 });
    return result.ok === 1;
  } finally {
    await client.close().catch(() => {});
  }
};

const mongoAnonymousRefused = async () => {
  const client = new MongoClient(withoutCredentials(mongoUri), { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    await client.db("admin").command({ listDatabases: 1 });
    return false; // anonymous access worked: not acceptable
  } catch (error) {
    return error && error.code === 13;
  } finally {
    await client.close().catch(() => {});
  }
};

const redisAuthenticated = async () => {
  const client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 3000, enableOfflineQueue: false });
  try {
    await client.connect();
    return (await client.ping()) === "PONG";
  } finally {
    client.disconnect();
  }
};

/*
 * Anonymous Redis check over a raw socket: send PING without AUTH and expect
 * the server's "-NOAUTH" reply. (A client library would first send HELLO and
 * report the refusal as an asynchronous error event instead.)
 */
const redisAnonymousRefused = () =>
  new Promise((resolve) => {
    const url = new URL(redisUrl);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const socket = net.connect(Number(url.port), host);
    let reply = "";
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(3000, () => done(false));
    socket.on("error", () => done(false));
    socket.on("connect", () => socket.write("PING\r\n"));
    socket.on("data", (chunk) => {
      reply += chunk.toString("latin1");
      if (reply.includes("\r\n")) done(/^-NOAUTH/.test(reply));
    });
  });

const checks = [
  ["mongo authenticated ping", mongoAuthenticated],
  ["mongo anonymous access refused", mongoAnonymousRefused],
  ["redis authenticated ping", redisAuthenticated],
  ["redis anonymous access refused", redisAnonymousRefused],
];

(async () => {
  for (const [label, check] of checks) {
    for (;;) {
      let ok = false;
      let reason = "";
      try {
        ok = await check();
      } catch (error) {
        reason = (error && error.name) || "Error";
      }
      if (ok) {
        console.log(`wait-infra: ${label}: OK`);
        break;
      }
      if (Date.now() > deadline) {
        console.error(`wait-infra: ${label}: FAILED after ${timeoutS} s${reason ? ` (${reason})` : ""}`);
        process.exit(1);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  process.exit(0);
})();
