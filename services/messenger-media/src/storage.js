import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export class MediaStorage {
  constructor(configuration) {
    this.bucket = configuration.bucket;
    this.client = new S3Client({
      credentials: {
        accessKeyId: configuration.accessKeyId,
        secretAccessKey: configuration.secretAccessKey
      },
      endpoint: configuration.endpoint,
      forcePathStyle: configuration.forcePathStyle,
      region: configuration.region
    });
  }

  async download(storageKey, filePath, expectedBytes) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    if (!result.Body || result.ContentLength !== expectedBytes) throw new PermanentMediaError("object_size_mismatch");
    await pipeline(result.Body, createWriteStream(filePath, { flags: "wx", mode: 0o600 }));
  }

  async upload(storageKey, filePath, contentType) {
    await this.client.send(new PutObjectCommand({
      Body: createReadStream(filePath),
      Bucket: this.bucket,
      ContentType: contentType,
      Key: storageKey,
      Metadata: { generated: "slate-messenger-media-v1" }
    }));
  }

  async delete(storageKey) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }));
  }

  async ping() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    return true;
  }
}

export class PermanentMediaError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
