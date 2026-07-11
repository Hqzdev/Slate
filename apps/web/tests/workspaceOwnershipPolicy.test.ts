import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceOwnershipPolicy } from "../lib/server/workspaceOwnershipPolicy";

function createPolicy(ownerCount: number) {
  const calls: unknown[] = [];
  const client = {
    workspaceMember: {
      async count(query: unknown) {
        calls.push(query);
        return ownerCount;
      }
    }
  };

  return {
    calls,
    policy: new WorkspaceOwnershipPolicy(client)
  };
}

test("members cannot remove themselves", () => {
  const { policy } = createPolicy(1);
  assert.throws(
    () => policy.assertMemberCanBeRemoved("user-1", "user-1"),
    /You cannot remove yourself from the workspace/
  );
});

test("owners can remove other members", () => {
  const { policy } = createPolicy(1);
  assert.doesNotThrow(() => policy.assertMemberCanBeRemoved("owner-1", "member-1"));
});

test("last owner cannot be removed or downgraded", async () => {
  const { policy } = createPolicy(0);
  await assert.rejects(
    () => policy.requireAnotherOwner("workspace-1", "owner-1"),
    /Workspace must keep at least one owner/
  );
});

test("owner changes are allowed when another owner remains", async () => {
  const { calls, policy } = createPolicy(1);
  await policy.requireAnotherOwner("workspace-1", "owner-1");
  assert.deepEqual(calls[0], {
    where: {
      role: "owner",
      workspaceId: "workspace-1",
      userId: { not: "owner-1" }
    }
  });
});
