import { WebSocket } from "ws";

const maximumBufferedBytes = 1_048_576;

export class ConnectionRegistry {
  constructor(accessRepository) {
    this.accessRepository = accessRepository;
    this.byWorkspace = new Map();
  }

  add(session) {
    const sessions = this.byWorkspace.get(session.claims.workspaceId) ?? new Set();
    sessions.add(session);
    this.byWorkspace.set(session.claims.workspaceId, sessions);
  }

  remove(session) {
    const sessions = this.byWorkspace.get(session.claims.workspaceId);
    if (!sessions) return;
    sessions.delete(session);
    if (sessions.size === 0) this.byWorkspace.delete(session.claims.workspaceId);
  }

  async dispatch(envelope) {
    const sessions = [...(this.byWorkspace.get(envelope.workspaceId) ?? [])];
    await Promise.all(sessions.map((session) => this.dispatchToSession(session, envelope)));
  }

  async dispatchToSession(session, envelope) {
    if (envelope.targetUserId && envelope.targetUserId !== session.claims.sub) return;
    if (envelope.type === "access.revoked") {
      session.socket.close(4003, "Messenger access changed");
      return;
    }
    if (envelope.type === "capabilities.changed") {
      session.socket.close(4004, "Messenger capabilities changed");
      return;
    }
    if (envelope.type === "conversation.added" && envelope.conversationId) {
      if (await this.accessRepository.canAccessConversation(session.claims.sub, envelope.workspaceId, envelope.conversationId)) {
        session.conversationIds.add(envelope.conversationId);
      }
    }
    if (envelope.conversationId && !session.conversationIds.has(envelope.conversationId)) return;
    if (session.socket.readyState !== WebSocket.OPEN) return;
    const message = JSON.stringify(publicEnvelope(envelope));
    if (Buffer.byteLength(message) > 16_384 || session.socket.bufferedAmount + Buffer.byteLength(message) > maximumBufferedBytes) {
      session.socket.close(4011, "Messenger client is too slow");
      return;
    }
    session.socket.send(message);
  }

  closeAll(code, reason) {
    for (const sessions of this.byWorkspace.values()) {
      for (const session of sessions) session.socket.close(code, reason);
    }
  }
}

function publicEnvelope(envelope) {
  const { targetUserId: _, ...publicValue } = envelope;
  return publicValue;
}
