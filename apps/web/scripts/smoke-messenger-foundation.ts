import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inviteRepository } from "../lib/server/inviteRepository";
import { prisma } from "../lib/server/prisma";
import { redis } from "../lib/server/redis";
import { MessengerDomainError } from "../lib/server/messenger/errors";
import { messengerKeyEnvelopeService } from "../lib/server/messenger/keyEnvelopeService";
import { messengerProvisioningService } from "../lib/server/messenger/provisioningService";
import { messengerRepository } from "../lib/server/messenger/repository";
import { workspaceRepository } from "../lib/server/workspaceRepository";

async function main() {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  if (!databaseUrl.pathname.toLowerCase().includes("test")) {
    throw new Error("Messenger smoke test requires a database name containing test");
  }
  const suffix = randomUUID();
  const owner = await prisma.user.create({
    data: {
      color: "blue",
      email: `messenger-owner-${suffix}@test.invalid`,
      initials: "OW",
      name: "Messenger Owner"
    }
  });
  const viewer = await prisma.user.create({
    data: {
      color: "gray",
      email: `messenger-viewer-${suffix}@test.invalid`,
      initials: "VW",
      name: "Messenger Viewer"
    }
  });
  const workspaceId = randomUUID();
  try {
    const preparedKeyEnvelope = messengerKeyEnvelopeService.prepareWorkspaceKey(workspaceId);
    const general = await prisma.$transaction(async (transaction) => {
      await transaction.workspace.create({
        data: {
          createdByUserId: owner.id,
          id: workspaceId,
          name: "Messenger Smoke",
          slug: `messenger-smoke-${suffix}`
        }
      });
      await transaction.workspaceSettings.create({ data: { workspaceId } });
      const ownerMember = await transaction.workspaceMember.create({
        data: { role: "owner", userId: owner.id, workspaceId }
      });
      const provisioned = await messengerProvisioningService.provisionGeneral(transaction, {
        member: ownerMember,
        now: new Date(),
        preparedKeyEnvelope
      });
      return provisioned;
    });
    const invitation = await inviteRepository.createInvite({
      createdByUserId: owner.id,
      email: viewer.email,
      role: "viewer",
      workspaceId
    });
    await inviteRepository.acceptInviteById(viewer.id, invitation.invite.id);
    const sendInput = {
      body: "Encrypted smoke message",
      clientRequestId: randomUUID()
    };
    const created = await messengerRepository.sendMessage(owner.id, workspaceId, general.conversationId, sendInput);
    const replay = await messengerRepository.sendMessage(owner.id, workspaceId, general.conversationId, sendInput);
    let conflictCode: string | null = null;
    try {
      await messengerRepository.sendMessage(owner.id, workspaceId, general.conversationId, {
        ...sendInput,
        body: "Conflicting body"
      });
    } catch (error) {
      conflictCode = error instanceof MessengerDomainError ? error.code : null;
    }
    let viewerWriteCode: string | null = null;
    try {
      await messengerRepository.sendMessage(viewer.id, workspaceId, general.conversationId, {
        body: "Forbidden viewer write",
        clientRequestId: randomUUID()
      });
    } catch (error) {
      viewerWriteCode = error instanceof MessengerDomainError ? error.code : null;
    }
    const viewerUnreadBefore = await messengerRepository.listUnread(viewer.id, workspaceId);
    await messengerRepository.updateReceipt(viewer.id, workspaceId, general.conversationId, {
      deliveredThroughSequence: BigInt(1),
      readThroughSequence: BigInt(1)
    });
    const viewerUnreadAfter = await messengerRepository.listUnread(viewer.id, workspaceId);
    const reaction = await messengerRepository.addReaction(owner.id, workspaceId, general.conversationId, created.message.id, "🚀");
    const stored = await prisma.messengerMessage.findUniqueOrThrow({
      select: { bodyCiphertext: true, requestFingerprint: true },
      where: { id: created.message.id }
    });
    const plaintextAbsent = !Buffer.from(stored.bodyCiphertext ?? []).includes(Buffer.from(sendInput.body));
    const fingerprintOpaque = Boolean(stored.requestFingerprint) && !stored.requestFingerprint?.includes(sendInput.body);
    const viewerMembership = await prisma.workspaceMember.findUniqueOrThrow({
      where: { userId_workspaceId: { userId: viewer.id, workspaceId } }
    });
    await workspaceRepository.updateWorkspaceMemberRole(owner.id, workspaceId, viewer.id, "editor");
    const promotedMembership = await prisma.workspaceMember.findUniqueOrThrow({
      where: { userId_workspaceId: { userId: viewer.id, workspaceId } }
    });
    await workspaceRepository.blockWorkspaceMember(owner.id, workspaceId, viewer.id);
    let blockedAccessCode: string | null = null;
    try {
      await messengerRepository.listUnread(viewer.id, workspaceId);
    } catch (error) {
      blockedAccessCode = error instanceof MessengerDomainError ? error.code : null;
    }
    await workspaceRepository.unblockWorkspaceUser(owner.id, workspaceId, viewer.id);
    let unblockedAccessCode: string | null = null;
    try {
      await messengerRepository.listUnread(viewer.id, workspaceId);
    } catch (error) {
      unblockedAccessCode = error instanceof MessengerDomainError ? error.code : null;
    }
    const rejoinInvitation = await inviteRepository.createInvite({
      createdByUserId: owner.id,
      email: viewer.email,
      role: "viewer",
      workspaceId
    });
    await inviteRepository.acceptInviteById(viewer.id, rejoinInvitation.invite.id);
    const rejoinedMembership = await prisma.workspaceMember.findUniqueOrThrow({
      where: { userId_workspaceId: { userId: viewer.id, workspaceId } }
    });
    await workspaceRepository.removeWorkspaceMember(owner.id, workspaceId, viewer.id);
    let revokedAccessCode: string | null = null;
    try {
      await messengerRepository.listUnread(viewer.id, workspaceId);
    } catch (error) {
      revokedAccessCode = error instanceof MessengerDomainError ? error.code : null;
    }
    const storedMessageCount = await prisma.messengerMessage.count({ where: { conversationId: general.conversationId } });
    assert.equal(conflictCode, "idempotency_conflict");
    assert.equal(created.message.sequence, "1");
    assert.equal(fingerprintOpaque, true);
    assert.equal(plaintextAbsent, true);
    assert.equal(replay.replayed, true);
    assert.equal(replay.message.id, created.message.id);
    assert.equal(storedMessageCount, 1);
    assert.equal(viewerUnreadBefore.total, 1);
    assert.equal(viewerUnreadAfter.total, 0);
    assert.equal(viewerWriteCode, "workspace_write_denied");
    assert.equal(promotedMembership.messengerAccessVersion, viewerMembership.messengerAccessVersion + 1);
    assert.equal(blockedAccessCode, "resource_not_found");
    assert.equal(unblockedAccessCode, "resource_not_found");
    assert.notEqual(rejoinedMembership.id, viewerMembership.id);
    assert.equal(revokedAccessCode, "resource_not_found");
    assert.ok(reaction.id);
    process.stdout.write(`${JSON.stringify({
      blockedAccessCode,
      conflictCode,
      createdSequence: created.message.sequence,
      fingerprintOpaque,
      plaintextAbsent,
      reactionId: reaction.id,
      revokedAccessCode,
      replayed: replay.replayed,
      rejoinedWithNewMembershipEpoch: rejoinedMembership.id !== viewerMembership.id,
      storedMessageCount,
      unblockedAccessCode,
      viewerUnreadAfter: viewerUnreadAfter.total,
      viewerUnreadBefore: viewerUnreadBefore.total,
      viewerWriteCode
    })}\n`);
  } finally {
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, viewer.id] } } });
    await prisma.$disconnect();
    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
  }
}

void main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ errorCode: safeErrorCode(error), status: "failed" })}\n`);
  process.exitCode = 1;
});

function safeErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code.slice(0, 80);
  }
  return error instanceof Error ? error.name.slice(0, 80) : "unknown_error";
}
