import fs from "fs/promises";
import { AppError } from "../../../../packages/shared/errors/AppError";
import { MAX_EXTRACTED_TEXT_CHARS, tooMuchTextError } from "./extraction-limits";
import {
  acquireExtractionSlot,
  releaseExtractionSlot,
  runSandboxedChild,
} from "./extraction-sandbox";

/**
 * PDF text extraction, bounded and isolated (Wave 6, SEC-002-PDF).
 *
 * pdf.js used to parse every upload on the service's own process with no
 * time or memory limit: a ~0.7 MB file whose compressed content stream
 * inflates to millions of operators kept the service busy for minutes. The
 * parse now runs in the same child-process sandbox as DOCX
 * (extraction-sandbox.ts): minimal environment, heap limit, wall-clock limit
 * with SIGKILL, and ONE concurrency gate shared with DOCX. The text cap is
 * applied inside the child (413), so oversized text never crosses IPC.
 *
 * The child runs exactly the former in-process code (pdf-parse's PDFParse,
 * getText(), trim), so successful output is unchanged byte for byte.
 */

export type PdfExtractionOptions = {
  /** Wall-clock limit for one extraction (ms). */
  timeoutMs?: number;
  /** V8 old-generation heap limit of the extraction process (MB). */
  heapLimitMb?: number;
  /** Maximum number of characters of extracted text. */
  maxTextChars?: number;
  /** Lower memory limits, for tests only (defaults: the PDF_MAX_* constants). */
  maxDecodedBufferBytes?: number;
  maxTotalLargeAllocationBytes?: number;
  maxArrayBufferBytes?: number;
};

export const PDF_EXTRACTION_TIMEOUT_MS = 30_000;
export const PDF_EXTRACTION_HEAP_MB = 512;

/**
 * pdf.js exception names that mean "this upload is not a readable PDF"
 * (corrupt/empty file, encrypted file, malformed structure). Anything else is
 * treated as a server-side failure (-> 500).
 */
const UNREADABLE_PDF_ERRORS = new Set(["InvalidPDFException", "PasswordException", "FormatError"]);

const UNREADABLE_PDF_MESSAGE = "Could not read the PDF file. It may be corrupted or password-protected.";
const TOO_COMPLEX_MESSAGE = "The PDF file is too large or too complex to process.";
const TIMEOUT_MESSAGE = "The PDF file took too long to process.";

/** Resource exhaustion inside the child (thrown, not fatal). */
const RESOURCE_EXHAUSTION_PATTERN =
  /maximum call stack|invalid string length|invalid array length|array buffer allocation failed|out of memory/i;

/*
 * Decoded-data bounds (Wave 6 Stage E, W6-R5-01). V8's --max-old-space-size
 * does not limit ArrayBuffer memory, and pdf.js decodes every stream (any
 * filter chain, encrypted or not) into ONE growing Uint8Array (doubling).
 * Inside the child, before pdf-parse is loaded:
 *  - every typed-array / ArrayBuffer constructor refuses a single allocation
 *    above PDF_MAX_DECODED_BUFFER_BYTES, so no stream can decode to more than
 *    that (a 10 MB upload can no longer carry a gigabyte stream);
 *  - the same trap keeps a running total of every allocation of at least
 *    PDF_LARGE_ALLOCATION_BYTES and refuses once it would pass
 *    PDF_MAX_TOTAL_LARGE_ALLOCATION_BYTES (Stage E round 2, W6-R5-09: a
 *    filter chain whose stages each stay under the per-allocation cap is
 *    decoded synchronously, so the sampled watchdog alone could overshoot);
 *  - a watchdog stops the child when ArrayBuffer memory or RSS passes
 *    PDF_MAX_ARRAY_BUFFER_BYTES / PDF_MAX_RSS_BYTES (sampled every 25 ms).
 * Any one ends the extraction with 422 "too large or too complex". Normal
 * documents never come near these limits, so their output is unchanged.
 */
export const PDF_MAX_DECODED_BUFFER_BYTES = 128 * 1024 * 1024;
export const PDF_LARGE_ALLOCATION_BYTES = 1024 * 1024;
export const PDF_MAX_TOTAL_LARGE_ALLOCATION_BYTES = 512 * 1024 * 1024;
export const PDF_MAX_ARRAY_BUFFER_BYTES = 384 * 1024 * 1024;
export const PDF_MAX_RSS_BYTES = 1280 * 1024 * 1024;

