import assert from "node:assert/strict";
import test, { after } from "node:test";
import { NextRequest } from "next/server";
import { guardMessengerPrincipalMutation, guardMessengerWorkspaceMutation } from "../lib/server/messenger/http";
import { RateLimitService, type RateLimitDecision } from "../lib/server/rateLimit";
import { redis } from "../lib/server/redis";

after(() => redis.disconnect());

test("preserves boolean rate-limit callers and reports the remaining memory window", async () => {
  let now = 1_000;
  const service = new RateLimitService({
    async eval() {
      throw new Error("Redis unavailable");
    }
  }, () => now);
  const options = { limit: 1, scope: "test", windowMs: 500 };
  assert.equal(await service.checkIdentity("user:1", options), true);
  assert.deepEqual(await service.checkIdentityWithMetadata("user:1", options), {
    allowed: false,
    retryAfterMs: 500
  });
  now = 1_500;
  assert.equal(await service.checkIdentity("user:1", options), true);
});

test("returns the Redis TTL for a denied rate-limit decision", async () => {
  const service = new RateLimitService({
    async eval() {
      return [0, 3_210];
    }
  });
  assert.deepEqual(await service.checkIdentityWithMetadata("user:1", {
    limit: 1,
    scope: "test",
    windowMs: 60_000
  }), {
    allowed: false,
    retryAfterMs: 3_210
  });
});

test("serializes the longest denied Messenger retry window", async () => {
  const decisions: RateLimitDecision[] = [
    { allowed: true, retryAfterMs: null },
    { allowed: false, retryAfterMs: 2_000 },
    { allowed: false, retryAfterMs: 4_500 },
    { allowed: true, retryAfterMs: null }
  ];
  const limiter = {
    async checkIdentityWithMetadata() {
      return decisions.shift() ?? { allowed: true, retryAfterMs: null };
    },
    async checkWithMetadata() {
      return decisions.shift() ?? { allowed: true, retryAfterMs: null };
    }
  };
  const response = await guardMessengerPrincipalMutation(
    new NextRequest("https://slate.test/api/workspaces/workspace-1/messenger/conversations/conversation-1/messages"),
    {
      conversationId: "conversation-1",
      limit: 60,
      scope: "messenger:messages:create",
      userId: "user-1",
      windowMs: 60_000,
      workspaceId: "workspace-1"
    },
    "d4f687b9-3d93-4f4a-b5fa-0d51619023e4",
    limiter
  );
  assert.ok(response);
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    code: "rate_limited",
    error: "Too many requests",
    requestId: "d4f687b9-3d93-4f4a-b5fa-0d51619023e4",
    retryable: true,
    retryAfterMs: 4_500
  });
});

test("rate limits realtime authorization by IP, user and workspace", async () => {
  const decisions: RateLimitDecision[] = [
    { allowed: true, retryAfterMs: null },
    { allowed: false, retryAfterMs: 1_200 },
    { allowed: false, retryAfterMs: 3_600 }
  ];
  const limiter = {
    async checkIdentityWithMetadata() {
      return decisions.shift() ?? { allowed: true, retryAfterMs: null };
    },
    async checkWithMetadata() {
      return decisions.shift() ?? { allowed: true, retryAfterMs: null };
    }
  };
  const response = await guardMessengerWorkspaceMutation(
    new NextRequest("https://slate.test/api/workspaces/workspace-1/messenger/realtime/authorize", { method: "POST" }),
    {
      limit: 12,
      scope: "messenger:realtime:authorize",
      userId: "user-1",
      windowMs: 60_000,
      workspaceId: "workspace-1"
    },
    "14e733e1-dc16-4139-b509-0f8d86f63357",
    limiter
  );
  assert.ok(response);
  assert.equal(response.status, 429);
  const body = await response.json() as { retryAfterMs: number };
  assert.equal(body.retryAfterMs, 3_600);
});
