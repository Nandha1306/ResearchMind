import zlib from "node:zlib";

/*
 * Minimal, valid PDF files built in memory (Wave 6, SEC-002-PDF tests).
 * Each page has one content stream; streams can be Flate-compressed. The
 * cross-reference table carries exact byte offsets, so pdf.js parses the
 * files without falling back to its repair path.
 */

export interface PdfPageSpec {
  /** Raw content-stream operators, e.g. "BT /F1 12 Tf 72 720 Td (Hi) Tj ET". */
  content: string | Buffer;
  compress?: boolean;
  /** `content` is already Flate-compressed (written as is, with /FlateDecode). */
  deflated?: boolean;
  /** Explicit /Filter value written as is (content is already encoded), e.g. "[/ASCIIHexDecode /FlateDecode]". */
  filter?: string;
}

export const makePdf = (pages: PdfPageSpec[]): Buffer => {
  const objects: Buffer[] = [];
  const pageCount = pages.length;
  // 1 catalog, 2 pages, 3 font, then (page, content) pairs
  const pageObjNumber = (i: number) => 4 + i * 2;
  const contentObjNumber = (i: number) => 5 + i * 2;

  objects[1] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>");
  objects[2] = Buffer.from(
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObjNumber(i)} 0 R`).join(" ")}] /Count ${pageCount} >>`
  );
  objects[3] = Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((page, i) => {
    objects[pageObjNumber(i)] = Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjNumber(i)} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`
    );
    const raw = Buffer.isBuffer(page.content) ? page.content : Buffer.from(page.content, "latin1");
    const data = page.compress && !page.deflated && !page.filter ? zlib.deflateSync(raw, { level: 9 }) : raw;
    const filter = page.filter ?? (page.compress || page.deflated ? "/FlateDecode" : "");
    objects[contentObjNumber(i)] = Buffer.concat([
      Buffer.from(`<< /Length ${data.length}${filter ? ` /Filter ${filter}` : ""} >>\nstream\n`),
      data,
      Buffer.from("\nendstream"),
    ]);
  });

  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  let offset = parts[0].length;
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = offset;
    const chunk = Buffer.concat([Buffer.from(`${n} 0 obj\n`), objects[n], Buffer.from("\nendobj\n")]);
    parts.push(chunk);
    offset += chunk.length;
  }
  const xref = [
    "xref",
    `0 ${objects.length}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length} /Root 1 0 R >>`,
    "startxref",
    String(offset),
    "%%EOF",
    "",
  ].join("\n");
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
};

const escapePdfText = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`);

/** A page showing each line with Tj (Helvetica 12 pt). */
export const textPage = (lines: string[], compress = false): PdfPageSpec => ({
  content: `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l) => `(${escapePdfText(l)}) Tj T*`).join(" ")} ET`,
  compress,
});

/** An ordinary multi-page document (legitimate input). */
export const legitPdf = (pages = 3, linesPerPage = 20): Buffer =>
  makePdf(
    Array.from({ length: pages }, (_, p) =>
      textPage(Array.from({ length: linesPerPage }, (_, l) => `Page ${p + 1} line ${l + 1}: research notes and results.`))
    )
  );

/**
 * A compressed content-stream bomb: a few hundred kilobytes on disk that
 * inflate to `operators` show-text operators on one page. pdf.js has to
 * inflate and interpret all of them.
 */
export const contentStreamBomb = async (operators = 4_000_000): Promise<{ buffer: Buffer; inflatedBytes: number }> => {
  // Compressed chunk by chunk: the inflated stream (16 bytes per operator) is
  // never held in memory, so building a large bomb cannot strain the test
  // process (24 million operators would otherwise be a ~384 MB string).
  const unit = Buffer.from("(xxxxxxxxxx) Tj ", "latin1");
  const perChunk = 65_536;
  const head = Buffer.from("BT /F1 1 Tf 0 0 Td ", "latin1");
  const tail = Buffer.from("ET", "latin1");
  const chunk = Buffer.concat(Array.from({ length: perChunk }, () => unit));
  async function* source() {
    yield head;
    for (let left = operators; left > 0; left -= perChunk) {
      yield left >= perChunk ? chunk : chunk.subarray(0, left * unit.length);
    }
    yield tail;
  }
  const inflatedBytes = head.length + operators * unit.length + tail.length;
  return { buffer: makePdf([{ content: await deflateStream(source()), deflated: true }]), inflatedBytes };
};

