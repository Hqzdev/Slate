import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

class DevelopmentStack {
  constructor() {
    this.children = new Set();
    this.isStopping = false;
    this.messengerEnabled = process.argv.includes("--messenger");
  }

  start() {
    this.installSignalHandlers();
    this.ensureDockerIsRunning();
    const dockerServices = [
      "compose",
      "up",
      "-d",
      "--wait",
      "postgres",
      "redis"
    ];
    if (this.messengerEnabled) dockerServices.push("minio", "clamav");
    this.runSetup("Docker services", "docker", dockerServices);
    if (this.messengerEnabled) this.runSetup("MinIO bucket", "docker", ["compose", "run", "--rm", "minio-init"]);
    this.runSetup("Prisma clients", "npm", [
      "--prefix",
      "apps/web",
      "run",
      "db:generate",
    ]);
    this.runSetup("Database migrations", "npm", [
      "--prefix",
      "apps/web",
      "run",
      "db:deploy",
    ]);
    if (this.messengerEnabled) this.runSetup("Messenger media worker", "docker", ["compose", "up", "-d", "--build", "--wait", "messenger-media"]);
    this.startService("web", "node", ["scripts/run-next.mjs", "dev"], "apps/web");
    this.startService("sync", "node", ["src/server.js"], "services/sync");
    if (this.messengerEnabled) this.startService("messenger-realtime", "node", ["src/server.js"], "services/messenger-realtime");
    if (this.messengerEnabled) this.startService("messenger-ai", "npm", ["run", "messenger:ai:worker"], "apps/web");
    this.startService("execution", "node", ["src/worker.js"], "services/execution");
  }

  ensureDockerIsRunning() {
    if (this.isDockerRunning()) {
      return;
    }

    if (process.platform !== "darwin") {
      throw new Error("Docker is not running");
    }

    const launchResult = spawnSync("open", ["-a", "Docker"], {
      stdio: "ignore",
    });

    if (launchResult.status !== 0) {
      throw new Error("Docker Desktop could not be started");
    }

    console.log("Waiting for Docker Desktop...");
    const deadline = Date.now() + 120_000;

    while (Date.now() < deadline) {
      if (this.isDockerRunning()) {
        return;
      }

      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
    }

    throw new Error("Docker Desktop did not become ready within 120 seconds");
  }

  isDockerRunning() {
    const result = spawnSync("docker", ["info"], { stdio: "ignore" });
    return result.status === 0;
  }

  runSetup(name, command, args) {
    const result = spawnSync(command, args, { stdio: "inherit" });

    if (result.error) {
      throw new Error(`${name} failed: ${result.error.message}`);
    }

    if (result.status !== 0) {
      throw new Error(`${name} exited with code ${result.status}`);
    }
  }

  startService(name, command, args, directory) {
    const child = spawn(command, args, {
      cwd: directory,
      stdio: "inherit",
    });

    this.children.add(child);
    child.once("error", (error) => {
      this.stop(1, `${name} failed to start: ${error.message}`);
    });
    child.once("exit", (code, signal) => {
      this.children.delete(child);

      if (!this.isStopping) {
        const reason = signal
          ? `${name} stopped by ${signal}`
          : `${name} exited with code ${code}`;
        this.stop(code ?? 1, reason);
      }
    });
  }

  installSignalHandlers() {
    process.once("SIGINT", () => this.stop(0));
    process.once("SIGTERM", () => this.stop(0));
  }

  stop(exitCode, reason) {
    if (this.isStopping) {
      return;
    }

    this.isStopping = true;

    if (reason) {
      console.error(`\n${reason}`);
    }

    for (const child of this.children) {
      if (child.pid) {
        try {
          child.kill("SIGTERM");
        } catch (error) {
          if (error.code !== "ESRCH") {
            console.error(error.message);
          }
        }
      }
    }

    process.exitCode = exitCode;
  }
}

try {
  new DevelopmentStack().start();
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
}
