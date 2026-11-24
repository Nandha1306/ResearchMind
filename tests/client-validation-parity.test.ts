import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test, describe } from "node:test";
import "./helpers/test-env"; // A-5: dead-port REDIS_URL/MONGO_URI defaults before any service code
import { registerSchema as clientRegisterSchema } from "../frontend/src/lib/validations/auth.schema.ts";
import * as meetingTasks from "../frontend/src/utils/meeting-tasks.ts";
import { registerSchema as serverRegisterSchema } from "../packages/validation/schemas/auth.schema";
import { summarizeMeetingSchema } from "../packages/validation/schemas/ai.schema";
import { createWorkspaceSchema } from "../packages/validation/schemas/workspace.schema";

/*
 * ISS-039: the client checks must reach the same verdict as the server, so a
 * user is told about a bad name, password or meeting-notes length before the
 * request instead of by a late server 400. The client schema is a hand-kept
 * mirror (the frontend does not import the server package), so this table
 * pins the two together.
 */

const VALID = { name: "Ada", email: "ada@example.test", password: "abcdefg1" };

const verdicts = (input: { name: string; email: string; password: string }) => {
  const server = serverRegisterSchema.safeParse(input);
  const client = clientRegisterSchema.safeParse({ ...input, confirmPassword: input.password });
  return { server: server.success, client: client.success };
};

describe("ISS-039: client registration rules match the server", () => {
  const cases: Array<[string, Partial<typeof VALID>, boolean]> = [
    ["one-letter name", { name: "A" }, false],
    ["two-letter name", { name: "Ab" }, true],
    ["password with letters only", { password: "abcdefgh" }, false],
    ["password with digits only", { password: "12345678" }, false],
    ["letters and a digit", { password: "abcdefg1" }, true],
    ["too short even with a letter and a digit", { password: "short1" }, false],
    ["valid e-mail", { email: "a@b.co" }, true],
    ["invalid e-mail", { email: "not-an-email" }, false],
  ];

  for (const [label, override, expected] of cases) {
    test(`${label}: both sides say ${expected ? "valid" : "invalid"}`, () => {
      const result = verdicts({ ...VALID, ...override });
      assert.deepStrictEqual(result, { server: expected, client: expected }, label);
    });
  }
});

describe("ISS-039: the client meeting-notes limit matches the server (10..50,000 after trim)", () => {
  test("the client exposes the server's limits", () => {
    assert.strictEqual((meetingTasks as Record<string, unknown>).MIN_MEETING_NOTES_LENGTH, 10);
    assert.strictEqual((meetingTasks as Record<string, unknown>).MAX_MEETING_NOTES_LENGTH, 50_000);
  });

  test("meetingNotesProblem agrees with the server schema at every boundary", () => {
    const problem = (meetingTasks as Record<string, unknown>).meetingNotesProblem as
      | ((text: string) => string | null)
      | undefined;
    assert.strictEqual(typeof problem, "function");
    const workspaceId = "a".repeat(24);
    for (const text of [
      "",
      "   ",
      "123456789",
      "1234567890",
      "  1234567890  ",
      "x".repeat(50_000),
      ` ${"x".repeat(50_000)} `,
      "x".repeat(50_001),
      "த".repeat(50_000),
      "த".repeat(50_001),
    ]) {
      const server = summarizeMeetingSchema.safeParse({ workspaceId, text }).success;
      const client = problem!(text) === null;
      assert.strictEqual(client, server, `length ${text.length}`);
    }
  });

  test("an over-long note gets a message naming the limit", () => {
    const problem = (meetingTasks as Record<string, unknown>).meetingNotesProblem as (text: string) => string | null;
    assert.match(problem("x".repeat(50_001)) ?? "", /50,000/);
  });
});

describe("ISS-050 (iii): the create-workspace form enforces the server's 3..100-character name", () => {
  const MODAL = path.join(__dirname, "..", "frontend", "src", "components", "workspace", "CreateWorkspaceModal.tsx");
  const HELPER = path.join(__dirname, "..", "frontend", "src", "utils", "workspace-name.ts");

  test("workspaceNameProblem agrees with the server schema (the form sends the trimmed name)", async () => {
    assert.ok(fs.existsSync(HELPER), "frontend/src/utils/workspace-name.ts must exist");
    const { workspaceNameProblem, MAX_WORKSPACE_NAME_LENGTH } = await import(pathToFileURL(HELPER).href);
    assert.strictEqual(MAX_WORKSPACE_NAME_LENGTH, 100);
    for (const name of ["", "ab", "abc", "  abc  ", "a".repeat(100), ` ${"a".repeat(100)} `, "a".repeat(101)]) {
      const server = createWorkspaceSchema.safeParse({ name: name.trim() }).success;
      assert.strictEqual(workspaceNameProblem(name) === null, server, `length ${name.length}`);
    }
    assert.match(workspaceNameProblem("a".repeat(101)) ?? "", /100 characters/);
  });

  test("the modal uses the helper and caps the input at 100 characters", () => {
    const modal = fs.readFileSync(MODAL, "utf8");
    assert.match(modal, /workspaceNameProblem\(/);
    assert.match(modal, /maxLength=\{MAX_WORKSPACE_NAME_LENGTH\}/);
  });
});
