import { NextRequest } from "next/server";
import { redis } from "@/lib/server/redis";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  limit: number;
  scope: string;
  windowMs: number;
};

const buckets = new Map<string, RateLimitBucket>();

export class RateLimitService {
  async check(request: NextRequest, options: RateLimitOptions) {
    const key = `slate:rate-limit:${options.scope}:${this.requestIdentity(request)}`;

    try {
      const allowed = await redis.eval(
        "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; if count > tonumber(ARGV[2]) then return 0; end; return 1;",
        1,
        key,
        options.windowMs,
        options.limit
      );
      return allowed === 1;
    } catch {
      return this.checkMemory(key, options);
    }
  }

  private checkMemory(key: string, options: RateLimitOptions) {
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return true;
    }

    if (bucket.count >= options.limit) {
      return false;
    }

    bucket.count += 1;
    return true;
  }

  private requestIdentity(request: NextRequest) {
    const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    return forwardedFor || request.headers.get("x-real-ip") || "local";
  }
}

export const rateLimitService = new RateLimitService();
