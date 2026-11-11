import fs from "fs/promises";
import mongoose from "mongoose";
import { Document } from "../models/Document";
import { CreateDocumentDto } from "../types/document.types";
import { Request, Response } from "express";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";
import { AppError } from "../../../../packages/shared/errors/AppError";
import { extractPdfText } from "../utils/pdf-extractor";
import { extractDocxText } from "../utils/docx-extractor";
import { checkWorkspaceMembership } from "../utils/workspace-checker";

import cloudinary from "../config/cloudinary";
import { addEmbeddingJob, getEmbeddingQueueLength } from "../queues/embedding.queue";
import { deleteDocumentVectors } from "./vector-cleanup.client";
import { assertFileMatchesType } from "../utils/file-signature";

/** Upload a document file to Cloudinary. */
export const uploadToCloudinary = async (
  filePath: string,
  fileName: string,
  fileExtension?: string
) => {
  const resourceType = fileExtension === "pdf" ? "image" : "raw";
  const publicId = fileName.replace(/\.(pdf|docx)$/i, "");

  const result = await cloudinary.uploader.upload(
    filePath,
    {
      resource_type: resourceType,
      folder: "researchmind/documents",
      public_id: publicId,
    }
  );

  return {
    url: result.secure_url,
    publicId: result.public_id,
  };
};

/** Save document metadata in MongoDB. */
export const createDocument = async (
  data: CreateDocumentDto
) => {
  return Document.create(data);
};

/** Upload, extract and persist a document. */
export const uploadDocument = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const { workspaceId } = req.body;

    if (!workspaceId) {
      await fs.unlink(req.file.path).catch(() => {});

      return res.status(400).json({
        success: false,
        message: "Workspace ID is required",
      });
    }

    const userId = (req as any).user?.userId || (req as any).user?.id;

    if (!userId) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    let isMember: boolean;
    try {
      isMember = await checkWorkspaceMembership(
        workspaceId,
        userId,
        req.headers.authorization
      );
    } catch (error) {
      // Invalid workspace id (400) or the check could not run (503): the
      // uploaded temp file must not be left behind.
      await fs.unlink(req.file.path).catch(() => {});
      throw error;
    }

    if (!isMember) {
      await fs.unlink(req.file.path).catch(() => {});

      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this workspace.",
      });
    }

    try {
      const fileExtension = req.file.originalname
        .split(".")
        .pop()
        ?.toLowerCase();

      let extractedText = "";

      // Trust the file's bytes, not the client-supplied name or MIME type:
      // rejects empty files and content that does not match the extension.
      if (fileExtension === "pdf" || fileExtension === "docx") {
        await assertFileMatchesType(req.file.path, fileExtension);
      }

      if (fileExtension === "pdf") {
        extractedText = await extractPdfText(
          req.file.path
        );
      } else if (fileExtension === "docx") {
        extractedText = await extractDocxText(
          req.file.path
        );
      } else {
        throw new AppError(
          "Unsupported document type. Only PDF and DOCX files are supported.",
          415
        );
      }

      let cloudinaryFile: Awaited<ReturnType<typeof uploadToCloudinary>>;
      try {
        cloudinaryFile = await uploadToCloudinary(
          req.file.path,
          req.file.filename,
          fileExtension
        );
      } catch (storageError) {
        // External storage failure: log the cause server-side, return a safe
        // message instead of a generic 500.
        console.error("Cloudinary upload failed:", storageError);
        throw new AppError(
          "File storage is temporarily unavailable. Please try again later.",
          502
        );
      }

      const document =
        await createDocument({
          workspaceId,
          uploadedBy: userId,
          originalName:
            req.file.originalname,
          fileType:
            fileExtension as "pdf" | "docx",
          fileSize: req.file.size,
          cloudinaryUrl:
            cloudinaryFile.url,
          cloudinaryPublicId:
            cloudinaryFile.publicId,
          extractedText,
          embeddingStatus: "pending",
        });

      try {
        await addEmbeddingJob({
          documentId: document._id.toString(),
          workspaceId: document.workspaceId,
          uploadedBy: document.uploadedBy,
          extractedText: document.extractedText,
          fileType: document.fileType,
        });
      } catch (error) {
        // Message only: ioredis errors carry the failed command's arguments,
        // i.e. the whole job including the document's extracted text.
        console.error("Failed to enqueue embedding job:", (error as Error)?.message);
        await Document.findByIdAndUpdate(
          document._id,
          {
            embeddingStatus: "failed",
          }
        );
      }

      await fs.unlink(req.file.path);

      res.status(201).json({
        success: true,
        message:
          "Document uploaded successfully",
        data: document,
      });
    } catch (error) {
      await fs.unlink(req.file.path).catch(() => {});
      throw error;
    }
  }
);

