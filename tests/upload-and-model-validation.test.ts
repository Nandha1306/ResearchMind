import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, describe, before, after } from "node:test";
import { setTestSecrets, listen } from "./helpers/test-env";
import express from "express";
import { matchesDocumentSignature, assertFileMatchesType } from "../services/document-service/src/utils/file-signature";
import { AppError } from "../packages/shared/errors/AppError";

/*
 * UNIT: upload content validation (A10), embedding/index configuration (A09)
 * and the ai-service internal vector-delete route's guards (A06/A07).
 */

setTestSecrets();
process.env.VOYAGE_API_KEY ||= "test-voyage-key";
process.env.PINECONE_API_KEY ||= "test-pinecone-key";
process.env.PINECONE_INDEX ||= "test-index";
process.env.XAI_API_KEY ||= "gsk_test_key_for_unit_tests";

describe("A10: file signature checks (document-service/src/utils/file-signature.ts)", () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "rm-sig-"));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("recognises PDF and ZIP (DOCX) headers", () => {
    assert.ok(matchesDocumentSignature(Buffer.from("%PDF-1.7\n..."), "pdf"));
    // SEC-020 (Wave 5, R3): this assertion was FLIPPED. Junk before "%PDF-" used
    // to be accepted (header search anywhere in the first 1 KB), which let an
    // HTML/PDF polyglot through; now only an optional UTF-8 BOM and/or ASCII
    // whitespace may precede the header.
    assert.ok(!matchesDocumentSignature(Buffer.concat([Buffer.from("junk before header "), Buffer.from("%PDF-1.4")]), "pdf"));
    assert.ok(matchesDocumentSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]), "docx"));
  });

  test("SEC-020: an HTML-then-%PDF polyglot is refused; a BOM- or whitespace-prefixed PDF is accepted", async () => {
    const polyglot = Buffer.from("<html><script>alert(1)</script></html>\n%PDF-1.4\n1 0 obj\n");
    assert.ok(!matchesDocumentSignature(polyglot, "pdf"));
    assert.ok(!matchesDocumentSignature(Buffer.from("text\n%PDF-1.4"), "pdf"));
    assert.ok(matchesDocumentSignature(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("%PDF-1.7")]), "pdf"));
    assert.ok(matchesDocumentSignature(Buffer.from("\r\n \t%PDF-1.5"), "pdf"));
    assert.ok(matchesDocumentSignature(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("\n  %PDF-1.6")]), "pdf"));
    // Whitespace must end before the 1024-byte window.
    assert.ok(!matchesDocumentSignature(Buffer.concat([Buffer.alloc(1100, 0x20), Buffer.from("%PDF-1.4")]), "pdf"));
    const file = path.join(dir, "polyglot.pdf");
    await fs.writeFile(file, polyglot);
    await assert.rejects(assertFileMatchesType(file, "pdf"), (e: any) => e instanceof AppError && e.statusCode === 415);
  });

  test("rejects mismatched content", () => {
    assert.ok(!matchesDocumentSignature(Buffer.from("MZ\x90\x00 executable"), "pdf"));
    assert.ok(!matchesDocumentSignature(Buffer.from("%PDF-1.7"), "docx"));
    assert.ok(!matchesDocumentSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04]), "pdf"));
  });

  test("an empty file is a 422, wrong content a 415, a valid header passes", async () => {
    const write = async (name: string, data: Buffer | string) => {
      const file = path.join(dir, name);
      await fs.writeFile(file, data);
      return file;
    };
    await assert.rejects(assertFileMatchesType(await write("e.pdf", Buffer.alloc(0)), "pdf"), (e: any) => e instanceof AppError && e.statusCode === 422);
    await assert.rejects(assertFileMatchesType(await write("x.pdf", "not a pdf"), "pdf"), (e: any) => e instanceof AppError && e.statusCode === 415);
    await assertFileMatchesType(await write("ok.pdf", "%PDF-1.4 rest"), "pdf");
  });
});

