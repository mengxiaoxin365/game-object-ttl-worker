import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const forwardedArgs = process.argv.slice(2);
const runInBand = forwardedArgs.includes("--runInBand");
const vitestArgs = forwardedArgs.filter((arg) => arg !== "--runInBand");

if (runInBand) {
  vitestArgs.push("--maxWorkers=1", "--no-file-parallelism");
}

const vitestCli = fileURLToPath(import.meta.resolve("vitest/vitest.mjs"));
const result = spawnSync(process.execPath, [vitestCli, "run", ...vitestArgs], {
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
