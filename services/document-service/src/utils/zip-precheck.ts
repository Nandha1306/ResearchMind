import { AppError } from "../../../../packages/shared/errors/AppError";

/**
 * Strict structural check of a DOCX (ZIP) archive BEFORE it is parsed (SEC-002).
 *
 * Reads the End-of-Central-Directory record, the central directory and every
 * local header of the uploaded bytes (no decompression), so a decompression
 * bomb -- for example a 19 KB file that expands to 6 MB of XML with 180,000
 * paragraphs -- is refused in milliseconds.
 *
 * Only a CANONICAL archive layout is accepted, so that no other ZIP reader
 * can see a different archive than this check does (parser differential):
 *  - the EOCD record is the last 22 bytes of the file: no archive comment,
 *    no trailing data, no second EOCD signature after it;
 *  - the central directory ends exactly where the EOCD starts, and it holds
 *    exactly the entries the EOCD announces;
 *  - the local entries (header + name + extra + data [+ data descriptor])
 *    tile the bytes from offset 0 up to the central directory with no gap,
 *    overlap or unreferenced byte, in central-directory order of offsets;
 *  - every local header agrees with its central-directory record (name,
 *    method, CRC and sizes).
 * Concatenated or nested archives, hidden data between entries, archives in
 * the comment and prepended data are therefore all rejected (422).
 *
 * The declared uncompressed sizes can still lie; the extraction process
 * (docx-extractor.ts) inflates every validated entry with an output cap equal
 * to its declared size and verifies the CRC, rebuilds a fresh archive from
 * those entries only, and parses that, under a heap and time limit.
 */

export type ZipEntry = {
  name: string;
  /** 0 = stored, 8 = deflate */
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  /** Offset of the entry's (compressed) data. */
  dataOffset: number;
};

export type DocxArchiveLimits = {
  /** Maximum number of entries in the archive. */
  maxEntries: number;
  /** Maximum sum of declared uncompressed sizes (bytes). */
  maxTotalUncompressedBytes: number;
  /** Maximum declared uncompressed size of word/document.xml (bytes). */
  maxDocumentXmlBytes: number;
  /** Maximum expansion ratio, per entry and overall... */
  maxCompressionRatio: number;
  /** ...applied once the (entry or total) uncompressed size exceeds this. */
  ratioCheckAboveBytes: number;
};

export const DEFAULT_DOCX_LIMITS: DocxArchiveLimits = {
  maxEntries: 1000,
  maxTotalUncompressedBytes: 50 * 1024 * 1024,
  maxDocumentXmlBytes: 20 * 1024 * 1024,
  maxCompressionRatio: 100,
  ratioCheckAboveBytes: 1024 * 1024,
};

export const UNREADABLE_DOCX_MESSAGE =
  "Could not read the DOCX file. It may be corrupted or not a valid Word document.";

const unreadable = () => new AppError(UNREADABLE_DOCX_MESSAGE, 422);
const tooLarge = (detail: string) =>
  new AppError(`The document is too large when expanded (${detail}).`, 413);

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const EOCD_SIZE = 22;
const FLAG_ENCRYPTED = 0x1;
const FLAG_DATA_DESCRIPTOR = 0x8;

const REQUIRED_PARTS = ["[Content_Types].xml", "word/document.xml"];

const EOCD_BYTES = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

type CentralRecord = Omit<ZipEntry, "dataOffset"> & { flags: number };

/**
 * Validate the archive against `limits` and the canonical layout above.
 * Returns the entries (in file order) for the extraction process.
 *
 * 422: not a ZIP, non-canonical or inconsistent layout, ZIP64, multi-disk,
 *      encryption, unsupported compression, duplicate names, missing
 *      [Content_Types].xml or word/document.xml.
 * 413: too many entries, too much declared uncompressed data, or an
 *      expansion ratio typical of a decompression bomb.
 */
