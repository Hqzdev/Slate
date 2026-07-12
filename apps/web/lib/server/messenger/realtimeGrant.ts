import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { WorkspaceRole } from "@prisma/client";

export type MessengerRealtimeGrantClaims = {
  accessVersion: number;
  aud: "slate-messenger";
  exp: number;
  iat: number;
  jti: string;
  kid: string;
  membershipId: string;
  role: WorkspaceRole;
  sub: string;
  v: 1;
  workspaceId: string;
};

export type MessengerRealtimeGrantConfiguration = {
  activeKid: string;
  keys: Record<string, Buffer>;
};

type MessengerRealtimeEnvironment = Readonly<Record<string, string | undefined>>;

type MessengerRealtimeGrantInput = {
  accessVersion: number;
  membershipId: string;
  role: WorkspaceRole;
  userId: string;
  workspaceId: string;
};

const allowedClaimKeys = new Set([
  "accessVersion",
  "aud",
  "exp",
  "iat",
  "jti",
  "kid",
  "membershipId",
  "role",
  "sub",
  "v",
  "workspaceId"
]);
const roles = new Set<WorkspaceRole>(["owner", "editor", "viewer"]);
const identifierPattern = /^[A-Za-z0-9_-]{1,128}$/;
const kidPattern = /^[A-Za-z0-9_-]{1,48}$/;
const signaturePattern = /^[A-Za-z0-9_-]{43}$/;

export class MessengerRealtimeGrantService {
  private readonly clockSkewSeconds = 30;
  private readonly ttlSeconds = 120;

  constructor(
    private readonly configuration: MessengerRealtimeGrantConfiguration | null = null,
    private readonly now: () => number = () => Date.now(),
    private readonly idFactory: () => string = randomUUID
  ) {}

  create(input: MessengerRealtimeGrantInput) {
    const configuration = this.getConfiguration();
    const issuedAt = Math.floor(this.now() / 1000);
    const claims: MessengerRealtimeGrantClaims = {
      accessVersion: input.accessVersion,
      aud: "slate-messenger",
      exp: issuedAt + this.ttlSeconds,
      iat: issuedAt,
      jti: this.idFactory(),
      kid: configuration.activeKid,
      membershipId: input.membershipId,
      role: input.role,
      sub: input.userId,
      v: 1,
      workspaceId: input.workspaceId
    };
    if (!this.isClaims(claims)) throw new Error("Messenger realtime grant input is invalid");
    const encodedClaims = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    return {
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      grant: `${encodedClaims}.${this.sign(encodedClaims, configuration.keys[configuration.activeKid] as Buffer)}`
    };
  }

  verify(token: string, expectedWorkspaceId?: string) {
    if (token.length === 0 || token.length > 8_192) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [encodedClaims, signature] = parts;
    if (!encodedClaims || !signature || !signaturePattern.test(signature)) return null;
    const claims = this.parseClaims(encodedClaims);
    if (!claims || expectedWorkspaceId && claims.workspaceId !== expectedWorkspaceId) return null;
    const key = this.getConfiguration().keys[claims.kid];
    if (!key) return null;
    const expectedSignature = this.sign(encodedClaims, key);
    const signatureBytes = Buffer.from(signature, "base64url");
    const expectedBytes = Buffer.from(expectedSignature, "base64url");
    if (signatureBytes.length !== expectedBytes.length || !timingSafeEqual(signatureBytes, expectedBytes)) return null;
    const nowSeconds = Math.floor(this.now() / 1000);
    if (claims.iat > nowSeconds + this.clockSkewSeconds) return null;
    if (claims.exp <= nowSeconds || claims.exp <= claims.iat || claims.exp - claims.iat > this.ttlSeconds) return null;
    return claims;
  }

  private parseClaims(encodedClaims: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(encodedClaims)) return null;
    try {
      const value = JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8"));
      return this.isClaims(value) ? value : null;
    } catch {
      return null;
    }
  }

  private isClaims(value: unknown): value is MessengerRealtimeGrantClaims {
    if (!isRecord(value) || Object.keys(value).some((key) => !allowedClaimKeys.has(key)) || Object.keys(value).length !== allowedClaimKeys.size) return false;
    return value.v === 1
      && value.aud === "slate-messenger"
      && typeof value.kid === "string"
      && kidPattern.test(value.kid)
      && typeof value.sub === "string"
      && identifierPattern.test(value.sub)
      && typeof value.workspaceId === "string"
      && identifierPattern.test(value.workspaceId)
      && typeof value.membershipId === "string"
      && identifierPattern.test(value.membershipId)
      && typeof value.role === "string"
      && roles.has(value.role as WorkspaceRole)
      && typeof value.accessVersion === "number"
      && Number.isInteger(value.accessVersion)
      && value.accessVersion > 0
      && typeof value.iat === "number"
      && Number.isInteger(value.iat)
      && value.iat > 0
      && typeof value.exp === "number"
      && Number.isInteger(value.exp)
      && value.exp > 0
      && typeof value.jti === "string"
      && identifierPattern.test(value.jti);
  }

  private sign(encodedClaims: string, key: Buffer) {
    return createHmac("sha256", key).update(encodedClaims).digest("base64url");
  }

  private getConfiguration() {
    return this.configuration ?? readGrantConfiguration(process.env);
  }
}

export function readGrantConfiguration(environment: MessengerRealtimeEnvironment): MessengerRealtimeGrantConfiguration {
  const activeKid = environment.MESSENGER_REALTIME_GRANT_ACTIVE_KID;
  const encodedKeys = environment.MESSENGER_REALTIME_GRANT_KEYS;
  if (!activeKid || !encodedKeys) {
    if (environment.NODE_ENV === "production") throw new Error("Messenger realtime grant keys are required");
    return {
      activeKid: "local-development-v1",
      keys: { "local-development-v1": Buffer.from("slate-messenger-realtime-local-key-v1", "utf8") }
    };
  }
  if (!kidPattern.test(activeKid)) throw new Error("Messenger realtime active kid is invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(encodedKeys);
  } catch {
    throw new Error("Messenger realtime grant keys must be valid JSON");
  }
  if (!isRecord(parsed)) throw new Error("Messenger realtime grant keys must be an object");
  const keys: Record<string, Buffer> = {};
  for (const [kid, encodedKey] of Object.entries(parsed)) {
    if (!kidPattern.test(kid) || typeof encodedKey !== "string") throw new Error("Messenger realtime grant key entry is invalid");
    const key = decodeKey(encodedKey);
    if (key.length < 32) throw new Error("Messenger realtime grant keys must be at least 32 bytes");
    keys[kid] = key;
  }
  if (!keys[activeKid]) throw new Error("Messenger realtime active kid is missing from the key set");
  return { activeKid, keys };
}

function decodeKey(value: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("Messenger realtime grant key is not base64");
  return Buffer.from(value, "base64");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const messengerRealtimeGrantService = new MessengerRealtimeGrantService();
