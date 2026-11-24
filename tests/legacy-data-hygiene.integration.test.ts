import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, before, after } from "node:test";
import "./helpers/test-env"; // A-5: dead-port REDIS_URL/MONGO_URI defaults before any service code
import mongoose from "mongoose";
import { infraDescribe } from "./helpers/infra";
import { connectTestDatabase, mongoSkip } from "./helpers/test-mongo";

/*
 * SEC-024 (b): legacy data hygiene as REVIEWED, USER-RUN scripts. Nothing runs
 * automatically and nothing here touches real data: every case uses a
 * disposable, randomly named database (TEST_MONGO_URI) and a temporary folder,
 * with the models, database handle and folder INJECTED. The scripts' main()
 * (which reads a service .env) is never called.
 *
 * Contract:
 *  - a dry run (no flags) changes nothing and prints counts and ids only
 *    (never an invite code);
 *  - each change needs its own explicit flag;
 *  - --rotate-legacy-invite-codes rewrites ONLY codes that do not match the
 *    current generator's format; a re-run is a no-op;
 *  - --drop-workspacemembers drops only that collection;
 *  - --drop-empty-workspaces-collection drops only when it is empty;
 *  - --delete-legacy-uploads deletes only top-level regular files older than
 *    1 h in the legacy uploads folder (no recursion, no links).
 */

const CONFORMING = /^[2-9A-HJ-NP-Z]{8}$/;
const OWNER = "665f1c2b9d3e4a00eeee0001";

let db: Awaited<ReturnType<typeof connectTestDatabase>> | undefined;
let Workspace: any;

before(async () => {
  if (mongoSkip) return;
  db = await connectTestDatabase("hygiene");
  ({ Workspace } = await import("../services/workspace-service/src/models/Workspace"));
  await Workspace.syncIndexes();
});

after(async () => {
  await db?.cleanup();
});

const collectionExists = async (name: string) =>
  (await mongoose.connection.db!.listCollections({ name }).toArray()).length === 1;

