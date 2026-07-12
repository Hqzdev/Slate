export class AccessRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async authorize(claims) {
    const membership = await this.pool.query(
      `SELECT wm.id, wm.role, wm."messengerAccessVersion"
       FROM "WorkspaceMember" wm
       LEFT JOIN "WorkspaceBlock" wb ON wb."workspaceId" = wm."workspaceId" AND wb."userId" = wm."userId"
       WHERE wm.id = $1 AND wm."workspaceId" = $2 AND wm."userId" = $3 AND wb.id IS NULL`,
      [claims.membershipId, claims.workspaceId, claims.sub]
    );
    const row = membership.rows[0];
    if (!row || row.role !== claims.role || row.messengerAccessVersion !== claims.accessVersion) return null;
    return {
      conversationIds: await this.listConversationIds(claims.sub, claims.workspaceId),
      role: row.role
    };
  }

  async listConversationIds(userId, workspaceId) {
    const result = await this.pool.query(
      `SELECT m."conversationId"
       FROM "MessengerConversationMember" m
       JOIN "MessengerConversation" c ON c.id = m."conversationId"
       WHERE m."userId" = $1 AND c."workspaceId" = $2 AND m.state = 'active'
         AND (c.kind = 'general' OR c."activatedAt" IS NOT NULL OR m."openedAt" IS NOT NULL)`,
      [userId, workspaceId]
    );
    return new Set(result.rows.map((row) => row.conversationId));
  }

  async canAccessConversation(userId, workspaceId, conversationId) {
    const result = await this.pool.query(
      `SELECT 1
       FROM "MessengerConversationMember" m
       JOIN "MessengerConversation" c ON c.id = m."conversationId"
       WHERE m."userId" = $1 AND c."workspaceId" = $2 AND m."conversationId" = $3 AND m.state = 'active'
         AND (c.kind = 'general' OR c."activatedAt" IS NOT NULL OR m."openedAt" IS NOT NULL)`,
      [userId, workspaceId, conversationId]
    );
    return result.rowCount === 1;
  }
}