/** zlib-deflate an async sequence of chunks without holding the input in memory. */
const deflateStream = async (source: AsyncIterable<Buffer>): Promise<Buffer> => {
  const parts: Buffer[] = [];
  const deflate = zlib.createDeflate({ level: 9 });
  deflate.on("data", (part: Buffer) => parts.push(part));
  const done = new Promise<void>((resolve, reject) => {
    deflate.once("end", resolve);
    deflate.once("error", reject);
  });
  for await (const piece of source) {
    if (!deflate.write(piece)) await new Promise((resolve) => deflate.once("drain", resolve));
  }
  deflate.end();
  await done;
  return Buffer.concat(parts);
};

/** ASCII85 (Adobe) encoding with the "~>" end marker. */
const ascii85 = (input: Buffer): Buffer => {
  const out = Buffer.alloc(Math.ceil(input.length / 4) * 5 + 2);
  let o = 0;
  for (let i = 0; i < input.length; i += 4) {
    const n = Math.min(4, input.length - i);
    let value = 0;
    for (let k = 0; k < 4; k++) value = value * 256 + (k < n ? input[i + k] : 0);
    if (value === 0 && n === 4) {
      out[o++] = 0x7a; // "z"
      continue;
    }
    const digits = [0, 0, 0, 0, 0];
    for (let d = 4; d >= 0; d--) {
      digits[d] = value % 85;
      value = Math.floor(value / 85);
    }
    for (let d = 0; d < n + 1; d++) out[o++] = digits[d] + 33;
  }
  out[o++] = 0x7e; // "~"
  out[o++] = 0x3e; // ">"
  return out.subarray(0, o);
};

/**
 * Stage E round 2 (W6-R5-09): a filter-chain bomb. The payload (spaces) is
 * ASCII85-encoded `layers` times and then deflated, and the stream declares
 * [/FlateDecode /ASCII85Decode ×layers]. pdf.js keeps every stage's buffer;
 * each stays under the per-allocation cap, but together they exceed it.
 */
export const filterChainBomb = (payloadBytes: number, layers: number): Buffer => {
  let data: Buffer = Buffer.alloc(payloadBytes, 0x20);
  for (let i = 0; i < layers; i++) data = ascii85(data);
  const deflated = zlib.deflateSync(data, { level: 9 });
  return makePdf([{ content: deflated, filter: `[/FlateDecode${" /ASCII85Decode".repeat(layers)}]` }]);
};

/**
 * Wave 6 Stage E (W6-R5-01): a decoded-size bomb. One content stream that
 * inflates to `decodedBytes` of spaces (pdf.js has to decode it into one
 * growing buffer; the parse itself is cheap). `asciiHex` wraps the deflated
 * data in an /ASCIIHexDecode stage ([/ASCIIHexDecode /FlateDecode]), so a
 * check that only looks at plain /FlateDecode streams would miss it.
 */
export const decodedSizeBomb = async (decodedBytes: number, options: { asciiHex?: boolean } = {}): Promise<{ buffer: Buffer; decodedBytes: number }> => {
  const chunk = Buffer.alloc(1 << 20, 0x20);
  async function* source() {
    for (let left = decodedBytes; left > 0; left -= chunk.length) yield left >= chunk.length ? chunk : chunk.subarray(0, left);
  }
  const deflated = await deflateStream(source());
  const page: PdfPageSpec = options.asciiHex
    ? { content: Buffer.from(`${deflated.toString("hex")}>`, "latin1"), filter: "[/ASCIIHexDecode /FlateDecode]" }
    : { content: deflated, deflated: true };
  return { buffer: makePdf([page]), decodedBytes };
};
