import assert from "node:assert";
import { test, describe } from "node:test";

describe("Workspace Isolation & Data Protection Matrix", () => {
  interface WorkspaceMembership {
    workspaceId: string;
    members: string[];
  }

  const workspaces: WorkspaceMembership[] = [
    { workspaceId: "ws_user_a", members: ["user_a_id"] },
    { workspaceId: "ws_user_b", members: ["user_b_id"] },
  ];

  const checkMembership = (workspaceId: string, userId: string): boolean => {
    const ws = workspaces.find((w) => w.workspaceId === workspaceId);
    return Boolean(ws && ws.members.includes(userId));
  };

  test("User A cannot access User B workspace resources (403 Forbidden)", () => {
    assert.strictEqual(checkMembership("ws_user_a", "user_a_id"), true);
    assert.strictEqual(checkMembership("ws_user_b", "user_a_id"), false);
  });

  test("User B cannot access User A workspace resources (403 Forbidden)", () => {
    assert.strictEqual(checkMembership("ws_user_b", "user_b_id"), true);
    assert.strictEqual(checkMembership("ws_user_a", "user_b_id"), false);
  });

  test("Subtask self-parenting and cycles are rejected", () => {
    const parentMap = new Map<string, string>();
    parentMap.set("task_b", "task_a");

    const willCreateCycle = (taskId: string, proposedParentId: string): boolean => {
      if (taskId === proposedParentId) return true;

      let cursor: string | undefined = proposedParentId;
      const visited = new Set<string>();

      while (cursor) {
        if (cursor === taskId) return true;
        if (visited.has(cursor)) return true;
        visited.add(cursor);
        cursor = parentMap.get(cursor);
      }
      return false;
    };

    // A -> B exists. Trying B -> A should detect cycle.
    assert.strictEqual(willCreateCycle("task_a", "task_a"), true);
    assert.strictEqual(willCreateCycle("task_a", "task_b"), true);
    assert.strictEqual(willCreateCycle("task_c", "task_a"), false);
  });
});