export const inspectDocxArchive = (
  buf: Buffer,
  limits: DocxArchiveLimits = DEFAULT_DOCX_LIMITS
): ZipEntry[] => {
  if (buf.length < EOCD_SIZE) throw unreadable();

  // EOCD exactly at the end, without a comment, and the last EOCD signature
  // in the file (readers that search backwards for the signature agree).
  const eocd = buf.length - EOCD_SIZE;
  if (buf.readUInt32LE(eocd) !== EOCD_SIGNATURE || buf.readUInt16LE(eocd + 20) !== 0) {
    throw unreadable();
  }
  if (buf.lastIndexOf(EOCD_BYTES) !== eocd) throw unreadable();

  const diskNumber = buf.readUInt16LE(eocd + 4);
  const directoryDisk = buf.readUInt16LE(eocd + 6);
  const entriesOnDisk = buf.readUInt16LE(eocd + 8);
  const totalEntries = buf.readUInt16LE(eocd + 10);
  const directorySize = buf.readUInt32LE(eocd + 12);
  const directoryOffset = buf.readUInt32LE(eocd + 16);

  // ZIP64 or multi-disk archives: never produced by Word; refuse rather than parse.
  const zip64 =
    (eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIGNATURE) ||
    totalEntries === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff;
  if (zip64 || diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw unreadable();
  }

  if (totalEntries > limits.maxEntries) {
    throw tooLarge(`${totalEntries} archive entries; the limit is ${limits.maxEntries}`);
  }
  // The central directory ends exactly where the EOCD record starts.
  if (directoryOffset + directorySize !== eocd) throw unreadable();

  /* ---- central directory ---- */
  const records: CentralRecord[] = [];
  const names = new Set<string>();
  let totalUncompressed = 0;
  let totalCompressed = 0;
  let p = directoryOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== CENTRAL_HEADER_SIGNATURE) throw unreadable();
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc32 = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const next = p + 46 + nameLength + extraLength + commentLength;
    if (next > eocd) throw unreadable();
    const name = buf.toString("utf8", p + 46, p + 46 + nameLength);

    if (flags & FLAG_ENCRYPTED) throw unreadable();
    if (method !== 0 && method !== 8) throw unreadable();
    if (method === 0 && compressedSize !== uncompressedSize) throw unreadable();
    if (name.length === 0 || names.has(name)) throw unreadable();
    names.add(name);

    if (
      uncompressedSize > limits.ratioCheckAboveBytes &&
      uncompressedSize > Math.max(compressedSize, 1) * limits.maxCompressionRatio
    ) {
      throw tooLarge(`an entry expands more than ${limits.maxCompressionRatio}:1`);
    }
    if (name === "word/document.xml" && uncompressedSize > limits.maxDocumentXmlBytes) {
      throw tooLarge(`the main document part exceeds ${limits.maxDocumentXmlBytes} bytes`);
    }
    totalUncompressed += uncompressedSize;
    totalCompressed += compressedSize;
    if (totalUncompressed > limits.maxTotalUncompressedBytes) {
      throw tooLarge(`more than ${limits.maxTotalUncompressedBytes} bytes uncompressed`);
    }

    records.push({ name, method, flags, crc32, compressedSize, uncompressedSize, localHeaderOffset });
    p = next;
  }
  // Exactly the announced entries fill the directory.
  if (p !== eocd) throw unreadable();

  if (
    totalUncompressed > limits.ratioCheckAboveBytes &&
    totalUncompressed > Math.max(totalCompressed, 1) * limits.maxCompressionRatio
  ) {
    throw tooLarge(`the archive expands more than ${limits.maxCompressionRatio}:1`);
  }
  for (const part of REQUIRED_PARTS) {
    if (!names.has(part)) throw unreadable();
  }

  /* ---- local entries must tile [0, directoryOffset) exactly ---- */
  const ordered = [...records].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
  const entries: ZipEntry[] = [];
  let expected = 0;
  for (const record of ordered) {
    const local = record.localHeaderOffset;
    if (local !== expected || local + 30 > directoryOffset) throw unreadable();
    if (buf.readUInt32LE(local) !== LOCAL_HEADER_SIGNATURE) throw unreadable();
    const localFlags = buf.readUInt16LE(local + 6);
    const localMethod = buf.readUInt16LE(local + 8);
    const nameLength = buf.readUInt16LE(local + 26);
    const extraLength = buf.readUInt16LE(local + 28);
    const dataOffset = local + 30 + nameLength + extraLength;
    if (dataOffset > directoryOffset) throw unreadable();
    if (buf.toString("utf8", local + 30, local + 30 + nameLength) !== record.name) throw unreadable();
    if (localMethod !== record.method || (localFlags & FLAG_ENCRYPTED)) throw unreadable();

    let end = dataOffset + record.compressedSize;
    if (end > directoryOffset) throw unreadable();
    if (localFlags & FLAG_DATA_DESCRIPTOR) {
      // Sizes follow the data; the central directory's values are authoritative.
      const withSignature = end + 4 <= directoryOffset && buf.readUInt32LE(end) === DATA_DESCRIPTOR_SIGNATURE;
      const descriptor = withSignature ? end + 4 : end;
      if (descriptor + 12 > directoryOffset) throw unreadable();
      if (
        buf.readUInt32LE(descriptor) !== record.crc32 ||
        buf.readUInt32LE(descriptor + 4) !== record.compressedSize ||
        buf.readUInt32LE(descriptor + 8) !== record.uncompressedSize
      ) {
        throw unreadable();
      }
      end = descriptor + 12;
    } else if (
      buf.readUInt32LE(local + 14) !== record.crc32 ||
      buf.readUInt32LE(local + 18) !== record.compressedSize ||
      buf.readUInt32LE(local + 22) !== record.uncompressedSize
    ) {
      throw unreadable();
    }

    const { flags: _flags, ...entry } = record;
    entries.push({ ...entry, dataOffset });
    expected = end;
  }
  // No unreferenced bytes between the last entry and the central directory.
  if (expected !== directoryOffset) throw unreadable();

  return entries;
};
