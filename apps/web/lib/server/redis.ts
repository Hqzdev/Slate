import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

const globalForRedis = globalThis as unknown as {
  redis?: Redis;
};

export const redis = globalForRedis.redis ?? new Redis(redisUrl, {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1
});

redis.on("error", () => {});

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
