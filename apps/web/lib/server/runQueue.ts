import { Queue } from "bullmq";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const connection = { url: redisUrl };

let queue: Queue | null = null;

export function getRunQueue() {
  queue = queue ?? new Queue("slate-runs", { connection });
  return queue;
}
