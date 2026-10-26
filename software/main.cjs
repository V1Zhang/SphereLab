const { app, BrowserWindow, dialog, shell } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let server;
let serverUrl;

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
    },
  });

  win.removeMenu();
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await win.loadURL(serverUrl);
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
