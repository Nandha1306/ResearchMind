import { spawn } from "child_process";
import { AppError } from "../../../../packages/shared/errors/AppError";

/**
 * The child-process sandbox shared by DOCX (SEC-002) and PDF (Wave 6,
 * SEC-002-PDF) text extraction.
 *
 *  - Each extraction runs in its own Node process started with `node -e` and
 *    a plain-CommonJS source, a V8 heap limit (--max-old-space-size) and a
 *    wall-clock limit (SIGKILL on timeout). A fatal out-of-memory abort kills
 *    only the child.
 *  - The child gets a minimal environment: PATH and the OS temp/system
 *    variables only -- no JWT_*, INTERNAL_SERVICE_TOKEN, CLOUDINARY_*,
 *    MONGO_URI, REDIS_URL or NODE_OPTIONS (no loader, no secret).
 *  - The input bytes and the result travel over IPC: the sandbox writes no
 *    temporary file of its own.
 *  - ONE concurrency gate for every format: at most MAX_CONCURRENT_EXTRACTIONS
 *    children run at once, MAX_QUEUED_EXTRACTIONS more requests wait, beyond
 *    that 503. A slot is released only after its child has actually exited.
 */

export const MAX_CONCURRENT_EXTRACTIONS = 2;
export const MAX_QUEUED_EXTRACTIONS = 8;

/** Fatal V8 out-of-memory output on the child's stderr. */
const FATAL_OOM_PATTERN = /heap out of memory|reached heap limit|allocation failed|out of memory/i;

/* ---- concurrency gate ---------------------------------------------------- */

let active = 0;
const waiting: Array<() => void> = [];

export const acquireExtractionSlot = async () => {
  if (active < MAX_CONCURRENT_EXTRACTIONS) {
    active++;
    return;
  }
  if (waiting.length >= MAX_QUEUED_EXTRACTIONS) {
    throw new AppError("The service is busy processing documents. Please try again shortly.", 503);
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  // The releasing extraction handed its slot over (active unchanged).
};

export const releaseExtractionSlot = () => {
  const next = waiting.shift();
  if (next) next();
  else active--;
};

/* ---- child process --------------------------------------------------------- */

const livePids = new Set<number>();

/** PIDs of extraction processes that have not exited yet (diagnostics/tests). */
export const liveExtractionPids = () => [...livePids];

/** Minimal environment: no secrets, no loaders (NODE_OPTIONS) for the child. */
export const sandboxChildEnv = () => {
  const env: NodeJS.ProcessEnv = {};
  // process.env lookups are case-insensitive on Windows, so "PATH" finds "Path".
  for (const name of ["PATH", "SystemRoot", "TEMP", "TMP", "TMPDIR"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return env;
};

export interface SandboxRunOptions {
  timeoutMs: number;
  heapLimitMb: number;
  /** 422 message when the wall-clock limit is hit. */
  timeoutMessage: string;
  /** 422 message when the child runs out of memory. */
  tooComplexMessage: string;
  /** Used in the error for a child that ends without a result. */
  label: string;
}

/**
 * Run `childSource` in a sandboxed child process and send it `job` over IPC.
 * Resolves with the child's first message, or rejects (422 on timeout or
 * fatal OOM). Settles only after the child has exited, so the caller's slot
 * covers the child's whole lifetime.
 */
export const runSandboxedChild = <T>(childSource: string, job: unknown, options: SandboxRunOptions) =>
  new Promise<T>((resolve, reject) => {
    const child = spawn(process.execPath, [`--max-old-space-size=${options.heapLimitMb}`, "-e", childSource], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      serialization: "advanced",
      env: sandboxChildEnv(),
      windowsHide: true,
    });

    let result: T | undefined;
    let timedOut = false;
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    // Remember whether V8 reported a fatal OOM (the message is followed by a
    // long native stack, so keep a flag rather than the text).
    let fatalOom = false;
    let stderrTail = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-512);
      if (FATAL_OOM_PATTERN.test(stderrTail)) fatalOom = true;
    });
    child.on("message", (message: T) => {
      result ??= message;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    child.on("error", (error) => {
      // Spawn failure (no process to wait for) or an IPC error: make sure the
      // child is gone; settle on `exit` if there is one, else now.
      if (child.pid === undefined) return settle(() => reject(error));
      child.kill("SIGKILL");
    });
    if (child.pid !== undefined) livePids.add(child.pid);
    child.once("exit", (code, signal) => {
      if (child.pid !== undefined) livePids.delete(child.pid);
      settle(() => {
        if (result) return resolve(result);
        if (timedOut) return reject(new AppError(options.timeoutMessage, 422));
        // V8 aborts on a fatal OOM: exit code 134 (Windows) / SIGABRT (POSIX).
        if (fatalOom || code === 134 || signal === "SIGABRT") {
          return reject(new AppError(options.tooComplexMessage, 422));
        }
        reject(new Error(`${options.label} extraction process ended without a result (code ${code}, signal ${signal})`));
      });
    });

    if (child.pid !== undefined) {
      child.send(job as any);
    }
  });
