import fs from "node:fs/promises";
import path from "node:path";

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

function tilePath(pattern, frame, column, row) {
  const values = [frame, column, row];
  let index = 0;
  return pattern.replace(/%0?(\d*)d/g, (_token, width) => {
    const value = String(values[index] ?? 0);
    index += 1;
    return width ? value.padStart(Number(width), "0") : value;
  });
}

export async function readTileManifest(file, options = {}) {
  const manifest = JSON.parse(await fs.readFile(file, "utf8"));
  const result = validateTileManifest(manifest);
  if (!result.valid) {
    const error = new Error(result.errors.join("; "));
    error.code = "invalid_tile_manifest";
    throw error;
  }
  if (options.checkFiles) {
    const root = options.mediaRoot || path.dirname(file);
    const missing = [];
    const frame = Number.isInteger(options.frame) ? options.frame : 0;
    for (let row = 0; row < manifest.tile.rows; row += 1) {
      for (let column = 0; column < manifest.tile.columns; column += 1) {
        const relative = tilePath(manifest.pattern, frame, column, row);
        const resolved = path.resolve(root, relative);
        if (!resolved.startsWith(path.resolve(root) + path.sep)) {
          const error = new Error("tile pattern escapes media root");
          error.code = "unsafe_tile_pattern";
          throw error;
        }
        try {
          await fs.access(resolved);
        } catch {
          missing.push(relative);
        }
      }
    }
    result.files = { frame, checked: manifest.tile.columns * manifest.tile.rows, missing };
  }
  return result;
}
