import { createReadStream } from "node:fs";
import { connect } from "node:net";

export class ClamavScanner {
  constructor(options) {
    this.host = options.host;
    this.port = options.port;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.connect = options.connect ?? connect;
  }

  scan(filePath) {
    return new Promise((resolve, reject) => {
      const socket = this.connect({ host: this.host, port: this.port });
      let response = "";
      const timer = setTimeout(() => socket.destroy(new Error("clamav_timeout")), this.timeoutMs);
      socket.setTimeout(this.timeoutMs, () => socket.destroy(new Error("clamav_timeout")));
      socket.on("connect", async () => {
        try {
          socket.write("zINSTREAM\0");
          for await (const chunk of createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
            const size = Buffer.allocUnsafe(4);
            size.writeUInt32BE(chunk.length);
            const sizeReady = socket.write(size);
            const chunkReady = socket.write(chunk);
            if (!sizeReady || !chunkReady) await new Promise((resume) => socket.once("drain", resume));
          }
          socket.write(Buffer.alloc(4));
        } catch (error) {
          socket.destroy(error);
        }
      });
      socket.on("data", (chunk) => {
        response += chunk.toString("utf8");
        if (response.length > 4_096) socket.destroy(new Error("clamav_response_invalid"));
      });
      socket.on("end", () => {
        clearTimeout(timer);
        const normalized = response.replace(/\0/gu, "").trim();
        if (normalized.endsWith("OK")) resolve({ clean: true, signature: null });
        else if (normalized.includes(" FOUND")) resolve({ clean: false, signature: normalized.split(":").slice(1).join(":").replace(/ FOUND$/u, "").trim() });
        else reject(new Error("clamav_response_invalid"));
      });
      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  ping(timeoutMs = 3_000) {
    return new Promise((resolve, reject) => {
      const socket = this.connect({ host: this.host, port: this.port });
      let response = "";
      const timer = setTimeout(() => socket.destroy(new Error("clamav_timeout")), timeoutMs);
      socket.setTimeout(timeoutMs, () => socket.destroy(new Error("clamav_timeout")));
      socket.on("connect", () => socket.write("zPING\0"));
      socket.on("data", (chunk) => { response += chunk.toString("utf8"); });
      socket.on("end", () => {
        clearTimeout(timer);
        if (response.replace(/\0/gu, "").trim() === "PONG") resolve(true);
        else reject(new Error("clamav_response_invalid"));
      });
      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }
}
