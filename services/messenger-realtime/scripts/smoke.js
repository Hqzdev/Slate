import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { WebSocket } from "ws";
import { loadEnvironment, readConfiguration } from "../src/configuration.js";

loadEnvironment();

const configuration = readConfiguration();
const pool = new pg.Pool({ connectionString: configuration.databaseUrl, max: 2 });
let insertedEventId = null;

try {
  const access = await pool.query(
    `SELECT wm.id AS "membershipId", wm."userId", wm."workspaceId", wm.role, wm."messengerAccessVersion" AS "accessVersion", m."conversationId"
     FROM "WorkspaceMember" wm
     JOIN "MessengerConversation" c ON c."workspaceId" = wm."workspaceId" AND c.kind = 'general'
     JOIN "MessengerConversationMember" m ON m."conversationId" = c.id AND m."userId" = wm."userId" AND m.state = 'active'
     LEFT JOIN "WorkspaceBlock" wb ON wb."workspaceId" = wm."workspaceId" AND wb."userId" = wm."userId"
     WHERE wb.id IS NULL
     LIMIT 1`
  );
  const member = access.rows[0];
  if (!member) throw new Error("No active Messenger membership is available for smoke testing");
  const grant = createGrant(configuration, member);
  const readyAndEvent = new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${configuration.port}/messenger?grant=${encodeURIComponent(grant)}`, {
      origin: "http://localhost:3000"
    });
    let ready = false;
    const timer = setTimeout(() => reject(new Error("Messenger realtime smoke test timed out")), 5_000);
    socket.on("message", async (data) => {
      const frame = JSON.parse(data.toString());
      if (frame.type === "ready" && !ready) {
        ready = true;
        insertedEventId = randomUUID();
        await pool.query(
          `INSERT INTO "MessengerOutboxEvent" (id, "eventId", type, payload, status, "attemptCount", "availableAt", "createdAt", "workspaceId", "conversationId")
           VALUES ($1, $2, 'conversation.changed', $3::jsonb, 'pending', 0, NOW(), NOW(), $4, $5)`,
          [randomUUID(), insertedEventId, JSON.stringify({ conversationId: member.conversationId }), member.workspaceId, member.conversationId]
        );
        return;
      }
      if (frame.eventId === insertedEventId) {
        clearTimeout(timer);
        socket.close(1000, "Smoke test complete");
        resolve(frame);
      }
    });
    socket.on("error", reject);
  });
  const frame = await readyAndEvent;
  process.stdout.write(`${JSON.stringify({ eventId: frame.eventId, status: "ok", type: frame.type })}\n`);
} finally {
  if (insertedEventId) await pool.query(`DELETE FROM "MessengerOutboxEvent" WHERE "eventId" = $1`, [insertedEventId]);
  await pool.end();
}

function createGrant(configuration, member) {
  const keySet = configuration.grantKeys
    ? JSON.parse(configuration.grantKeys)
    : { "local-development-v1": Buffer.from("slate-messenger-realtime-local-key-v1", "utf8").toString("base64") };
  const kid = configuration.grantActiveKid ?? "local-development-v1";
  const issuedAt = Math.floor(Date.now() / 1_000);
  const claims = {
    accessVersion: member.accessVersion,
    aud: "slate-messenger",
    exp: issuedAt + 120,
    iat: issuedAt,
    jti: randomUUID(),
    kid,
    membershipId: member.membershipId,
    role: member.role,
    sub: member.userId,
    v: 1,
    workspaceId: member.workspaceId
  };
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", Buffer.from(keySet[kid], "base64")).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}
