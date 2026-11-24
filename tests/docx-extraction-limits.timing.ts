import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { describe, test, before, after } from "node:test";
import "./helpers/test-env"; // A-5: dead-port REDIS_URL/MONGO_URI defaults before any service code
import JSZip from "jszip";
import { AppError } from "../packages/shared/errors/AppError";
import {
  extractDocxText,
  liveExtractionPids,
  MAX_CONCURRENT_EXTRACTIONS,
  MAX_QUEUED_EXTRACTIONS,
} from "../services/document-service/src/utils/docx-extractor";
import { DEFAULT_DOCX_LIMITS, inspectDocxArchive } from "../services/document-service/src/utils/zip-precheck";
import { measureNoiseBaseline, noiseNote, type NoiseBaseline } from "./helpers/noise";
import {
  appendAfterArchive,
  commentArchiveDocx,
  DTD_ENTITY_DOCUMENT,
  rawDocumentDocx,
  forgeDeclaredSize,
  gapBetweenEntriesDocx,
  hiddenArchiveDocx,
  hugeRunDocx,
  innocentDocx,
  largeLegitDocx,
  makeDocx,
  manyEntries,
  paragraph,
  paragraphBomb,
  spaceBomb,
} from "./helpers/docx-fixtures";

/*
 * SEC-002: DOCX decompression / parse amplification, on the REAL extractor
 * (strict zip pre-check + extraction in a heap- and time-limited CHILD
 * PROCESS that parses only an archive rebuilt from the validated entries +
 * text cap + concurrency gate). No infrastructure needed. Upload-route and
 * service-process behaviour is in docx-upload-limits.timing.ts.
 *
 * Timing-sensitive (< 1 s, event-loop delay < 200 ms): run serialized by
 * `npm run test:timing` (--test-concurrency=1), not in the parallel suite.
 */

let dir: string;
// Wave 6 (W6-TEST-01): environment noise measured before this file's tests;
// reported in latency failure messages only (never changes a verdict).
let noise: NoiseBaseline | undefined;
before(async () => {
  noise = await measureNoiseBaseline();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "rm-docx-limits-"));
});
after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

let counter = 0;
const write = async (buffer: Buffer) => {
  const file = path.join(dir, `f${counter++}.docx`);
  await fs.writeFile(file, buffer);
  return file;
};

const appError = (status: number, pattern?: RegExp) => (err: unknown) => {
  assert.ok(err instanceof AppError, `expected AppError, got ${String(err)}`);
  assert.strictEqual(err.statusCode, status, err.message);
  if (pattern) assert.match(err.message, pattern);
  return true;
};

/** Run `fn` while sampling event-loop delay. */
const measured = async <T>(fn: () => Promise<T>) => {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  const started = performance.now();
  let outcome: { value?: T; error?: unknown };
  try {
    outcome = { value: await fn() };
  } catch (error) {
    outcome = { error };
  }
  const elapsed = performance.now() - started;
  histogram.disable();
  return { ...outcome, maxLagMs: histogram.max / 1e6, elapsed };
};

/** Relaxed size limits, so a bomb reaches the extraction process (tests the backstop). */
const NO_SIZE_LIMITS = {
  ...DEFAULT_DOCX_LIMITS,
  maxCompressionRatio: Number.MAX_SAFE_INTEGER,
  maxTotalUncompressedBytes: Number.MAX_SAFE_INTEGER,
  maxDocumentXmlBytes: Number.MAX_SAFE_INTEGER,
};

const UNREADABLE = /Could not read the DOCX file/;

describe("SEC-002: size pre-check rejects bombs before parsing", () => {
  test("the 19 KB / 180,000-paragraph bomb is rejected (413) in < 1 s without blocking the event loop", async () => {
    const { buffer, documentXmlLength } = await paragraphBomb();
    assert.ok(buffer.length < 25 * 1024, `fixture is ${buffer.length} bytes`);
    assert.ok(documentXmlLength > 6_000_000, `fixture XML is ${documentXmlLength} chars`);
    const file = await write(buffer);

    const run = await measured(() => extractDocxText(file));
    appError(413, /too large when expanded/)(run.error);
    assert.ok(run.elapsed < 1000, `took ${run.elapsed.toFixed(0)} ms${noiseNote(noise)}`);
    assert.ok(run.maxLagMs < 200, `event loop blocked ${run.maxLagMs.toFixed(0)} ms${noiseNote(noise)}`);
  });

  test("a single huge run of spaces (high-ratio single entry) is rejected (413)", async () => {
    const { buffer } = await spaceBomb();
    assert.ok(buffer.length < 200 * 1024, `fixture is ${buffer.length} bytes`);
    await assert.rejects(extractDocxText(await write(buffer)), appError(413));
  });

  test("more than 1,000 archive entries is rejected (413)", async () => {
    const { buffer } = await manyEntries(DEFAULT_DOCX_LIMITS.maxEntries + 1);
    await assert.rejects(extractDocxText(await write(buffer)), appError(413, /archive entries/));
  });

  test("a zip without word/document.xml, a truncated zip and a non-zip are unreadable (422)", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types/>");
    const noDocument = await zip.generateAsync({ type: "nodebuffer" });
    const { buffer } = await makeDocx(paragraph("x"));
    for (const bad of [noDocument, buffer.subarray(0, buffer.length - 10), Buffer.from("PK\u0003\u0004 not really")]) {
      assert.throws(() => inspectDocxArchive(bad), appError(422, UNREADABLE));
    }
  });
});

