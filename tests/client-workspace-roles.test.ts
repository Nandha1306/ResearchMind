import assert from "node:assert";
import { describe, test } from "node:test";
import { canRemoveMember, isWorkspaceOwner } from "../frontend/src/utils/workspace-roles.ts";

/*
 * SEC-010 (frontend): delete and remove-member controls are shown to the
 * workspace owner only (the server enforces the same rule with 403).
 */

describe("workspace roles (frontend/src/utils/workspace-roles.ts)", () => {
  const workspace = { ownerId: "owner-1" };

  test("only the owner is the owner", () => {
    assert.strictEqual(isWorkspaceOwner(workspace, { id: "owner-1" }), true);
    assert.strictEqual(isWorkspaceOwner(workspace, { id: "member-2" }), false);
    assert.strictEqual(isWorkspaceOwner(workspace, null), false);
    assert.strictEqual(isWorkspaceOwner(null, { id: "owner-1" }), false);
    assert.strictEqual(isWorkspaceOwner({ ownerId: "" }, { id: "" }), false, "missing ids never match");
  });

  test("the owner may remove other members, never themself; members may remove nobody", () => {
    assert.strictEqual(canRemoveMember(workspace, { id: "owner-1" }, "member-2"), true);
    assert.strictEqual(canRemoveMember(workspace, { id: "owner-1" }, "owner-1"), false);
    assert.strictEqual(canRemoveMember(workspace, { id: "member-2" }, "member-3"), false);
  });
});
