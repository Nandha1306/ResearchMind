import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { test, describe, before, after } from "node:test";
import { infraDescribe } from "./helpers/infra";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { setTestSecrets, listen } from "./helpers/test-env";
import { TEST_MONGO_URI, connectTestDatabase, mongoSkip } from "./helpers/test-mongo";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { measureNoiseBaseline, noiseNote, type NoiseBaseline } from "./helpers/noise";
import {
  appendAfterArchive,
  commentArchiveDocx,
  DTD_ENTITY_DOCUMENT,
  rawDocumentDocx,
  forgeDeclaredSize,
  hiddenArchiveDocx,
  innocentDocx,
  largeLegitDocx,
  makeDocx,
  manyEntries,
  paragraph,
  paragraphBomb,
  spaceBomb,
} from "./helpers/docx-fixtures";
import { REPO_ROOT } from "./helpers/compose";
import { DEFAULT_DOCX_LIMITS } from "../services/document-service/src/utils/zip-precheck";

const DEFAULT_ENTRIES_PLUS_ONE = DEFAULT_DOCX_LIMITS.maxEntries + 1;

/*
 * SEC-002 through the REAL document-service upload route (real MongoDB):
 * a DOCX decompression bomb is refused quickly with a 4xx, the service stays
 * responsive while it is handled (/health keeps answering, the event loop is
 * not blocked), nothing is stored or uploaded, and no temp file is left.
 * Legitimate documents are still accepted.
 *
 * Stand-ins: workspace membership (local HTTP stub), Cloudinary uploader
 * (replaced on the real client, counting calls), Redis (closed port).
 *
 * Timing-sensitive: run serialized by `npm run test:timing`.
 */

setTestSecrets();

const WS = new mongoose.Types.ObjectId().toString();
const USER = new mongoose.Types.ObjectId().toString();
const token = jwt.sign({ userId: USER }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "10m" });

let workspaceStub: { url: string; close: () => Promise<void> };
let app: { url: string; close: () => Promise<void> };
let db: { cleanup: () => Promise<void> } | undefined;
let Document: any;
let redis: any;
let tmpDir: string;
let cloudinaryUploads = 0;
// Wave 6 (W6-TEST-01): environment noise measured before this file's tests;
// reported in latency failure messages only (never changes a verdict).
let noise: NoiseBaseline | undefined;

before(async () => {
  noise = await measureNoiseBaseline();
  if (mongoSkip) return;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-docx-upload-"));
  process.chdir(tmpDir); // service logs land here, not in the repo
  // SEC-024 (a): upload temp files go to UPLOAD_TMP_DIR (per test process).
  process.env.UPLOAD_TMP_DIR = path.join(tmpDir, "uploads");

  workspaceStub = await listen((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, data: { isMember: true } }));
  });
  process.env.WORKSPACE_SERVICE_URL = workspaceStub.url;
  process.env.REDIS_URL = "redis://127.0.0.1:6599"; // nothing listens: enqueue fails (handled)

  db = await connectTestDatabase("docxlimits");
  const { default: cloudinary } = await import("../services/document-service/src/config/cloudinary");
  cloudinary.uploader.upload = (async (_file: string, options: { public_id: string; folder: string }) => {
    cloudinaryUploads++;
    return {
      secure_url: `https://res.cloudinary.com/demo/raw/upload/${options.folder}/${options.public_id}`,
      public_id: `${options.folder}/${options.public_id}`,
    };
  }) as any;
  ({ default: redis } = await import("../services/document-service/src/config/redis"));
  ({ Document } = await import("../services/document-service/src/models/Document"));
  await Document.init();
  const { default: documentApp } = await import("../services/document-service/src/app");
  app = await listen(documentApp);
});

after(async () => {
  await app?.close();
  await workspaceStub?.close();
  redis?.disconnect();
  await db?.cleanup();
  if (tmpDir) {
    const { default: logger } = await import("../services/document-service/src/utils/logger");
    await new Promise<void>((resolve) => {
      logger.on("finish", () => resolve());
      logger.end();
      setTimeout(resolve, 1000);
    });
    process.chdir(os.tmpdir());
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      console.warn(`Could not remove temp dir ${tmpDir}: ${(error as Error).message}`);
    }
  }
});