/** Return all documents for a workspace (without full extracted text payload). */
export const getWorkspaceDocuments = async (
  workspaceId: string
) => {
  return Document.find({
    workspaceId,
    deletedAt: null,
  })
    .select("-extractedText")
    .sort({
      createdAt: -1,
    });
};

/** Find a document by id (documents being deleted are not visible). */
export const getDocumentById = async (
  documentId: string
) => {
  if (!mongoose.Types.ObjectId.isValid(documentId)) {
    return null;
  }
  return Document.findOne({ _id: documentId, deletedAt: null });
};

type DocumentRecord = InstanceType<typeof Document>;

/**
 * Destroy a document's Cloudinary asset, unless another document record also
 * references the same public id.
 *
 * The public id stored on a record must never be trusted to be exclusively
 * owned: records created before server-owned storage fields were enforced may
 * carry an id copied from another workspace's document. Destroying it would
 * delete that other tenant's file.
 */
const destroyCloudinaryAsset = async (document: DocumentRecord) => {
  if (!document.cloudinaryPublicId) return;

  const sharedWithAnotherRecord = await Document.exists({
    cloudinaryPublicId: document.cloudinaryPublicId,
    _id: { $ne: document._id },
  });
  if (sharedWithAnotherRecord) {
    console.warn(
      `[document-service] Skipping Cloudinary destroy for document ${document._id}: asset is referenced by another document`
    );
    return;
  }

  try {
    const resourceType = document.fileType === "pdf" ? "image" : "raw";
    await cloudinary.uploader.destroy(document.cloudinaryPublicId, {
      resource_type: resourceType,
    });
  } catch (err) {
    // Storage cleanup failure does not make the document retrievable (its
    // vectors are already gone); log the id so the orphan can be removed.
    console.error(
      `[document-service] Failed to destroy Cloudinary asset for document ${document._id}:`,
      (err as Error)?.message
    );
  }
};

/**
 * Remove a soft-deleted document's vectors, storage asset and record.
 * Idempotent: every step tolerates having already run.
 */
const finishDocumentDeletion = async (document: DocumentRecord) => {
  await deleteDocumentVectors(document.workspaceId, document._id.toString());
  await destroyCloudinaryAsset(document);
  await Document.deleteOne({ _id: document._id });
};

/**
 * Delete a document, its vector embeddings and its Cloudinary asset.
 *
 * Order matters for data integrity:
 *  1. Mark the document as deleting (hidden from reads; workers can no longer
 *     claim it or mark it indexed, and a worker that finishes afterwards
 *     removes the vectors it wrote).
 *  2. Remove its vectors from the workspace namespace via ai-service. If this
 *     fails, the deletion is rolled back and reported (503): the document
 *     stays visible and consistent, and the user can retry. A document whose
 *     content is still searchable is never silently hidden.
 *  3. Remove the Cloudinary asset (guarded against shared ids) and the record.
 *     If the service stops part-way, the recovery sweep finishes the job.
 */
