import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, describe, before, after, beforeEach } from "node:test";
import { infraDescribe } from "./helpers/infra";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { setTestSecrets, listen } from "./helpers/test-env";
import { connectTestDatabase, mongoSkip } from "./helpers/test-mongo";
import { rawRequest, startGateway } from "./helpers/gateway";

/*
 * SEC-005: documents are private Cloudinary assets, delivered only by
 * streaming through document-service after a live membership check.
 *
 * REAL document-service app (routes, controllers, model) on a disposable
 * MongoDB, reached THROUGH the real api-gateway app. Stand-ins:
 *  - workspace membership: local HTTP stub;
 *  - Cloudinary uploader/destroy: replaced on the real SDK object (records
 *    the options it is called with); no request reaches Cloudinary;
 *  - storage download: `storageHttp.fetch` replaced by a recording stub, so
 *    the URL the service would fetch is asserted without any network call.
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599"; // closed port: enqueue fails (handled)
process.env.CLOUDINARY_CLOUD_NAME = "rmtestcloud";
process.env.CLOUDINARY_API_KEY = "111111111111111";
process.env.CLOUDINARY_API_SECRET = "test-secret-not-real";

const WS_A = new mongoose.Types.ObjectId().toString();
const WS_B = new mongoose.Types.ObjectId().toString();
const USER_A = new mongoose.Types.ObjectId().toString();
const USER_B = new mongoose.Types.ObjectId().toString();
const MEMBERS: Record<string, string[]> = { [WS_A]: [USER_A], [WS_B]: [USER_B] };
const tokenFor = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "10m" });

const PDF_BYTES = Buffer.from("%PDF-1.4\nstub pdf bytes for the stream test\n%%EOF\n", "latin1");

let workspaceStub: { url: string; close: () => Promise<void> };
let docApp: { url: string; close: () => Promise<void> };
let gateway: Awaited<ReturnType<typeof startGateway>>;
let db: { cleanup: () => Promise<void> } | undefined;
let Document: any;
let redis: any;
let storage: typeof import("../services/document-service/src/services/file-storage");
let tmpDir: string;

const uploadCalls: Record<string, any>[] = [];
const destroyCalls: { publicId: string; options: Record<string, any> }[] = [];
type FetchCall = { url: string; init: any };
const fetchCalls: FetchCall[] = [];
let fetchBehaviour: (call: FetchCall) => Promise<Response> = async () =>
  new Response(PDF_BYTES, { status: 200, headers: { "content-type": "image/pdf", "content-length": String(PDF_BYTES.length) } });

before(async () => {
  if (mongoSkip) return;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-doc-file-"));
  process.chdir(tmpDir);

  workspaceStub = await listen((req, res) => {
    const match = /^\/api\/workspaces\/([^/]+)\/membership$/.exec(req.url || "");
    let isMember = false;
    try {
      const token = String(req.headers.authorization || "").replace(/^Bearer /, "");
      const { userId } = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as { userId: string };
      isMember = Boolean(match && MEMBERS[match[1]]?.includes(userId));
    } catch {
      res.statusCode = 401;
      res.end(JSON.stringify({ success: false }));
      return;
    }
    res.setHeader("Content-Type", "application/json");
    // Each workspace here has a single member, who owns it (SEC-010).
    res.end(JSON.stringify({ success: true, data: { isMember, isOwner: isMember } }));
  });
  process.env.WORKSPACE_SERVICE_URL = workspaceStub.url;
  process.env.AI_SERVICE_URL = workspaceStub.url; // vector delete answers 404 -> handled per test

  db = await connectTestDatabase("docfile");
  const { default: cloudinary } = await import("../services/document-service/src/config/cloudinary");
  cloudinary.uploader.upload = (async (_file: string, options: Record<string, any>) => {
    uploadCalls.push(options);
    return {
      public_id: `${options.folder}/${options.public_id}`,
      resource_type: options.resource_type,
      type: options.type,
      format: options.resource_type === "image" ? "pdf" : undefined,
      secure_url: "https://res.cloudinary.com/rmtestcloud/should-never-reach-a-client",
    };
  }) as any;
  cloudinary.uploader.destroy = (async (publicId: string, options: Record<string, any>) => {
    destroyCalls.push({ publicId, options });
    return { result: "ok" };
  }) as any;

  storage = await import("../services/document-service/src/services/file-storage");
  storage.storageHttp.fetch = (async (url: string, init: any) => {
    const call = { url: String(url), init };
    fetchCalls.push(call);
    return fetchBehaviour(call);
  }) as any;

  ({ default: redis } = await import("../services/document-service/src/config/redis"));
  ({ Document } = await import("../services/document-service/src/models/Document"));
  await Document.init();
  const { default: documentApp } = await import("../services/document-service/src/app");
  docApp = await listen(documentApp);

  process.env.DOCUMENT_SERVICE_URL = docApp.url;
  gateway = await startGateway();
});

after(async () => {
  await gateway?.close();
  await docApp?.close();
  await workspaceStub?.close();
  redis?.disconnect();
  await db?.cleanup();
  if (tmpDir) {
    const { default: logger } = await import("../services/document-service/src/utils/logger");
    await new Promise<void>((resolve) => {
      logger.on("finish", () => resolve());
      logger.end();
      setTimeout(resolve, 1000);
    });
    process.chdir(os.tmpdir());
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      console.warn(`Could not remove temp dir ${tmpDir}: ${(error as Error).message}`);
    }
  }
});

beforeEach(() => {
  uploadCalls.length = 0;
  destroyCalls.length = 0;
  fetchCalls.length = 0;
  fetchBehaviour = async () =>
    new Response(PDF_BYTES, { status: 200, headers: { "content-length": String(PDF_BYTES.length) } });
});

/** Minimal valid single-page PDF. */
const minimalPdf = () => {
  const content = "BT /F1 12 Tf 72 720 Td (Hello private file) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
};

