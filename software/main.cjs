const { app, BrowserWindow, dialog, shell, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

let server;
let serverUrl;
const videoExportSessions = new Map();

ipcMain.handle("import-media", async (_event, sourcePath) => {
  if (typeof sourcePath !== "string" || !path.isAbsolute(sourcePath)) throw new Error("invalid media path");
  const mediaRoot = process.env.SPHERELAB_MEDIA_DIR || path.join(os.homedir(), "SphereLab-media");
  await fs.promises.mkdir(mediaRoot, { recursive: true });
  const filename = path.basename(sourcePath);
  await fs.promises.copyFile(sourcePath, path.join(mediaRoot, filename));
  return { source: `/data/media/${filename}`, filename };
});

function ffmpegCandidates() {
  const bundled = app.isPackaged
    ? path.join(process.resourcesPath, "ffmpeg", process.arch, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
    : path.join(__dirname, "vendor", "ffmpeg", process.arch, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  return [process.env.SPHERELAB_FFMPEG, bundled, "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"].filter(Boolean);
}

async function resolveFfmpeg() {
  for (const candidate of ffmpegCandidates()) {
    if (candidate === "ffmpeg") return candidate;
    try {
      await fs.promises.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try the next bundled or common installation path.
    }
  }
  throw new Error("找不到 FFmpeg。请安装 FFmpeg，或设置 SPHERELAB_FFMPEG 环境变量。");
}

ipcMain.handle("video-export-start", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "spherelab-erp-export-"));
  const id = path.basename(directory);
  videoExportSessions.set(id, { directory });
  return { id };
});

ipcMain.handle("video-export-frame", async (_event, id, frameIndex, bytes) => {
  const session = videoExportSessions.get(id);
  if (!session || !Number.isInteger(frameIndex) || !(bytes instanceof Uint8Array)) throw new Error("无效的视频导出帧");
  const filename = path.join(session.directory, `frame-${String(frameIndex).padStart(6, "0")}.png`);
  await fs.promises.writeFile(filename, Buffer.from(bytes));
});

ipcMain.handle("video-export-finish", async (_event, id, fps) => {
  const session = videoExportSessions.get(id);
  if (!session) throw new Error("视频导出会话不存在");
  videoExportSessions.delete(id);
  try {
    const ffmpeg = await resolveFfmpeg();
    const result = await dialog.showSaveDialog({
      title: "导出无损 ERP 视频",
      defaultPath: path.join(os.homedir(), `spherelab-adjusted-video-${Date.now()}.mp4`),
      filters: [{ name: "MP4 视频", extensions: ["mp4"] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    await new Promise((resolve, reject) => {
      const child = spawn(ffmpeg, [
        "-hide_banner", "-loglevel", "error",
        "-framerate", String(Math.max(1, Number(fps) || 30)),
        "-i", path.join(session.directory, "frame-%06d.png"),
        "-an",
        "-c:v", "libx264",
        "-preset", "medium",
        "-qp", "0",
        "-pix_fmt", "yuv444p",
        "-movflags", "+faststart",
        "-y", result.filePath,
      ]);
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `FFmpeg exited with code ${code}`)));
    });
    return { cancelled: false, path: result.filePath };
  } finally {
    await fs.promises.rm(session.directory, { recursive: true, force: true });
  }
});

function appDistDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app-dist");
  }
  return path.join(__dirname, "app-dist");
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".wasm":
      return "application/wasm";
    case ".map":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0]);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.join(root, normalized);
  if (!fullPath.startsWith(root)) return null;
  return fullPath;
}

function startStaticServer(root) {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const urlPath = req.url === "/" ? "/index.html" : req.url || "/index.html";
      let filePath = safeJoin(root, urlPath);
      if (!filePath) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      fs.stat(filePath, (statErr, stat) => {
        if (!statErr && stat.isDirectory()) filePath = path.join(filePath, "index.html");

        fs.readFile(filePath, (readErr, data) => {
          if (readErr) {
            fs.readFile(path.join(root, "index.html"), (fallbackErr, fallbackData) => {
              if (fallbackErr) {
                res.writeHead(404);
                res.end("Not found");
                return;
              }
              res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
              res.end(fallbackData);
            });
            return;
          }

          res.writeHead(200, { "Content-Type": contentType(filePath) });
          res.end(data);
        });
      });
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate local app server port."));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function createWindow() {
  const root = appDistDir();
  const indexPath = path.join(root, "index.html");

  if (!fs.existsSync(indexPath)) {
    await dialog.showMessageBox({
      type: "error",
      title: "SphereLab bundle missing",
      message: "Cannot find app-dist/index.html.",
      detail: "Run `pnpm run prepare-app` inside the software directory after building the root app.",
    });
    app.quit();
    return;
  }

  serverUrl = await startStaticServer(root);

  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    title: "SphereLab",
    backgroundColor: "#0a0c10",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  win.removeMenu();
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Desktop builds default to the local NVIDIA server so the user can launch the AppImage from
  // the desktop without first opening a terminal. An environment variable still allows a remote
  // or non-default server during testing.
  const serverPreview = process.env.SPHERELAB_SERVER_URL || (process.platform === "linux" ? "http://127.0.0.1:8787" : "");
  const appUrl = serverPreview
    ? `${serverUrl}/?desktopServer=${encodeURIComponent(serverPreview)}`
    : serverUrl;
  await win.loadURL(appUrl);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  if (server) server.close();
});
