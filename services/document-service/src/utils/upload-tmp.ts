import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * Upload temp directory (SEC-024 a, scope-review rule R2).
 *
 * Uploaded files are written here only until they are parsed and stored in
 * Cloudinary; the request handler deletes them afterwards. A crash can leave
 * one behind, so document-service sweeps the directory at startup.
 *
 * - Directory: UPLOAD_TMP_DIR, default <OS temp>/researchmind-uploads. It
 *   used to be the cwd-relative "uploads/" (inside the repository).
 * - Names: rm-upload-<uuid>.<ext>. The client's file name never becomes part
 *   of a path.
 * - The sweep deletes ONLY top-level regular files whose name matches that
 *   pattern and that are older than 1 hour. It uses lstat (links are never
 *   followed or removed) and never recurses. It refuses -- with a warning --
 *   to sweep the repository or anything inside it, the legacy
 *   services/document-service/uploads folder, a filesystem root and the home
 *   directory, so a misconfigured UPLOAD_TMP_DIR cannot delete user files.
 */

export const UPLOAD_TEMP_NAME = /^rm-upload-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|docx)$/;
export const UPLOAD_TMP_MAX_AGE_MS = 60 * 60 * 1000;

export const resolveUploadTmpDir = (env: Record<string, string | undefined> = process.env): string => {
  const configured = env.UPLOAD_TMP_DIR?.trim();
  return path.resolve(configured || path.join(os.tmpdir(), "researchmind-uploads"));
};

export const newUploadTempName = (extension: string): string => {
  const ext = extension.toLowerCase() === ".docx" ? ".docx" : ".pdf";
  return `rm-upload-${crypto.randomUUID()}${ext}`;
};

export const ensureUploadTmpDir = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true });
};

/** The repository root: the nearest ancestor whose package.json is "researchmind". */
const findRepoRoot = (): string | null => {
  let dir = __dirname;
  for (;;) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      if (pkg?.name === "researchmind") return dir;
    } catch {
      /* no package.json here */
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

const normalise = (p: string) => {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

const isInside = (child: string, parent: string) => {
  const rel = path.relative(normalise(parent), normalise(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/** Why a directory must not be swept, or null when it may be. */
export const sweepRefusalReason = (dir: string): string | null => {
  const target = path.resolve(dir);
  if (normalise(target) === normalise(path.parse(target).root)) return "it is a filesystem root";
  if (normalise(target) === normalise(os.homedir())) return "it is the home directory";
  const repo = findRepoRoot();
  if (repo && isInside(target, path.join(repo, "services", "document-service", "uploads"))) {
    return "it is the legacy services/document-service/uploads folder";
  }
  if (repo && isInside(target, repo)) return "it is inside the repository";
  return null;
};

export interface SweepOptions {
  maxAgeMs?: number;
  now?: number;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

/** Delete old leftover upload temp files (see the rules above). */
export const sweepUploadTmpDir = async (
  dir: string,
  { maxAgeMs = UPLOAD_TMP_MAX_AGE_MS, now = Date.now(), log = console.log, warn = console.warn }: SweepOptions = {}
): Promise<{ removed: number; refused: boolean }> => {
  const refusal = sweepRefusalReason(dir);
  if (refusal) {
    warn(`[document-service] Upload temp sweep refused for ${dir}: ${refusal}. Set UPLOAD_TMP_DIR to a dedicated folder.`);
    return { removed: 0, refused: true };
  }
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return { removed: 0, refused: false };
  }
  let removed = 0;
  for (const name of entries) {
    if (!UPLOAD_TEMP_NAME.test(name)) continue;
    const full = path.join(dir, name);
    try {
      const stat = await fs.promises.lstat(full);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      if (now - stat.mtimeMs < maxAgeMs) continue;
      await fs.promises.unlink(full);
      removed++;
    } catch {
      /* vanished or locked: leave it */
    }
  }
  if (removed > 0) log(`[document-service] Removed ${removed} leftover upload temp file(s) from ${dir}`);
  return { removed, refused: false };
};