/** Upload through the GATEWAY (the browser's path). */
const uploadViaGateway = async (name: string, content: Buffer, user = USER_A, workspaceId = WS_A) => {
  const form = new FormData();
  form.append("workspaceId", workspaceId);
  form.append("file", new Blob([new Uint8Array(content)]), name);
  const res = await fetch(`${gateway.url}/api/documents/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(user)}` },
    body: form,
  });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
};

const getFile = (id: string, user?: string, signal?: AbortSignal) =>
  fetch(`${gateway.url}/api/documents/${id}/file`, {
    headers: user ? { Authorization: `Bearer ${tokenFor(user)}` } : {},
    signal,
  });

const STORAGE_FIELDS = /cloudinary|res\.cloudinary\.com|publicId|public_id|secure_url/i;

const insertDocument = async (fields: Record<string, unknown>) =>
  Document.create({
    workspaceId: WS_A,
    uploadedBy: USER_A,
    originalName: "legacy paper.pdf",
    fileType: "pdf",
    fileSize: 100,
    extractedText: "text",
    embeddingStatus: "indexed",
    ...fields,
  });

infraDescribe("SEC-005: private storage and authenticated streaming (real MongoDB, via the gateway)", mongoSkip, () => {
  test("a new upload is stored as an authenticated asset with a random public id; no storage detail reaches the client", async () => {
    const first = await uploadViaGateway("paper.pdf", minimalPdf());
    const second = await uploadViaGateway("paper.pdf", minimalPdf());
    assert.strictEqual(first.status, 201, first.text);
    assert.strictEqual(second.status, 201, second.text);

    assert.strictEqual(uploadCalls.length, 2);
    for (const options of uploadCalls) {
      assert.strictEqual(options.type, "authenticated");
      assert.strictEqual(options.overwrite, false);
      assert.strictEqual(options.resource_type, "image");
      assert.match(options.public_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.ok(!/paper|\d{13}/.test(options.public_id), "public id derived from the file name or a timestamp");
    }
    assert.notStrictEqual(uploadCalls[0].public_id, uploadCalls[1].public_id);

    for (const response of [first, second]) {
      assert.doesNotMatch(response.text, STORAGE_FIELDS, "storage details leaked in the upload response");
      assert.strictEqual(response.body.data.hasFile, true);
    }
    const stored = await Document.findById(first.body.data._id).lean();
    assert.strictEqual(stored.cloudinaryDeliveryType, "authenticated");
    assert.strictEqual(stored.cloudinaryPublicId, `researchmind/documents/${uploadCalls[0].public_id}`);
    assert.strictEqual(stored.cloudinaryUrl, null, "no delivery URL is stored for new assets");
  });

  test("list, get, re-index and delete responses carry no storage fields", async () => {
    const created = (await uploadViaGateway("notes.pdf", minimalPdf())).body.data;
    await insertDocument({
      cloudinaryUrl: "https://res.cloudinary.com/rmtestcloud/image/upload/v1/researchmind/documents/1700000000000-old.pdf",
      cloudinaryPublicId: "researchmind/documents/1700000000000-old",
      embeddingStatus: "failed",
    });
    const auth = { Authorization: `Bearer ${tokenFor(USER_A)}` };
    // Let the re-index enqueue succeed (Redis is a closed port in this file).
    const originalRpush = redis.rpush;
    redis.rpush = async () => 1;
    try {
      for (const [method, url] of [
        ["GET", `/api/documents/workspace/${WS_A}`],
        ["GET", `/api/documents/${created._id}`],
        ["POST", `/api/documents/${created._id}/reindex`],
      ] as const) {
        const res = await fetch(`${gateway.url}${url}`, { method, headers: auth });
        const text = await res.text();
        assert.strictEqual(res.status, 200, `${method} ${url}: ${res.status} ${text}`);
        assert.doesNotMatch(text, STORAGE_FIELDS, `${method} ${url} leaked storage details`);
      }
    } finally {
      redis.rpush = originalRpush;
    }
    const list = await (await fetch(`${gateway.url}/api/documents/workspace/${WS_A}`, { headers: auth })).json();
    assert.ok(list.data.length >= 2 && list.data.every((d: any) => d.hasFile === true));
  });

  test("a member streams the bytes: correct headers, a signed authenticated URL built server-side, no redirects followed", async () => {
    const { body } = await uploadViaGateway("Quarterly report (final).pdf", minimalPdf());
    const res = await getFile(body.data._id, USER_A);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(Buffer.from(await res.arrayBuffer()), PDF_BYTES);
    assert.strictEqual(res.headers.get("content-type"), "application/pdf");
    assert.strictEqual(res.headers.get("x-content-type-options"), "nosniff");
    assert.strictEqual(res.headers.get("cache-control"), "private, no-store");
    const disposition = res.headers.get("content-disposition") ?? "";
    assert.match(disposition, /^inline; filename="Quarterly report _final_\.pdf"; filename\*=UTF-8''/);

    assert.strictEqual(fetchCalls.length, 1);
    const fetched = new URL(fetchCalls[0].url);
    assert.strictEqual(fetched.protocol, "https:");
    assert.strictEqual(fetched.hostname, "res.cloudinary.com");
    assert.match(fetched.pathname, /^\/rmtestcloud\/image\/authenticated\/s--[A-Za-z0-9_-]{8}--\//);
    assert.strictEqual(fetchCalls[0].init.redirect, "error");
    assert.ok(fetchCalls[0].init.signal instanceof AbortSignal, "upstream request has an abort signal");
  });

  test("a DOCX is streamed as an attachment with the Word content type", async () => {
    const doc = await insertDocument({
      originalName: "draft.docx",
      fileType: "docx",
      cloudinaryPublicId: `researchmind/documents/${crypto.randomUUID()}`,
      cloudinaryDeliveryType: "authenticated",
      cloudinaryResourceType: "raw",
    });
    const res = await getFile(doc._id.toString(), USER_A);
    assert.strictEqual(res.status, 200);
    await res.arrayBuffer();
    assert.strictEqual(res.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.match(res.headers.get("content-disposition") ?? "", /^attachment; filename="draft\.docx"/);
    assert.match(new URL(fetchCalls[0].url).pathname, /^\/rmtestcloud\/raw\/authenticated\/s--/);
  });

  test("not authenticated -> 401, non-member -> 403, and storage is never contacted", async () => {
    const { body } = await uploadViaGateway("private.pdf", minimalPdf());
    fetchCalls.length = 0;
    assert.strictEqual((await getFile(body.data._id)).status, 401);
    const raw = await rawRequest(gateway.port, "GET", `/api/documents/${body.data._id}/file`, {
      headers: { Authorization: "Bearer not-a-jwt" },
    });
    assert.strictEqual(raw.status, 401);
    const nonMember = await getFile(body.data._id, USER_B);
    assert.strictEqual(nonMember.status, 403);
    assert.doesNotMatch(await nonMember.text(), STORAGE_FIELDS);
    assert.strictEqual(fetchCalls.length, 0);
  });

  test("deleted, unknown and malformed ids -> 404; a record without a stored file -> 404", async () => {
    const deleted = await insertDocument({
      cloudinaryPublicId: `researchmind/documents/${crypto.randomUUID()}`,
      cloudinaryDeliveryType: "authenticated",
      cloudinaryResourceType: "image",
      deletedAt: new Date(),
    });
    const metadataOnly = await insertDocument({ cloudinaryPublicId: null, cloudinaryUrl: null });
    for (const id of [deleted._id.toString(), new mongoose.Types.ObjectId().toString(), "not-an-id", metadataOnly._id.toString()]) {
      const res = await getFile(id, USER_A);
      assert.strictEqual(res.status, 404, id);
      await res.arrayBuffer();
    }
    assert.strictEqual(fetchCalls.length, 0);
  });

  test("a legacy public asset still opens through the same endpoint (stored URL on the allowlisted host)", async () => {
    const legacyUrl = "https://res.cloudinary.com/rmtestcloud/image/upload/v1700000000/researchmind/documents/1700000000000-legacy.pdf";
    const doc = await insertDocument({
      cloudinaryUrl: legacyUrl,
      cloudinaryPublicId: "researchmind/documents/1700000000000-legacy",
    });
    const res = await getFile(doc._id.toString(), USER_A);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(Buffer.from(await res.arrayBuffer()), PDF_BYTES);
    assert.strictEqual(fetchCalls[0].url, legacyUrl);
    assert.strictEqual(fetchCalls[0].init.redirect, "error");
    const stored = await Document.findById(doc._id).lean();
    assert.strictEqual(stored.cloudinaryUrl, legacyUrl, "legacy record is not altered");
  });

  test("a legacy URL outside the allowlist is never fetched (502, no URL in the response)", async () => {
    for (const forged of [
      "https://evil.example/researchmind/documents/x.pdf",
      "http://res.cloudinary.com/rmtestcloud/image/upload/v1/x.pdf",
      "https://res.cloudinary.com/othercloud/image/upload/v1/x.pdf",
      "https://res.cloudinary.com@evil.example/rmtestcloud/image/upload/v1/x.pdf",
      "https://res.cloudinary.com:8443/rmtestcloud/image/upload/v1/x.pdf",
      "javascript:alert(1)",
    ]) {
      const doc = await insertDocument({ cloudinaryUrl: forged, cloudinaryPublicId: null });
      const res = await getFile(doc._id.toString(), USER_A);
      const text = await res.text();
      assert.strictEqual(res.status, 502, forged);
      assert.ok(!text.includes("evil") && !text.includes("http"), `response leaks the URL: ${text}`);
    }
    assert.strictEqual(fetchCalls.length, 0);
  });

  test("upstream failures map to 502/503 without leaking URLs", async () => {
    const { body } = await uploadViaGateway("upstream.pdf", minimalPdf());
    fetchBehaviour = async () => new Response("not found", { status: 404 });
    let res = await getFile(body.data._id, USER_A);
    let text = await res.text();
    assert.strictEqual(res.status, 502);
    assert.doesNotMatch(text, /cloudinary|https?:/i);

    fetchBehaviour = async () => {
      throw new TypeError("fetch failed");
    };
    res = await getFile(body.data._id, USER_A);
    text = await res.text();
    assert.strictEqual(res.status, 503);
    assert.doesNotMatch(text, /cloudinary|https?:/i);
  });

  test("a client abort cancels the upstream download", async () => {
    const { body } = await uploadViaGateway("slow.pdf", minimalPdf());
    let cancelled = false;
    let upstreamSignal: AbortSignal | undefined;
    fetchBehaviour = async (call) => {
      upstreamSignal = call.init.signal;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(Buffer.from("%PDF-1.4 first chunk")));
          // ...and then nothing more: a slow or hung upstream.
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(stream, { status: 200 });
    };
    const controller = new AbortController();
    const res = await getFile(body.data._id, USER_A, controller.signal);
    assert.strictEqual(res.status, 200);
    const reader = res.body!.getReader();
    await reader.read(); // first chunk arrived
    controller.abort();
    const deadline = Date.now() + 5000;
    while (!(cancelled || upstreamSignal?.aborted) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(cancelled || upstreamSignal?.aborted, "upstream download kept running after the client left");
  });

  test("delete destroys the asset with its own delivery type (authenticated for new, upload for legacy)", async () => {
    // Vector removal must succeed for the delete to go ahead: answer 200.
    const vectorStub = await listen((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: true }));
    });
    const previousAi = process.env.AI_SERVICE_URL;
    process.env.AI_SERVICE_URL = vectorStub.url;
    try {
      const { body } = await uploadViaGateway("to-delete.pdf", minimalPdf());
      const legacy = await insertDocument({
        cloudinaryUrl: "https://res.cloudinary.com/rmtestcloud/raw/upload/v1/researchmind/documents/1700000000001-old",
        cloudinaryPublicId: `researchmind/documents/1700000000001-old-${crypto.randomBytes(3).toString("hex")}`,
        fileType: "docx",
        originalName: "old.docx",
      });
      const auth = { Authorization: `Bearer ${tokenFor(USER_A)}` };
      for (const id of [body.data._id, legacy._id.toString()]) {
        const res = await fetch(`${gateway.url}/api/documents/${id}`, { method: "DELETE", headers: auth });
        const text = await res.text();
        assert.strictEqual(res.status, 200, text);
        assert.doesNotMatch(text, STORAGE_FIELDS);
      }
      assert.deepStrictEqual(
        destroyCalls.map((c) => [c.options.type, c.options.resource_type]),
        [
          ["authenticated", "image"],
          ["upload", "raw"],
        ]
      );
    } finally {
      process.env.AI_SERVICE_URL = previousAi;
      await vectorStub.close();
    }
  });
});

