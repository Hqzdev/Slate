import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceRole } from "@prisma/client";
import { MessengerAccessPolicy } from "../lib/server/messenger/accessPolicy";
import { MessengerDomainError } from "../lib/server/messenger/errors";

type PolicyInput = {
  activated?: boolean;
  blocked?: boolean;
  conversationExists?: boolean;
  conversationWorkspaceId?: string;
  kind?: "general" | "direct";
  opened?: boolean;
  role?: WorkspaceRole;
  workspaceMemberExists?: boolean;
  workspacePolicyDenied?: boolean;
};

function createPolicy(input: PolicyInput = {}) {
  const role = input.role ?? "editor";
  const workspaceId = input.conversationWorkspaceId ?? "workspace-1";
  const membership = {
    conversation: {
      activatedAt: input.activated === false ? null : new Date(),
      createdAt: new Date(),
      createdByUserId: null,
      directPairKey: input.kind === "direct" ? "a:b" : null,
      generalKey: input.kind === "direct" ? null : workspaceId,
      id: "conversation-1",
      kind: input.kind ?? "general",
      lastMessageAt: null,
      lastMessageSequence: BigInt(0),
      retainedFromSequence: BigInt(1),
      updatedAt: new Date(),
      workspaceId
    },
    conversationId: "conversation-1",
    createdAt: new Date(),
    historyFromSequence: BigInt(1),
    id: "membership-1",
    joinedAt: new Date(),
    openedAt: input.opened ? new Date() : null,
    revokedAt: null,
    state: "active" as const,
    updatedAt: new Date(),
    userId: "user-1"
  };
  const client = {
    messengerConversationMember: {
      async findFirst(query: { where: { conversation: { workspaceId: string }; conversationId: string; userId: string } }) {
        if (input.conversationExists === false) return null;
        if (query.where.conversationId !== membership.conversationId || query.where.userId !== membership.userId) return null;
        if (query.where.conversation.workspaceId !== membership.conversation.workspaceId) return null;
        return membership;
      }
    },
    workspaceBlock: {
      async findUnique() {
        return input.blocked ? { id: "block-1" } : null;
      }
    },
    workspaceMember: {
      async findUnique() {
        return input.workspaceMemberExists === false ? null : {
          createdAt: new Date(),
          id: "workspace-member-1",
          messengerAccessVersion: 3,
          role,
          userId: "user-1",
          workspaceId: "workspace-1"
        };
      }
    }
  };
  const workspacePolicy = {
    async requireWorkspaceReader() {
      if (input.workspacePolicyDenied) throw new Error("Workspace access denied");
      return { role };
    }
  };
  return {
    client,
    policy: new MessengerAccessPolicy(client as never, workspacePolicy)
  };
}

function assertCode(error: unknown, code: string) {
  assert.ok(error instanceof MessengerDomainError);
  assert.equal(error.code, code);
  return true;
}

test("owner and editor can write while viewers remain read-only", async () => {
  await createPolicy({ role: "owner" }).policy.requireConversationWriter("user-1", "workspace-1", "conversation-1");
  await createPolicy({ role: "editor" }).policy.requireConversationWriter("user-1", "workspace-1", "conversation-1");
  await createPolicy({ role: "viewer" }).policy.requireConversationReader("user-1", "workspace-1", "conversation-1");
  await assert.rejects(
    () => createPolicy({ role: "viewer" }).policy.requireConversationWriter("user-1", "workspace-1", "conversation-1"),
    (error) => assertCode(error, "workspace_write_denied")
  );
});

test("workspace denials collapse to a non-enumerating resource response", async () => {
  await assert.rejects(
    () => createPolicy({ workspacePolicyDenied: true }).policy.requireConversationReader("user-1", "workspace-1", "conversation-1"),
    (error) => assertCode(error, "resource_not_found")
  );
});

test("wrong-workspace and missing conversation membership use the same response", async () => {
  await assert.rejects(
    () => createPolicy({ conversationWorkspaceId: "workspace-2" }).policy.requireConversationReader("user-1", "workspace-1", "conversation-1"),
    (error) => assertCode(error, "conversation_not_found")
  );
  await assert.rejects(
    () => createPolicy({ conversationExists: false }).policy.requireConversationReader("user-1", "workspace-1", "conversation-1"),
    (error) => assertCode(error, "conversation_not_found")
  );
});

test("provisional direct conversations require explicit open visibility", async () => {
  await assert.rejects(
    () => createPolicy({ activated: false, kind: "direct" }).policy.requireConversationReader("user-1", "workspace-1", "conversation-1"),
    (error) => assertCode(error, "conversation_not_found")
  );
  const membership = await createPolicy({ activated: false, kind: "direct", opened: true }).policy
    .requireConversationReader("user-1", "workspace-1", "conversation-1");
  assert.equal(membership.conversation.kind, "direct");
});

test("transactional checks deny blocked and missing workspace memberships", async () => {
  const blocked = createPolicy({ blocked: true });
  await assert.rejects(
    () => blocked.policy.requireConversationReaderWithClient(blocked.client as never, "user-1", "workspace-1", "conversation-1"),
    (error) => assertCode(error, "resource_not_found")
  );
  const missing = createPolicy({ workspaceMemberExists: false });
  await assert.rejects(
    () => missing.policy.requireConversationWriterWithClient(missing.client as never, "user-1", "workspace-1", "conversation-1"),
    (error) => assertCode(error, "resource_not_found")
  );
});

test("realtime access returns the current membership epoch and rejects blocks", async () => {
  const allowed = await createPolicy({ role: "viewer" }).policy.requireRealtimeWorkspaceAccess("user-1", "workspace-1");
  assert.deepEqual({ accessVersion: allowed.messengerAccessVersion, id: allowed.id, role: allowed.role }, {
    accessVersion: 3,
    id: "workspace-member-1",
    role: "viewer"
  });
  await assert.rejects(
    () => createPolicy({ blocked: true }).policy.requireRealtimeWorkspaceAccess("user-1", "workspace-1"),
    (error) => assertCode(error, "resource_not_found")
  );
});
