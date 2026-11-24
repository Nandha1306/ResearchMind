import crypto from "node:crypto";
import zlib from "node:zlib";
import JSZip from "jszip";

/**
 * DOCX fixtures generated in-test (no binaries in the repository), including
 * the decompression bombs of SEC-002. Every bomb is checked by the caller to
 * be what it claims (small on disk, large when expanded), so a test cannot
 * pass vacuously.
 */

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const RELS =
  '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
const HEAD =
  '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';
const TAIL = "</w:body></w:document>";

/** A DOCX whose word/document.xml is exactly `documentXml` (no wrapping). */
export const rawDocumentDocx = async (documentXml: string) => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file("word/document.xml", documentXml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
};

/** document.xml with a DTD declaring an internal entity that the body uses. */
export const DTD_ENTITY_DOCUMENT =
  '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE w:document [<!ENTITY e "expanded">]>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&e;</w:t></w:r></w:p></w:body></w:document>';

export const paragraph =(text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** Build a DOCX from the body XML; `extra` adds more archive entries. */
export const makeDocx = async (bodyXml: string, extra: Record<string, string> = {}) => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file("word/document.xml", HEAD + bodyXml + TAIL);
  for (const [name, content] of Object.entries(extra)) zip.file(name, content);
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  return { buffer, documentXmlLength: HEAD.length + bodyXml.length + TAIL.length };
};

/** (a) The audit's bomb: ~19 KB on disk, 180,000 paragraphs / >6 MB of XML. */
export const paragraphBomb = (paragraphs = 180_000) =>
  makeDocx("<w:p><w:r><w:t>a</w:t></w:r></w:p>".repeat(paragraphs));

/** (b) One huge run of spaces: tens of MB expanding from tens of KB. */
export const spaceBomb = (bytes = 55 * 1024 * 1024) => makeDocx(paragraph(" ".repeat(bytes)));

/** (c) Many tiny entries. */
export const manyEntries = async (count: number) => {
  const extra: Record<string, string> = {};
  for (let i = 0; i < count; i++) extra[`customXml/item${i}.xml`] = "<a/>";
  return makeDocx(paragraph("many entries"), extra);
};

const WORDS = "research method result data model analysis paper study evidence figure table theory sample error value".split(" ");

/** (g) A legitimate large document: `paragraphs` paragraphs of ~200 characters of varied text. */
export const largeLegitDocx = (paragraphs = 5000) => {
  const parts: string[] = [];
  for (let i = 0; i < paragraphs; i++) {
    let text = `${i}.`;
    while (text.length < 200) text += ` ${WORDS[crypto.randomInt(WORDS.length)]}${crypto.randomInt(1000)}`;
    parts.push(paragraph(text));
  }
  return makeDocx(parts.join(""));
};

/* ---- hand-built archives for parser-differential cases ------------------ */

type RawEntry = { name: string; data: Buffer; method: 0 | 8; crc: number; usize: number };

const storedEntry = (name: string, text: string): RawEntry => {
  const data = Buffer.from(text, "utf8");
  return { name, data, method: 0, crc: zlib.crc32(data), usize: data.length };
};

/** Deflate `head + unit×total + tail` as a stream (never materialised). */
const deflatedRun = (name: string, head: string, unit: string, totalBytes: number, tail: string) =>
  new Promise<RawEntry>((resolve, reject) => {
    const chunk = Buffer.alloc(1024 * 1024, unit);
    const out: Buffer[] = [];
    const deflate = zlib.createDeflateRaw({ level: 9 });
    let crc = zlib.crc32(head);
    deflate.on("data", (c: Buffer) => out.push(c));
    deflate.on("error", reject);
    deflate.on("end", () =>
      resolve({ name, data: Buffer.concat(out), method: 8, crc, usize: head.length + totalBytes + tail.length })
    );
    deflate.write(head);
    let written = 0;
    const pump = () => {
      while (written < totalBytes) {
        const n = Math.min(chunk.length, totalBytes - written);
        const piece = n === chunk.length ? chunk : chunk.subarray(0, n);
        crc = zlib.crc32(piece, crc);
        written += n;
        if (!deflate.write(piece)) {
          deflate.once("drain", pump);
          return;
        }
      }
      crc = zlib.crc32(tail, crc);
      deflate.end(tail);
    };
    pump();
  });

/** Serialise entries; local headers start at absolute offset `base`. */
const serialise = (entries: RawEntry[], base: number) => {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = base;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.method, 8);
    local.writeUInt32LE(e.crc >>> 0, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.usize, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.method, 10);
    central.writeUInt32LE(e.crc >>> 0, 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.usize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, e.data);
    directory.push(central, name);
    offset += 30 + name.length + e.data.length;
  }
  return { locals: Buffer.concat(locals), directory: Buffer.concat(directory), count: entries.length };
};