describe("A09: embedding configuration and index compatibility", () => {
  let resolveEmbeddingConfig: typeof import("../services/ai-service/src/config/voyage").resolveEmbeddingConfig;
  let DEFAULT_VOYAGE_MODEL: string;
  let checkIndexCompatibility: typeof import("../services/ai-service/src/utils/verify-pinecone").checkIndexCompatibility;

  before(async () => {
    ({ resolveEmbeddingConfig, DEFAULT_VOYAGE_MODEL } = await import("../services/ai-service/src/config/voyage"));
    ({ checkIndexCompatibility } = await import("../services/ai-service/src/utils/verify-pinecone"));
  });

  test("explicit configuration is used as-is", () => {
    assert.deepStrictEqual(
      resolveEmbeddingConfig({ VOYAGE_MODEL: "voyage-3", VOYAGE_EMBEDDING_DIMENSION: "1024" }),
      { model: "voyage-3", dimension: 1024, modelIsDefault: false }
    );
  });

  test("a missing model falls back to the pinned default and is flagged as such", () => {
    const config = resolveEmbeddingConfig({});
    assert.strictEqual(config.model, DEFAULT_VOYAGE_MODEL);
    assert.strictEqual(config.modelIsDefault, true);
    assert.strictEqual(config.dimension, 1024);
  });

  test("an invalid dimension is rejected with an actionable message", () => {
    for (const bad of ["abc", "0", "-5", "1.5", "99999"]) {
      assert.throws(() => resolveEmbeddingConfig({ VOYAGE_EMBEDDING_DIMENSION: bad }), /VOYAGE_EMBEDDING_DIMENSION/);
    }
  });

  test("index dimension must match the configured embedding dimension", () => {
    const indexes = [{ name: "researchmind", dimension: 1024, metric: "cosine" }];
    assert.ok(checkIndexCompatibility(indexes, "researchmind", 1024).ok);

    const mismatch = checkIndexCompatibility(indexes, "researchmind", 512);
    assert.ok(!mismatch.ok && /dimension 1024/.test(mismatch.reason));

    const missing = checkIndexCompatibility(indexes, "other-index", 1024);
    assert.ok(!missing.ok && /not found/.test(missing.reason));
  });

  /*
   * RT-006: a rejected Pinecone key at startup is fatal (the server and the
   * worker exit through their existing catch); an unreachable Pinecone stays
   * "unverified" so a transient outage does not keep the service down.
   */
  describe("RT-006: startup check distinguishes a rejected key from an outage", () => {
    let pinecone: any;
    let originalListIndexes: any;
    let validate: typeof import("../services/ai-service/src/utils/verify-pinecone").validateVectorIndexAtStartup;
    let indexName: string;
    let dimension: number;

    before(async () => {
      ({ pinecone, PINECONE_INDEX_NAME: indexName } = await import("../services/ai-service/src/config/pinecone"));
      ({ VOYAGE_EMBEDDING_DIMENSION: dimension } = await import("../services/ai-service/src/config/voyage"));
      ({ validateVectorIndexAtStartup: validate } = await import("../services/ai-service/src/utils/verify-pinecone"));
      originalListIndexes = pinecone.listIndexes;
    });
    after(() => {
      pinecone.listIndexes = originalListIndexes;
    });

    test("a 401 (PineconeAuthorizationError) rejects with a clear message naming PINECONE_API_KEY, without the key", async (t) => {
      t.mock.method(console, "warn", () => {});
      const { Errors } = await import("@pinecone-database/pinecone");
      pinecone.listIndexes = async () => {
        throw Errors.mapHttpStatusError({ status: 401, url: "https://api.pinecone.io/indexes" } as any);
      };
      await assert.rejects(validate(), (error: Error) => {
        assert.match(error.message, /Pinecone rejected PINECONE_API_KEY/);
        assert.ok(!error.message.includes(process.env.PINECONE_API_KEY!), "the key value is in the message");
        return true;
      });
    });

    test("a network error stays 'unverified'", async (t) => {
      t.mock.method(console, "warn", () => {});
      pinecone.listIndexes = async () => {
        throw new TypeError("fetch failed");
      };
      assert.strictEqual(await validate(), "unverified");
    });

    test("a matching index is 'verified'", async (t) => {
      t.mock.method(console, "log", () => {});
      pinecone.listIndexes = async () => ({ indexes: [{ name: indexName, dimension, metric: "cosine" }] });
      assert.strictEqual(await validate(), "verified");
    });
  });
});

describe("A06/A07: ai-service internal vector-delete route guards", () => {
  let server: { url: string; close: () => Promise<void> };

  before(async () => {
    const { default: internalRoutes } = await import("../services/ai-service/src/routes/internal.routes");
    const { errorMiddleware } = await import("../packages/shared/errors/error.middleware");
    const app = express();
    app.use("/internal", internalRoutes);
    app.use(errorMiddleware);
    server = await listen(app);
  });

  after(async () => {
    await server?.close();
  });

  const del = (urlPath: string, token?: string) =>
    fetch(`${server.url}${urlPath}`, { method: "DELETE", headers: token ? { "x-internal-token": token } : {} });

  test("requires the internal service token", async () => {
    const res = await del("/internal/vectors/workspaces/665f1c2b9d3e4a0087654321/documents/665f1c2b9d3e4a0012345678");
    assert.strictEqual(res.status, 401);
    const wrong = await del("/internal/vectors/workspaces/665f1c2b9d3e4a0087654321/documents/665f1c2b9d3e4a0012345678", "wrong-token");
    assert.strictEqual(wrong.status, 401);
  });

  test("rejects ids that are not ObjectIds before touching the vector store", async () => {
    const token = process.env.INTERNAL_SERVICE_TOKEN!;
    for (const p of [
      "/internal/vectors/workspaces/not-an-id/documents/665f1c2b9d3e4a0012345678",
      "/internal/vectors/workspaces/665f1c2b9d3e4a0087654321/documents/..%2F..%2Fother",
    ]) {
      assert.strictEqual((await del(p, token)).status, 400, p);
    }
  });
});
