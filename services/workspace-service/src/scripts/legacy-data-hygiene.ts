/*
 * SEC-024 (b): legacy data hygiene for the WORKSPACE database. User-run only.
 *
 * What it looks at:
 *  - invite codes that do not match the current generator's format (8
 *    characters from 23456789ABCDEFGHJKLMNPQRSTUVWXYZ). They come from an old
 *    generator; codes with lower-case letters can no longer be used at all
 *    (joins upper-case the input);
 *  - the unused `workspacemembers` collection (no code reads or writes it).
 *
 * SAFE BY DEFAULT: without flags it is a DRY RUN that prints counts and
 * workspace ids only (never an invite code) and changes nothing. Each change
 * needs its own flag:
 *
 *   --rotate-legacy-invite-codes  give each legacy-format code a new code from
 *                                 the current generator. Codes already shared
 *                                 stop working; current members are unaffected.
 *   --drop-workspacemembers       drop the unused collection (irreversible).
 *
 * Idempotent: a re-run finds nothing left to rotate or drop.
 *
 * Run it YOURSELF from services/workspace-service (it reads that service's
 * .env for MONGO_URI). Take a backup first; dry run first:
 *
 *   npx ts-node src/scripts/legacy-data-hygiene.ts
 *   npx ts-node src/scripts/legacy-data-hygiene.ts --rotate-legacy-invite-codes
 *   npx ts-node src/scripts/legacy-data-hygiene.ts --drop-workspacemembers
 */
import type { Db } from "mongodb";
import type { Model } from "mongoose";
import { generateInviteCode } from "../utils/invite-code";

/** The current generator's format (utils/invite-code.ts). */
export const CURRENT_INVITE_CODE = /^[2-9A-HJ-NP-Z]{8}$/;
export const isCurrentInviteCode = (code: unknown): boolean =>
  typeof code === "string" && CURRENT_INVITE_CODE.test(code);

export const UNUSED_MEMBERS_COLLECTION = "workspacemembers";
const MAX_ROTATION_ATTEMPTS = 5;

export type WorkspaceHygieneOptions = {
  rotateLegacyInviteCodes: boolean;
  dropWorkspaceMembers: boolean;
};

export type WorkspaceHygieneSummary = {
  legacyInviteCodes: number;
  rotated: number;
  rotationFailed: number;
  workspaceMembersDocuments: number;
  workspaceMembersDropped: boolean;
};

const FLAGS: Record<string, keyof WorkspaceHygieneOptions> = {
  "--rotate-legacy-invite-codes": "rotateLegacyInviteCodes",
  "--drop-workspacemembers": "dropWorkspaceMembers",
};

/** Explicit flags only; anything else is refused (a typo must not be guessed). */
export const parseHygieneArgs = (args: string[]): WorkspaceHygieneOptions => {
  const options: WorkspaceHygieneOptions = { rotateLegacyInviteCodes: false, dropWorkspaceMembers: false };
  for (const arg of args) {
    const key = FLAGS[arg];
    if (!key) throw new Error(`Unknown option ${arg}. Allowed: ${Object.keys(FLAGS).join(", ")}`);
    options[key] = true;
  }
  return options;
};

const isDuplicateKey = (error: unknown) => (error as { code?: number })?.code === 11000;

export const runWorkspaceHygiene = async ({
  options,
  Workspace,
  db,
  filter = {},
  generate = generateInviteCode,
  log = console.log,
}: {
  options: WorkspaceHygieneOptions;
  Workspace: Pick<Model<any>, "find" | "updateOne">;
  db: Db;
  /** Extra filter (tests scope the run to their own records). */
  filter?: Record<string, unknown>;
  generate?: () => string;
  log?: (line: string) => void;
}): Promise<WorkspaceHygieneSummary> => {
  const dryRun = !options.rotateLegacyInviteCodes && !options.dropWorkspaceMembers;
  log(dryRun ? "DRY RUN: nothing will be changed." : "APPLY: only the requested changes are made.");

  const legacy: Array<{ _id: unknown; inviteCode?: string }> = await Workspace.find({
    $and: [{ inviteCode: { $not: CURRENT_INVITE_CODE } }, filter],
  })
    .select("_id inviteCode")
    .lean();
  const summary: WorkspaceHygieneSummary = {
    legacyInviteCodes: legacy.length,
    rotated: 0,
    rotationFailed: 0,
    workspaceMembersDocuments: 0,
    workspaceMembersDropped: false,
  };
  log(`${legacy.length} workspace(s) have a legacy-format invite code`);

  if (options.rotateLegacyInviteCodes) {
    for (const workspace of legacy) {
      let done = false;
      for (let attempt = 1; attempt <= MAX_ROTATION_ATTEMPTS && !done; attempt++) {
        const next = generate();
        try {
          // Conditional on the old code: a code changed meanwhile is left alone.
          const result = await Workspace.updateOne(
            { _id: workspace._id, inviteCode: workspace.inviteCode },
            { $set: { inviteCode: next } }
          );
          done = true;
          if (result.modifiedCount === 1) {
            summary.rotated += 1;
            log(`  workspace ${workspace._id}: invite code rotated`);
          } else {
            log(`  workspace ${workspace._id}: code changed meanwhile, left alone`);
          }
        } catch (error) {
          if (!isDuplicateKey(error)) throw error;
          // The generated code is taken: try another one.
        }
      }
      if (!done) {
        summary.rotationFailed += 1;
        log(`  workspace ${workspace._id}: FAILED to find a free code; re-run to retry`);
      }
    }
  } else {
    for (const workspace of legacy) log(`  would rotate the invite code of workspace ${workspace._id}`);
  }

  const exists = (await db.listCollections({ name: UNUSED_MEMBERS_COLLECTION }).toArray()).length === 1;
  if (exists) {
    summary.workspaceMembersDocuments = await db.collection(UNUSED_MEMBERS_COLLECTION).countDocuments();
  }
  log(
    exists
      ? `Collection ${UNUSED_MEMBERS_COLLECTION}: ${summary.workspaceMembersDocuments} document(s), not used by the application`
      : `Collection ${UNUSED_MEMBERS_COLLECTION}: not present`
  );
  if (options.dropWorkspaceMembers && exists) {
    await db.dropCollection(UNUSED_MEMBERS_COLLECTION);
    summary.workspaceMembersDropped = true;
    log(`Collection ${UNUSED_MEMBERS_COLLECTION} dropped`);
  }

  if (dryRun) log("Nothing was changed. Re-run with an explicit flag to apply a change.");
  return summary;
};

const main = async () => {
  const options = parseHygieneArgs(process.argv.slice(2));
  const dotenv = await import("dotenv");
  dotenv.config();
  const uri = process.env.MONGO_URI;
  if (!uri || !uri.trim()) throw new Error("Set MONGO_URI for workspace-service");
  const { default: mongoose } = await import("mongoose");
  const { Workspace } = await import("../models/Workspace");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const summary = await runWorkspaceHygiene({ options, Workspace, db: mongoose.connection.db! });
    process.exitCode = summary.rotationFailed > 0 ? 1 : 0;
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Hygiene script aborted: ${(error as Error).message}`);
    process.exit(1);
  });
}
