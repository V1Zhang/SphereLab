# SphereLab Linux/NVIDIA Server Runtime

This is the Linux-only server track. It is intentionally separate from the root Vite web app and the legacy Electron wrapper, so server work does not change the deployed web version.

The target runtime is:

- Linux + NVIDIA GPU
- FFmpeg/GStreamer for media ingest and hardware decode
- GPU off-screen renderer for venue, dome and mask rendering
- Native local frame streaming for the Linux desktop application
- Existing WebRTC tile transport for the unchanged web preview

## Current status

The service entry point, configuration loading, FFmpeg/ffprobe media probe, 16K tile validation, renderer process lifecycle and signaling boundary are in place. The native Linux renderer executable is built inside the Docker image and starts with NVIDIA GPU and tile-manifest checks. Preview mode is `native-tile`: the 16384×16384 source remains at native resolution and is transported as 4096×4096 tiles rather than downsampled to a single 4K/8K frame. The WebRTC tile transport is reported explicitly by the native process until its media path is connected.

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

The web preview still uses the tile manifest path described below. The Linux desktop application uses `/api/native/stream` instead: it accepts the path of one complete video, starts FFmpeg once, and streams encoded frames sequentially while the file is playing. No user-created tile manifest is required for the desktop path.

The desktop container must mount the same host directory that the application uses for imported files:

```bash
docker run --gpus all --rm -p 8787:8787 \
  -v "$HOME/SphereLab-media:/data/media:ro" \
  -v /tmp/spherelab-config:/opt/spherelab/config.json:ro \
  spherelab-server
```

The desktop endpoint is a local HTTP native stream, not WebRTC. It uses a length-prefixed frame protocol so large frames are consumed incrementally and backpressure is respected.

For an end-to-end smoke test without production media, use the PNG manifest and generator:

```bash
cp tile-manifest.png.example.json /data/media/tile-manifest.json
bash scripts/generate-test-tiles.sh /data/media
```

The generator creates 16 valid 4096×4096 PNG tiles. It is only a transport/GPU pipeline test, not production visual content.

After the container is running, run the bundled deployment checks from the host:

```bash
bash scripts/verify-deployment.sh
```

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

- Node sends `{"type":"start", "sessionId", "source", "manifest", "venue", "output", "webrtc", "preview"}` on stdin. `preview.mode` is `native-tile` and `preview.preserveSourceResolution` is always true.
- The renderer emits `{"type":"ready"}` when the GPU pipeline is initialized.
- The renderer emits `{"type":"tile", "frame", "column", "row", "width":4096, "height":4096, "payload":...}` or a WebRTC tile-track offer, followed by ICE events.
- Node forwards browser signaling with `POST /api/render/session/:id/signal`.

Session endpoints:

- `POST /api/render/session` starts a native renderer session.
- `GET /api/render/session/:id` reads state and recent events.
- `POST /api/render/session/:id/signal` forwards WebRTC signaling.
- `DELETE /api/render/session/:id` stops the renderer.

For a direct DataChannel tile smoke test, open `http://server:8787/preview`. The page creates a WebRTC DataChannel, negotiates with `POST /api/render/webrtc`, starts the native CUDA compositor, receives the 16 native-resolution tile payloads and draws them into a 16384×16384 canvas. This direct browser path requires `format: "png-sequence"`; EXR decoding remains in the native GPU renderer path and must be converted to PNG tiles before browser transport.

The web build is not used by this runtime.
