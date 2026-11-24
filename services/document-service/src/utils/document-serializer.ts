import { hasStoredFile, type StorageRecord } from "../services/file-storage";

/**
 * Storage fields that must never reach a client (SEC-005): a delivery URL
 * would let anyone with the link read the file without a membership check,
 * and the public id names the asset in the storage account.
 */
const STORAGE_FIELDS = [
  "cloudinaryUrl",
  "cloudinaryPublicId",
  "cloudinaryResourceType",
  "cloudinaryDeliveryType",
  "cloudinaryFormat",
] as const;

type Serializable = { toObject?: () => Record<string, unknown> } & Record<string, unknown>;

/**
 * Failure reasons ResearchMind writes itself (RT-007). Any other stored
 * `embeddingError` -- e.g. a raw provider message written by an older worker,
 * which can contain key identifiers or internal hosts -- is returned as
 * "Indexing failed". Stored data is not modified; it is masked when read.
 */
const CANONICAL_FAILURE_REASONS = [
  /^No extractable text$/,
  /^Document contains no usable text$/,
  /^Indexing failed$/,
  /^Indexing timed out$/,
  /^Indexing failed after \d+ attempts$/,
  /^Could not queue the document for indexing$/,
  /^Embedding job did not match the document's workspace$/,
];

export const clientFailureReason = (reason: unknown): string | null => {
  if (reason === null || reason === undefined || reason === "") return (reason as null) ?? null;
  const text = String(reason);
  return CANONICAL_FAILURE_REASONS.some((pattern) => pattern.test(text)) ? text : "Indexing failed";
};

/**
 * Client view of a document record (a Mongoose document or a plain object):
 * everything except the storage location, plus `hasFile` (whether
 * GET /api/documents/:id/file can deliver a file). `embeddingError` is
 * reduced to a canonical reason (RT-007).
 */
export const toClientDocument = (input: unknown) => {
  if (!input) return input;
  const document = input as Serializable;
  const plain: Record<string, unknown> =
    typeof document.toObject === "function" ? document.toObject() : { ...document };
  const hasFile = hasStoredFile(plain as unknown as StorageRecord);
  for (const field of STORAGE_FIELDS) delete plain[field];
  if ("embeddingError" in plain) plain.embeddingError = clientFailureReason(plain.embeddingError);
  return { ...plain, hasFile };
};

export const toClientDocuments = (documents: unknown[]) => documents.map(toClientDocument);
