import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost, type PresignedPostOptions } from "@aws-sdk/s3-presigned-post";
import { MessengerDomainError } from "./errors";

export type MessengerUploadOperation = {
  expiresAt: string;
  fields: Record<string, string>;
  headers: null;
  method: "POST";
  url: string;
};

export type MessengerStoredObject = {
  attachmentId: string | null;
  byteSize: number;
  checksum: string | null;
  contentType: string;
  etag: string;
  version: string | null;
};

export type MessengerObjectRead = {
  body: ReadableStream<Uint8Array>;
  byteSize: number;
  contentRange: string | null;
  contentType: string;
  etag: string | null;
};

type MessengerStorageEnvironment = Readonly<Record<string, string | undefined>>;

export class MessengerObjectStorage {
  private readonly uploadLifetimeSeconds = 15 * 60;
  private runtime: { bucket: string; client: S3Client; serverSideEncryption: string | null } | null = null;

  constructor(
    private readonly environment: MessengerStorageEnvironment = process.env,
    private readonly configuredClient?: S3Client
  ) {}

  async createUpload(input: {
    attachmentId: string;
    byteSize: number;
    contentType: string;
    storageKey: string;
  }): Promise<MessengerUploadOperation> {
    const runtime = this.getRuntime();
    const fields: Record<string, string> = {
      "Content-Type": input.contentType,
      success_action_status: "201",
      "x-amz-meta-attachment-id": input.attachmentId
    };
    const conditions: NonNullable<PresignedPostOptions["Conditions"]> = [
      ["content-length-range", input.byteSize, input.byteSize],
      { "Content-Type": input.contentType },
      { success_action_status: "201" },
      { "x-amz-meta-attachment-id": input.attachmentId }
    ];
    if (runtime.serverSideEncryption) {
      fields["x-amz-server-side-encryption"] = runtime.serverSideEncryption;
      conditions.push({ "x-amz-server-side-encryption": runtime.serverSideEncryption });
    }
    try {
      const operation = await createPresignedPost(runtime.client, {
        Bucket: runtime.bucket,
        Conditions: conditions,
        Expires: this.uploadLifetimeSeconds,
        Fields: fields,
        Key: input.storageKey
      });
      return {
        expiresAt: new Date(Date.now() + this.uploadLifetimeSeconds * 1_000).toISOString(),
        fields: operation.fields,
        headers: null,
        method: "POST",
        url: operation.url
      };
    } catch {
      throw new MessengerDomainError("storage_unavailable", "Attachment storage is unavailable", 503, true);
    }
  }

  async headObject(storageKey: string): Promise<MessengerStoredObject> {
    const runtime = this.getRuntime();
    try {
      const result = await runtime.client.send(new HeadObjectCommand({ Bucket: runtime.bucket, Key: storageKey }));
      if (!Number.isSafeInteger(result.ContentLength) || !result.ContentType || !result.ETag) {
        throw new Error("Stored object metadata is incomplete");
      }
      return {
        attachmentId: result.Metadata?.["attachment-id"] ?? null,
        byteSize: result.ContentLength as number,
        checksum: result.ChecksumSHA256 ?? null,
        contentType: result.ContentType,
        etag: normalizeEtag(result.ETag),
        version: result.VersionId ?? null
      };
    } catch {
      throw new MessengerDomainError("storage_unavailable", "Attachment storage is unavailable", 503, true);
    }
  }

  async deleteObject(storageKey: string) {
    const runtime = this.getRuntime();
    try {
      await runtime.client.send(new DeleteObjectCommand({ Bucket: runtime.bucket, Key: storageKey }));
    } catch {
      throw new MessengerDomainError("storage_unavailable", "Attachment storage is unavailable", 503, true);
    }
  }

  async readObject(storageKey: string, range: string | null): Promise<MessengerObjectRead> {
    const runtime = this.getRuntime();
    try {
      const result = await runtime.client.send(new GetObjectCommand({
        Bucket: runtime.bucket,
        Key: storageKey,
        Range: range ?? undefined
      }));
      if (!result.Body || !Number.isSafeInteger(result.ContentLength) || !result.ContentType) {
        throw new Error("Stored object body is incomplete");
      }
      return {
        body: result.Body.transformToWebStream(),
        byteSize: result.ContentLength as number,
        contentRange: result.ContentRange ?? null,
        contentType: result.ContentType,
        etag: result.ETag ? normalizeEtag(result.ETag) : null
      };
    } catch {
      throw new MessengerDomainError("storage_unavailable", "Attachment storage is unavailable", 503, true);
    }
  }

  private getRuntime() {
    if (this.runtime) return this.runtime;
    const configuration = readMessengerStorageConfiguration(this.environment);
    this.runtime = {
      bucket: configuration.bucket,
      client: this.configuredClient ?? new S3Client({
        credentials: configuration.credentials,
        endpoint: configuration.endpoint,
        forcePathStyle: configuration.forcePathStyle,
        region: configuration.region
      }),
      serverSideEncryption: configuration.serverSideEncryption
    };
    return this.runtime;
  }
}

export function normalizeEtag(value: string) {
  return value.trim().replace(/^"|"$/gu, "");
}

export function readMessengerStorageConfiguration(environment: MessengerStorageEnvironment) {
  const production = environment.NODE_ENV === "production";
  const accessKeyId = environment.MESSENGER_STORAGE_ACCESS_KEY_ID ?? (production ? null : "slate-minio");
  const secretAccessKey = environment.MESSENGER_STORAGE_SECRET_ACCESS_KEY ?? (production ? null : "slate-minio-development");
  const endpoint = environment.MESSENGER_STORAGE_ENDPOINT ?? (production ? null : "http://127.0.0.1:9000");
  const bucket = environment.MESSENGER_STORAGE_BUCKET ?? (production ? null : "slate-messenger");
  const region = environment.MESSENGER_STORAGE_REGION ?? "us-east-1";
  const serverSideEncryption = environment.MESSENGER_STORAGE_SSE ?? (production ? null : null);
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket)) {
    throw new MessengerDomainError("storage_configuration_invalid", "Attachment storage is not configured", 503);
  }
  if (production && !serverSideEncryption) {
    throw new MessengerDomainError("storage_configuration_invalid", "Attachment storage encryption is not configured", 503);
  }
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    throw new MessengerDomainError("storage_configuration_invalid", "Attachment storage endpoint is invalid", 503);
  }
  if (!new Set(["http:", "https:"]).has(endpointUrl.protocol)
    || endpointUrl.username
    || endpointUrl.password
    || endpointUrl.search
    || endpointUrl.hash
    || production && endpointUrl.protocol !== "https:") {
    throw new MessengerDomainError("storage_configuration_invalid", "Attachment storage endpoint is invalid", 503);
  }
  return {
    bucket,
    credentials: { accessKeyId, secretAccessKey },
    endpoint: endpointUrl.toString(),
    forcePathStyle: environment.MESSENGER_STORAGE_FORCE_PATH_STYLE !== "false",
    region,
    serverSideEncryption
  };
}

export const messengerObjectStorage = new MessengerObjectStorage();
