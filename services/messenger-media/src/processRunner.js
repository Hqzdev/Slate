import { execFile } from "node:child_process";

export class ProcessRunner {
  run(command, args, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      execFile(command, args, {
        encoding: "utf8",
        env: { LANG: "C", PATH: process.env.PATH },
        maxBuffer: 1024 * 1024,
        timeout: timeoutMs,
        windowsHide: true
      }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stderr, stdout });
      });
    });
  }
}
