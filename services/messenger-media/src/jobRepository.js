import { randomUUID } from "node:crypto";

export class MediaJobRepository {
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
      const result = await client.query(
        `WITH candidates AS (
           SELECT job.id
           FROM "MessengerMediaJob" job
           JOIN "MessengerMessageAttachment" attachment ON attachment.id = job."attachmentId"
           WHERE job.status IN ('pending', 'processing')
             AND job."availableAt" <= NOW()
             AND (job.status = 'pending' OR job."leaseExpiresAt" <= NOW())
             AND attachment.status IN ('uploaded', 'scanning')
           ORDER BY job."createdAt", job.id
           FOR UPDATE OF job SKIP LOCKED
           LIMIT $1
         )
         UPDATE "MessengerMediaJob" job
         SET status = 'processing',
             "leaseOwner" = $2,
             "leaseExpiresAt" = NOW() + ($3 * INTERVAL '1 millisecond'),
             "attemptCount" = job."attemptCount" + 1
         FROM candidates
         WHERE job.id = candidates.id
         RETURNING job.id, job."attachmentId", job."attemptCount"`,
        [this.batchSize, this.owner, this.leaseDurationMs]
      );
      const jobs = [];
      for (const claimed of result.rows) {
        const attachmentResult = await client.query(
          `UPDATE "MessengerMessageAttachment"
           SET status = 'scanning', "scanStartedAt" = COALESCE("scanStartedAt", NOW())
           WHERE id = $1 AND status IN ('uploaded', 'scanning')
           RETURNING id, kind, "storageKey", "declaredContentType", "declaredByteSize",
                     "workspaceId", "conversationId", "createdByUserId"`,
          [claimed.attachmentId]
        );
        const attachment = attachmentResult.rows[0];
        if (attachment) jobs.push({ ...attachment, attemptCount: claimed.attemptCount, jobId: claimed.id });
      }
      await client.query("COMMIT");
      return jobs;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async markReady(job, result) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE "MessengerMessageAttachment" attachment
         SET status = 'ready',
             "detectedContentType" = $3,
             "verifiedByteSize" = $4,
             "checksumSha256" = $5,
             width = $6,
             height = $7,
             "durationMs" = $8,
             "thumbnailStorageKey" = $9,
             "posterStorageKey" = $10,
             "readyAt" = NOW(),
             "expiresAt" = NOW() + INTERVAL '24 hours'
         WHERE attachment.id = $1
           AND attachment.status = 'scanning'
           AND EXISTS (
             SELECT 1
             FROM "WorkspaceMember" member
             JOIN "MessengerConversationMember" conversation_member
               ON conversation_member."conversationId" = attachment."conversationId"
              AND conversation_member."userId" = attachment."createdByUserId"
              AND conversation_member.state = 'active'
             LEFT JOIN "WorkspaceBlock" block
               ON block."workspaceId" = member."workspaceId"
              AND block."userId" = member."userId"
             WHERE member."workspaceId" = attachment."workspaceId"
               AND member."userId" = attachment."createdByUserId"
               AND member.role IN ('owner', 'editor')
               AND block.id IS NULL
           )
           AND EXISTS (
             SELECT 1 FROM "MessengerMediaJob" job
             WHERE job.id = $2 AND job."attachmentId" = attachment.id
               AND job.status = 'processing' AND job."leaseOwner" = $11
           )
         RETURNING attachment.id`,
        [
          job.id,
          job.jobId,
          result.contentType,
          result.byteSize,
          result.checksumSha256,
          result.width,
          result.height,
          result.durationMs,
          result.thumbnailStorageKey,
          result.posterStorageKey,
          this.owner
        ]
      );
      const status = updated.rowCount === 1 ? "ready" : "rejected";
      if (updated.rowCount !== 1) {
        await client.query(
          `UPDATE "MessengerMessageAttachment" SET status = 'rejected', "rejectionCode" = 'access_revoked'
           WHERE id = $1 AND status = 'scanning'`,
          [job.id]
        );
      }
      await this.completeJob(client, job.jobId);
      await this.appendEvent(client, job, status);
      await client.query("COMMIT");
      return status;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async reject(job, rejectionCode) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const changed = await client.query(
        `UPDATE "MessengerMessageAttachment" attachment
         SET status = 'rejected', "rejectionCode" = $3
         WHERE attachment.id = $1 AND attachment.status = 'scanning'
           AND EXISTS (
             SELECT 1 FROM "MessengerMediaJob" job
             WHERE job.id = $2 AND job."attachmentId" = attachment.id
               AND job.status = 'processing' AND job."leaseOwner" = $4
           )`,
        [job.id, job.jobId, rejectionCode, this.owner]
      );
      if (changed.rowCount === 1) {
        await this.completeJob(client, job.jobId);
        await this.appendEvent(client, job, "rejected");
      }
      await client.query("COMMIT");
      return changed.rowCount === 1;
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
      `WITH released AS (
         UPDATE "MessengerMediaJob"
         SET status = 'pending',
             "availableAt" = NOW() + ($4 * INTERVAL '1 millisecond'),
             "leaseOwner" = NULL,
             "leaseExpiresAt" = NULL,
             "lastErrorCode" = $3
         WHERE id = $1 AND status = 'processing' AND "leaseOwner" = $2
         RETURNING "attachmentId"
       )
       UPDATE "MessengerMessageAttachment" attachment
       SET status = 'uploaded'
       FROM released
       WHERE attachment.id = released."attachmentId" AND attachment.status = 'scanning'`,
      [job.jobId, this.owner, errorCode, delayMs]
    );
    return result.rowCount === 1;
  }

  async release() {
    await this.pool.query(
      `WITH released AS (
         UPDATE "MessengerMediaJob"
         SET status = 'pending', "leaseOwner" = NULL, "leaseExpiresAt" = NULL
         WHERE status = 'processing' AND "leaseOwner" = $1
         RETURNING "attachmentId"
       )
       UPDATE "MessengerMessageAttachment" attachment
       SET status = 'uploaded'
       FROM released
       WHERE attachment.id = released."attachmentId" AND attachment.status = 'scanning'`,
      [this.owner]
    );
  }

  async completeJob(client, jobId) {
    await client.query(
      `UPDATE "MessengerMediaJob"
       SET status = 'completed', "completedAt" = NOW(), "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "lastErrorCode" = NULL
       WHERE id = $1 AND status = 'processing' AND "leaseOwner" = $2`,
      [jobId, this.owner]
    );
  }

  async appendEvent(client, job, status) {
    await client.query(
      `INSERT INTO "MessengerOutboxEvent"
       (id, "eventId", type, payload, status, "attemptCount", "availableAt", "createdAt", "workspaceId", "conversationId", "targetUserId")
       VALUES ($1, $2, 'attachment.changed', $3::jsonb, 'pending', 0, NOW(), NOW(), $4, $5, $6)`,
      [randomUUID(), randomUUID(), JSON.stringify({ attachmentId: job.id, status }), job.workspaceId, job.conversationId, job.createdByUserId]
    );
  }
}
