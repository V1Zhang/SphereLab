import http from "node:http";
import { loadConfig } from "./config.mjs";
import { probeMedia } from "./media/ffmpeg.mjs";
import { readTileManifest } from "./media/tile-manifest.mjs";
import { rendererStatus, requireRenderer } from "./renderer/contract.mjs";
import { RendererAdapter } from "./renderer/adapter.mjs";
import { TileWebRtcSessions } from "./renderer/webrtc.mjs";
import fs from "node:fs/promises";

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
  const renderer = new RendererAdapter(config);
  const tileWebRtc = new TileWebRtcSessions(config, renderer);
  const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/preview") {
      const html = await fs.readFile(new URL("../public/native-tile-preview.html", import.meta.url), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.method === "GET" && req.url === "/health") {
      json(res, 200, { ok: true, service: "spherelab-server", renderer: renderer.status() });
      return;
    }

    if (req.method === "GET" && req.url === "/api/renderer/status") {
      json(res, 200, renderer.status());
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
      json(res, 200, await readTileManifest(file, { checkFiles: payload.checkFiles === true, frame: payload.frame }));
      return;
    }

    if (req.method === "POST" && req.url === "/api/render/session") {
      requireRenderer(config);
      const payload = await readJson(req);
      json(res, 201, await renderer.createSession(payload));
      return;
    }

    if (req.method === "POST" && req.url === "/api/render/webrtc") {
      json(res, 201, await tileWebRtc.create(await readJson(req)));
      return;
    }

    const signalMatch = req.url.match(/^\/api\/render\/session\/([^/]+)\/signal$/);
    if (req.method === "POST" && signalMatch) {
      json(res, 200, renderer.signal(signalMatch[1], await readJson(req)));
      return;
    }

    const sessionMatch = req.url.match(/^\/api\/render\/session\/([^/]+)$/);
    if (req.method === "GET" && sessionMatch) {
      const session = renderer.get(sessionMatch[1]);
      if (!session) return json(res, 404, { error: "render_session_not_found" });
      json(res, 200, session);
      return;
    }
    if (req.method === "DELETE" && sessionMatch) {
      const stopped = renderer.stop(sessionMatch[1]);
      json(res, stopped ? 200 : 404, { ok: stopped });
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    const status = ["renderer_not_configured", "renderer_adapter_unavailable"].includes(error.code) ? 503 : 400;
    json(res, status, { error: error.code || "request_failed", message: error.message });
  }
  });

  if (process.argv.includes("--health")) {
    console.log(JSON.stringify({ ok: true, service: "spherelab-server", renderer: renderer.status() }, null, 2));
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
