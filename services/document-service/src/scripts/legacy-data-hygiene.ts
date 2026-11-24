/*
 * SEC-024 (b): legacy data hygiene for the DOCUMENT database and the legacy
 * upload folder. User-run only.
 *
 * What it looks at:
 *  - the `workspaces` collection in the document database (no document-service
 *    code uses it; workspaces live in the workspace database);
 *  - files left in the legacy cwd-relative folder services/document-service/
 *    uploads by the old upload middleware (temporary uploads now go to
 *    UPLOAD_TMP_DIR and are swept at startup; this folder is never swept).
 *
 * SAFE BY DEFAULT: without flags it is a DRY RUN that prints counts and file
 * names and changes nothing. Each change needs its own flag:
 *
 *   --drop-empty-workspaces-collection  drop `workspaces`, ONLY if it is empty.
 *   --delete-legacy-uploads             delete the top-level regular files in
 *                                       the legacy folder that are older than
 *                                       1 hour (no subfolders, no links).
 *
 * Idempotent: a re-run finds nothing left to do.
 *
 * Run it YOURSELF from services/document-service (it reads that service's
 * .env for MONGODB_URI or MONGO_URI). Dry run first:
 *
 *   npx ts-node src/scripts/legacy-data-hygiene.ts
 *   npx ts-node src/scripts/legacy-data-hygiene.ts --drop-empty-workspaces-collection
 *   npx ts-node src/scripts/legacy-data-hygiene.ts --delete-legacy-uploads
 */
import fs from "fs";
import path from "path";
import type { Db } from "mongodb";

export const UNUSED_WORKSPACES_COLLECTION = "workspaces";
/** The folder the pre-Wave-5 upload middleware wrote to (relative to this service). */
export const LEGACY_UPLOADS_DIR = path.resolve(__dirname, "..", "..", "uploads");
const LEGACY_FILE_MIN_AGE_MS = 60 * 60 * 1000;

export type DocumentHygieneOptions = {
  dropEmptyWorkspacesCollection: boolean;
  deleteLegacyUploads: boolean;
};

export type DocumentHygieneSummary = {
  workspacesDocuments: number;
  workspacesDropped: boolean;
  legacyUploads: number;
  legacyUploadsDeleted: number;
};

const FLAGS: Record<string, keyof DocumentHygieneOptions> = {
  "--drop-empty-workspaces-collection": "dropEmptyWorkspacesCollection",
  "--delete-legacy-uploads": "deleteLegacyUploads",
};

/** Explicit flags only; anything else is refused (a typo must not be guessed). */
export const parseDocumentHygieneArgs = (args: string[]): DocumentHygieneOptions => {
  const options: DocumentHygieneOptions = { dropEmptyWorkspacesCollection: false, deleteLegacyUploads: false };
  for (const arg of args) {
    const key = FLAGS[arg];
    if (!key) throw new Error(`Unknown option ${arg}. Allowed: ${Object.keys(FLAGS).join(", ")}`);
    options[key] = true;
  }
  return options;
};

/** Top-level regular files (lstat: links are never followed) older than 1 h. */
const listLegacyUploads = (dir: string, now: number): string[] => {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return []; // the folder does not exist: nothing to do (it is never created)
  }
  return names.filter((name) => {
    try {
      const stat = fs.lstatSync(path.join(dir, name));
      return stat.isFile() && now - stat.mtimeMs > LEGACY_FILE_MIN_AGE_MS;
    } catch {
      return false;
    }
  });
};

export const runDocumentHygiene = async ({
  options,
  db,
  uploadsDir = LEGACY_UPLOADS_DIR,
  now = Date.now(),
  log = console.log,
}: {
  options: DocumentHygieneOptions;
  db: Db;
  uploadsDir?: string;
  now?: number;
  log?: (line: string) => void;
}): Promise<DocumentHygieneSummary> => {
  const dryRun = !options.dropEmptyWorkspacesCollection && !options.deleteLegacyUploads;
  log(dryRun ? "DRY RUN: nothing will be changed." : "APPLY: only the requested changes are made.");
  const summary: DocumentHygieneSummary = {
    workspacesDocuments: 0,
    workspacesDropped: false,
    legacyUploads: 0,
    legacyUploadsDeleted: 0,
  };

  const exists = (await db.listCollections({ name: UNUSED_WORKSPACES_COLLECTION }).toArray()).length === 1;
  if (exists) {
    summary.workspacesDocuments = await db.collection(UNUSED_WORKSPACES_COLLECTION).countDocuments();
  }
  log(
    exists
      ? `Collection ${UNUSED_WORKSPACES_COLLECTION} (document database): ${summary.workspacesDocuments} document(s), not used by the application`
      : `Collection ${UNUSED_WORKSPACES_COLLECTION} (document database): not present`
  );
  if (options.dropEmptyWorkspacesCollection && exists) {
    if (summary.workspacesDocuments === 0) {
      await db.dropCollection(UNUSED_WORKSPACES_COLLECTION);
      summary.workspacesDropped = true;
      log(`Collection ${UNUSED_WORKSPACES_COLLECTION} dropped (it was empty)`);
    } else {
      log(`Collection ${UNUSED_WORKSPACES_COLLECTION} is NOT empty: not dropped. Inspect it first.`);
    }
  }

  const files = listLegacyUploads(uploadsDir, now);
  summary.legacyUploads = files.length;
  log(`Legacy upload folder ${uploadsDir}: ${files.length} file(s) older than 1 hour`);
  for (const name of files) {
    if (options.deleteLegacyUploads) {
      try {
        fs.unlinkSync(path.join(uploadsDir, name));
        summary.legacyUploadsDeleted += 1;
        log(`  deleted ${name}`);
      } catch (error) {
        log(`  could not delete ${name}: ${(error as NodeJS.ErrnoException).code ?? "error"}`);
      }
    } else {
      log(`  would delete ${name}`);
    }
  }

  if (dryRun) log("Nothing was changed. Re-run with an explicit flag to apply a change.");
  return summary;
};

const main = async () => {
  const options = parseDocumentHygieneArgs(process.argv.slice(2));
  const dotenv = await import("dotenv");
  dotenv.config();
  const { resolveMongoUri } = await import("../../../../packages/shared/lifecycle/mongo");
  const uri = resolveMongoUri("MONGODB_URI", "MONGO_URI")?.uri;
  if (!uri) throw new Error("Set MONGODB_URI (or MONGO_URI) for document-service");
  const { default: mongoose } = await import("mongoose");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await runDocumentHygiene({ options, db: mongoose.connection.db! });
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Hygiene script aborted: ${(error as Error).message}`);
    process.exit(1);
  });
}
