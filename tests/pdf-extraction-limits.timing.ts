import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { test, describe, before, after } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { infraDescribe } from "./helpers/infra";
import { setTestSecrets, listen } from "./helpers/test-env";
import { connectTestDatabase, mongoSkip } from "./helpers/test-mongo";
import { contentStreamBomb, decodedSizeBomb, filterChainBomb, legitPdf } from "./helpers/pdf-fixtures";
import { makeDocx, paragraph } from "./helpers/docx-fixtures";
import { measureNoiseBaseline, noiseNote, type NoiseBaseline } from "./helpers/noise";

// W6-TEST-01: environment noise, reported in latency failure messages only.
let noise: NoiseBaseline | undefined;

/*
 * Wave 6 WP-5 (SEC-002-PDF, lead decision D-1, A-11): a heavy PDF can no
 * longer occupy document-service without bound. The parse runs in the shared
 * child-process sandbox: wall-clock limit (SIGKILL), heap limit, one gate
 * shared with DOCX.
 *
 * The fixture is a ~0.7 MB upload whose single compressed content stream
 * inflates to 24,000,000 show-text operators. Before Wave 6 it was parsed on
 * the service's own process with no time or memory limit (about 16.6 s of
 * CPU already for 4,000,000 operators on the development machine, and the
 * upload was then accepted: 201).
 *
 * Through the REAL upload route (real MongoDB): 422 within the extraction
 * timeout, /health answering throughout, the event loop not blocked, nothing
 * stored, nothing uploaded, no temp file, no extraction process left.
 * Stand-ins: workspace membership (local stub), Cloudinary uploader (counted),
 * Redis (closed port). Timing-sensitive: serialized by `npm run test:timing`.
 */

setTestSecrets();
process.env.MONGO_URI ||= "mongodb://127.0.0.1:6598/rmtest_unused";

const WS = new mongoose.Types.ObjectId().toString();
const USER = new mongoose.Types.ObjectId().toString();
const token = jwt.sign({ userId: USER }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "10m" });

/** Built once, compressed chunk by chunk (inflates to ~384 MB of operators). */
let heavy: ReturnType<typeof contentStreamBomb> | undefined;
const heavyPdf = () => (heavy ??= contentStreamBomb(24_000_000));

