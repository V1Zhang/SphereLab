import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const softwareDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(softwareDir, "..");
const sourceDist = path.join(repoRoot, "dist");
const targetDist = path.join(softwareDir, "app-dist");

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(path.join(sourceDist, "index.html")))) {
  console.error("Missing ../dist/index.html.");
  console.error("Run `pnpm run build` from the repository root before packaging the desktop app.");
  process.exit(1);
}

await fs.rm(targetDist, { recursive: true, force: true });
await fs.mkdir(targetDist, { recursive: true });
await fs.cp(sourceDist, targetDist, { recursive: true });

console.log(`Copied ${sourceDist} -> ${targetDist}`);