infraDescribe("SEC-024 (b): workspace-service legacy-data-hygiene (injected models, disposable DB)", mongoSkip, () => {
  test("parseHygieneArgs: dry run by default, explicit flags only, unknown flags refused", async () => {
    const { parseHygieneArgs } = await import("../services/workspace-service/src/scripts/legacy-data-hygiene");
    assert.deepStrictEqual(parseHygieneArgs([]), { rotateLegacyInviteCodes: false, dropWorkspaceMembers: false });
    assert.deepStrictEqual(parseHygieneArgs(["--rotate-legacy-invite-codes"]), {
      rotateLegacyInviteCodes: true,
      dropWorkspaceMembers: false,
    });
    assert.deepStrictEqual(parseHygieneArgs(["--drop-workspacemembers"]), {
      rotateLegacyInviteCodes: false,
      dropWorkspaceMembers: true,
    });
    assert.throws(() => parseHygieneArgs(["--apply"]), /Unknown option/);
    assert.throws(() => parseHygieneArgs(["--rotate"]), /Unknown option/);
  });

  test("dry run changes nothing and prints no invite code; the flags rotate only legacy codes, idempotently", async () => {
    const { runWorkspaceHygiene, isCurrentInviteCode } = await import("../services/workspace-service/src/scripts/legacy-data-hygiene");
    const legacyCodes = ["abc123xyz", "LEGACY-CODE-1", "a1b2c3d4", "IIIIIIII"]; // lower case, too long, I/O not in the alphabet
    const currentCode = "ABCD2345";
    const docs = await Workspace.insertMany([
      ...legacyCodes.map((inviteCode, i) => ({ name: `Legacy ${i}`, ownerId: OWNER, members: [OWNER], inviteCode })),
      { name: "Current", ownerId: OWNER, members: [OWNER], inviteCode: currentCode },
    ]);
    const scope = { _id: { $in: docs.map((d: any) => d._id) } };
    await mongoose.connection.db!.collection("workspacemembers").insertMany([{ legacy: 1 }, { legacy: 2 }]);
    assert.strictEqual(isCurrentInviteCode(currentCode), true);
    for (const code of legacyCodes) assert.strictEqual(isCurrentInviteCode(code), false, code);

    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    const dry = await runWorkspaceHygiene({
      options: { rotateLegacyInviteCodes: false, dropWorkspaceMembers: false },
      Workspace,
      db: mongoose.connection.db!,
      filter: scope,
      log,
    });
    assert.deepStrictEqual(dry, { legacyInviteCodes: 4, rotated: 0, rotationFailed: 0, workspaceMembersDocuments: 2, workspaceMembersDropped: false });
    const afterDry = await Workspace.find(scope).sort({ name: 1 }).lean();
    assert.deepStrictEqual(afterDry.map((w: any) => w.inviteCode).sort(), [...legacyCodes, currentCode].sort(), "dry run changed a code");
    assert.ok(await collectionExists("workspacemembers"), "dry run dropped a collection");
    const printed = lines.join("\n");
    for (const code of [...legacyCodes, currentCode]) assert.ok(!printed.includes(code), `printed invite code ${code}`);
    assert.match(printed, /DRY RUN/);

    // Rotation only (the collection stays). One generated code collides once (E11000 -> retry).
    const generated = ["ABCD2345", "QRST6789", "WXYZ2345", "HJKL3456", "MNPQ4567"];
    const rotate = await runWorkspaceHygiene({
      options: { rotateLegacyInviteCodes: true, dropWorkspaceMembers: false },
      Workspace,
      db: mongoose.connection.db!,
      filter: scope,
      generate: () => generated.shift()!,
      log,
    });
    assert.strictEqual(rotate.rotated, 4);
    assert.strictEqual(rotate.rotationFailed, 0);
    assert.strictEqual(rotate.workspaceMembersDropped, false);
    assert.ok(await collectionExists("workspacemembers"));
    const afterRotate = await Workspace.find(scope).lean();
    for (const w of afterRotate) assert.match(w.inviteCode, CONFORMING, w.name);
    assert.strictEqual(afterRotate.find((w: any) => w.name === "Current").inviteCode, currentCode, "a current code was rotated");
    assert.strictEqual(new Set(afterRotate.map((w: any) => w.inviteCode)).size, afterRotate.length, "codes stay unique");

    // Re-run: nothing left to rotate.
    const again = await runWorkspaceHygiene({
      options: { rotateLegacyInviteCodes: true, dropWorkspaceMembers: false },
      Workspace,
      db: mongoose.connection.db!,
      filter: scope,
      generate: () => assert.fail("no code should be generated on a re-run"),
      log,
    });
    assert.strictEqual(again.legacyInviteCodes, 0);
    assert.strictEqual(again.rotated, 0);

    // The drop flag drops only that collection; a re-run is a no-op.
    const drop = await runWorkspaceHygiene({
      options: { rotateLegacyInviteCodes: false, dropWorkspaceMembers: true },
      Workspace,
      db: mongoose.connection.db!,
      filter: scope,
      log,
    });
    assert.strictEqual(drop.workspaceMembersDropped, true);
    assert.strictEqual(await collectionExists("workspacemembers"), false);
    assert.strictEqual(await Workspace.countDocuments(scope), 5, "workspaces untouched by the drop");
    const dropAgain = await runWorkspaceHygiene({
      options: { rotateLegacyInviteCodes: false, dropWorkspaceMembers: true },
      Workspace,
      db: mongoose.connection.db!,
      filter: scope,
      log,
    });
    assert.deepStrictEqual(dropAgain, { legacyInviteCodes: 0, rotated: 0, rotationFailed: 0, workspaceMembersDocuments: 0, workspaceMembersDropped: false });
  });
});

