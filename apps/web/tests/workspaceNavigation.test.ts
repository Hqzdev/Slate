import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceNavigationUrl, readWorkspaceNavigation, repairWorkspaceNavigationUrl, WorkspaceAiRouteMemory } from "../lib/client/workspaceNavigation";

test("blocks Messenger routes and conversation state", () => {
  assert.deepEqual(
    readWorkspaceNavigation({ pathname: "/workspace/messenger", search: "?workspaceId=workspace-1&conversationId=general-1" }),
    { aiConversationId: null, conversationId: null, documentId: null, view: "dashboard", workspaceId: "workspace-1" }
  );
  assert.deepEqual(
    readWorkspaceNavigation({ pathname: "/workspace", search: "?workspaceId=workspace-1&view=messenger&conversationId=general-1" }),
    { aiConversationId: null, conversationId: null, documentId: null, view: "dashboard", workspaceId: "workspace-1" }
  );
  assert.deepEqual(
    readWorkspaceNavigation({ pathname: "/workspace", search: "?view=files&conversationId=general-1" }),
    { aiConversationId: null, conversationId: null, documentId: null, view: "files", workspaceId: null }
  );
});

test("repairs unknown views and preserves the existing AI route contract", () => {
  assert.equal(readWorkspaceNavigation({ pathname: "/workspace", search: "?view=unknown" }).view, "dashboard");
  assert.deepEqual(
    readWorkspaceNavigation({ pathname: "/workspace/ai/sltx-abcd-1234", search: "?workspaceId=workspace-1" }),
    { aiConversationId: "sltx-abcd-1234", conversationId: null, documentId: null, view: "ai", workspaceId: "workspace-1" }
  );
});

test("creates canonical workspace URLs and drops stale conversation identifiers", () => {
  assert.equal(
    createWorkspaceNavigationUrl("https://slate.test/workspace?view=comments&conversationId=stale", {
      conversationId: "general-1",
      view: "messenger",
      workspaceId: "workspace-1"
    }),
    "/workspace?workspaceId=workspace-1&view=dashboard"
  );
  assert.equal(
    createWorkspaceNavigationUrl("https://slate.test/workspace?conversationId=stale", {
      view: "activity",
      workspaceId: "workspace-1"
    }),
    "/workspace?workspaceId=workspace-1&view=activity"
  );
  assert.equal(
    createWorkspaceNavigationUrl("https://slate.test/workspace?view=ai", {
      aiConversationId: "sltx-abcd-1234",
      view: "ai",
      workspaceId: "workspace-1"
    }),
    "/workspace/ai/sltx-abcd-1234?workspaceId=workspace-1"
  );
  assert.equal(
    createWorkspaceNavigationUrl("https://slate.test/workspace/ai/sltx-abcd-1234?workspaceId=workspace-1", {
      aiConversationId: "sltx-abcd-1234",
      view: "ai",
      workspaceId: "workspace-1"
    }),
    "/workspace/ai/sltx-abcd-1234?workspaceId=workspace-1"
  );
});

test("repairs workspace identity without carrying conversation state across an invalid workspace", () => {
  assert.equal(
    repairWorkspaceNavigationUrl("https://slate.test/workspace?workspaceId=missing&view=messenger&conversationId=general-missing", "workspace-1"),
    "/workspace?workspaceId=workspace-1&view=dashboard"
  );
  assert.equal(
    repairWorkspaceNavigationUrl("https://slate.test/workspace/messenger?workspaceId=workspace-1&conversationId=general-1", "workspace-1"),
    "/workspace?workspaceId=workspace-1&view=dashboard"
  );
  assert.equal(
    repairWorkspaceNavigationUrl("https://slate.test/workspace/ai/sltx-abcd-1234?workspaceId=workspace-1", "workspace-1"),
    "/workspace/ai/sltx-abcd-1234?workspaceId=workspace-1"
  );
  assert.equal(
    repairWorkspaceNavigationUrl("https://slate.test/workspace/ai/sltx-abcd-1234", "workspace-1"),
    "/workspace/ai/sltx-abcd-1234?workspaceId=workspace-1"
  );
  assert.equal(
    repairWorkspaceNavigationUrl("https://slate.test/workspace/ai/sltx-abcd-1234?workspaceId=missing", "workspace-1"),
    "/workspace?workspaceId=workspace-1&view=ai"
  );
});

test("remembers AI conversations independently for each workspace", () => {
  const memory = new WorkspaceAiRouteMemory();
  memory.remember("workspace-1", "sltx-abcd-1234");
  memory.remember("workspace-2", "sltx-fedc-5678");
  memory.remember("workspace-1", "invalid");
  assert.equal(memory.get("workspace-1"), "sltx-abcd-1234");
  assert.equal(memory.get("workspace-2"), "sltx-fedc-5678");
  assert.equal(memory.get("workspace-3"), null);
});
