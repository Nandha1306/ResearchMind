import crypto from "crypto";
import cloudinary from "../config/cloudinary";

/**
 * Document file storage on Cloudinary (SEC-005).
 *
 *  - New uploads are AUTHENTICATED assets (no public delivery URL works
 *    without a signature) with an unpredictable public id (random UUID, never
 *    derived from the file name or time), and are never overwritten.
 *  - Clients never receive a storage URL or public id. document-service
 *    builds a signed URL itself from the stored public id and streams the
 *    bytes after a membership check (controllers/document-file.controller.ts).
 *  - Legacy assets (public "upload" assets created before SEC-005) keep
 *    working: their stored delivery URL is used, but only if it is an https
 *    URL on res.cloudinary.com under the configured cloud name. No other URL
 *    is ever fetched (no SSRF), and redirects are refused.
 */

export const DOCUMENT_FOLDER = "researchmind/documents";
export const NEW_ASSET_DELIVERY_TYPE = "authenticated";
const DELIVERY_HOST = "res.cloudinary.com";

export type StorageResourceType = "image" | "raw";
export type DeliveryType = "upload" | "authenticated" | "private";

/** PDFs are stored as "image" assets (Cloudinary can render them), DOCX as "raw". */
export const resourceTypeFor = (fileType: string): StorageResourceType =>
  fileType === "pdf" ? "image" : "raw";

/** Unpredictable storage id: never derived from the file name or upload time. */
export const newStoragePublicId = () => crypto.randomUUID();

export type StoredAsset = {
  publicId: string;
  resourceType: StorageResourceType;
  deliveryType: DeliveryType;
  format: string | null;
};

/** Upload a document file as a private (authenticated) Cloudinary asset. */
export const uploadToCloudinary = async (
  filePath: string,
  fileType: "pdf" | "docx"
): Promise<StoredAsset> => {
  const resourceType = resourceTypeFor(fileType);
  const result = await cloudinary.uploader.upload(filePath, {
    resource_type: resourceType,
    folder: DOCUMENT_FOLDER,
    public_id: newStoragePublicId(),
    type: NEW_ASSET_DELIVERY_TYPE,
    overwrite: false,
    use_filename: false,
    unique_filename: false,
  });

  return {
    publicId: result.public_id,
    resourceType: (result.resource_type as StorageResourceType) || resourceType,
    deliveryType: (result.type as DeliveryType) || NEW_ASSET_DELIVERY_TYPE,
    format: result.format || (resourceType === "image" ? "pdf" : null),
  };
};

/** The storage fields of a document record (all optional on legacy records). */
export type StorageRecord = {
  fileType: string;
  cloudinaryUrl?: string | null;
  cloudinaryPublicId?: string | null;
  cloudinaryResourceType?: string | null;
  cloudinaryDeliveryType?: string | null;
  cloudinaryFormat?: string | null;
};

export const storedResourceType = (record: StorageRecord): StorageResourceType =>
  record.cloudinaryResourceType === "image" || record.cloudinaryResourceType === "raw"
    ? record.cloudinaryResourceType
    : resourceTypeFor(record.fileType);

/** Delivery type of the stored asset; records without one are legacy public uploads. */
export const storedDeliveryType = (record: StorageRecord): DeliveryType =>
  record.cloudinaryDeliveryType === "authenticated" || record.cloudinaryDeliveryType === "private"
    ? record.cloudinaryDeliveryType
    : "upload";

/** Does the record point at any stored file at all? */
export const hasStoredFile = (record: StorageRecord): boolean =>
  Boolean(record.cloudinaryPublicId || record.cloudinaryUrl);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Only a plain delivery URL of one of OUR documents:
 *
 *   https://res.cloudinary.com/<cloud>/(image|raw)/(upload|authenticated|private)/
 *     [s--<signature>--/][v<version>/]researchmind/documents/<id>[.<ext>]
 *
 * No other scheme, host, port or credentials; no other resource type; no
 * remote-fetch delivery types (`/image/fetch/`, `/youtube/`, ...); no
 * transformation segment at all (which also rules out `l_fetch:` overlays);
 * no other folder; no encoded separators or dot segments. Everything else is
 * refused without a request.
 */
export const isAllowedStorageUrl = (raw: string): boolean => {
  const cloudName = cloudinary.config().cloud_name;
  if (!cloudName || typeof raw !== "string") return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== DELIVERY_HOST ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return false;
  }
  const pattern = new RegExp(
    `^/${escapeRegExp(cloudName)}/(image|raw)/(upload|authenticated|private)/` +
      `(s--[A-Za-z0-9_-]{8}--/)?(v\\d+/)?${escapeRegExp(DOCUMENT_FOLDER)}/[^/]+$`
  );
  return pattern.test(url.pathname) && !/%2f|%5c|%2e%2e/i.test(url.pathname);
};

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

/**
 * The URL document-service fetches for a record, or null when the record has
 * no stored file. Throws StorageUnavailableError when the record's location
 * is not acceptable (never fetched).
 */
export const resolveStorageUrl = (record: StorageRecord): string | null => {
  if (!hasStoredFile(record)) return null;

  const deliveryType = storedDeliveryType(record);
  const resourceType = storedResourceType(record);
  let url: string;

  if (deliveryType !== "upload" && record.cloudinaryPublicId) {
    // Private asset: a signed delivery URL, built here and never sent out.
    const format = record.cloudinaryFormat || (resourceType === "image" ? "pdf" : undefined);
    url = cloudinary.url(record.cloudinaryPublicId, {
      resource_type: resourceType,
      type: deliveryType,
      sign_url: true,
      secure: true,
      ...(format ? { format } : {}),
    });
  } else if (record.cloudinaryUrl) {
    // Legacy public asset: the stored URL, only on the allowlisted host.
    url = record.cloudinaryUrl;
  } else {
    // Legacy record with an id but no stored URL.
    url = cloudinary.url(record.cloudinaryPublicId as string, {
      resource_type: resourceType,
      type: "upload",
      secure: true,
      ...(resourceType === "image" ? { format: "pdf" } : {}),
    });
  }

  if (!isAllowedStorageUrl(url)) {
    throw new StorageUnavailableError("stored file location is not an allowed storage URL");
  }
  return url;
};

/**
 * HTTP client for storage downloads. A property (not a direct `fetch` call)
 * so tests can replace it; production always uses the global fetch.
 */
export const storageHttp: { fetch: (url: string, init: RequestInit) => Promise<Response> } = {
  fetch: (url, init) => fetch(url, init),
};

/** Destroy options matching how the asset was stored (legacy: public upload). */
export const destroyOptionsFor = (record: StorageRecord) => ({
  resource_type: storedResourceType(record),
  type: storedDeliveryType(record),
  invalidate: true,
});
