import assert from "node:assert/strict";
import test from "node:test";
import { MessengerKeyEnvelopeService } from "../lib/server/messenger/keyEnvelopeService";

test("key rotation moves the prior data key to decrypt-only and audits the new version", async () => {
  const calls: Array<{ name: string; value?: unknown }> = [];
  const transaction = {
    auditEvent: {
      async create(input: { data: { metadata: unknown; type: string; workspaceId: string | null } }) {
        calls.push({ name: "audit", value: input.data });
        return {};
      }
    },
    messengerKeyEnvelope: {
      async create(input: { data: { kmsKeyId: string; version: number } }) {
        calls.push({ name: "create", value: input.data });
        return { kmsKeyId: input.data.kmsKeyId, version: input.data.version };
      },
      async findFirst(input: { select?: { version: true } }) {
        return input.select ? { version: 4 } : { id: "key-4", version: 4 };
      },
      async updateMany(input: { data: { state: string } }) {
        calls.push({ name: "deactivate", value: input.data.state });
        return { count: 1 };
      }
    }
  };
  const client = {
    async $transaction<T>(operation: (client: typeof transaction) => Promise<T>) {
      return operation(transaction);
    }
  };
  const codec = {
    prepareWorkspaceKey(_workspaceId: string, version: number) {
      return {
        algorithm: "aes-256-gcm-v1",
        kmsKeyId: "new-key",
        version,
        wrapNonce: Buffer.alloc(12, 1),
        wrappedDataKey: Buffer.alloc(48, 2)
      };
    },
    unwrapWorkspaceKey() {
      return Buffer.alloc(32, 1);
    }
  };
  const service = new MessengerKeyEnvelopeService(client as never, codec as never);

  assert.deepEqual(await service.rotateActiveKey("workspace-1"), { kmsKeyId: "new-key", version: 5 });
  assert.equal(calls[0]?.name, "deactivate");
  assert.equal(calls[0]?.value, "decrypt_only");
  const created = calls[1]?.value as { activatedAt: Date; algorithm: string; kmsKeyId: string; state: string; version: number; workspaceId: string };
  assert.equal(calls[1]?.name, "create");
  assert.ok(created.activatedAt instanceof Date);
  assert.equal(created.algorithm, "aes-256-gcm-v1");
  assert.equal(created.kmsKeyId, "new-key");
  assert.equal(created.state, "active");
  assert.equal(created.version, 5);
  assert.equal(created.workspaceId, "workspace-1");
  assert.deepEqual(calls[2], {
    name: "audit",
    value: {
      actorUserId: null,
      documentId: null,
      metadata: { keyVersion: 5 },
      targetUserId: null,
      type: "messenger.key.rotated",
      workspaceId: "workspace-1"
    }
  });
});
