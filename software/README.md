# SphereLab Linux Desktop Wrapper

This directory contains the Linux desktop application for SphereLab. It packages the complete venue editor and, when a Linux/NVIDIA SphereLab server is available, exposes the native 16K tile preview inside the same application window.

This wrapper is Linux-only. The Linux/NVIDIA server runtime lives in [`../server/`](../server/README.md); the desktop application connects to it over localhost/WebRTC and does not open the preview in a separate browser window.

## Directory Boundary

Files under `software/` are the only files needed for the desktop wrapper:

```text
software/
├── main.cjs
├── package.json
├── scripts/prepare-app.mjs
├── README.md
└── .gitignore
```

Generated files also stay inside `software/`:

```text
software/app-dist/      # copied static app bundle
software/release/       # packaged installers
software/node_modules/  # Electron tooling
```

## Build Flow

From the repository root, build the existing app first:

```bash
pnpm install
pnpm run build
```

Then build the desktop software:

```bash
cd software
pnpm install
pnpm run build
```

The installer / packaged app will be written to:

```text
software/release/
```

## Local Test

After the root `dist/` exists:

```bash
cd software
pnpm install
pnpm run prepare-app
pnpm run start
```

## Updating the Desktop App

Whenever the root app changes:

```bash
pnpm run build
cd software
pnpm run build
```

This copies the latest root `dist/` into `software/app-dist/` before packaging.

## Notes

- This wrapper does not provide server-side GPU rendering; use `server/` for that runtime.
- The Electron package is Linux-only and remains a local control/compatibility shell.
- The root web version is independent and is not changed by server runtime work.

## Server-native preview

To make the Linux desktop wrapper display the server's native-resolution tile preview, set the server URL before starting Electron:

```bash
SPHERELAB_SERVER_URL=http://127.0.0.1:8787 pnpm run start
```

The main SphereLab window keeps the normal venue editor and shows a `16K 原生预览` button. The embedded preview receives 4096×4096 tiles over WebRTC and assembles the 16384×16384 canvas.

Packaged AppImage builds use `http://127.0.0.1:8787` by default, so after the NVIDIA server container is running you can launch the application from the Linux desktop directly. Set `SPHERELAB_SERVER_URL` only when the renderer is on another address.

The 16K source still needs to be prepared as a valid server-side tile manifest. The desktop app is the operator interface; the NVIDIA server performs decoding and GPU composition so the browser/Electron video decoder is not used for 16K HEVC.