const CHILD_SOURCE = `
"use strict";
const peak = { arrayBuffers: 0, rss: 0 };
let limitHit = false;

const sample = (job) => {
  const usage = process.memoryUsage();
  peak.arrayBuffers = Math.max(peak.arrayBuffers, usage.arrayBuffers);
  peak.rss = Math.max(peak.rss, usage.rss);
  if (usage.arrayBuffers > job.maxArrayBufferBytes || usage.rss > job.maxRssBytes) limitHit = true;
};

const bytesRequested = (target, arg) => {
  const width = target.BYTES_PER_ELEMENT || 1;
  if (typeof arg === "number") return arg * width;
  if (arg && typeof arg === "object" && !(arg instanceof ArrayBuffer) && !ArrayBuffer.isView(arg) && typeof arg.length === "number") {
    return arg.length * width;
  }
  return 0;
};

// Running total of large allocations (Stage E round 2, W6-R5-09): enforced
// synchronously in the constructor trap, so a filter chain whose stages each
// stay under the per-allocation cap cannot outrun the sampled watchdog.
let largeAllocated = 0;

const guardAllocations = (limit, totalLimit, largeThreshold) => {
  for (const name of ["ArrayBuffer", "Uint8Array", "Uint8ClampedArray", "Int8Array", "Uint16Array", "Int16Array",
    "Uint32Array", "Int32Array", "Float32Array", "Float64Array"]) {
    const Original = globalThis[name];
    globalThis[name] = new Proxy(Original, {
      construct(target, args, newTarget) {
        const requested = bytesRequested(target, args[0]);
        if (requested > limit || (requested >= largeThreshold && largeAllocated + requested > totalLimit)) {
          limitHit = true;
          throw new RangeError("Decoded PDF data exceeds the extraction limit");
        }
        if (requested >= largeThreshold) largeAllocated += requested;
        return Reflect.construct(target, args, newTarget);
      },
    });
  }
};

const run = async (job) => {
  const bytes = job.bytes;
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  guardAllocations(job.maxDecodedBufferBytes, job.maxTotalLargeAllocationBytes, job.largeAllocationBytes);
  const watchdog = setInterval(() => {
    sample(job);
    if (limitHit) {
      process.send({ kind: "too-complex", peak }, () => process.exit(0));
    }
  }, 25);
  const { PDFParse } = require(job.pdfParsePath);
  const parser = new PDFParse({ data });
  try {
    let textResult;
    try {
      textResult = await parser.getText();
    } catch (error) {
      sample(job);
      if (limitHit) return { kind: "too-complex", peak };
      throw error;
    }
    sample(job);
    if (limitHit) return { kind: "too-complex", peak };
    const text = textResult.text.trim();
    if (text.length > job.maxTextChars) return { kind: "too-much-text", peak };
    return { kind: "ok", text, peak };
  } finally {
    clearInterval(watchdog);
    await parser.destroy().catch(() => {});
  }
};

process.once("message", (job) => {
  run(job).then(
    (result) => process.send(result, () => process.exit(0)),
    (error) =>
      process.send(
        { kind: "error", name: error && error.name, message: String((error && error.message) || error), peak },
        () => process.exit(0)
      )
  );
});
`;

type ChildPeak = { arrayBuffers: number; rss: number };

type ChildResult =
  | { kind: "ok"; text: string; peak?: ChildPeak }
  | { kind: "too-much-text"; peak?: ChildPeak }
  | { kind: "too-complex"; peak?: ChildPeak }
  | { kind: "error"; name?: string; message: string; peak?: ChildPeak };

let lastPeak: ChildPeak | undefined;

/** Peak memory the last PDF extraction child reported (diagnostics and tests). */
export const lastPdfExtractionPeak = () => lastPeak;

/** The same pdf-parse build the service resolved before Wave 6 (CommonJS entry). */
const pdfParsePath = () => require.resolve("pdf-parse");

/** Extract readable text from a PDF file (bounded; see the header comment). */
export const extractPdfText = async (filePath: string, options: PdfExtractionOptions = {}) => {
  const fileBuffer = await fs.readFile(filePath);
  const maxTextChars = options.maxTextChars ?? MAX_EXTRACTED_TEXT_CHARS;

  await acquireExtractionSlot();
  let result: ChildResult;
  try {
    result = await runSandboxedChild<ChildResult>(
      CHILD_SOURCE,
      {
        bytes: fileBuffer,
        pdfParsePath: pdfParsePath(),
        maxTextChars,
        maxDecodedBufferBytes: options.maxDecodedBufferBytes ?? PDF_MAX_DECODED_BUFFER_BYTES,
        maxTotalLargeAllocationBytes: options.maxTotalLargeAllocationBytes ?? PDF_MAX_TOTAL_LARGE_ALLOCATION_BYTES,
        largeAllocationBytes: PDF_LARGE_ALLOCATION_BYTES,
        maxArrayBufferBytes: options.maxArrayBufferBytes ?? PDF_MAX_ARRAY_BUFFER_BYTES,
        maxRssBytes: PDF_MAX_RSS_BYTES,
      },
      {
        timeoutMs: options.timeoutMs ?? PDF_EXTRACTION_TIMEOUT_MS,
        heapLimitMb: options.heapLimitMb ?? PDF_EXTRACTION_HEAP_MB,
        timeoutMessage: TIMEOUT_MESSAGE,
        tooComplexMessage: TOO_COMPLEX_MESSAGE,
        label: "PDF",
      }
    );
  } finally {
    releaseExtractionSlot();
  }
  lastPeak = result.peak;

  switch (result.kind) {
    case "ok":
      return result.text;
    case "too-much-text":
      throw tooMuchTextError(maxTextChars);
    case "too-complex":
      throw new AppError(TOO_COMPLEX_MESSAGE, 422);
    default:
      if (UNREADABLE_PDF_ERRORS.has(result.name ?? "")) {
        throw new AppError(UNREADABLE_PDF_MESSAGE, 422);
      }
      if (RESOURCE_EXHAUSTION_PATTERN.test(result.message)) {
        throw new AppError(TOO_COMPLEX_MESSAGE, 422);
      }
      throw Object.assign(new Error(`PDF extraction failed: ${result.message}`), { name: result.name ?? "Error" });
  }
};