const uploadsLeft = () => {
  const dir = process.env.UPLOAD_TMP_DIR!;
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

const upload = async (name: string, content: Buffer) => {
  const form = new FormData();
  form.append("workspaceId", WS);
  form.append("file", new Blob([new Uint8Array(content)]), name);
  const started = performance.now();
  const res = await fetch(`${app.url}/api/documents/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, body: await res.json().catch(() => null), ms: performance.now() - started };
};

/** Upload while polling /health every 50 ms and sampling event-loop delay. */
const uploadWhileProbing = async (name: string, content: Buffer) => {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  const probes: { ok: boolean; ms: number }[] = [];
  let stop = false;
  const poller = (async () => {
    while (!stop) {
      const started = performance.now();
      try {
        // 200 or 503 (Redis is a closed port) -- what matters is that it answers.
        const res = await fetch(`${app.url}/health`, { signal: AbortSignal.timeout(500) });
        await res.arrayBuffer();
        probes.push({ ok: true, ms: performance.now() - started });
      } catch {
        probes.push({ ok: false, ms: performance.now() - started });
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })();
  const result = await upload(name, content);
  stop = true;
  await poller;
  histogram.disable();
  return { ...result, probes, maxLagMs: histogram.max / 1e6 };
};

infraDescribe("SEC-002: DOCX bombs through the upload route (real MongoDB)", mongoSkip, () => {
  test("the 180,000-paragraph bomb: 413 in < 1 s, service responsive, nothing stored, no temp file", async () => {
    const { buffer, documentXmlLength } = await paragraphBomb();
    assert.ok(buffer.length < 25 * 1024 && documentXmlLength > 6_000_000, "fixture is a real bomb");
    const before = { uploads: cloudinaryUploads, docs: await Document.countDocuments({}) };

    const result = await uploadWhileProbing("bomb.docx", buffer);
    assert.strictEqual(result.status, 413, JSON.stringify(result.body));
    assert.match(result.body.message, /too large when expanded/);
    assert.ok(result.ms < 1000, `took ${result.ms.toFixed(0)} ms${noiseNote(noise)}`);
    assert.ok(result.maxLagMs < 200, `event loop blocked ${result.maxLagMs.toFixed(0)} ms${noiseNote(noise)}`);
    assert.ok(result.probes.every((p) => p.ok), "/health stopped answering");

    assert.strictEqual(cloudinaryUploads, before.uploads, "nothing uploaded to storage");
    assert.strictEqual(await Document.countDocuments({}), before.docs, "no document stored");
    assert.deepStrictEqual(uploadsLeft(), [], "temp file removed");
  });

  test("the review's 410 KB hidden-archive bypass: 422 in < 1 s, nothing stored, no temp file", async () => {
    const file = await hiddenArchiveDocx();
    const before = { uploads: cloudinaryUploads, docs: await Document.countDocuments({}) };
    const result = await uploadWhileProbing("differential.docx", file);
    assert.strictEqual(result.status, 422, JSON.stringify(result.body));
    assert.ok(result.ms < 1000, `took ${result.ms.toFixed(0)} ms${noiseNote(noise)}`);
    assert.ok(result.probes.every((p) => p.ok), "/health stopped answering");
    assert.strictEqual(cloudinaryUploads, before.uploads);
    assert.strictEqual(await Document.countDocuments({}), before.docs);
    assert.deepStrictEqual(uploadsLeft(), []);
  });

  test("a DOCX with a DTD entity is unreadable (422, not 500); nothing stored, no temp file", async () => {
    const before = { uploads: cloudinaryUploads, docs: await Document.countDocuments({}) };
    const result = await upload("dtd-entity.docx", await rawDocumentDocx(DTD_ENTITY_DOCUMENT));
    assert.strictEqual(result.status, 422, JSON.stringify(result.body));
    assert.match(result.body.message, /Could not read the DOCX file/);
    assert.strictEqual(cloudinaryUploads, before.uploads);
    assert.strictEqual(await Document.countDocuments({}), before.docs);
    assert.deepStrictEqual(uploadsLeft(), []);
  });

  test("a bomb that lies about its sizes reaches the extraction process and is refused (422); /health keeps answering", async () => {
    const { buffer } = await paragraphBomb();
    const forged = forgeDeclaredSize(buffer, "word/document.xml", 1024);
    const result = await uploadWhileProbing("forged.docx", forged);
    assert.strictEqual(result.status, 422, JSON.stringify(result.body));
    assert.ok(result.ms < 1500, `took ${result.ms.toFixed(0)} ms${noiseNote(noise)}`);
    assert.ok(result.probes.every((p) => p.ok));
    assert.ok(result.maxLagMs < 200, `event loop blocked ${result.maxLagMs.toFixed(0)} ms${noiseNote(noise)}`);
    assert.deepStrictEqual(uploadsLeft(), []);
  });

  test("repeated bombs leave the service alive and healthy", async () => {
    const bombs = [(await paragraphBomb()).buffer, (await spaceBomb()).buffer, (await paragraphBomb()).buffer];
    for (const [i, buffer] of bombs.entries()) {
      const result = await upload(`bomb-${i}.docx`, buffer);
      assert.strictEqual(result.status, 413);
      const health = await fetch(`${app.url}/health`, { signal: AbortSignal.timeout(500) });
      assert.ok([200, 503].includes(health.status));
      assert.deepStrictEqual(uploadsLeft(), []);
    }
  });

  test("a large legitimate DOCX is still accepted and extracted (201)", async () => {
    const { buffer } = await largeLegitDocx();
    const result = await upload("thesis.docx", buffer);
    assert.strictEqual(result.status, 201, JSON.stringify(result.body));
    assert.ok(result.body.data.extractedText.startsWith("0."));
    // No timing assertion here: with Redis on a closed port the enqueue step
    // retries for several seconds (pre-existing, unrelated to extraction).
    // Extraction time is asserted in docx-extraction-limits.timing.ts.
    assert.deepStrictEqual(uploadsLeft(), []);
  });
});

/*
 * Process level: the REAL document-service server (src/server.ts via tsx) in
 * its own process, cwd = a fresh temp directory (no .env is read; uploads/
 * and logs land there), disposable database, Redis on a closed port, dummy
 * Cloudinary credentials (no request in this suite reaches Cloudinary). Every
 * crafted DOCX must get a 4xx while /health keeps answering, the process must
 * stay alive and no temp file may remain.
 */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });

infraDescribe("SEC-002: the document-service process survives crafted DOCX uploads", mongoSkip, () => {
  let child: ChildProcess;
  let baseUrl = "";
  let cwd = "";
  let dbName = "";
  let stub: { url: string; close: () => Promise<void> };
  let exitInfo: string | null = null;
  let output = "";

  before(async () => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "rm-docsvc-proc-"));
    stub = await listen((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: true, data: { isMember: true } }));
    });
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    dbName = `rmtest_docproc_${crypto.randomBytes(4).toString("hex")}`;
    const mongoUri = new URL(TEST_MONGO_URI!);
    mongoUri.pathname = `/${dbName}`;

    const env: NodeJS.ProcessEnv = {
      PORT: String(port),
      MONGO_URI: mongoUri.toString(),
      REDIS_URL: "redis://127.0.0.1:6599",
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
      INTERNAL_SERVICE_TOKEN: process.env.INTERNAL_SERVICE_TOKEN,
      WORKSPACE_SERVICE_URL: stub.url,
      AI_SERVICE_URL: "http://127.0.0.1:6599",
      CLOUDINARY_CLOUD_NAME: "dummy",
      CLOUDINARY_API_KEY: "dummy",
      CLOUDINARY_API_SECRET: "dummy",
      // SEC-024 (a): the process writes its upload temp files here.
      UPLOAD_TMP_DIR: path.join(cwd, "uploads"),
    };
    for (const name of ["PATH", "SystemRoot", "TEMP", "TMP", "TMPDIR"]) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    // Wave 6 (W6-TEST-13): one process with the tsx loader (--import), not
    // the cli.mjs wrapper that starts a second process (the Wave 4 EBUSY pattern).
    child = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(path.join(REPO_ROOT, "node_modules", "tsx", "dist", "loader.mjs")).href,
        path.join(REPO_ROOT, "services", "document-service", "src", "server.ts"),
      ],
      { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
    );
    const keep = (chunk: Buffer) => (output = (output + chunk.toString()).slice(-4000));
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.on("exit", (code, signal) => (exitInfo = `code ${code}, signal ${signal}`));

    const deadline = Date.now() + 60_000;
    for (;;) {
      if (exitInfo) assert.fail(`document-service exited during startup (${exitInfo}): ${output}`);
      try {
        await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
        break;
      } catch {
        if (Date.now() > deadline) assert.fail(`document-service did not start: ${output}`);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  });

  after(async () => {
    if (child && !exitInfo) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
      if (!exitInfo) child.kill("SIGKILL");
    }
    await stub?.close();
    if (dbName) {
      const admin = await mongoose.createConnection(TEST_MONGO_URI!, { dbName, serverSelectionTimeoutMS: 5000 }).asPromise();
      try {
        await admin.dropDatabase();
      } finally {
        await admin.close();
      }
    }
    if (cwd) {
      try {
        fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch (error) {
        console.warn(`Could not remove temp dir ${cwd}: ${(error as Error).message}`);
      }
    }
  });

  const processUploadsLeft = () => {
    const dir = path.join(cwd, "uploads");
    return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  };

  const uploadToProcess = async (name: string, content: Buffer) => {
    const form = new FormData();
    form.append("workspaceId", WS);
    form.append("file", new Blob([new Uint8Array(content)]), name);
    const started = performance.now();
    const res = await fetch(`${baseUrl}/api/documents/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    return { status: res.status, body: await res.json().catch(() => null), ms: performance.now() - started };
  };

  test("every crafted or corrupt DOCX gets a 4xx; /health answers throughout; the process stays up", async () => {
    const { buffer: bomb } = await paragraphBomb();
    const { buffer: valid } = await makeDocx(paragraph("valid"));
    const cases: [string, Buffer, number][] = [
      ["review-410kb-hidden-archive.docx", await hiddenArchiveDocx(), 422],
      ["paragraph-bomb-19kb.docx", bomb, 413],
      ["space-bomb.docx", (await spaceBomb()).buffer, 413],
      ["many-entries.docx", (await manyEntries(DEFAULT_ENTRIES_PLUS_ONE)).buffer, 413],
      ["lying-sizes.docx", forgeDeclaredSize(bomb, "word/document.xml", 1024), 422],
      ["bomb-in-comment.docx", commentArchiveDocx(bomb), 422],
      ["concatenated.docx", appendAfterArchive(innocentDocx(), bomb), 422],
      ["trailing-data.docx", appendAfterArchive(valid, Buffer.from("trailing")), 422],
      ["corrupt.docx", Buffer.concat([Buffer.from("PK\u0003\u0004"), crypto.randomBytes(2048)]), 422],
      ["dtd-entity.docx", await rawDocumentDocx(DTD_ENTITY_DOCUMENT), 422],
    ];
    for (const [name, content, expected] of cases) {
      let probeFailures = 0;
      let stop = false;
      const poller = (async () => {
        while (!stop) {
          try {
            const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
            await res.arrayBuffer();
          } catch {
            probeFailures++;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      })();
      const result = await uploadToProcess(name, content);
      stop = true;
      await poller;

      assert.strictEqual(result.status, expected, `${name}: ${result.status} ${JSON.stringify(result.body)}`);
      assert.strictEqual(probeFailures, 0, `${name}: /health did not answer`);
      assert.strictEqual(exitInfo, null, `${name}: document-service exited (${exitInfo}): ${output}`);
      assert.deepStrictEqual(processUploadsLeft(), [], `${name}: temp file left`);
      console.log(`[process] ${name}: ${result.status} in ${result.ms.toFixed(0)} ms`);
    }
    const health = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
    assert.ok([200, 503].includes(health.status), "service still answers /health");
  });
});
