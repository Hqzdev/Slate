import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceOwnershipPolicy } from "../lib/server/workspaceOwnershipPolicy";

test("members cannot remove themselves", () => {
  const policy = new WorkspaceOwnershipPolicy();
  assert.throws(
    () => policy.assertMemberCanBeRemoved("user-1", "user-1"),
    /You cannot remove yourself from the workspace/
  );
});

test("owners can remove other members", () => {
  const policy = new WorkspaceOwnershipPolicy();
  assert.doesNotThrow(() => policy.assertMemberCanBeRemoved("owner-1", "member-1"));
});

test("ownership transfer requires the exact workspace name", () => {
  const policy = new WorkspaceOwnershipPolicy();
  assert.doesNotThrow(() => policy.assertTransferConfirmation("Yaroslav's Workspace", "Yaroslav's Workspace"));
  assert.throws(() => policy.assertTransferConfirmation("Yaroslav's Workspace", "yaroslav's workspace"), /does not match/);
});
