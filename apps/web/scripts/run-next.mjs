import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const nextExecutable = resolve(scriptDirectory, "../node_modules/next/dist/bin/next");
const certificatePath = resolve(scriptDirectory, "../../../certs/russian_trusted_root_ca_pem.crt");
const child = spawn(process.execPath, [nextExecutable, ...process.argv.slice(2)], {
  env: {
    ...process.env,
    NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS || certificatePath
  },
  stdio: "inherit"
});

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
