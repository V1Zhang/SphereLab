# SphereLab Desktop Software

This directory is an isolated desktop wrapper for SphereLab. It does not change the root Vite app, docs, deployment config, or existing `dist/` output.

The wrapper uses Electron to package the already-built web app into a desktop application. At runtime it serves the packaged static files from a local in-app HTTP server and opens them in an application window.

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

- This is not a backend server product. The local HTTP server runs only inside the desktop app process.
- Users do not need to open a browser.
- File loading, rendering, analysis, and exports still run locally on the user's machine.
- If you deploy the root web version separately, this desktop wrapper does not affect it.
