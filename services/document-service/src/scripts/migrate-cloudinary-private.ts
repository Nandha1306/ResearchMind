/*
 * SEC-005 migration: make LEGACY public Cloudinary document assets private.
 *
 * Documents uploaded before SEC-005 are public "upload" assets: anyone who
 * has (or guesses) the delivery URL can read the file without signing in.
 * This script changes each such asset's delivery type to "authenticated"
 * (Cloudinary `rename` with `to_type`, keeping the same public id -- no
 * re-upload, reversible with the inverse rename) and records the new type on
 * the document, so document-service builds signed URLs for it from then on.
 * Files keep opening through GET /api/documents/:id/file throughout.
 *
 * SAFE BY DEFAULT: without --apply it only reports how many documents would
 * be migrated (DRY RUN) and changes nothing. It never prints secrets or
 * delivery URLs (only document ids, per-document outcomes and counts). It is
 * idempotent per document: a re-run picks up every document whose record
 * still says "public" -- including one whose asset an earlier run already
 * made private but whose record update failed: the script detects the
 * private asset (Admin API lookup) and completes the record ("reconciled").
 *
 * Run it YOURSELF, from services/document-service (it reads that service's
 * .env: MONGO_URI/MONGODB_URI and the CLOUDINARY_* credentials):
 *
 *   npx ts-node src/scripts/migrate-cloudinary-private.ts            # dry run
 *   npx ts-node src/scripts/migrate-cloudinary-private.ts --apply    # migrate
 *
 * Afterwards, old public URLs stop working (CDN caches are invalidated with
 * `invalidate: true`; invalidation can take a few minutes).
 */
import type { Model } from "mongoose";

type MigrationClient = {
  uploader: {
    rename: (from: string, to: string, options: Record<string, unknown>) => Promise<unknown>;
  };
  api: {
    /** Admin API lookup; rejects when the asset does not exist with that type. */
    resource: (publicId: string, options: Record<string, unknown>) => Promise<unknown>;
  };
};

export type MigrationSummary = {
  candidates: number;
  /** Asset renamed to authenticated and record updated. */
  migrated: number;
  /** Asset was already authenticated (an earlier run renamed it); record completed. */
  reconciled: number;
  failed: number;
  apply: boolean;
};

type DocumentStore = Pick<Model<any>, "find" | "updateMany">;

/** Documents that still point at a public (legacy) asset. */
export const LEGACY_PUBLIC_FILTER = {
  cloudinaryPublicId: { $nin: [null, ""] },
  $or: [
    { cloudinaryDeliveryType: null },
    { cloudinaryDeliveryType: { $exists: false } },
    { cloudinaryDeliveryType: "upload" },
  ],
};

export const migrateLegacyAssets = async ({
  apply,
  cloudinary,
  Document,
  filter = {},
  log = console.log,
}: {
  apply: boolean;
  cloudinary: MigrationClient;
  Document: DocumentStore;
  /** Extra filter (tests scope the run to their own records). */
  filter?: Record<string, unknown>;
  log?: (line: string) => void;
}): Promise<MigrationSummary> => {
  const candidates: Array<{ _id: unknown; fileType: string; cloudinaryPublicId: string }> = await Document.find({
    $and: [LEGACY_PUBLIC_FILTER, filter],
  })
    .select("_id fileType cloudinaryPublicId")
    .lean();
  const summary: MigrationSummary = { candidates: candidates.length, migrated: 0, reconciled: 0, failed: 0, apply };

  log(`${apply ? "APPLY" : "DRY RUN"}: ${candidates.length} document(s) reference a public (legacy) asset`);
  if (!apply) {
    for (const doc of candidates) log(`  would migrate document ${doc._id}`);
    log("Nothing was changed. Re-run with --apply to migrate.");
    return summary;
  }

  // One rename per asset (several legacy records may share an id).
  const byPublicId = new Map<string, { fileType: string; ids: unknown[] }>();
  for (const doc of candidates) {
    const entry: { fileType: string; ids: unknown[] } =
      byPublicId.get(doc.cloudinaryPublicId) ?? { fileType: doc.fileType, ids: [] };
    entry.ids.push(doc._id);
    byPublicId.set(doc.cloudinaryPublicId, entry);
  }

  // Message only: never an asset URL or a credential.
  const reason = (error: unknown) =>
    (error as { message?: string; error?: { message?: string } })?.message ??
    (error as { error?: { message?: string } })?.error?.message ??
    "error";

  for (const [publicId, { fileType, ids }] of byPublicId) {
    const resourceType = fileType === "pdf" ? "image" : "raw";
    const label = ids.join(", ");

    /*
     * 1. Make the asset private. If the rename fails, the asset may already
     *    be authenticated: an earlier run renamed it but could not update the
     *    record (e.g. the database was unavailable). Check, and if so just
     *    complete the record -- otherwise the document would stay pointing at
     *    a dead public URL (502) and every re-run would fail on the rename.
     */
    let outcome: "migrated" | "reconciled";
    try {
      await cloudinary.uploader.rename(publicId, publicId, {
        resource_type: resourceType,
        type: "upload",
        to_type: "authenticated",
        invalidate: true,
        overwrite: false,
      });
      outcome = "migrated";
    } catch (renameError) {
      try {
        await cloudinary.api.resource(publicId, { resource_type: resourceType, type: "authenticated" });
        outcome = "reconciled";
      } catch {
        summary.failed += ids.length;
        log(`  document(s) ${label}: FAILED to make the asset private (${reason(renameError)}); re-run to retry`);
        continue;
      }
    }

    // 2. Record the new delivery type (idempotent).
    try {
      await Document.updateMany(
        { _id: { $in: ids } },
        {
          $set: {
            cloudinaryDeliveryType: "authenticated",
            cloudinaryResourceType: resourceType,
            cloudinaryFormat: resourceType === "image" ? "pdf" : null,
            // The public URL no longer works; signed URLs are built on demand.
            cloudinaryUrl: null,
          },
        }
      );
    } catch (updateError) {
      summary.failed += ids.length;
      log(
        `  document(s) ${label}: asset is private now, but the record update FAILED (${reason(updateError)}); ` +
          "re-run the script to finish (it detects the private asset)"
      );
      continue;
    }

    summary[outcome] += ids.length;
    log(
      outcome === "migrated"
        ? `  document(s) ${label}: migrated`
        : `  document(s) ${label}: reconciled (asset was already private; record completed)`
    );
  }

  log(
    `Done: ${summary.migrated} migrated, ${summary.reconciled} reconciled, ${summary.failed} failed` +
      (summary.failed ? " (re-run to retry the failures)." : ".")
  );
  return summary;
};

const main = async () => {
  const apply = process.argv.includes("--apply");
  const dotenv = await import("dotenv");
  dotenv.config();
  const { default: mongoose } = await import("mongoose");
  const { resolveMongoUri } = await import("../../../../packages/shared/lifecycle/mongo");
  const uri = resolveMongoUri("MONGODB_URI", "MONGO_URI")?.uri;
  if (!uri) throw new Error("Set MONGO_URI (or MONGODB_URI) for document-service");
  const { default: cloudinary } = await import("../config/cloudinary");
  if (apply && !cloudinary.config().api_secret) throw new Error("Cloudinary credentials are not configured");
  const { Document } = await import("../models/Document");

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const summary = await migrateLegacyAssets({ apply, cloudinary: cloudinary as unknown as MigrationClient, Document });
    process.exitCode = summary.failed > 0 ? 1 : 0;
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Migration aborted: ${(error as Error).message}`);
    process.exit(1);
  });
}
