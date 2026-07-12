import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { clientIpAddressResolver } from "./clientIpAddress";
import { redis } from "./redis";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  limit: number;
  scope: string;
  windowMs: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterMs: number | null;
};

type RateLimitRedis = {
  eval(script: string, keyCount: number, ...arguments_: Array<number | string>): Promise<unknown>;
};

export class RateLimitService {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly redisClient: RateLimitRedis = redis as unknown as RateLimitRedis,
    private readonly now: () => number = Date.now
  ) {}

  async check(request: NextRequest, options: RateLimitOptions) {
    return this.checkIdentity(`ip:${this.requestIdentity(request)}`, options);
  }

  async checkWithMetadata(request: NextRequest, options: RateLimitOptions) {
    return this.checkIdentityWithMetadata(`ip:${this.requestIdentity(request)}`, options);
  }

  async checkIdentity(identity: string, options: RateLimitOptions) {
    return (await this.checkIdentityWithMetadata(identity, options)).allowed;
  }

  async checkIdentityWithMetadata(identity: string, options: RateLimitOptions): Promise<RateLimitDecision> {
    const identityHash = createHash("sha256").update(identity, "utf8").digest("base64url");
    const key = `slate:rate-limit:${options.scope}:${identityHash}`;

    try {
      const result = await this.redisClient.eval(
        "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; local ttl = redis.call('PTTL', KEYS[1]); if count > tonumber(ARGV[2]) then return {0, ttl}; end; return {1, ttl};",
        1,
        key,
        options.windowMs,
        options.limit
      );
      return this.parseRedisDecision(result, options.windowMs);
    } catch {
      return this.checkMemory(key, options);
    }
  }

  private checkMemory(key: string, options: RateLimitOptions) {
    const now = this.now();
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return { allowed: true, retryAfterMs: null };
    }

    if (bucket.count >= options.limit) {
      return { allowed: false, retryAfterMs: Math.max(1, bucket.resetAt - now) };
    }

    bucket.count += 1;
    return { allowed: true, retryAfterMs: null };
  }

  private parseRedisDecision(value: unknown, fallbackRetryAfterMs: number): RateLimitDecision {
    if (!Array.isArray(value) || value.length < 2) {
      throw new Error("Invalid rate limit response");
    }
    const allowed = Number(value[0]) === 1;
    if (allowed) return { allowed: true, retryAfterMs: null };
    const ttl = Number(value[1]);
    return {
      allowed: false,
      retryAfterMs: Number.isFinite(ttl) && ttl > 0 ? Math.ceil(ttl) : fallbackRetryAfterMs
    };
  }

  private requestIdentity(request: NextRequest) {
    return clientIpAddressResolver.resolve(request) ?? "untrusted";
  }
}

export const rateLimitService = new RateLimitService();
