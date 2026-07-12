import { rm } from "node:fs/promises";

await rm(new URL("../.tmp/test-build", import.meta.url), { force: true, recursive: true });
