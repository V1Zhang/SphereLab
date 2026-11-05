# SphereLab Linux Desktop Wrapper

This directory is an isolated desktop wrapper for SphereLab. It does not change the root Vite app, docs, deployment config, or existing `dist/` output.

This wrapper is Linux-only. It packages the current web UI for local control, but it is not the server GPU renderer. The Linux/NVIDIA server runtime lives in [`../server/`](../server/README.md).

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

The wrapper keeps the normal local venue editor in the main window and opens `/preview` as a second software window. The preview window receives 4096×4096 tiles over WebRTC and assembles the 16384×16384 canvas. Without this variable it opens only the local venue editor.