infraDescribe("SEC-005: storage URL allowlist (unit)", mongoSkip, () => {
  test("only plain delivery URLs of our own documents on https://res.cloudinary.com/<cloud>/ are allowed", () => {
    const allowed = storage.isAllowedStorageUrl;
    for (const ok of [
      "https://res.cloudinary.com/rmtestcloud/image/upload/v1/researchmind/documents/1700000000000-a.pdf",
      "https://res.cloudinary.com/rmtestcloud/image/upload/researchmind/documents/1700000000000-a%20b.pdf",
      "https://res.cloudinary.com/rmtestcloud/raw/upload/v1700000000/researchmind/documents/1700000000000-a",
      "https://res.cloudinary.com/rmtestcloud/image/authenticated/s--AbCdEf12--/v1/researchmind/documents/0b7c6f1e-9a1d-4c2a-8f3e-1d2c3b4a5f6e.pdf",
      "https://res.cloudinary.com/rmtestcloud/raw/private/s--AbCdEf12--/v1/researchmind/documents/x",
    ]) {
      assert.ok(allowed(ok), ok);
    }
    for (const bad of [
      "https://res.cloudinary.com/rmtestcloud2/image/upload/v1/researchmind/documents/a.pdf",
      "https://res.cloudinary.com.evil.example/rmtestcloud/image/upload/v1/researchmind/documents/a.pdf",
      "https://user:pw@res.cloudinary.com/rmtestcloud/image/upload/v1/researchmind/documents/a.pdf",
      "ftp://res.cloudinary.com/rmtestcloud/image/upload/v1/researchmind/documents/a.pdf",
      "https://127.0.0.1/rmtestcloud/image/upload/v1/researchmind/documents/a.pdf",
      // L1: Cloudinary remote-fetch delivery and fetch inside transformations
      "https://res.cloudinary.com/rmtestcloud/image/fetch/http://169.254.169.254/latest/meta-data",
      "https://res.cloudinary.com/rmtestcloud/image/fetch/v1/researchmind/documents/a.pdf",
      "https://res.cloudinary.com/rmtestcloud/image/upload/l_fetch:aHR0cDovLzE2OS4yNTQuMTY5LjI1NA==/v1/researchmind/documents/a.pdf",
      "https://res.cloudinary.com/rmtestcloud/image/upload/w_100/researchmind/documents/a.pdf",
      "https://res.cloudinary.com/rmtestcloud/image/youtube/dQw4w9WgXcQ",
      "https://res.cloudinary.com/rmtestcloud/video/upload/v1/researchmind/documents/a.pdf",
      "https://res.cloudinary.com/rmtestcloud/image/upload/v1/othercloud/folder/a.pdf",
      "https://res.cloudinary.com/rmtestcloud/image/upload/v1/researchmind/documents/sub/a.pdf",
      "https://res.cloudinary.com/rmtestcloud/image/upload/v1/researchmind/documents/a%2F..%2Fb.pdf",
      "https://res.cloudinary.com/rmtestcloud/image/upload/v1/researchmind/documents/",
      "not a url",
      "",
    ]) {
      assert.strictEqual(allowed(bad), false, bad);
    }
  });

  test("a stored legacy URL using Cloudinary fetch is refused by the stream endpoint without any request", async () => {
    fetchCalls.length = 0;
    const doc = await insertDocument({
      cloudinaryUrl: "https://res.cloudinary.com/rmtestcloud/image/fetch/http://169.254.169.254/latest/meta-data",
      cloudinaryPublicId: null,
    });
    const res = await getFile(doc._id.toString(), USER_A);
    assert.strictEqual(res.status, 502);
    await res.arrayBuffer();
    assert.strictEqual(fetchCalls.length, 0);
  });
});

