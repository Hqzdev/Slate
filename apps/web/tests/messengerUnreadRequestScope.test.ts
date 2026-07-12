import assert from "node:assert/strict";
import test from "node:test";
import { MessengerUnreadRequestScope } from "../lib/client/messengerUnreadRequestScope";

test("deactivating an old unread scope cannot abort or supersede the current workspace request", () => {
  const workspaceA = new MessengerUnreadRequestScope("workspace-a");
  workspaceA.activate();
  const requestA = workspaceA.begin();
  assert.ok(requestA);

  const workspaceB = new MessengerUnreadRequestScope("workspace-b");
  workspaceB.activate();
  const requestB = workspaceB.begin();
  assert.ok(requestB);

  workspaceA.deactivate();
  assert.equal(requestA.controller.signal.aborted, true);
  assert.equal(requestB.controller.signal.aborted, false);
  assert.equal(workspaceA.isCurrent(requestA), false);
  assert.equal(workspaceB.isCurrent(requestB), true);
  assert.equal(workspaceA.begin(), null);

  workspaceA.finish(requestA);
  assert.equal(workspaceB.isCurrent(requestB), true);
});
