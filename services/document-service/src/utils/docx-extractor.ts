import fs from "fs/promises";
import path from "path";
import { AppError } from "../../../../packages/shared/errors/AppError";
import {
  MAX_CONCURRENT_EXTRACTIONS,
  MAX_QUEUED_EXTRACTIONS,
  acquireExtractionSlot,
  liveExtractionPids,
  releaseExtractionSlot,
  runSandboxedChild,
} from "./extraction-sandbox";
import {
  DEFAULT_DOCX_LIMITS,
  UNREADABLE_DOCX_MESSAGE,
  inspectDocxArchive,
  type DocxArchiveLimits,
  type ZipEntry,
} from "./zip-precheck";
import { MAX_EXTRACTED_TEXT_CHARS, tooMuchTextError } from "./extraction-limits";

/**
 * DOCX text extraction, bounded and isolated (SEC-002).
 *
 * Previously mammoth inflated the archive and built the document DOM on the
 * HTTP event loop with no size, entry, memory or time limit: a 19 KB upload
 * expanding to 180,000 paragraphs blocked the whole service for seconds and
 * could exhaust its heap. Now:
 *
 *  1. inspectDocxArchive() checks the ZIP structure in milliseconds: only a
 *     canonical layout is accepted (no comment, trailing or hidden data,
 *     concatenated archives or header mismatches), plus entry count, declared
 *     sizes, expansion ratio and required parts -> 413/422;
 *  2. the parse runs in a separate CHILD PROCESS with a V8 heap limit
 *     (--max-old-space-size) and a wall-clock limit. A fatal out-of-memory
 *     abort kills only the child; the service answers 422. The child:
 *       - inflates every VALIDATED entry with an output cap equal to its
 *         declared size and checks the CRC (a lying archive -> 422);
 *       - rebuilds a fresh archive from exactly those entries and hands only
 *         that to mammoth, so the parser can never read bytes the check did
 *         not validate;
 *  3. the extracted text is capped (MAX_EXTRACTED_TEXT_CHARS -> 413);
 *  4. at most MAX_CONCURRENT_EXTRACTIONS children run at once; a few more
 *     requests wait, beyond that 503. A slot is released only after its child
 *     has actually exited (a timed-out child is killed first).
 *
 * The child runs CHILD_SOURCE with `node -e`: plain CommonJS that only needs
 * Node built-ins and the resolved paths of mammoth and its jszip, so it works
 * the same under ts-node (dev), tsx (tests) and the compiled dist build, and
 * it inherits no loader, no secret and no environment beyond PATH.
 *
 * Wave 6: the process runner and the concurrency gate live in
 * extraction-sandbox.ts and are shared with PDF extraction (one gate for
 * both formats). Behaviour for DOCX is unchanged.
 */

// Re-exported for existing callers and tests (the values live in the sandbox).
export { MAX_CONCURRENT_EXTRACTIONS, MAX_QUEUED_EXTRACTIONS, liveExtractionPids };

export type DocxExtractionOptions = {
  limits?: DocxArchiveLimits;
  /** Wall-clock limit for one extraction (ms). */
  timeoutMs?: number;
  /** V8 old-generation heap limit of the extraction process (MB). */
  heapLimitMb?: number;
  /** Maximum number of characters of extracted text. */
  maxTextChars?: number;
};

export const DOCX_EXTRACTION_TIMEOUT_MS = 20_000;
export const DOCX_EXTRACTION_HEAP_MB = 256;

/**
 * mammoth/JSZip/xmldom messages that mean "this upload is not a readable
 * DOCX" (including XML the parser rejects, e.g. a DTD entity:
 * "[xmldom error] entity not found").
 * Anything else is treated as a server-side failure (-> 500).
 */
const UNREADABLE_DOCX_PATTERN =
  /end of central directory|corrupted zip|end of data reached|is this a zip file|main document part|invalid (distance|block|code|stored)|unexpected end of file|incorrect header check|unexpected close tag|unclosed|non-whitespace before first tag|invalid character|\[xmldom (error|fatalError)\]/i;

/** Resource exhaustion inside the child (thrown, not fatal). */
const RESOURCE_EXHAUSTION_PATTERN =
  /maximum call stack|invalid string length|invalid array length|array buffer allocation failed|out of memory/i;

const TOO_COMPLEX_MESSAGE = "The DOCX file is too large or too complex to process.";
const INCONSISTENT_MESSAGE =
  "The DOCX file is damaged: its contents do not match the sizes it declares.";
const TIMEOUT_MESSAGE = "The DOCX file took too long to process.";

