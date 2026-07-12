export class OutboxLeaseRepository {
  constructor(pool, options) {
    this.pool = pool;
    this.batchSize = options.batchSize;
    this.leaseDurationMs = options.leaseDurationMs;
    this.owner = options.owner;
  }

  async claim() {
    const result = await this.pool.query(
      `WITH candidates AS (
         SELECT id
         FROM "MessengerOutboxEvent"
         WHERE status = 'pending'
           AND "availableAt" <= NOW()
           AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= NOW())
         ORDER BY "createdAt", id
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE "MessengerOutboxEvent" event
       SET "leaseOwner" = $2,
           "leaseExpiresAt" = NOW() + ($3 * INTERVAL '1 millisecond'),
           "attemptCount" = event."attemptCount" + 1
       FROM candidates
       WHERE event.id = candidates.id
       RETURNING event.id, event."eventId", event.type, event.payload, event."workspaceId",
                 event."conversationId", event."targetUserId", event."createdAt", event."attemptCount"`,
      [this.batchSize, this.owner, this.leaseDurationMs]
    );
    return result.rows;
  }

  async acknowledge(id) {
    const result = await this.pool.query(
      `UPDATE "MessengerOutboxEvent"
       SET status = 'published', "publishedAt" = NOW(), "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "lastErrorCode" = NULL
       WHERE id = $1 AND status = 'pending' AND "leaseOwner" = $2`,
      [id, this.owner]
    );
    return result.rowCount === 1;
  }

  async retry(id, attemptCount, errorCode) {
    if (attemptCount >= 12) {
      const failed = await this.pool.query(
        `UPDATE "MessengerOutboxEvent"
         SET status = 'failed', "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "lastErrorCode" = $3
         WHERE id = $1 AND status = 'pending' AND "leaseOwner" = $2`,
        [id, this.owner, errorCode]
      );
      return failed.rowCount === 1;
    }
    const delayMs = Math.min(30_000, 250 * (2 ** Math.min(attemptCount - 1, 7)));
    const result = await this.pool.query(
      `UPDATE "MessengerOutboxEvent"
       SET "availableAt" = NOW() + ($3 * INTERVAL '1 millisecond'),
           "leaseOwner" = NULL,
           "leaseExpiresAt" = NULL,
           "lastErrorCode" = $4
       WHERE id = $1 AND status = 'pending' AND "leaseOwner" = $2`,
      [id, this.owner, delayMs, errorCode]
    );
    return result.rowCount === 1;
  }

  async release() {
    await this.pool.query(
      `UPDATE "MessengerOutboxEvent"
       SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL
       WHERE status = 'pending' AND "leaseOwner" = $1`,
      [this.owner]
    );
  }
}
