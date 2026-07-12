import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceAccessPolicy } from "../lib/server/workspaceAccessPolicy";

type Member = {
  role: "owner" | "editor" | "viewer";
  user?: {
    color: string;
    email: string;
    id: string;
    initials: string;
    name: string;
  };
};

function createPolicy(input: { blocked?: boolean; documentExists?: boolean; member?: Member | null }) {
  const calls: { documentWhere: unknown[]; memberWhere: unknown[] } = {
    documentWhere: [],
    memberWhere: []
  };
  const client = {
    document: {
      async findFirst(query: { where: unknown }) {
        calls.documentWhere.push(query.where);
        return input.documentExists === false ? null : { id: "document-1" };
      }
    },
    workspaceMember: {
      async findUnique(query: { where: unknown }) {
        calls.memberWhere.push(query.where);
        return input.member ?? null;
      }
    },
    workspaceBlock: {
      async findUnique() {
        return input.blocked ? { id: "block-1" } : null;
      }
    }
  };

  return {
    calls,
    policy: new WorkspaceAccessPolicy(client)
  };
}

function member(role: "owner" | "editor" | "viewer"): Member {
  return {
    role,
    user: {
      color: "blue",
      email: `${role}@slate.test`,
      id: `${role}-user`,
      initials: role.slice(0, 2).toUpperCase(),
      name: `${role} user`
    }
  };
}

test("workspace readers include viewers", async () => {
  const { policy } = createPolicy({ member: member("viewer") });
  const result = await policy.requireWorkspaceReader("viewer-user", "workspace-1");
  assert.equal(result.role, "viewer");
});

test("workspace writers reject viewers", async () => {
  const { policy } = createPolicy({ member: member("viewer") });
  await assert.rejects(
    () => policy.requireWorkspaceWriter("viewer-user", "workspace-1"),
    /Workspace access denied/
  );
});

test("workspace owners reject editors", async () => {
  const { policy } = createPolicy({ member: member("editor") });
  await assert.rejects(
    () => policy.requireWorkspaceOwner("editor-user", "workspace-1"),
    /Workspace access denied/
  );
});

test("workspace logs are available only to owners", async () => {
  const { policy: ownerPolicy } = createPolicy({ member: member("owner") });
  const { policy: editorPolicy } = createPolicy({ member: member("editor") });

  const owner = await ownerPolicy.requireWorkspaceLogReader("owner-user", "workspace-1");
  assert.equal(owner.role, "owner");
  await assert.rejects(
    () => editorPolicy.requireWorkspaceLogReader("editor-user", "workspace-1"),
    /Workspace access denied/
  );
});

test("missing memberships are denied", async () => {
  const { policy } = createPolicy({ member: null });
  await assert.rejects(
    () => policy.requireWorkspaceReader("outsider-user", "workspace-1"),
    /Workspace access denied/
  );
});

test("blocked members are denied even when membership exists", async () => {
  const { policy } = createPolicy({ blocked: true, member: member("editor") });
  await assert.rejects(
    () => policy.requireWorkspaceReader("editor-user", "workspace-1"),
    /Workspace access denied/
  );
});

test("realtime rooms reject malformed names", async () => {
  const { calls, policy } = createPolicy({ member: member("owner") });
  const grant = await policy.authorizeRealtimeRoom("owner-user", "bad-room");
  assert.equal(grant, null);
  assert.equal(calls.memberWhere.length, 0);
  assert.equal(calls.documentWhere.length, 0);
});

test("realtime rooms reject missing memberships", async () => {
  const { calls, policy } = createPolicy({ member: null });
  const grant = await policy.authorizeRealtimeRoom("outsider-user", "slate:room:workspace-1:file:document-1");
  assert.equal(grant, null);
  assert.equal(calls.memberWhere.length, 1);
  assert.equal(calls.documentWhere.length, 0);
});

test("realtime rooms reject blocked members before loading membership or document", async () => {
  const { calls, policy } = createPolicy({ blocked: true, member: member("editor") });
  const grant = await policy.authorizeRealtimeRoom("editor-user", "slate:room:workspace-1:file:document-1");
  assert.equal(grant, null);
  assert.equal(calls.memberWhere.length, 0);
  assert.equal(calls.documentWhere.length, 0);
});

test("realtime rooms reject missing documents", async () => {
  const { calls, policy } = createPolicy({ documentExists: false, member: member("editor") });
  const grant = await policy.authorizeRealtimeRoom("editor-user", "slate:room:workspace-1:file:document-1");
  assert.equal(grant, null);
  assert.deepEqual(calls.documentWhere[0], {
    archivedAt: null,
    id: "document-1",
    type: "code",
    workspaceId: "workspace-1"
  });
});

test("realtime room grants preserve viewer read-only access", async () => {
  const { policy } = createPolicy({ member: member("viewer") });
  const grant = await policy.authorizeRealtimeRoom("viewer-user", "slate:room:workspace-1:note:document-1");
  assert.equal(grant?.role, "viewer");
  assert.equal(grant?.canWrite, false);
});

test("realtime room grants allow editor writes", async () => {
  const { calls, policy } = createPolicy({ member: member("editor") });
  const grant = await policy.authorizeRealtimeRoom("editor-user", "slate:room:workspace-1:canvas:document-1");
  assert.equal(grant?.role, "editor");
  assert.equal(grant?.canWrite, true);
  assert.deepEqual(calls.documentWhere[0], {
    archivedAt: null,
    id: "document-1",
    type: "canvas",
    workspaceId: "workspace-1"
  });
});
