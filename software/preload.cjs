const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("sphereLabDesktop", {
  isDesktop: true,
  getPathForFile(file) { return webUtils.getPathForFile(file); },
  importMedia(filePath) { return ipcRenderer.invoke("import-media", filePath); },
  startVideoExport(fps) { return ipcRenderer.invoke("video-export-start", fps); },
  writeVideoExportFrame(id, frameIndex, bytes) { return ipcRenderer.invoke("video-export-frame", id, frameIndex, bytes); },
  finishVideoExport(id) { return ipcRenderer.invoke("video-export-finish", id); },
});