infraDescribe("SEC-005: migration script for legacy public assets (reviewed, NOT run against real data)", mongoSkip, () => {
  test("dry run changes nothing; --apply renames to authenticated and updates the records; failures are counted", async () => {
    const { migrateLegacyAssets } = await import("../services/document-service/src/scripts/migrate-cloudinary-private");
    const ids = [crypto.randomBytes(4).toString("hex"), crypto.randomBytes(4).toString("hex")];
    const pdf = await insertDocument({
      cloudinaryUrl: `https://res.cloudinary.com/rmtestcloud/image/upload/v1/researchmind/documents/${ids[0]}.pdf`,
      cloudinaryPublicId: `researchmind/documents/${ids[0]}`,
    });
    const docx = await insertDocument({
      fileType: "docx",
      originalName: "x.docx",
      cloudinaryUrl: `https://res.cloudinary.com/rmtestcloud/raw/upload/v1/researchmind/documents/${ids[1]}`,
      cloudinaryPublicId: `researchmind/documents/${ids[1]}`,
    });
    const scope = { _id: { $in: [pdf._id, docx._id] } };
    const renames: any[] = [];
    // A stateful fake: each asset is "upload" until renamed; rename of a
    // non-upload asset fails like the real API; resource() looks an asset up.
    const assetType = new Map<string, string>([
      [`researchmind/documents/${ids[0]}`, "upload"],
      [`researchmind/documents/${ids[1]}`, "upload"],
    ]);
    let failNextRename = false;
    const fakeCloudinary = {
      uploader: {
        rename: async (from: string, to: string, options: Record<string, unknown>) => {
          renames.push({ from, to, options });
          if (failNextRename) {
            failNextRename = false;
            throw new Error("simulated network error");
          }
          if (assetType.get(from) !== options.type) throw new Error("Resource not found");
          assetType.set(from, String(options.to_type));
          return { public_id: to, type: options.to_type };
        },
      },
      api: {
        resource: async (publicId: string, options: Record<string, unknown>) => {
          if (assetType.get(publicId) !== options.type) throw { error: { message: "Resource not found", http_code: 404 } };
          return { public_id: publicId, type: options.type };
        },
      },
    };
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);

    const dry = await migrateLegacyAssets({ apply: false, cloudinary: fakeCloudinary, Document, filter: scope, log });
    assert.deepStrictEqual(dry, { candidates: 2, migrated: 0, reconciled: 0, failed: 0, apply: false });
    assert.strictEqual(renames.length, 0);

    failNextRename = true;
    const first = await migrateLegacyAssets({ apply: true, cloudinary: fakeCloudinary, Document, filter: scope, log });
    assert.deepStrictEqual(first, { candidates: 2, migrated: 1, reconciled: 0, failed: 1, apply: true });
    const second = await migrateLegacyAssets({ apply: true, cloudinary: fakeCloudinary, Document, filter: scope, log });
    assert.deepStrictEqual(second, { candidates: 1, migrated: 1, reconciled: 0, failed: 0, apply: true }, "re-run picks up only what is left");

    for (const call of renames) {
      assert.strictEqual(call.from, call.to, "public id unchanged");
      assert.strictEqual(call.options.type, "upload");
      assert.strictEqual(call.options.to_type, "authenticated");
      assert.strictEqual(call.options.invalidate, true);
    }
    const after = await Document.find(scope).lean();
    for (const record of after) {
      assert.strictEqual(record.cloudinaryDeliveryType, "authenticated");
      assert.strictEqual(record.cloudinaryUrl, null);
      assert.strictEqual(record.cloudinaryResourceType, record.fileType === "pdf" ? "image" : "raw");
    }
    assert.ok(!lines.join("\n").includes(process.env.CLOUDINARY_API_SECRET!), "a secret was printed");
    assert.ok(!lines.join("\n").includes("https://"), "a URL was printed");
  });

  test("M2: asset renamed but the record update failed -> the re-run detects the private asset and completes the record; the file opens", async () => {
    const { migrateLegacyAssets } = await import("../services/document-service/src/scripts/migrate-cloudinary-private");
    const assetId = `researchmind/documents/${crypto.randomBytes(4).toString("hex")}`;
    const legacy = await insertDocument({
      cloudinaryUrl: `https://res.cloudinary.com/rmtestcloud/image/upload/v1/${assetId}.pdf`,
      cloudinaryPublicId: assetId,
    });
    const scope = { _id: legacy._id };
    let assetType = "upload";
    const fakeCloudinary = {
      uploader: {
        rename: async (_from: string, to: string, options: Record<string, unknown>) => {
          if (assetType !== options.type) throw new Error("Resource not found");
          assetType = String(options.to_type);
          return { public_id: to };
        },
      },
      api: {
        resource: async (_publicId: string, options: Record<string, unknown>) => {
          if (assetType !== options.type) throw new Error("Resource not found");
          return {};
        },
      },
    };
    // The database update fails once (e.g. MongoDB unavailable mid-run).
    let failUpdate = true;
    const flakyDocument = {
      find: Document.find.bind(Document),
      updateMany: (...args: any[]) => {
        if (failUpdate) {
          failUpdate = false;
          return Promise.reject(new Error("MongoNetworkError: simulated"));
        }
        return Document.updateMany(...args);
      },
    };
    const lines: string[] = [];

    const first = await migrateLegacyAssets({ apply: true, cloudinary: fakeCloudinary, Document: flakyDocument as any, filter: scope, log: (l) => lines.push(l) });
    assert.deepStrictEqual(first, { candidates: 1, migrated: 0, reconciled: 0, failed: 1, apply: true });
    assert.strictEqual(assetType, "authenticated", "the asset itself was made private");
    assert.match(lines.join("\n"), /record update FAILED.*re-run/);

    // In this state the old public URL is dead: before the re-run, the file would 502.
    fetchBehaviour = async (call) =>
      call.url.includes("/upload/") ? new Response("gone", { status: 404 }) : new Response(PDF_BYTES, { status: 200 });
    assert.strictEqual((await getFile(legacy._id.toString(), USER_A)).status, 502);

    const second = await migrateLegacyAssets({ apply: true, cloudinary: fakeCloudinary, Document: flakyDocument as any, filter: scope, log: (l) => lines.push(l) });
    assert.deepStrictEqual(second, { candidates: 1, migrated: 0, reconciled: 1, failed: 0, apply: true });
    const record = await Document.findById(legacy._id).lean();
    assert.strictEqual(record.cloudinaryDeliveryType, "authenticated");
    assert.strictEqual(record.cloudinaryUrl, null);

    const third = await migrateLegacyAssets({ apply: true, cloudinary: fakeCloudinary, Document, filter: scope, log: (l) => lines.push(l) });
    assert.deepStrictEqual(third, { candidates: 0, migrated: 0, reconciled: 0, failed: 0, apply: true }, "idempotent");

    fetchCalls.length = 0;
    const res = await getFile(legacy._id.toString(), USER_A);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(Buffer.from(await res.arrayBuffer()), PDF_BYTES);
    assert.match(new URL(fetchCalls[0].url).pathname, /^\/rmtestcloud\/image\/authenticated\/s--/);
    assert.ok(!lines.join("\n").includes("https://"), "a URL was printed");
  });
});
