import http from "node:http";
import { loadConfig } from "./config.mjs";
import { probeMedia } from "./media/ffmpeg.mjs";
import { readTileManifest } from "./media/tile-manifest.mjs";
import { rendererStatus, requireRenderer } from "./renderer/contract.mjs";

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function start() {
  const config = await loadConfig();
  const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      json(res, 200, { ok: true, service: "spherelab-server", renderer: rendererStatus(config) });
      return;
    }

    if (req.method === "GET" && req.url === "/api/renderer/status") {
      json(res, 200, rendererStatus(config));
      return;
    }

    if (req.method === "POST" && req.url === "/api/media/probe") {
      const payload = await readJson(req);
      const source = payload.source || config.media.source;
      json(res, 200, { source, probe: await probeMedia(source) });
      return;
    }

    if (req.method === "POST" && req.url === "/api/media/tile-manifest") {
      const payload = await readJson(req);
      const file = payload.path || config.media.manifest;
      if (!file) {
        const error = new Error("tile manifest path is required");
        error.code = "tile_manifest_path_required";
        throw error;
      }
      json(res, 200, await readTileManifest(file));
      return;
    }

    if (req.method === "POST" && req.url === "/api/render/session") {
      requireRenderer(config);
      json(res, 501, {
        error: "renderer_adapter_not_started",
        message: "The native Linux/NVIDIA renderer adapter must be installed before starting a WebRTC session.",
      });
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    const status = error.code === "renderer_not_configured" ? 503 : 400;
    json(res, status, { error: error.code || "request_failed", message: error.message });
  }
  });

  if (process.argv.includes("--health")) {
    console.log(JSON.stringify({ ok: true, service: "spherelab-server", renderer: rendererStatus(config) }, null, 2));
  } else {
    server.listen(config.port, config.host, () => {
      console.log(`SphereLab server listening on ${config.host}:${config.port}`);
    });
  }
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
