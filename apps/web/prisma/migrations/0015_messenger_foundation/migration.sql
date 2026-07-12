CREATE TYPE "MessengerConversationKind" AS ENUM ('general', 'direct');
CREATE TYPE "MessengerMembershipState" AS ENUM ('active', 'revoked');
CREATE TYPE "MessengerAuthorKind" AS ENUM ('member', 'slate_ai', 'system');
CREATE TYPE "MessengerOutboxStatus" AS ENUM ('pending', 'published');
CREATE TYPE "MessengerPayloadEncoding" AS ENUM ('server_aead_v1');
CREATE TYPE "MessengerKeyEnvelopeState" AS ENUM ('active', 'decrypt_only', 'retired');

ALTER TABLE "WorkspaceMember"
ADD COLUMN "messengerAccessVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "WorkspaceSettings"
ADD COLUMN "messengerAiEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "WorkspaceSettings"
ALTER COLUMN "messengerAiEnabled" SET DEFAULT true;

CREATE TABLE "MessengerConversation" (
    "id" TEXT NOT NULL,
    "kind" "MessengerConversationKind" NOT NULL,
    "generalKey" TEXT,
    "directPairKey" TEXT,
    "activatedAt" TIMESTAMP(3),
    "lastMessageSequence" BIGINT NOT NULL DEFAULT 0,
    "retainedFromSequence" BIGINT NOT NULL DEFAULT 1,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    CONSTRAINT "MessengerConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessengerConversationMember" (
    "id" TEXT NOT NULL,
    "state" "MessengerMembershipState" NOT NULL DEFAULT 'active',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "historyFromSequence" BIGINT NOT NULL DEFAULT 1,
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "MessengerConversationMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessengerMessage" (
    "id" TEXT NOT NULL,
    "sequence" BIGINT NOT NULL,
    "authorKind" "MessengerAuthorKind" NOT NULL,
    "authorUserId" TEXT,
    "clientRequestId" TEXT,
    "requestFingerprint" TEXT,
    "bodyCiphertext" BYTEA,
    "bodyNonce" BYTEA,
    "bodyKeyVersion" INTEGER,
    "bodyEncoding" "MessengerPayloadEncoding" NOT NULL DEFAULT 'server_aead_v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversationId" TEXT NOT NULL,
    CONSTRAINT "MessengerMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessengerMessageReceipt" (
    "id" TEXT NOT NULL,
    "deliveredThroughSequence" BIGINT NOT NULL DEFAULT 0,
    "readThroughSequence" BIGINT NOT NULL DEFAULT 0,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "MessengerMessageReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessengerMessageReaction" (
    "id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "MessengerMessageReaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessengerOutboxEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "MessengerOutboxStatus" NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" TEXT,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT,
    "targetUserId" TEXT,
    CONSTRAINT "MessengerOutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessengerKeyEnvelope" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "wrappedDataKey" BYTEA NOT NULL,
    "wrapNonce" BYTEA NOT NULL,
    "kmsKeyId" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "state" "MessengerKeyEnvelopeState" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3) NOT NULL,
    "retiredAt" TIMESTAMP(3),
    "workspaceId" TEXT NOT NULL,
    CONSTRAINT "MessengerKeyEnvelope_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessengerConversation_generalKey_key" ON "MessengerConversation"("generalKey");
CREATE UNIQUE INDEX "MessengerConversation_workspaceId_directPairKey_key" ON "MessengerConversation"("workspaceId", "directPairKey");
CREATE INDEX "MessengerConversation_workspaceId_kind_idx" ON "MessengerConversation"("workspaceId", "kind");
CREATE INDEX "MessengerConversation_workspaceId_lastMessageAt_id_idx" ON "MessengerConversation"("workspaceId", "lastMessageAt", "id");
CREATE INDEX "WorkspaceMember_workspaceId_userId_idx" ON "WorkspaceMember"("workspaceId", "userId");
CREATE UNIQUE INDEX "MessengerConversationMember_conversationId_userId_key" ON "MessengerConversationMember"("conversationId", "userId");
CREATE INDEX "MessengerConversationMember_conversationId_state_idx" ON "MessengerConversationMember"("conversationId", "state");
CREATE INDEX "MessengerConversationMember_userId_state_updatedAt_idx" ON "MessengerConversationMember"("userId", "state", "updatedAt");
CREATE UNIQUE INDEX "MessengerMessage_conversationId_sequence_key" ON "MessengerMessage"("conversationId", "sequence");
CREATE UNIQUE INDEX "MessengerMessage_conversationId_authorUserId_clientRequestId_key" ON "MessengerMessage"("conversationId", "authorUserId", "clientRequestId");
CREATE INDEX "MessengerMessage_authorUserId_createdAt_idx" ON "MessengerMessage"("authorUserId", "createdAt");
CREATE UNIQUE INDEX "MessengerMessageReceipt_conversationId_userId_key" ON "MessengerMessageReceipt"("conversationId", "userId");
CREATE INDEX "MessengerMessageReceipt_userId_updatedAt_idx" ON "MessengerMessageReceipt"("userId", "updatedAt");
CREATE UNIQUE INDEX "MessengerMessageReaction_messageId_userId_emoji_key" ON "MessengerMessageReaction"("messageId", "userId", "emoji");
CREATE INDEX "MessengerMessageReaction_userId_createdAt_idx" ON "MessengerMessageReaction"("userId", "createdAt");
CREATE UNIQUE INDEX "MessengerOutboxEvent_eventId_key" ON "MessengerOutboxEvent"("eventId");
CREATE INDEX "MessengerOutboxEvent_workspaceId_createdAt_idx" ON "MessengerOutboxEvent"("workspaceId", "createdAt");
CREATE INDEX "MessengerOutboxEvent_conversationId_createdAt_idx" ON "MessengerOutboxEvent"("conversationId", "createdAt");
CREATE INDEX "MessengerOutboxEvent_targetUserId_createdAt_idx" ON "MessengerOutboxEvent"("targetUserId", "createdAt");
CREATE UNIQUE INDEX "MessengerKeyEnvelope_workspaceId_version_key" ON "MessengerKeyEnvelope"("workspaceId", "version");
CREATE INDEX "MessengerKeyEnvelope_workspaceId_state_idx" ON "MessengerKeyEnvelope"("workspaceId", "state");
CREATE UNIQUE INDEX "MessengerKeyEnvelope_one_active_per_workspace_key" ON "MessengerKeyEnvelope"("workspaceId") WHERE "state" = 'active';
CREATE INDEX "MessengerOutboxEvent_pending_availableAt_createdAt_idx" ON "MessengerOutboxEvent"("availableAt", "createdAt") WHERE "status" = 'pending';

ALTER TABLE "WorkspaceMember"
ADD CONSTRAINT "WorkspaceMember_messengerAccessVersion_check"
CHECK ("messengerAccessVersion" >= 1);

ALTER TABLE "WorkspaceInvite"
ADD CONSTRAINT "WorkspaceInvite_terminal_state_check"
CHECK (
    num_nonnulls("acceptedAt", "declinedAt", "revokedAt") <= 1
    AND (
        ("acceptedAt" IS NULL AND "acceptedByUserId" IS NULL)
        OR "acceptedAt" IS NOT NULL
    )
);

ALTER TABLE "MessengerConversation"
ADD CONSTRAINT "MessengerConversation_kind_check"
CHECK (
    (
        "kind" = 'general'
        AND "generalKey" = "workspaceId"
        AND "directPairKey" IS NULL
        AND "createdByUserId" IS NULL
        AND "activatedAt" IS NOT NULL
    )
    OR
    (
        "kind" = 'direct'
        AND "generalKey" IS NULL
        AND "directPairKey" IS NOT NULL
        AND length("directPairKey") > 0
    )
);

ALTER TABLE "MessengerConversation"
ADD CONSTRAINT "MessengerConversation_sequences_check"
CHECK (
    "lastMessageSequence" >= 0
    AND "retainedFromSequence" >= 1
    AND "retainedFromSequence" <= "lastMessageSequence" + 1
);

ALTER TABLE "MessengerConversation"
ADD CONSTRAINT "MessengerConversation_lastMessage_check"
CHECK (
    ("lastMessageSequence" = 0 AND "lastMessageAt" IS NULL)
    OR
    ("lastMessageSequence" > 0 AND "lastMessageAt" IS NOT NULL)
);

ALTER TABLE "MessengerConversationMember"
ADD CONSTRAINT "MessengerConversationMember_state_check"
CHECK (
    ("state" = 'active' AND "revokedAt" IS NULL)
    OR
    ("state" = 'revoked' AND "revokedAt" IS NOT NULL)
);

ALTER TABLE "MessengerConversationMember"
ADD CONSTRAINT "MessengerConversationMember_history_check"
CHECK ("historyFromSequence" >= 1);

ALTER TABLE "MessengerMessage"
ADD CONSTRAINT "MessengerMessage_sequence_check"
CHECK ("sequence" >= 1);

ALTER TABLE "MessengerMessage"
ADD CONSTRAINT "MessengerMessage_author_check"
CHECK (
    (
        "authorKind" = 'member'
        AND "authorUserId" IS NOT NULL
        AND "clientRequestId" IS NOT NULL
        AND "requestFingerprint" IS NOT NULL
    )
    OR
    (
        "authorKind" IN ('slate_ai', 'system')
        AND "authorUserId" IS NULL
        AND "clientRequestId" IS NULL
        AND "requestFingerprint" IS NULL
    )
);

ALTER TABLE "MessengerMessage"
ADD CONSTRAINT "MessengerMessage_bodyEnvelope_check"
CHECK (
    (
        "bodyCiphertext" IS NULL
        AND "bodyNonce" IS NULL
        AND "bodyKeyVersion" IS NULL
    )
    OR
    (
        "bodyCiphertext" IS NOT NULL
        AND octet_length("bodyCiphertext") > 0
        AND "bodyNonce" IS NOT NULL
        AND octet_length("bodyNonce") = 12
        AND "bodyKeyVersion" >= 1
    )
);

ALTER TABLE "MessengerMessageReceipt"
ADD CONSTRAINT "MessengerMessageReceipt_cursor_check"
CHECK (
    "deliveredThroughSequence" >= 0
    AND "readThroughSequence" >= 0
    AND "readThroughSequence" <= "deliveredThroughSequence"
);

ALTER TABLE "MessengerMessageReceipt"
ADD CONSTRAINT "MessengerMessageReceipt_timestamp_check"
CHECK (
    ("deliveredThroughSequence" = 0 AND "deliveredAt" IS NULL)
    OR
    ("deliveredThroughSequence" > 0 AND "deliveredAt" IS NOT NULL)
);

ALTER TABLE "MessengerMessageReceipt"
ADD CONSTRAINT "MessengerMessageReceipt_readTimestamp_check"
CHECK (
    ("readThroughSequence" = 0 AND "readAt" IS NULL)
    OR
    ("readThroughSequence" > 0 AND "readAt" IS NOT NULL)
);

ALTER TABLE "MessengerMessageReaction"
ADD CONSTRAINT "MessengerMessageReaction_emoji_check"
CHECK ("emoji" IN ('👍', '❤️', '😂', '🎉', '😮', '😢', '👀', '🚀'));

ALTER TABLE "MessengerOutboxEvent"
ADD CONSTRAINT "MessengerOutboxEvent_attemptCount_check"
CHECK ("attemptCount" >= 0);

ALTER TABLE "MessengerOutboxEvent"
ADD CONSTRAINT "MessengerOutboxEvent_publishState_check"
CHECK (
    ("status" = 'pending' AND "publishedAt" IS NULL)
    OR
    ("status" = 'published' AND "publishedAt" IS NOT NULL)
);

ALTER TABLE "MessengerKeyEnvelope"
ADD CONSTRAINT "MessengerKeyEnvelope_content_check"
CHECK (
    "version" >= 1
    AND octet_length("wrappedDataKey") > 0
    AND octet_length("wrapNonce") = 12
    AND length("kmsKeyId") > 0
    AND length("algorithm") > 0
);

ALTER TABLE "MessengerKeyEnvelope"
ADD CONSTRAINT "MessengerKeyEnvelope_state_check"
CHECK (
    (
        "state" IN ('active', 'decrypt_only')
        AND "retiredAt" IS NULL
    )
    OR
    (
        "state" = 'retired'
        AND "retiredAt" IS NOT NULL
        AND "retiredAt" >= "activatedAt"
    )
);

ALTER TABLE "MessengerConversation" ADD CONSTRAINT "MessengerConversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerConversation" ADD CONSTRAINT "MessengerConversation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MessengerConversationMember" ADD CONSTRAINT "MessengerConversationMember_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "MessengerConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerConversationMember" ADD CONSTRAINT "MessengerConversationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessengerMessage" ADD CONSTRAINT "MessengerMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "MessengerConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerMessage" ADD CONSTRAINT "MessengerMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessengerMessageReceipt" ADD CONSTRAINT "MessengerMessageReceipt_conversationId_userId_fkey" FOREIGN KEY ("conversationId", "userId") REFERENCES "MessengerConversationMember"("conversationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerMessageReaction" ADD CONSTRAINT "MessengerMessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "MessengerMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerMessageReaction" ADD CONSTRAINT "MessengerMessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessengerOutboxEvent" ADD CONSTRAINT "MessengerOutboxEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerOutboxEvent" ADD CONSTRAINT "MessengerOutboxEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "MessengerConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerKeyEnvelope" ADD CONSTRAINT "MessengerKeyEnvelope_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