infraDescribe("SEC-024 (b): document-service legacy-data-hygiene (injected DB and folder)", mongoSkip, () => {
  let uploads: string;
  // Its own disposable database: the workspace suite above created a
  // `workspaces` collection in the shared test database.
  let docDb: import("mongodb").Db;
  before(() => {
    uploads = fs.mkdtempSync(path.join(os.tmpdir(), "rm-legacy-uploads-"));
    docDb = mongoose.connection.getClient().db(`${db!.dbName}_doc`);
  });
  after(async () => {
    if (uploads) fs.rmSync(uploads, { recursive: true, force: true });
    await docDb?.dropDatabase();
  });
  const docCollectionExists = async (name: string) => (await docDb.listCollections({ name }).toArray()).length === 1;

  const make = (name: string, ageMs: number) => {
    const file = path.join(uploads, name);
    fs.writeFileSync(file, "x");
    const time = new Date(Date.now() - ageMs);
    fs.utimesSync(file, time, time);
    return file;
  };

  test("parseDocumentHygieneArgs: dry run by default, explicit flags only, unknown flags refused", async () => {
    const { parseDocumentHygieneArgs } = await import("../services/document-service/src/scripts/legacy-data-hygiene");
    assert.deepStrictEqual(parseDocumentHygieneArgs([]), { dropEmptyWorkspacesCollection: false, deleteLegacyUploads: false });
    assert.deepStrictEqual(parseDocumentHygieneArgs(["--drop-empty-workspaces-collection", "--delete-legacy-uploads"]), {
      dropEmptyWorkspacesCollection: true,
      deleteLegacyUploads: true,
    });
    assert.throws(() => parseDocumentHygieneArgs(["--force"]), /Unknown option/);
  });

  test("dry run changes nothing; the collection is dropped only when empty; only old top-level files are deleted", async () => {
    const { runDocumentHygiene } = await import("../services/document-service/src/scripts/legacy-data-hygiene");
    const HOUR = 60 * 60 * 1000;
    const oldA = make("1723800000000-test_sample.pdf", 30 * 24 * HOUR);
    const oldB = make("test_sample.docx", 2 * HOUR);
    const fresh = make("1723800000001-new.pdf", 10 * 60 * 1000);
    fs.mkdirSync(path.join(uploads, "nested"));
    const nestedOld = path.join(uploads, "nested", "old.pdf");
    fs.writeFileSync(nestedOld, "x");
    fs.utimesSync(nestedOld, new Date(Date.now() - 48 * HOUR), new Date(Date.now() - 48 * HOUR));

    const collection = "workspaces";
    await docDb.collection(collection).insertOne({ legacy: true });
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    const run = (options: { dropEmptyWorkspacesCollection: boolean; deleteLegacyUploads: boolean }) =>
      runDocumentHygiene({ options, db: docDb, uploadsDir: uploads, log });

    const dry = await run({ dropEmptyWorkspacesCollection: false, deleteLegacyUploads: false });
    assert.deepStrictEqual(dry, { workspacesDocuments: 1, workspacesDropped: false, legacyUploads: 2, legacyUploadsDeleted: 0 });
    for (const file of [oldA, oldB, fresh, nestedOld]) assert.ok(fs.existsSync(file), `dry run deleted ${file}`);
    assert.ok(await docCollectionExists(collection));
    assert.match(lines.join("\n"), /DRY RUN/);

    // Not empty: the drop flag refuses.
    const refused = await run({ dropEmptyWorkspacesCollection: true, deleteLegacyUploads: false });
    assert.strictEqual(refused.workspacesDropped, false);
    assert.ok(await docCollectionExists(collection), "a non-empty collection was dropped");

    // Empty: dropped. Old top-level files deleted; the fresh file and the subfolder are kept.
    await docDb.collection(collection).deleteMany({});
    const applied = await run({ dropEmptyWorkspacesCollection: true, deleteLegacyUploads: true });
    assert.deepStrictEqual(applied, { workspacesDocuments: 0, workspacesDropped: true, legacyUploads: 2, legacyUploadsDeleted: 2 });
    assert.strictEqual(await docCollectionExists(collection), false);
    assert.strictEqual(fs.existsSync(oldA), false);
    assert.strictEqual(fs.existsSync(oldB), false);
    assert.ok(fs.existsSync(fresh), "a file younger than 1 h was deleted");
    assert.ok(fs.existsSync(nestedOld), "the script recursed into a subfolder");

    // Re-run: nothing to do.
    const again = await run({ dropEmptyWorkspacesCollection: true, deleteLegacyUploads: true });
    assert.deepStrictEqual(again, { workspacesDocuments: 0, workspacesDropped: false, legacyUploads: 0, legacyUploadsDeleted: 0 });
  });

  test("a missing legacy folder is reported, not created", async () => {
    const { runDocumentHygiene } = await import("../services/document-service/src/scripts/legacy-data-hygiene");
    const missing = path.join(uploads, "does-not-exist");
    const summary = await runDocumentHygiene({
      options: { dropEmptyWorkspacesCollection: false, deleteLegacyUploads: true },
      db: docDb,
      uploadsDir: missing,
      log: () => undefined,
    });
    assert.strictEqual(summary.legacyUploads, 0);
    assert.strictEqual(fs.existsSync(missing), false);
  });
});