export const deleteDocument = async (
  documentId: string,
  workspaceId: string
) => {
  if (!mongoose.Types.ObjectId.isValid(documentId)) {
    return null;
  }

  const document = await Document.findOneAndUpdate(
    { _id: documentId, workspaceId, deletedAt: null },
    { $set: { deletedAt: new Date() } },
    { returnDocument: "after" }
  );

  if (!document) {
    return null;
  }

  try {
    await deleteDocumentVectors(document.workspaceId, document._id.toString());
  } catch (error) {
    console.error(
      `[document-service] Vector cleanup failed for document ${document._id}; deletion rolled back:`,
      (error as Error)?.message
    );
    await Document.updateOne({ _id: document._id }, { $set: { deletedAt: null } });
    throw new AppError(
      "The document could not be removed from the search index. Please try again later.",
      503
    );
  }

  await destroyCloudinaryAsset(document);
  await Document.deleteOne({ _id: document._id });

  return document;
};

/** Re-index a failed or pending document by re-enqueuing its embedding job. */
export const reindexDocument = async (
  documentId: string,
  workspaceId: string
) => {
  if (!mongoose.Types.ObjectId.isValid(documentId)) {
    return null;
  }

  // A manual re-index starts a fresh retry budget. It is refused while a
  // worker holds a live (non-stale) claim: resetting the document then would
  // let a second worker claim it and race the first.
  const liveClaimSince = new Date(Date.now() - STALE_INDEXING_MS);
  const document = await Document.findOneAndUpdate(
    {
      _id: documentId,
      workspaceId,
      deletedAt: null,
      $nor: [{ embeddingStatus: "indexing", indexingStartedAt: { $gte: liveClaimSince } }],
    },
    {
      $set: {
        embeddingStatus: "pending",
        embeddingAttempts: 0,
        embeddingError: null,
        indexingStartedAt: null,
      },
    },
    { returnDocument: "after" }
  );

  if (!document) {
    const beingIndexed = await Document.exists({ _id: documentId, workspaceId, deletedAt: null });
    if (beingIndexed) {
      throw new AppError("The document is currently being indexed. Try again when it finishes.", 409);
    }
    return null;
  }

  try {
    await addEmbeddingJob({
      documentId: document._id.toString(),
      workspaceId: document.workspaceId,
      uploadedBy: document.uploadedBy,
      extractedText: document.extractedText,
      fileType: document.fileType,
    });
  } catch (error) {
    console.error("Failed to re-enqueue embedding job:", (error as Error)?.message);
    document.embeddingStatus = "failed";
    document.embeddingError = "Could not queue the document for indexing";
    await document.save();
    throw new AppError(
      "Indexing queue is temporarily unavailable. Please try again later.",
      503
    );
  }

  return document;
};

/* ------------------------------------------------------------------------- *
 * Embedding job claiming and recovery
 * ------------------------------------------------------------------------- */

/** Maximum processing attempts before a document is left as failed. */
export const MAX_EMBEDDING_ATTEMPTS = 3;

/** A document stuck in `indexing` this long is assumed abandoned (worker crash). */
export const STALE_INDEXING_MS = 15 * 60 * 1000;

/** A `pending` / retryable `failed` document this old without progress is re-queued. */
export const STALE_PENDING_MS = 10 * 60 * 1000;

/**
 * Documents created before attempt tracking existed have no
 * `embeddingAttempts` field, and `$lt` never matches a missing field: treat
 * them as having made no attempts.
 */
const HAS_RETRIES_LEFT = {
  $or: [
    { embeddingAttempts: { $lt: MAX_EMBEDDING_ATTEMPTS } },
    { embeddingAttempts: { $exists: false } },
  ],
};

/** The sweep does not re-queue while at least this many jobs are waiting. */
export const MAX_RECOVERY_BACKLOG = 100;

/** Unfinished deletions older than this are completed by the sweep. */
export const STALE_DELETION_MS = 5 * 60 * 1000;

export type ClaimResult =
  | { claimed: true; document: DocumentRecord }
  | {
      claimed: false;
      reason: "not-found" | "deleted" | "already-indexed" | "in-progress" | "retry-limit";
    };

/**
 * Atomically claim a document for embedding (called by the ai-service worker
 * before doing any work). Only one worker can hold a claim; a duplicate or
 * concurrent delivery of the same job gets `in-progress` and is skipped.
 * A claim whose holder crashed becomes claimable again after STALE_INDEXING_MS.
 */
