import { createEnvelope, workspaceChannel } from "./eventContract.js";

export class OutboxPublisher {
  constructor(repository, redis, options = {}) {
    this.repository = repository;
    this.redis = redis;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.timer = null;
    this.waitResolve = null;
    this.running = false;
    this.stopping = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.run();
  }

  async stop() {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.waitResolve?.();
    this.waitResolve = null;
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10));
    await this.repository.release();
  }

  async publishBatch() {
    const events = await this.repository.claim();
    for (const event of events) {
      try {
        const envelope = createEnvelope(event);
        await this.redis.publish(workspaceChannel(event.workspaceId), JSON.stringify(envelope));
        await this.repository.acknowledge(event.id);
      } catch (error) {
        await this.repository.retry(event.id, event.attemptCount, classifyError(error));
      }
    }
    return events.length;
  }

  async run() {
    try {
      while (!this.stopping) {
        let count = 0;
        try {
          count = await this.publishBatch();
        } catch {}
        if (count === 0 && !this.stopping) await this.wait();
      }
    } finally {
      this.running = false;
    }
  }

  wait() {
    return new Promise((resolve) => {
      this.waitResolve = resolve;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.waitResolve = null;
        resolve();
      }, this.pollIntervalMs);
    });
  }
}

function classifyError(error) {
  if (error instanceof Error && error.message.includes("contract")) return "invalid_event_contract";
  return "publish_failed";
}
