# SphereLab Linux/NVIDIA Server Runtime

This is the Linux-only server track. It is intentionally separate from the root Vite web app and the legacy Electron wrapper, so server work does not change the deployed web version.

The target runtime is:

- Linux + NVIDIA GPU
- FFmpeg/GStreamer for media ingest and hardware decode
- GPU off-screen renderer for venue, dome and mask rendering
- WebRTC transport for interactive preview

## Current status

The service entry point, configuration loading, FFmpeg/ffprobe media probe, 16K tile validation, renderer process lifecycle and signaling boundary are in place. The actual CUDA/EGL/WebRTC renderer is a separate native Linux executable. The Node service starts it as a child process and exchanges JSONL commands/events; it reports an unavailable adapter instead of silently falling back to browser rendering.

## Run

```bash
node src/index.mjs
curl http://127.0.0.1:8787/health
curl -X POST http://127.0.0.1:8787/api/media/probe \
  -H 'content-type: application/json' \
  -d '{"source":"/data/media/demo.mp4"}'
```

## Docker

The image expects NVIDIA Container Toolkit on the host:

```bash
docker build -t spherelab-server .
docker run --gpus all --rm -p 8787:8787 spherelab-server
```

The image installs Node.js 20 because the server runtime uses modern Node ESM APIs; the Ubuntu 22.04 default Node.js package is too old.

## 16K tile input

The high-resolution path uses a manifest instead of one monolithic `16384x16384` HEVC stream. Copy `tile-manifest.example.json` to the media directory as `tile-manifest.json`, then place the 4x4 `4096x4096` tile frames under the declared pattern.

Validate the manifest:

```bash
curl -X POST http://127.0.0.1:8787/api/media/tile-manifest \\
  -H 'content-type: application/json' \\
  -d '{"path":"/data/media/tile-manifest.json"}'
```

The current service validates the tile asset. GPU composition and WebRTC output are the next renderer-adapter stage.

To also check that the first frame's 16 tiles exist:

```bash
curl -X POST http://127.0.0.1:8787/api/media/tile-manifest \\
  -H 'content-type: application/json' \\
  -d '{"path":"/data/media/tile-manifest.json","checkFiles":true,"frame":0}'
```

## Renderer contract

Copy `config.example.json` to `config.json` and set `renderer.command` to the native Linux renderer adapter. The adapter protocol is JSONL:

- Node sends `{"type":"start", "sessionId", "source", "manifest", "venue", "output", "webrtc"}` on stdin.
- The renderer emits `{"type":"ready"}` when the GPU pipeline is initialized.
- The renderer emits `{"type":"offer", "sdp", ...}` and subsequent ICE events.
- Node forwards browser signaling with `POST /api/render/session/:id/signal`.

Session endpoints:

- `POST /api/render/session` starts a native renderer session.
- `GET /api/render/session/:id` reads state and recent events.
- `POST /api/render/session/:id/signal` forwards WebRTC signaling.
- `DELETE /api/render/session/:id` stops the renderer.

The web build is not used by this runtime.
