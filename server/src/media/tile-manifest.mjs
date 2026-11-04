import fs from "node:fs/promises";

export function validateTileManifest(manifest) {
  const canvas = manifest && manifest.canvas;
  const tile = manifest && manifest.tile;
  const errors = [];
  if (!manifest || manifest.version !== 1) errors.push("version must be 1");
  if (!canvas || canvas.width !== 16384 || canvas.height !== 16384) errors.push("canvas must be 16384x16384");
  if (!tile || tile.width !== 4096 || tile.height !== 4096 || tile.columns !== 4 || tile.rows !== 4) {
    errors.push("tile layout must be 4x4 of 4096x4096");
  }
  if (!Number.isFinite(manifest.frameRate) || manifest.frameRate <= 0) errors.push("frameRate must be positive");
  if (!Number.isInteger(manifest.frameCount) || manifest.frameCount < 1) errors.push("frameCount must be a positive integer");
  if (typeof manifest.pattern !== "string" || !manifest.pattern) errors.push("pattern is required");
  return { valid: errors.length === 0, errors, manifest };
}

export async function readTileManifest(file) {
  const manifest = JSON.parse(await fs.readFile(file, "utf8"));
  const result = validateTileManifest(manifest);
  if (!result.valid) {
    const error = new Error(result.errors.join("; "));
    error.code = "invalid_tile_manifest";
    throw error;
  }
  return result;
}
