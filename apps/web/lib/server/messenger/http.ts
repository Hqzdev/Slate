import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { guardRequestOrigin } from "../apiSecurity";
import { rateLimitService, type RateLimitDecision } from "../rateLimit";
import { MessengerDomainError, toMessengerDomainError } from "./errors";

type MessengerRateLimiter = {
  checkWithMetadata(request: NextRequest, options: { limit: number; scope: string; windowMs: number }): Promise<RateLimitDecision>;
  checkIdentityWithMetadata(identity: string, options: { limit: number; scope: string; windowMs: number }): Promise<RateLimitDecision>;
};

export function messengerJson(body: unknown, status = 200, requestId = randomUUID()) {
  const response = NextResponse.json(body, { status });
  response.headers.set("cache-control", "no-store");
  response.headers.set("pragma", "no-cache");
  response.headers.set("x-request-id", requestId);
  return response;
}

export function messengerAuthenticationRequired(requestId = randomUUID()) {
  return messengerJson({
    code: "authentication_required",
    error: "Authentication required",
    requestId,
    retryable: false,
    retryAfterMs: null
  }, 401, requestId);
}

export function messengerErrorResponse(error: unknown, requestId = randomUUID()) {
  const domainError = toMessengerDomainError(error);
  return messengerJson({
    code: domainError.code,
    error: domainError.message,
    requestId,
    retryable: domainError.retryable,
    retryAfterMs: domainError.retryAfterMs
  }, domainError.status, requestId);
}

export async function guardMessengerMutation(
  request: NextRequest,
  requestId = randomUUID()
) {
  const denied = guardRequestOrigin(request);
  if (!denied) return null;
  return messengerErrorResponse(new MessengerDomainError("request_origin_denied", "Request origin denied", 403), requestId);
}

export async function guardMessengerPrincipalMutation(
  request: NextRequest,
  input: {
    conversationId: string;
    limit: number;
    scope: string;
    userId: string;
    windowMs: number;
    workspaceId: string;
  },
  requestId = randomUUID(),
  limiter: MessengerRateLimiter = rateLimitService
) {
  const checks = await Promise.all([
    limiter.checkWithMetadata(request, {
      limit: input.limit * 5,
      scope: `${input.scope}:ip`,
      windowMs: input.windowMs
    }),
    limiter.checkIdentityWithMetadata(`user:${input.userId}`, {
      limit: input.limit,
      scope: `${input.scope}:user`,
      windowMs: input.windowMs
    }),
    limiter.checkIdentityWithMetadata(`workspace:${input.workspaceId}`, {
      limit: input.limit * 20,
      scope: `${input.scope}:workspace`,
      windowMs: input.windowMs
    }),
    limiter.checkIdentityWithMetadata(`conversation:${input.workspaceId}:${input.conversationId}`, {
      limit: input.limit * 10,
      scope: `${input.scope}:conversation`,
      windowMs: input.windowMs
    })
  ]);
  if (checks.every((check) => check.allowed)) return null;
  const retryAfterMs = Math.max(1, ...checks.flatMap((check) => check.allowed || check.retryAfterMs === null ? [] : [check.retryAfterMs]));
  return messengerErrorResponse(new MessengerDomainError("rate_limited", "Too many requests", 429, true, retryAfterMs), requestId);
}

export async function guardMessengerWorkspaceMutation(
  request: NextRequest,
  input: {
    limit: number;
    scope: string;
    userId: string;
    windowMs: number;
    workspaceId: string;
  },
  requestId = randomUUID(),
  limiter: MessengerRateLimiter = rateLimitService
) {
  const checks = await Promise.all([
    limiter.checkWithMetadata(request, {
      limit: input.limit * 5,
      scope: `${input.scope}:ip`,
      windowMs: input.windowMs
    }),
    limiter.checkIdentityWithMetadata(`user:${input.userId}`, {
      limit: input.limit,
      scope: `${input.scope}:user`,
      windowMs: input.windowMs
    }),
    limiter.checkIdentityWithMetadata(`workspace:${input.workspaceId}`, {
      limit: input.limit * 20,
      scope: `${input.scope}:workspace`,
      windowMs: input.windowMs
    })
  ]);
  if (checks.every((check) => check.allowed)) return null;
  const retryAfterMs = Math.max(1, ...checks.flatMap((check) => check.allowed || check.retryAfterMs === null ? [] : [check.retryAfterMs]));
  return messengerErrorResponse(new MessengerDomainError("rate_limited", "Too many requests", 429, true, retryAfterMs), requestId);
}

export async function readMessengerJson(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    throw new MessengerDomainError("invalid_request", "Request body must be valid JSON", 400);
  }
}