export const claimDocumentForEmbedding = async (
  documentId: string,
  now: Date = new Date()
): Promise<ClaimResult> => {
  if (!mongoose.Types.ObjectId.isValid(documentId)) {
    return { claimed: false, reason: "not-found" };
  }

  const staleBefore = new Date(now.getTime() - STALE_INDEXING_MS);

  const document = await Document.findOneAndUpdate(
    {
      _id: documentId,
      deletedAt: null,
      $and: [
        HAS_RETRIES_LEFT,
        {
          $or: [
            { embeddingStatus: { $in: ["pending", "failed"] } },
            { embeddingStatus: "indexing", indexingStartedAt: { $lt: staleBefore } },
            // Documents left in `indexing` by a worker version that did not
            // record a start time.
            { embeddingStatus: "indexing", indexingStartedAt: null },
          ],
        },
      ],
    },
    {
      $set: { embeddingStatus: "indexing", indexingStartedAt: now, embeddingError: null },
      $inc: { embeddingAttempts: 1, claimSequence: 1 },
    },
    { returnDocument: "after" }
  );

  if (document) {
    return { claimed: true, document };
  }

  const current = await Document.findById(documentId).select(
    "embeddingStatus embeddingAttempts indexingStartedAt deletedAt"
  );
  if (!current) return { claimed: false, reason: "not-found" };
  if (current.deletedAt) return { claimed: false, reason: "deleted" };
  if (current.embeddingStatus === "indexed") return { claimed: false, reason: "already-indexed" };

  // A live claim is checked before the retry limit: a duplicate delivery
  // during the final attempt must not mark the running job failed.
  const liveClaim = { embeddingStatus: "indexing" as const, indexingStartedAt: { $gte: staleBefore } };
  if (
    current.embeddingStatus === "indexing" &&
    current.indexingStartedAt &&
    current.indexingStartedAt >= staleBefore
  ) {
    return { claimed: false, reason: "in-progress" };
  }

  if ((current.embeddingAttempts ?? 0) >= MAX_EMBEDDING_ATTEMPTS) {
    // Make retry exhaustion visible instead of leaving the document pending.
    // Conditional, so a claim taken in the meantime is never overwritten.
    await Document.updateOne(
      { _id: documentId, embeddingStatus: { $ne: "indexed" }, $nor: [liveClaim] },
      {
        $set: {
          embeddingStatus: "failed",
          embeddingError: `Indexing failed after ${MAX_EMBEDDING_ATTEMPTS} attempts`,
        },
      }
    );
    return { claimed: false, reason: "retry-limit" };
  }

  return { claimed: false, reason: "in-progress" };
};

/**
 * Periodic recovery for embedding work and deletions (run at startup and on
 * an interval). Jobs are delivered through a Redis list that a worker pops
 * destructively, so a crash mid-job loses the queue entry; the document's
 * durable status is what makes the work recoverable:
 *
 *  - `indexing` documents whose claim is older than STALE_INDEXING_MS
 *    (worker crashed or was killed) are re-queued;
 *  - `pending` documents with no progress for STALE_PENDING_MS (queue entry
 *    lost) are re-queued;
 *  - `failed` documents are re-queued while retries remain (bounded by
 *    MAX_EMBEDDING_ATTEMPTS, so a permanently bad document stops);
 *  - deletions interrupted part-way are finished.
 *
 * Re-queuing an item that is also still in the queue is safe: the worker's
 * atomic claim lets only one delivery process the document.
 */
