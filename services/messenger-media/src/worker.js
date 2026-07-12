export class MediaWorker {
  constructor(repository, processor, options = {}) {
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.processor = processor;
    this.repository = repository;
    this.running = false;
    this.stopping = false;
    this.timer = null;
    this.waitResolve = null;
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

  async run() {
    try {
      while (!this.stopping) {
        let jobs = [];
        try {
          jobs = await this.repository.claim();
          await Promise.all(jobs.map((job) => this.processor.process(job)));
        } catch (error) {
          process.stderr.write(`${JSON.stringify({
            code: "media_worker_iteration_failed",
            errorType: error instanceof Error ? error.name : "unknown"
          })}\n`);
        }
        if (jobs.length === 0 && !this.stopping) await this.wait();
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
