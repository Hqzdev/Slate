import { randomUUID } from "node:crypto";
import { redis } from "../redis";
import { AiDomainError } from "./errors";

type MemoryBucket = {
  count: number;
  resetAt: number;
};

const maximumRequestsPerMinute = 12;
const maximumConcurrentRequests = 2;
const providerSlotLifetimeMs = 120_000;
const buckets = new Map<string, MemoryBucket>();
const activeRequests = new Map<string, number>();
let activeProviderRequests = 0;

type ProviderSlot = {
  distributed: boolean;
  key: string;
  leaseId: string;
};

export class AiUsageLimiter {
  async run<T>(ownerUserId: string, operation: () => Promise<T>) {
    const key = ownerUserId;
    await this.requireRateAllowance(key);
    const active = activeRequests.get(key) ?? 0;
    if (active >= maximumConcurrentRequests) {
      throw new AiDomainError("ai_concurrency_limited", "Too many AI requests are already running", 429, true);
    }
    activeRequests.set(key, active + 1);
    let providerSlot: ProviderSlot | null = null;
    try {
      providerSlot = await this.acquireProviderSlot();
      return await operation();
    } finally {
      if (providerSlot) await this.releaseProviderSlot(providerSlot);
      const remaining = (activeRequests.get(key) ?? 1) - 1;
      if (remaining <= 0) activeRequests.delete(key);
      else activeRequests.set(key, remaining);
    }
  }

  private async acquireProviderSlot(): Promise<ProviderSlot> {
    const maximumProviderConcurrency = providerConcurrencyLimit();
    const leaseId = randomUUID();
    try {
      for (let index = 0; index < maximumProviderConcurrency; index += 1) {
        const key = `slate:ai-provider-slot:${index}`;
        const acquired = await redis.set(key, leaseId, "PX", providerSlotLifetimeMs, "NX");
        if (acquired === "OK") return { distributed: true, key, leaseId };
      }
      throw new AiDomainError("provider_concurrency_limited", "The AI provider is busy. Retry shortly.", 429, true);
    } catch (error) {
      if (error instanceof AiDomainError) throw error;
      if (activeProviderRequests >= maximumProviderConcurrency) {
        throw new AiDomainError("provider_concurrency_limited", "The AI provider is busy. Retry shortly.", 429, true);
      }
      activeProviderRequests += 1;
      return { distributed: false, key: "memory", leaseId };
    }
  }

  private async releaseProviderSlot(slot: ProviderSlot) {
    if (!slot.distributed) {
      activeProviderRequests = Math.max(0, activeProviderRequests - 1);
      return;
    }
    await redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]); end; return 0;",
      1,
      slot.key,
      slot.leaseId
    ).catch(() => null);
  }

  private async requireRateAllowance(identity: string) {
    const key = `slate:ai-rate:${identity}`;
    try {
      const allowed = await redis.eval(
        "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; if count > tonumber(ARGV[2]) then return 0; end; return 1;",
        1,
        key,
        60_000,
        maximumRequestsPerMinute
      );
      if (allowed !== 1) throw new AiDomainError("ai_rate_limited", "AI request limit reached", 429, true);
      return;
    } catch (error) {
      if (error instanceof AiDomainError) throw error;
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + 60_000 });
        return;
      }
      if (bucket.count >= maximumRequestsPerMinute) {
        throw new AiDomainError("ai_rate_limited", "AI request limit reached", 429, true);
      }
      bucket.count += 1;
    }
  }
}

function providerConcurrencyLimit() {
  const configured = Number(process.env.GIGACHAT_MAX_CONCURRENCY ?? 1);
  if (!Number.isInteger(configured)) return 1;
  return Math.min(20, Math.max(1, configured));
}

export const aiUsageLimiter = new AiUsageLimiter();