describe("SEC-002: parser differentials are rejected (what is checked is what is parsed)", () => {
  test("the review's ~410 KB hidden-archive bypass (400 MB hidden run) is rejected (422) in < 1 s", async () => {
    const file = await hiddenArchiveDocx();
    assert.ok(file.length < 500 * 1024, `fixture is ${file.length} bytes`);
    // Self-check: JSZip (mammoth's reader) really sees the hidden 400 MB part.
    const seenByJsZip = await JSZip.loadAsync(file);
    const hidden = (seenByJsZip.file("word/document.xml") as unknown as { _data: { uncompressedSize: number } })._data;
    assert.ok(hidden.uncompressedSize > 400 * 1024 * 1024, "fixture is not a differential");

    const path = await write(file);
    const run = await measured(() => extractDocxText(path));
    appError(422, UNREADABLE)(run.error);
    assert.ok(run.elapsed < 1000, `took ${run.elapsed.toFixed(0)} ms${noiseNote(noise)}`);
    assert.ok(run.maxLagMs < 200, `event loop blocked ${run.maxLagMs.toFixed(0)} ms${noiseNote(noise)}`);
  });

  test("a bomb archive inside the ZIP comment is rejected (422)", async () => {
    const { buffer: inner } = await paragraphBomb();
    const file = commentArchiveDocx(inner);
    assert.ok((await JSZip.loadAsync(file)).file("word/document.xml"), "JSZip reads the inner archive");
    await assert.rejects(extractDocxText(await write(file)), appError(422, UNREADABLE));
  });

  test("concatenated archives and trailing data are rejected (422)", async () => {
    const { buffer: bomb } = await paragraphBomb();
    const { buffer: valid } = await makeDocx(paragraph("valid"));
    for (const file of [
      appendAfterArchive(innocentDocx(), bomb), // A then B: readers that take the last EOCD see B
      appendAfterArchive(valid, Buffer.from("x")),
      appendAfterArchive(valid, Buffer.alloc(4096)),
    ]) {
      await assert.rejects(extractDocxText(await write(file)), appError(422, UNREADABLE));
    }
  });

  test("unreferenced bytes between entries are rejected (422)", async () => {
    const file = gapBetweenEntriesDocx(Buffer.from("hidden bytes nobody references"));
    await assert.rejects(extractDocxText(await write(file)), appError(422, UNREADABLE));
  });

  test("the hand-built canonical archive itself is accepted (the builders are sound)", async () => {
    assert.strictEqual(await extractDocxText(await write(innocentDocx())), "Innocent text");
  });
});

describe("XML the parser rejects is an unreadable document (422), not a server error", () => {
  test("a DTD-declared entity and an undefined entity give 422", async () => {
    const undefinedEntity = (await makeDocx(paragraph("&undefined;"))).buffer;
    for (const buffer of [await rawDocumentDocx(DTD_ENTITY_DOCUMENT), undefinedEntity]) {
      await assert.rejects(extractDocxText(await write(buffer)), appError(422, UNREADABLE));
    }
  });
});

