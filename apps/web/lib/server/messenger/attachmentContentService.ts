import type { MessengerMessageAttachment } from "@prisma/client";
import { prisma } from "../prisma";
import { messengerAccessPolicy, type MessengerAccessPolicy } from "./accessPolicy";
import { messengerPayloadCodec, type MessengerPayloadCodec } from "./cryptography";
import { MessengerDomainError } from "./errors";
import { messengerKeyEnvelopeService, type MessengerKeyEnvelopeService } from "./keyEnvelopeService";
import { messengerMediaStreamRegistry, type MessengerMediaStreamRegistry } from "./mediaStreamRegistry";
import { messengerObjectStorage, type MessengerObjectStorage } from "./objectStorage";

export type MessengerAttachmentVariant = "original" | "poster" | "thumbnail";

type AttachmentContentDependencies = {
  accessPolicy: Pick<MessengerAccessPolicy, "requireConversationReader">;
  client: typeof prisma;
  keyService: Pick<MessengerKeyEnvelopeService, "resolveKeyVersion">;
  objectStorage: Pick<MessengerObjectStorage, "headObject" | "readObject">;
  payloadCodec: Pick<MessengerPayloadCodec, "decryptAttachmentFileName">;
  streamRegistry: MessengerMediaStreamRegistry;
};

const defaultDependencies: AttachmentContentDependencies = {
  accessPolicy: messengerAccessPolicy,
  client: prisma,
  keyService: messengerKeyEnvelopeService,
  objectStorage: messengerObjectStorage,
  payloadCodec: messengerPayloadCodec,
  streamRegistry: messengerMediaStreamRegistry
};

export class MessengerAttachmentContentService {
  constructor(private readonly dependencies: AttachmentContentDependencies = defaultDependencies) {}

  async open(input: {
    attachmentId: string;
    conversationId: string;
    rangeHeader: string | null;
    requestSignal?: AbortSignal;
    userId: string;
    variant: MessengerAttachmentVariant;
    workspaceId: string;
  }) {
    await this.dependencies.accessPolicy.requireConversationReader(input.userId, input.workspaceId, input.conversationId);
    const attachment = await this.dependencies.client.messengerMessageAttachment.findFirst({
      where: {
        conversationId: input.conversationId,
        id: input.attachmentId,
        message: { conversationId: input.conversationId },
        messageId: { not: null },
        status: "attached",
        workspaceId: input.workspaceId
      }
    });
    if (!attachment) throw new MessengerDomainError("attachment_not_found", "Attachment was not found", 404);
    const object = await this.resolveObject(attachment, input.variant);
    const range = parseMessengerByteRange(input.rangeHeader, object.totalBytes);
    const stored = await this.dependencies.objectStorage.readObject(object.storageKey, range?.storageHeader ?? null);
    await this.dependencies.accessPolicy.requireConversationReader(input.userId, input.workspaceId, input.conversationId);
    const fileName = await this.decryptFileName(attachment);
    return {
      body: this.dependencies.streamRegistry.track(stored.body, {
        userId: input.userId,
        workspaceId: input.workspaceId
      }, input.requestSignal),
      byteSize: stored.byteSize,
      contentDisposition: createContentDisposition(fileName, input.variant, object.contentType),
      contentRange: range ? `bytes ${range.start}-${range.end}/${object.totalBytes}` : null,
      contentType: object.contentType,
      etag: stored.etag,
      status: range ? 206 : 200
    };
  }

  private async decryptFileName(attachment: MessengerMessageAttachment) {
    const key = await this.dependencies.keyService.resolveKeyVersion(attachment.workspaceId, attachment.fileNameKeyVersion);
    try {
      return this.dependencies.payloadCodec.decryptAttachmentFileName({
        attachmentId: attachment.id,
        ciphertext: Buffer.from(attachment.fileNameCiphertext),
        conversationId: attachment.conversationId,
        dataKey: key.dataKey,
        keyVersion: attachment.fileNameKeyVersion,
        nonce: Buffer.from(attachment.fileNameNonce),
        workspaceId: attachment.workspaceId
      });
    } finally {
      key.dataKey.fill(0);
    }
  }

  private async resolveObject(attachment: MessengerMessageAttachment, variant: MessengerAttachmentVariant) {
    if (variant === "original") {
      if (!attachment.detectedContentType || attachment.verifiedByteSize === null) {
        throw new MessengerDomainError("attachment_not_found", "Attachment was not found", 404);
      }
      return {
        contentType: attachment.detectedContentType,
        storageKey: attachment.storageKey,
        totalBytes: Number(attachment.verifiedByteSize)
      };
    }
    const storageKey = variant === "thumbnail" ? attachment.thumbnailStorageKey : attachment.posterStorageKey;
    if (!storageKey) throw new MessengerDomainError("attachment_variant_not_found", "Attachment preview was not found", 404);
    const stored = await this.dependencies.objectStorage.headObject(storageKey);
    const expectedContentType = variant === "thumbnail" ? "image/webp" : "image/jpeg";
    if (stored.contentType !== expectedContentType || stored.byteSize < 1) {
      throw new MessengerDomainError("attachment_variant_not_found", "Attachment preview was not found", 404);
    }
    return { contentType: expectedContentType, storageKey, totalBytes: stored.byteSize };
  }
}

export class MessengerContentRangeError extends MessengerDomainError {
  constructor(readonly totalBytes: number) {
    super("invalid_range", "Requested attachment range is invalid", 416);
  }
}

export function parseMessengerByteRange(value: string | null, totalBytes: number) {
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 1) {
    throw new MessengerDomainError("attachment_not_found", "Attachment was not found", 404);
  }
  if (value === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim());
  if (!match || match[1] === "" && match[2] === "") throw new MessengerContentRangeError(totalBytes);
  const startValue = match[1] ? Number(match[1]) : null;
  const endValue = match[2] ? Number(match[2]) : null;
  if (startValue !== null && (!Number.isSafeInteger(startValue) || startValue < 0)) throw new MessengerContentRangeError(totalBytes);
  if (endValue !== null && (!Number.isSafeInteger(endValue) || endValue < 0)) throw new MessengerContentRangeError(totalBytes);
  let start: number;
  let end: number;
  if (startValue === null) {
    if (endValue === null || endValue < 1) throw new MessengerContentRangeError(totalBytes);
    start = Math.max(0, totalBytes - endValue);
    end = totalBytes - 1;
  } else {
    start = startValue;
    end = endValue === null ? totalBytes - 1 : Math.min(endValue, totalBytes - 1);
  }
  if (start >= totalBytes || end < start) throw new MessengerContentRangeError(totalBytes);
  return { end, start, storageHeader: `bytes=${start}-${end}` };
}

function createContentDisposition(fileName: string, variant: MessengerAttachmentVariant, contentType: string) {
  const displayName = variant === "original"
    ? fileName
    : `${fileName}.${variant === "thumbnail" ? "webp" : "jpg"}`;
  const fallback = displayName
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/gu, "_")
    .replace(/["\\]/gu, "_")
    .slice(0, 180) || "attachment";
  const disposition = variant !== "original" || contentType.startsWith("image/") || contentType.startsWith("video/") ? "inline" : "attachment";
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(displayName)}`;
}

export const messengerAttachmentContentService = new MessengerAttachmentContentService();