export const recoverEmbeddingWork = async ({
  enqueue = addEmbeddingJob,
  queueLength = getEmbeddingQueueLength,
  now = new Date(),
  batchSize = 100,
}: {
  enqueue?: (job: Parameters<typeof addEmbeddingJob>[0]) => Promise<void>;
  queueLength?: () => Promise<number>;
  now?: Date;
  batchSize?: number;
} = {}) => {
  const summary = { requeued: 0, exhausted: 0, deletionsFinished: 0, errors: 0, backlog: 0 };

  // 1. Finish deletions interrupted after their vectors were removed.
  const unfinishedDeletions = await Document.find({
    deletedAt: { $ne: null, $lt: new Date(now.getTime() - STALE_DELETION_MS) },
  }).limit(batchSize);
  for (const doc of unfinishedDeletions) {
    try {
      await finishDocumentDeletion(doc);
      summary.deletionsFinished++;
    } catch (error) {
      summary.errors++;
      console.error(
        `[document-service] Could not finish deletion of document ${doc._id}:`,
        (error as Error)?.message
      );
    }
  }

  // 2. Stale claims that exhausted their retries: record the failure.
  const exhausted = await Document.updateMany(
    {
      deletedAt: null,
      embeddingStatus: "indexing",
      embeddingAttempts: { $gte: MAX_EMBEDDING_ATTEMPTS },
      indexingStartedAt: { $lt: new Date(now.getTime() - STALE_INDEXING_MS) },
    },
    {
      $set: {
        embeddingStatus: "failed",
        embeddingError: `Indexing failed after ${MAX_EMBEDDING_ATTEMPTS} attempts`,
      },
    }
  );
  summary.exhausted = exhausted.modifiedCount ?? 0;

  // 3. Re-queue recoverable work -- unless jobs are already waiting. While
  // workers are down, every sweep would otherwise add another copy of each
  // pending document (with its full text) to Redis. Once the backlog drains,
  // the next sweep re-queues whatever is still unfinished.
  try {
    summary.backlog = await queueLength();
  } catch (error) {
    summary.errors++;
    console.error("[document-service] Could not read the embedding queue length:", (error as Error)?.message);
    return summary;
  }
  if (summary.backlog >= MAX_RECOVERY_BACKLOG) {
    console.warn(
      `[document-service] Embedding queue backlog is ${summary.backlog}; recovery re-queueing deferred`
    );
    return summary;
  }

  const recoverable = await Document.find({
    deletedAt: null,
    $and: [HAS_RETRIES_LEFT],
    $or: [
      {
        embeddingStatus: "indexing",
        indexingStartedAt: { $lt: new Date(now.getTime() - STALE_INDEXING_MS) },
      },
      { embeddingStatus: "indexing", indexingStartedAt: null },
      {
        embeddingStatus: { $in: ["pending", "failed"] },
        updatedAt: { $lt: new Date(now.getTime() - STALE_PENDING_MS) },
      },
    ],
  })
    .sort({ updatedAt: 1 })
    .limit(batchSize);

  for (const doc of recoverable) {
    try {
      await enqueue({
        documentId: doc._id.toString(),
        workspaceId: doc.workspaceId,
        uploadedBy: doc.uploadedBy,
        extractedText: doc.extractedText || "",
        fileType: doc.fileType,
      });
      // Mark the document as waiting again so it is not re-queued on every
      // sweep while its job sits in the queue: a re-queued abandoned claim
      // goes back to `pending`, and updatedAt restarts the pending window.
      // The filter includes the claim time it was selected with, so a worker
      // that claimed the document in the meantime is never overwritten.
      await Document.updateOne(
        doc.embeddingStatus === "indexing"
          ? { _id: doc._id, embeddingStatus: "indexing", indexingStartedAt: doc.indexingStartedAt }
          : { _id: doc._id, embeddingStatus: doc.embeddingStatus },
        doc.embeddingStatus === "indexing"
          ? { $set: { embeddingStatus: "pending", indexingStartedAt: null, updatedAt: now } }
          : { $set: { updatedAt: now } },
        { timestamps: false }
      );
      summary.requeued++;
    } catch (error) {
      summary.errors++;
      console.error(
        `[document-service] Could not re-queue document ${doc._id}:`,
        (error as Error)?.message
      );
    }
  }

  if (summary.requeued || summary.exhausted || summary.deletionsFinished || summary.errors) {
    console.log("[document-service] Embedding recovery sweep:", summary);
  }
  return summary;
};