describe("SEC-002: the extraction process is the backstop", () => {
  test("forged (understated) uncompressed sizes are detected before parsing (422)", async () => {
    const { buffer } = await paragraphBomb();
    const forged = forgeDeclaredSize(buffer, "word/document.xml", 1024);
    assert.doesNotThrow(() => inspectDocxArchive(forged), "the forged sizes must pass the structure check");
    const file = await write(forged);
    const run = await measured(() => extractDocxText(file));
    appError(422, /do not match the sizes it declares/)(run.error);
    assert.ok(run.elapsed < 1500, `took ${run.elapsed.toFixed(0)} ms${noiseNote(noise)}`);
  });

  test("a FATAL out-of-memory abort kills only the extraction process (422); this process carries on", async () => {
    // A canonical archive with one 120 MB run, past relaxed size limits, in a
    // 64 MB heap: the child aborts with "JavaScript heap out of memory".
    const file = await write(await hugeRunDocx(120 * 1024 * 1024));
    const run = await measured(() => extractDocxText(file, { limits: NO_SIZE_LIMITS, heapLimitMb: 64 }));
    appError(422, /too large or too complex/)(run.error);
    assert.ok(run.maxLagMs < 200, `event loop blocked ${run.maxLagMs.toFixed(0)} ms${noiseNote(noise)}`);
    assert.deepStrictEqual(liveExtractionPids(), []);
    // Still able to extract afterwards.
    assert.strictEqual(await extractDocxText(await write(innocentDocx())), "Innocent text");
  });

  test("a DOM-heavy parse beyond the heap limit maps to 422", async () => {
    const { buffer } = await paragraphBomb();
    const file = await write(buffer);
    const run = await measured(() => extractDocxText(file, { limits: NO_SIZE_LIMITS, heapLimitMb: 32 }));
    appError(422, /too large or too complex|took too long/)(run.error);
    assert.ok(run.maxLagMs < 200, `event loop blocked ${run.maxLagMs.toFixed(0)} ms${noiseNote(noise)}`);
  });

  test("the time limit kills the process (422), and it has exited before the call returns", async () => {
    const { buffer } = await paragraphBomb();
    const file = await write(buffer);
    const run = await measured(() => extractDocxText(file, { limits: NO_SIZE_LIMITS, timeoutMs: 300 }));
    appError(422, /took too long/)(run.error);
    assert.ok(run.elapsed < 2000, `took ${run.elapsed.toFixed(0)} ms${noiseNote(noise)}`);
    assert.ok(run.maxLagMs < 200, `event loop blocked ${run.maxLagMs.toFixed(0)} ms${noiseNote(noise)}`);
    assert.deepStrictEqual(liveExtractionPids(), [], "slot released before the child exited");
  });
});

describe("SEC-002: legitimate documents still extract", () => {
  test("a small DOCX extracts", async () => {
    const { buffer } = await makeDocx(paragraph("Hello bounded ResearchMind"));
    assert.strictEqual(await extractDocxText(await write(buffer)), "Hello bounded ResearchMind");
  });

  test("a large legitimate DOCX (5,000 paragraphs, > 1 MB of XML) extracts in < 3 s", async () => {
    const { buffer, documentXmlLength } = await largeLegitDocx();
    assert.ok(documentXmlLength > 1_000_000, `fixture XML is ${documentXmlLength} chars`);
    const started = performance.now();
    const text = await extractDocxText(await write(buffer));
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 3000, `took ${elapsed.toFixed(0)} ms${noiseNote(noise)}`);
    assert.ok(text.startsWith("0."));
    assert.ok(text.includes("\n\n4999."), "last paragraph present");
  });

  test("a DOCX with a directory entry and a data descriptor (streamed zip) extracts", async () => {
    const zip = new JSZip();
    const { buffer: base } = await makeDocx(paragraph("Streamed archive text"));
    const loaded = await JSZip.loadAsync(base);
    for (const [name, entry] of Object.entries(loaded.files)) zip.file(name, await entry.async("nodebuffer"));
    zip.folder("customXml");
    const streamed = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", streamFiles: true });
    assert.strictEqual(await extractDocxText(await write(streamed)), "Streamed archive text");
  });

  test("extracted text above the cap is refused (413)", async () => {
    const { buffer } = await makeDocx(paragraph("x".repeat(500)));
    await assert.rejects(extractDocxText(await write(buffer), { maxTextChars: 100 }), appError(413, /too much text/));
  });
});

describe("SEC-002: concurrency gate", () => {
  test(`at most ${MAX_CONCURRENT_EXTRACTIONS} processes run; ${MAX_QUEUED_EXTRACTIONS} more wait; beyond that 503`, async () => {
    // Slow extractions (a bomb past the size limits, stopped by the child's
    // limits after up to 1 s each), so every call overlaps the first ones.
    const { buffer } = await paragraphBomb();
    const file = await write(buffer);
    const slow = { limits: NO_SIZE_LIMITS, timeoutMs: 1000, heapLimitMb: 32 };
    const total = MAX_CONCURRENT_EXTRACTIONS + MAX_QUEUED_EXTRACTIONS + 2;
    let maxLive = 0;
    const sampler = setInterval(() => (maxLive = Math.max(maxLive, liveExtractionPids().length)), 5);
    const results = await Promise.allSettled(Array.from({ length: total }, () => extractDocxText(file, slow)));
    clearInterval(sampler);
    const statuses = results.map((r) => (r.status === "rejected" && r.reason instanceof AppError ? r.reason.statusCode : -1));
    assert.strictEqual(statuses.filter((s) => s === 503).length, 2, `statuses: ${statuses}`);
    assert.strictEqual(statuses.filter((s) => s === 422).length, MAX_CONCURRENT_EXTRACTIONS + MAX_QUEUED_EXTRACTIONS);
    assert.ok(maxLive <= MAX_CONCURRENT_EXTRACTIONS, `${maxLive} extraction processes alive at once`);
    assert.deepStrictEqual(liveExtractionPids(), []);
    // The gate is released: a later extraction runs normally.
    const { buffer: small } = await makeDocx(paragraph("after the burst"));
    assert.strictEqual(await extractDocxText(await write(small)), "after the burst");
  });
});
