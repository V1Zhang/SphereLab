# SphereLab Linux/NVIDIA Server Runtime

This is the Linux-only server track. It is intentionally separate from the root Vite web app and the legacy Electron wrapper, so server work does not change the deployed web version.

The target runtime is:

- Linux + NVIDIA GPU
- FFmpeg/GStreamer for media ingest and hardware decode
- GPU off-screen renderer for venue, dome and mask rendering
- WebRTC transport for interactive preview

## Current status

The service entry point, configuration loading, FFmpeg/ffprobe media probe, renderer status API and session boundary are in place. The actual GPU renderer and WebRTC media transport are host adapters and must be installed/configured on the target Linux NVIDIA machine. The service reports this explicitly rather than silently falling back to browser rendering.

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

## Renderer contract

Copy `config.example.json` to `config.json` and set `renderer.command` to the native Linux renderer adapter. The adapter will consume a `VenueConfig` session and expose rendered frames to the WebRTC transport. This is the next server-side implementation boundary; the web build is not used by this runtime.
