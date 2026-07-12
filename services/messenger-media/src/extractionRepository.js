import { randomUUID } from "node:crypto";

export class AiExtractionRepository {
  constructor(pool, options) {
    this.batchSize = options.batchSize;
    this.leaseDurationMs = options.leaseDurationMs;
    this.owner = options.owner;
    this.pool = pool;
  }

  async claim() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query(
        `WITH candidates AS (
           SELECT selected.id
           FROM "MessengerAiInvocationAttachment" selected
           JOIN "MessengerAiInvocation" invocation ON invocation.id = selected."invocationId"
           JOIN "MessengerMessageAttachment" attachment ON attachment.id = selected."attachmentId"
           WHERE invocation.status = 'queued'
             AND selected."availableAt" <= NOW()
             AND selected."expiresAt" > NOW()
             AND attachment.status = 'attached'
             AND (
               selected."extractionStatus" = 'pending'
               OR (selected."extractionStatus" = 'processing' AND selected."processingStartedAt" <= NOW() - ($2 * INTERVAL '1 millisecond'))
             )
           ORDER BY selected."consentedAt", selected.id
           FOR UPDATE OF selected SKIP LOCKED
           LIMIT $1
         )
         UPDATE "MessengerAiInvocationAttachment" selected
         SET "extractionStatus" = 'processing',
             "processingLeaseId" = $3,
             "processingStartedAt" = NOW(),
             "attemptCount" = selected."attemptCount" + 1
         FROM candidates
         WHERE selected.id = candidates.id
         RETURNING selected.id`,
        [this.batchSize, this.leaseDurationMs, this.owner]
      );
      const ids = claimed.rows.map((row) => row.id);
      if (ids.length === 0) {
        await client.query("COMMIT");
        return [];
      }
      const result = await client.query(
        `SELECT selected.id,
                selected."attemptCount",
                selected."attachmentId",
                selected."invocationId",
                invocation."workspaceId",
                invocation."conversationId",
                invocation."requestedByUserId",
                attachment."storageKey",
                attachment."detectedContentType",
                attachment."verifiedByteSize",
                envelope.algorithm AS "keyAlgorithm",
                envelope."kmsKeyId",
                envelope.version AS "keyVersion",
                envelope."wrapNonce",
                envelope."wrappedDataKey"
         FROM "MessengerAiInvocationAttachment" selected
         JOIN "MessengerAiInvocation" invocation ON invocation.id = selected."invocationId"
         JOIN "MessengerMessageAttachment" attachment ON attachment.id = selected."attachmentId"
         JOIN "MessengerKeyEnvelope" envelope ON envelope."workspaceId" = invocation."workspaceId" AND envelope.state = 'active'
         WHERE selected.id = ANY($1::text[]) AND selected."processingLeaseId" = $2`,
        [ids, this.owner]
      );
      await client.query("COMMIT");
      return result.rows;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(job, encrypted, characterCount, contentHash) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE "MessengerAiInvocationAttachment" selected
         SET "extractionStatus" = 'completed',
             "extractCiphertext" = $3,
             "extractNonce" = $4,
             "extractKeyVersion" = $5,
             "verifiedContentHash" = $6,
             "characterCount" = $7,
             "processingLeaseId" = NULL,
             "processingStartedAt" = NULL,
             "errorCode" = NULL
         WHERE selected.id = $1
           AND selected."processingLeaseId" = $2
           AND selected."extractionStatus" = 'processing'
           AND selected."expiresAt" > NOW()
           AND EXISTS (
             SELECT 1
             FROM "MessengerAiInvocation" invocation
             JOIN "WorkspaceMember" member ON member."workspaceId" = invocation."workspaceId" AND member."userId" = invocation."requestedByUserId"
             JOIN "MessengerConversationMember" conversation_member ON conversation_member."conversationId" = invocation."conversationId" AND conversation_member."userId" = invocation."requestedByUserId" AND conversation_member.state = 'active'
             LEFT JOIN "WorkspaceBlock" block ON block."workspaceId" = invocation."workspaceId" AND block."userId" = invocation."requestedByUserId"
             WHERE invocation.id = selected."invocationId"
               AND invocation.status = 'queued'
               AND member.role IN ('owner', 'editor')
               AND block.id IS NULL
           )
           AND COALESCE((
             SELECT SUM(other."characterCount")
             FROM "MessengerAiInvocationAttachment" other
             WHERE other."invocationId" = selected."invocationId" AND other."extractionStatus" = 'completed'
           ), 0) + $7 <= 32000
         RETURNING selected.id`,
        [job.id, this.owner, encrypted.ciphertext, encrypted.nonce, encrypted.keyVersion, contentHash, characterCount]
      );
      await client.query("COMMIT");
      return updated.rowCount === 1;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async reject(job, errorCode) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const failed = await client.query(
        `UPDATE "MessengerAiInvocationAttachment"
         SET "extractionStatus" = 'failed', "errorCode" = $3, "processingLeaseId" = NULL, "processingStartedAt" = NULL
         WHERE id = $1 AND "processingLeaseId" = $2 AND "extractionStatus" = 'processing'
         RETURNING "invocationId"`,
        [job.id, this.owner, errorCode]
      );
      const invocationId = failed.rows[0]?.invocationId;
      if (invocationId) {
        const invocation = await client.query(
          `UPDATE "MessengerAiInvocation"
           SET status = 'failed', "errorCode" = $2
           WHERE id = $1 AND status = 'queued'
           RETURNING id, "workspaceId", "conversationId"`,
          [invocationId, errorCode]
        );
        if (invocation.rowCount === 1) await this.appendEvent(client, invocation.rows[0], "failed");
      }
      await client.query("COMMIT");
      return failed.rowCount === 1;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async retry(job, errorCode) {
    const delayMs = Math.min(60_000, 1_000 * (2 ** Math.min(job.attemptCount - 1, 6)));
    const result = await this.pool.query(
      `UPDATE "MessengerAiInvocationAttachment"
       SET "extractionStatus" = 'pending',
           "availableAt" = NOW() + ($4 * INTERVAL '1 millisecond'),
           "processingLeaseId" = NULL,
           "processingStartedAt" = NULL,
           "errorCode" = $3
       WHERE id = $1 AND "processingLeaseId" = $2 AND "extractionStatus" = 'processing'`,
      [job.id, this.owner, errorCode, delayMs]
    );
    return result.rowCount === 1;
  }

  async release() {
    await this.pool.query(
      `UPDATE "MessengerAiInvocationAttachment"
       SET "extractionStatus" = 'pending', "processingLeaseId" = NULL, "processingStartedAt" = NULL
       WHERE "extractionStatus" = 'processing' AND "processingLeaseId" = $1`,
      [this.owner]
    );
  }

  async appendEvent(client, invocation, status) {
    await client.query(
      `INSERT INTO "MessengerOutboxEvent"
       (id, "eventId", type, payload, status, "attemptCount", "availableAt", "createdAt", "workspaceId", "conversationId", "targetUserId")
       VALUES ($1, $2, 'ai.invocation.changed', $3::jsonb, 'pending', 0, NOW(), NOW(), $4, $5, NULL)`,
      [randomUUID(), randomUUID(), JSON.stringify({ invocationId: invocation.id, status }), invocation.workspaceId, invocation.conversationId]
    );
  }
}
