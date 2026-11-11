import assert from "node:assert";
import { test, describe, before, after } from "node:test";
import express from "express";
import multer from "multer";
import { listen } from "./helpers/test-env";
import { errorMiddleware } from "../packages/shared/errors/error.middleware";
import { AppError } from "../packages/shared/errors/AppError";
import { validate } from "../packages/validation/validation";
import { loginSchema } from "../packages/validation/schemas/auth.schema";

/*
 * Drives the REAL shared error middleware (used by auth, workspace, document,
 * task and ai services) through a real Express app and real HTTP requests,
 * including errors raised by the real body parser and multer.
 */

let server: { url: string; close: () => Promise<void> };

const throwing = (makeError: () => unknown) => () => {
  throw makeError();
};

before(async () => {
  const app = express();
  app.use(express.json());

  app.post("/echo", (req, res) => res.json({ success: true, data: req.body }));
  app.post("/login", validate(loginSchema), (_req, res) => res.json({ success: true }));

  const tinyUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 } });
  app.post("/upload", tinyUpload.single("file"), (_req, res) => res.json({ success: true }));

  app.get("/app-error", throwing(() => new AppError("Workspace not found", 404)));
  app.get("/app-error-500", throwing(() => new AppError("AI provider unavailable", 502)));
  app.get("/cast", throwing(() => Object.assign(new Error("Cast to ObjectId failed"), { name: "CastError" })));
  app.get(
    "/mongoose-validation",
    throwing(() => Object.assign(new Error("Task validation failed: title: too long"), { name: "ValidationError" }))
  );
  app.get(
    "/duplicate",
    throwing(() =>
      Object.assign(new Error('E11000 duplicate key error dup key: { email: "victim@example.com" }'), {
        name: "MongoServerError",
        code: 11000,
      })
    )
  );
  app.get(
    "/db-down",
    throwing(() => Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:27017"), { name: "MongoServerSelectionError" }))
  );
  app.get(
    "/db-down-mongoose",
    throwing(() => Object.assign(new Error("Could not connect to any servers"), { name: "MongooseServerSelectionError" }))
  );
  app.get("/db-buffering", throwing(() => new Error("Operation `tasks.find()` buffering timed out after 10000ms")));
  app.get("/unexpected", throwing(() => new Error("secret internal detail at db.internal:27017")));
  app.get("/async-unexpected", async () => {
    throw new Error("async failure detail");
  });
  app.get("/stream-then-fail", (_req, res, next) => {
    res.status(200).write("partial");
    next(new Error("failed mid-stream"));
  });

  app.use(errorMiddleware);
  server = await listen(app);
});

after(async () => {
  await server?.close();
});

const get = (path: string) => fetch(`${server.url}${path}`);

const expectError = async (res: Response, status: number, message?: RegExp) => {
  assert.strictEqual(res.status, status);
  const body = await res.json();
  assert.strictEqual(body.success, false);
  if (message) assert.match(body.message, message);
  return body;
};

describe("Client errors are 4xx, not 500", () => {
  test("malformed JSON body -> 400", async () => {
    const res = await fetch(`${server.url}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"email": ',
    });
    await expectError(res, 400, /Malformed JSON/);
  });

  test("JSON body over the 100 KB parser limit -> 413", async () => {
    const res = await fetch(`${server.url}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blob: "x".repeat(200 * 1024) }),
    });
    await expectError(res, 413, /too large/);
  });

  test("uploaded file over the multer size limit -> 413", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.alloc(100)]), "big.pdf");
    const res = await fetch(`${server.url}/upload`, { method: "POST", body: form });
    await expectError(res, 413, /File is too large/);
  });

  test("schema validation failure (missing fields) -> 400 with messages", async () => {
    const res = await fetch(`${server.url}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const body = await expectError(res, 400);
    assert.ok(Array.isArray(body.errors) && body.errors.length > 0);
  });

  test("invalid resource id (CastError) -> 400", async () => {
    await expectError(await get("/cast"), 400, /Invalid resource ID/);
  });

  test("Mongoose ValidationError -> 400", async () => {
    await expectError(await get("/mongoose-validation"), 400, /validation failed/);
  });

  test("duplicate unique key -> 409 without echoing the duplicated value", async () => {
    const res = await get("/duplicate");
    const body = await expectError(res, 409);
    assert.ok(!JSON.stringify(body).includes("victim@example.com"));
  });

  test("AppError keeps its status and message (missing resource -> 404)", async () => {
    await expectError(await get("/app-error"), 404, /^Workspace not found$/);
  });
});

describe("Server and dependency errors are safe", () => {
  test("database unreachable -> 503, no infrastructure details", async () => {
    const body = await expectError(await get("/db-down"), 503, /temporarily unavailable/);
    assert.ok(!JSON.stringify(body).includes("10.0.0.5"));
  });

  test("Mongoose buffering timeout (no connection) -> 503", async () => {
    await expectError(await get("/db-buffering"), 503);
  });

  test("Mongoose-level server selection error -> 503", async () => {
    await expectError(await get("/db-down-mongoose"), 503);
  });

  test("an AppError with a 5xx status keeps its deliberate message", async () => {
    await expectError(await get("/app-error-500"), 502, /AI provider unavailable/);
  });

  test("unexpected errors -> 500 with a generic message and no stack or detail", async () => {
    for (const path of ["/unexpected", "/async-unexpected"]) {
      const body = await expectError(await get(path), 500, /^Internal Server Error$/);
      const raw = JSON.stringify(body);
      assert.ok(!raw.includes("secret internal detail") && !raw.includes("async failure detail"));
      assert.ok(!raw.includes("stack") && !raw.includes(".ts:"));
    }
  });

  test("once headers are sent, the error is handed to Express instead of writing a JSON error", () => {
    let statusCalled = false;
    let forwarded: unknown;
    const err = new Error("failed mid-stream");
    const res: any = {
      headersSent: true,
      status: () => {
        statusCalled = true;
        throw new Error("ERR_HTTP_HEADERS_SENT"); // what Express would do
      },
    };
    errorMiddleware(err, { method: "GET", originalUrl: "/x" } as any, res, (e?: unknown) => {
      forwarded = e;
    });
    assert.strictEqual(statusCalled, false);
    assert.strictEqual(forwarded, err);
  });

  test("an error after a streamed response started does not crash the server", async () => {
    await get("/stream-then-fail")
      .then((res) => res.text())
      .catch(() => undefined); // the connection may be cut; that is expected
    // The server must still serve requests afterwards.
    const res = await get("/app-error");
    assert.strictEqual(res.status, 404);
  });
});