const CHILD_SOURCE = `
"use strict";
const zlib = require("zlib");

const run = async (job) => {
  const bytes = job.bytes;
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const JSZip = require(job.jszipPath);
  const rebuilt = new JSZip();

  for (const entry of job.entries) {
    const data = buf.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
    if (data.length !== entry.compressedSize) return { kind: "inconsistent" };
    let content;
    if (entry.method === 8) {
      try {
        content = zlib.inflateRawSync(data, { maxOutputLength: Math.max(entry.uncompressedSize, 1) });
      } catch (error) {
        return { kind: "inconsistent" };
      }
    } else {
      content = Buffer.from(data);
    }
    if (content.length !== entry.uncompressedSize) return { kind: "inconsistent" };
    if (typeof zlib.crc32 === "function" && (zlib.crc32(content) >>> 0) !== (entry.crc32 >>> 0)) {
      return { kind: "inconsistent" };
    }
    if (entry.name.endsWith("/")) continue; // directory entry
    rebuilt.file(entry.name, content, { binary: true, createFolders: false });
  }

  // Parse ONLY the archive rebuilt from the validated entries.
  const archive = await rebuilt.generateAsync({ type: "nodebuffer", compression: "STORE" });
  const mammoth = require(job.mammothPath);
  const result = await mammoth.extractRawText({ buffer: archive });
  const text = String(result.value).trim();
  if (text.length > job.maxTextChars) return { kind: "too-much-text" };
  return { kind: "ok", text };
};

process.once("message", (job) => {
  run(job).then(
    (result) => process.send(result, () => process.exit(0)),
    (error) =>
      process.send(
        { kind: "error", name: error && error.name, message: String((error && error.message) || error) },
        () => process.exit(0)
      )
  );
});
`;

type ChildResult =
  | { kind: "ok"; text: string }
  | { kind: "inconsistent" }
  | { kind: "too-much-text" }
  | { kind: "error"; name?: string; message: string };

/* ---- child process (shared sandbox: extraction-sandbox.ts) ---------------- */

const mammothPath = () => require.resolve("mammoth");
// jszip is mammoth's own dependency (no new dependency for this service).
const jszipPath = () => require.resolve("jszip", { paths: [path.dirname(mammothPath())] });

/**
 * Run one extraction in a sandboxed child process. Resolves/rejects only
 * after the child has exited, so the caller's slot covers its whole lifetime.
 */
const runChild = (
  bytes: Buffer,
  entries: ZipEntry[],
  options: { timeoutMs: number; heapLimitMb: number; maxTextChars: number }
) =>
  runSandboxedChild<ChildResult>(
    CHILD_SOURCE,
    {
      bytes,
      entries,
      mammothPath: mammothPath(),
      jszipPath: jszipPath(),
      maxTextChars: options.maxTextChars,
    },
    {
      timeoutMs: options.timeoutMs,
      heapLimitMb: options.heapLimitMb,
      timeoutMessage: TIMEOUT_MESSAGE,
      tooComplexMessage: TOO_COMPLEX_MESSAGE,
      label: "DOCX",
    }
  );

/** Extract readable text from a DOCX file (bounded; see the header comment). */
export const extractDocxText = async (
  filePath: string,
  options: DocxExtractionOptions = {}
) => {
  const buffer = await fs.readFile(filePath);
  const entries = inspectDocxArchive(buffer, options.limits ?? DEFAULT_DOCX_LIMITS);
  const maxTextChars = options.maxTextChars ?? MAX_EXTRACTED_TEXT_CHARS;

  await acquireExtractionSlot();
  let result: ChildResult;
  try {
    result = await runChild(buffer, entries, {
      timeoutMs: options.timeoutMs ?? DOCX_EXTRACTION_TIMEOUT_MS,
      heapLimitMb: options.heapLimitMb ?? DOCX_EXTRACTION_HEAP_MB,
      maxTextChars,
    });
  } finally {
    releaseExtractionSlot();
  }

  switch (result.kind) {
    case "ok":
      return result.text;
    case "inconsistent":
      throw new AppError(INCONSISTENT_MESSAGE, 422);
    case "too-much-text":
      throw tooMuchTextError(maxTextChars);
    default:
      if (RESOURCE_EXHAUSTION_PATTERN.test(result.message)) {
        throw new AppError(TOO_COMPLEX_MESSAGE, 422);
      }
      if (UNREADABLE_DOCX_PATTERN.test(result.message)) {
        throw new AppError(UNREADABLE_DOCX_MESSAGE, 422);
      }
      throw Object.assign(new Error(`DOCX extraction failed: ${result.message}`), { name: result.name ?? "Error" });
  }
};
