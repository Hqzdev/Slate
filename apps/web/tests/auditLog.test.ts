import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { AuditLogService } from "../lib/server/auditLog";

test("audit log records explicit fields", async () => {
  const writes: unknown[] = [];
  const service = new AuditLogService();
  const client = {
    auditEvent: {
      async create(input: unknown) {
        writes.push(input);
      }
    }
  };

  await service.recordWithClient(client, {
    actorUserId: "actor-1",
    metadata: { role: "editor" },
    targetUserId: "target-1",
    type: "member.role_changed",
    workspaceId: "workspace-1"
  });

  assert.deepEqual(writes[0], {
    data: {
      actorUserId: "actor-1",
      documentId: null,
      metadata: { role: "editor" },
      targetUserId: "target-1",
      type: "member.role_changed",
      workspaceId: "workspace-1"
    }
  });
});

test("audit log normalizes omitted optional fields", async () => {
  const writes: unknown[] = [];
  const service = new AuditLogService();
  const client = {
    auditEvent: {
      async create(input: unknown) {
        writes.push(input);
      }
    }
  };

  await service.recordWithClient(client, {
    type: "auth.login_failed"
  });

  assert.deepEqual(writes[0], {
    data: {
      actorUserId: null,
      documentId: null,
      metadata: Prisma.JsonNull,
      targetUserId: null,
      type: "auth.login_failed",
      workspaceId: null
    }
  });
});
