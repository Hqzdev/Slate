import { createHmac, timingSafeEqual } from "node:crypto";

const claimKeys = new Set(["accessVersion", "aud", "exp", "iat", "jti", "kid", "membershipId", "role", "sub", "v", "workspaceId"]);
const identifierPattern = /^[A-Za-z0-9_-]{1,128}$/;
const kidPattern = /^[A-Za-z0-9_-]{1,48}$/;
const signaturePattern = /^[A-Za-z0-9_-]{43}$/;
const roles = new Set(["owner", "editor", "viewer"]);

export class GrantVerifier {
  constructor(configuration, now = () => Date.now()) {
    this.keys = readKeys(configuration);
    this.now = now;
  }

  verify(token) {
    if (typeof token !== "string" || token.length === 0 || token.length > 8_192) return null;
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !signaturePattern.test(parts[1] ?? "")) return null;
    const claims = parseClaims(parts[0]);
    const key = claims ? this.keys[claims.kid] : null;
    if (!claims || !key) return null;
    const expected = createHmac("sha256", key).update(parts[0]).digest();
    const actual = Buffer.from(parts[1], "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const nowSeconds = Math.floor(this.now() / 1000);
    if (claims.iat > nowSeconds + 30 || claims.exp <= nowSeconds || claims.exp <= claims.iat || claims.exp - claims.iat > 120) return null;
    return claims;
  }
}

function readKeys(configuration) {
  if (!configuration.grantActiveKid || !configuration.grantKeys) {
    if (process.env.NODE_ENV === "production") throw new Error("Messenger realtime grant keys are required");
    return { "local-development-v1": Buffer.from("slate-messenger-realtime-local-key-v1", "utf8") };
  }
  let parsed;
  try {
    parsed = JSON.parse(configuration.grantKeys);
  } catch {
    throw new Error("Messenger realtime grant keys must be valid JSON");
  }
  if (!isRecord(parsed) || !parsed[configuration.grantActiveKid]) throw new Error("Messenger realtime active key is missing");
  const keys = {};
  for (const [kid, encoded] of Object.entries(parsed)) {
    if (!kidPattern.test(kid) || typeof encoded !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("Messenger realtime grant key is invalid");
    const key = Buffer.from(encoded, "base64");
    if (key.length < 32) throw new Error("Messenger realtime grant key is too short");
    keys[kid] = key;
  }
  return keys;
}

function parseClaims(encoded) {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!isRecord(value) || Object.keys(value).length !== claimKeys.size || Object.keys(value).some((key) => !claimKeys.has(key))) return null;
    if (value.v !== 1 || value.aud !== "slate-messenger" || !validIdentifier(value.sub) || !validIdentifier(value.workspaceId)
      || !validIdentifier(value.membershipId) || !validIdentifier(value.jti) || typeof value.kid !== "string" || !kidPattern.test(value.kid)
      || !roles.has(value.role) || !positiveInteger(value.accessVersion) || !positiveInteger(value.iat) || !positiveInteger(value.exp)) return null;
    return value;
  } catch {
    return null;
  }
}

function validIdentifier(value) {
  return typeof value === "string" && identifierPattern.test(value);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