const endRecord = (count: number, directorySize: number, directoryOffset: number, commentLength: number) => {
  const b = Buffer.alloc(22);
  b.writeUInt32LE(0x06054b50, 0);
  b.writeUInt16LE(count, 8);
  b.writeUInt16LE(count, 10);
  b.writeUInt32LE(directorySize, 12);
  b.writeUInt32LE(directoryOffset, 16);
  b.writeUInt16LE(commentLength, 20);
  return b;
};

const RUN_HEAD = `${HEAD}<w:p><w:r><w:t>`;
const RUN_TAIL = `</w:t></w:r></w:p>${TAIL}`;
const innocentParts = () => [
  storedEntry("[Content_Types].xml", CONTENT_TYPES),
  storedEntry("_rels/.rels", RELS),
  storedEntry("word/document.xml", `${RUN_HEAD}Innocent text${RUN_TAIL}`),
];

/**
 * The Wave 2 review's bypass (about 410 KB with the default 400 MB): archive
 * A is a tiny valid DOCX; archive B's data hides between A's entries and B's
 * central directory + EOCD sit in A's ZIP comment, followed by one trailing
 * byte. A reader that takes the EOCD whose comment ends the file sees A; a
 * reader that takes the LAST EOCD signature (JSZip, used by mammoth) sees B,
 * whose word/document.xml is one run of `hiddenBytes` characters.
 */
export const hiddenArchiveDocx = async (hiddenBytes = 400 * 1024 * 1024) => {
  const hiddenDocument = await deflatedRun("word/document.xml", RUN_HEAD, "a", hiddenBytes, RUN_TAIL);
  const a = serialise(innocentParts(), 0);
  const b = serialise(
    [storedEntry("[Content_Types].xml", CONTENT_TYPES), storedEntry("_rels/.rels", RELS), hiddenDocument],
    a.locals.length
  );
  const aDirectoryOffset = a.locals.length + b.locals.length;
  const bDirectoryOffset = aDirectoryOffset + a.directory.length + 22;
  const comment = Buffer.concat([b.directory, endRecord(b.count, b.directory.length, bDirectoryOffset, 0), Buffer.from([0])]);
  return Buffer.concat([
    a.locals,
    b.locals,
    a.directory,
    endRecord(a.count, a.directory.length, aDirectoryOffset, comment.length),
    comment,
  ]);
};

/** Variant: a whole bomb archive (`inner`) stored in a small valid archive's comment. */
export const commentArchiveDocx = (inner: Buffer) => {
  const a = serialise(innocentParts(), 0);
  return Buffer.concat([a.locals, a.directory, endRecord(a.count, a.directory.length, a.locals.length, inner.length), inner]);
};

/** A small valid archive with `appended` bytes after its EOCD (concatenation or trailing data). */
export const appendAfterArchive = (archive: Buffer, appended: Buffer) => Buffer.concat([archive, appended]);

/** A valid archive whose entries are separated by `gap` unreferenced bytes (offsets kept consistent). */
export const gapBetweenEntriesDocx = (gap: Buffer) => {
  const parts = innocentParts();
  const first = serialise([parts[0]], 0);
  const rest = serialise(parts.slice(1), first.locals.length + gap.length);
  const directory = Buffer.concat([first.directory, rest.directory]);
  const directoryOffset = first.locals.length + gap.length + rest.locals.length;
  return Buffer.concat([first.locals, gap, rest.locals, directory, endRecord(parts.length, directory.length, directoryOffset, 0)]);
};

/**
 * A CANONICAL archive whose word/document.xml is one run of `bytes`
 * characters (passes the layout checks; only the size limits stop it).
 */
export const hugeRunDocx = async (bytes: number) => {
  const parts = [
    storedEntry("[Content_Types].xml", CONTENT_TYPES),
    storedEntry("_rels/.rels", RELS),
    await deflatedRun("word/document.xml", RUN_HEAD, "a", bytes, RUN_TAIL),
  ];
  const a = serialise(parts, 0);
  return Buffer.concat([a.locals, a.directory, endRecord(a.count, a.directory.length, a.locals.length, 0)]);
};

/** The plain innocent archive A on its own (hand-built, canonical). */
export const innocentDocx = () => {
  const a = serialise(innocentParts(), 0);
  return Buffer.concat([a.locals, a.directory, endRecord(a.count, a.directory.length, a.locals.length, 0)]);
};

/**
 * (d) Rewrite the DECLARED uncompressed size of `name` (central directory and
 * local header) without changing the data: a lying archive.
 */
export const forgeDeclaredSize = (input: Buffer, name: string, declared: number) => {
  const buf = Buffer.from(input);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const nameLength = buf.readUInt16LE(p + 28);
    const entryName = buf.toString("utf8", p + 46, p + 46 + nameLength);
    if (entryName === name) {
      buf.writeUInt32LE(declared, p + 24);
      buf.writeUInt32LE(declared, buf.readUInt32LE(p + 42) + 22);
      return buf;
    }
    p += 46 + nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  throw new Error(`entry ${name} not found`);
};