describe("SEC-002-PDF: sandbox limits (extractor level, no infrastructure)", () => {
  let dir: string;
  let pdf: typeof import("../services/document-service/src/utils/pdf-extractor");
  let docx: typeof import("../services/document-service/src/utils/docx-extractor");
  let sandbox: typeof import("../services/document-service/src/utils/extraction-sandbox");

  before(async () => {
    noise = await measureNoiseBaseline();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-pdf-limits-"));
    pdf = await import("../services/document-service/src/utils/pdf-extractor");
    docx = await import("../services/document-service/src/utils/docx-extractor");
    sandbox = await import("../services/document-service/src/utils/extraction-sandbox");
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("a heavy PDF is stopped at the wall-clock limit (422) and its process is killed", async () => {
    const file = path.join(dir, "bomb.pdf");
    fs.writeFileSync(file, (await heavyPdf()).buffer);
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();
    const started = performance.now();
    await assert.rejects(pdf.extractPdfText(file, { timeoutMs: 2_000 }), (err: any) => {
      assert.strictEqual(err.statusCode, 422, String(err));
      assert.match(err.message, /took too long|too large or too complex/);
      return true;
    });
    const ms = performance.now() - started;
    histogram.disable();
    assert.ok(ms < 6_000, `took ${ms.toFixed(0)} ms${noiseNote(noise)}`);
    assert.ok(histogram.max / 1e6 < 200, `event loop blocked ${(histogram.max / 1e6).toFixed(0)} ms${noiseNote(noise)}`);
    assert.deepStrictEqual(sandbox.liveExtractionPids(), [], "the extraction process is still alive");
  });

  test("PDF and DOCX share one gate: never more than MAX_CONCURRENT_EXTRACTIONS processes; beyond the queue 503", async () => {
    const bombFile = path.join(dir, "gate-bomb.pdf");
    fs.writeFileSync(bombFile, (await heavyPdf()).buffer);
    const docxFile = path.join(dir, "gate.docx");
    fs.writeFileSync(docxFile, (await makeDocx(paragraph("gate test"))).buffer);
    const total = sandbox.MAX_CONCURRENT_EXTRACTIONS + sandbox.MAX_QUEUED_EXTRACTIONS + 2;
    let maxLive = 0;
    const sampler = setInterval(() => (maxLive = Math.max(maxLive, sandbox.liveExtractionPids().length)), 5);
    const jobs = Array.from({ length: total }, (_, i) =>
      (i % 2 === 0 ? pdf.extractPdfText(bombFile, { timeoutMs: 1_500 }) : docx.extractDocxText(docxFile)).then(
        () => 200,
        (err: any) => err.statusCode ?? 500
      )
    );
    const statuses = await Promise.all(jobs);
    clearInterval(sampler);
    assert.ok(maxLive <= sandbox.MAX_CONCURRENT_EXTRACTIONS, `${maxLive} extraction processes alive at once`);
    assert.strictEqual(statuses.filter((s) => s === 503).length, 2, `statuses ${statuses}`);
    assert.ok(!statuses.includes(500), `statuses ${statuses}`);
    assert.deepStrictEqual(sandbox.liveExtractionPids(), []);
  });

  /*
   * Wave 6 Stage E (W6-R5-01, independent security review): V8's heap limit
   * does not bound ArrayBuffer memory, and pdf.js decodes a stream into one
   * growing Uint8Array. The reviewer's 204,501-byte PDF decoding to ~200 MB
   * was accepted after ~7 s with ~400 MB of child memory; a 10 MB upload can
   * carry a stream decoding to gigabytes. Decoded data is now bounded inside
   * the child (largest single decode buffer, and a memory watchdog).
   */
  for (const [label, decodedBytes, asciiHex] of [
    ["~0.2 MB PDF whose stream decodes to 200 MB (the reviewer's case)", 200 * 1024 * 1024, false],
    ["stream decoding to 1 GiB (the 10 MB -> GB case)", 1024 * 1024 * 1024, false],
    ["the 200 MB bomb behind [/ASCIIHexDecode /FlateDecode]", 200 * 1024 * 1024, true],
  ] as const) {
    test(`W6-R5-01: ${label} is refused (422) before memory grows unbounded`, async () => {
      const { buffer } = await decodedSizeBomb(decodedBytes, { asciiHex });
      assert.ok(buffer.length < 2 * 1024 * 1024, `fixture is ${buffer.length} bytes`);
      const file = path.join(dir, `decoded-${decodedBytes}-${asciiHex}.pdf`);
      fs.writeFileSync(file, buffer);
      const started = performance.now();
      await assert.rejects(pdf.extractPdfText(file), (err: any) => {
        assert.strictEqual(err.statusCode, 422, String(err));
        assert.match(err.message, /too large or too complex/);
        return true;
      });
      const ms = performance.now() - started;
      assert.ok(ms < 10_000, `took ${ms.toFixed(0)} ms${noiseNote(noise)}`);
      const peak = pdf.lastPdfExtractionPeak();
      assert.ok(peak && peak.arrayBuffers <= pdf.PDF_MAX_ARRAY_BUFFER_BYTES, `child arrayBuffers peak ${JSON.stringify(peak)}`);
      assert.deepStrictEqual(sandbox.liveExtractionPids(), []);
    });
  }

  /*
   * Stage E round 2 (W6-R5-09): the reviewer's Flate + 6x ASCII85 chain,
   * scaled down 1/16 so this host stays light (per-allocation cap 8 MiB,
   * cumulative large-allocation budget 32 MiB, watchdog 24 MiB). Every stage
   * buffer stays under the per-allocation cap and pdf.js decodes the chain
   * synchronously, so only the cumulative budget, enforced in the
   * allocation trap, can stop it before memory passes the budget.
   */
  test("W6-R5-09: a filter chain under the per-allocation cap is refused before passing the cumulative budget", async () => {
    const MiB = 1024 * 1024;
    const limits = { maxDecodedBufferBytes: 8 * MiB, maxTotalLargeAllocationBytes: 32 * MiB, maxArrayBufferBytes: 24 * MiB };
    const file = path.join(dir, "filter-chain.pdf");
    fs.writeFileSync(file, filterChainBomb(2 * MiB, 6));
    await assert.rejects(pdf.extractPdfText(file, limits), (err: any) => {
      assert.strictEqual(err.statusCode, 422, String(err));
      assert.match(err.message, /too large or too complex/);
      return true;
    });
    const peak = pdf.lastPdfExtractionPeak();
    // At most the budget plus the process's own small baseline (input bytes, Node internals).
    assert.ok(peak && peak.arrayBuffers <= limits.maxTotalLargeAllocationBytes + 4 * MiB, `child arrayBuffers peak ${JSON.stringify(peak)}`);
    assert.deepStrictEqual(sandbox.liveExtractionPids(), []);
  });

  test("the production defaults include the cumulative budget (512 MiB, counted from 1 MiB allocations)", () => {
    assert.strictEqual(pdf.PDF_MAX_TOTAL_LARGE_ALLOCATION_BYTES, 512 * 1024 * 1024);
    assert.strictEqual(pdf.PDF_LARGE_ALLOCATION_BYTES, 1024 * 1024);
  });

  test("a legitimate 40-page PDF still extracts in < 5 s", async () => {
    const file = path.join(dir, "legit.pdf");
    fs.writeFileSync(file, legitPdf(40, 20));
    const started = performance.now();
    const text = await pdf.extractPdfText(file);
    const ms = performance.now() - started;
    assert.match(text, /^Page 1 line 1: research notes and results\./);
    assert.match(text, /-- 40 of 40 --/);
    assert.ok(ms < 5_000, `took ${ms.toFixed(0)} ms${noiseNote(noise)}`);
  });
});

let workspaceStub: { url: string; close: () => Promise<void> };
let app: { url: string; close: () => Promise<void> };
let db: { cleanup: () => Promise<void> } | undefined;
let Document: any;
let redis: any;
let tmpDir: string;
let cloudinaryUploads = 0;

infraDescribe("SEC-002-PDF: a heavy PDF through the upload route (real MongoDB)", mongoSkip, () => {
  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-pdf-upload-"));
    process.chdir(tmpDir); // service logs land here, not in the repo
    process.env.UPLOAD_TMP_DIR = path.join(tmpDir, "uploads");
    workspaceStub = await listen((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: true, data: { isMember: true } }));
    });
    process.env.WORKSPACE_SERVICE_URL = workspaceStub.url;
    process.env.REDIS_URL = "redis://127.0.0.1:6599"; // nothing listens: enqueue fails (handled)
    db = await connectTestDatabase("pdflimits");
    const { default: cloudinary } = await import("../services/document-service/src/config/cloudinary");
    cloudinary.uploader.upload = (async (_file: string, options: { public_id: string; folder: string }) => {
      cloudinaryUploads++;
      return { secure_url: `https://res.cloudinary.com/demo/raw/upload/${options.folder}/${options.public_id}`, public_id: `${options.folder}/${options.public_id}` };
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

  test("the heavy PDF: 422 within the extraction timeout, /health answering, nothing stored, no temp file", async () => {
    const { PDF_EXTRACTION_TIMEOUT_MS } = await import("../services/document-service/src/utils/pdf-extractor");
    const { liveExtractionPids } = await import("../services/document-service/src/utils/extraction-sandbox");
    const { buffer, inflatedBytes } = await heavyPdf();
    assert.ok(buffer.length < 2 * 1024 * 1024 && inflatedBytes > 300_000_000, "fixture is a real bomb");
    const before = { uploads: cloudinaryUploads, docs: await Document.countDocuments({}) };

    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();
    const probes: boolean[] = [];
    let stop = false;
    const poller = (async () => {
      while (!stop) {
        try {
          const res = await fetch(`${app.url}/health`, { signal: AbortSignal.timeout(500) });
          await res.arrayBuffer();
          probes.push(true);
        } catch {
          probes.push(false);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    })();
    const form = new FormData();
    form.append("workspaceId", WS);
    form.append("file", new Blob([new Uint8Array(buffer)]), "heavy.pdf");
    const started = performance.now();
    const res = await fetch(`${app.url}/api/documents/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(PDF_EXTRACTION_TIMEOUT_MS + 30_000),
    });
    const body = await res.json().catch(() => null);
    const ms = performance.now() - started;
    stop = true;
    await poller;
    histogram.disable();

    assert.strictEqual(res.status, 422, JSON.stringify(body));
    assert.ok(ms < PDF_EXTRACTION_TIMEOUT_MS + 5_000, `took ${ms.toFixed(0)} ms${noiseNote(noise)}`);
    assert.ok(probes.length > 0 && probes.every(Boolean), "/health stopped answering");
    assert.ok(histogram.max / 1e6 < 200, `event loop blocked ${(histogram.max / 1e6).toFixed(0)} ms${noiseNote(noise)}`);
    assert.strictEqual(cloudinaryUploads, before.uploads, "nothing uploaded to storage");
    assert.strictEqual(await Document.countDocuments({}), before.docs, "no document stored");
    assert.deepStrictEqual(uploadsLeft(), [], "temp file removed");
    assert.deepStrictEqual(liveExtractionPids(), [], "no extraction process left");
  });
});
