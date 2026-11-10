const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("sphereLabDesktop", {
  isDesktop: true,
  getPathForFile(file) { return webUtils.getPathForFile(file); },
  importMedia(filePath) { return ipcRenderer.invoke("import-media", filePath); },
  startVideoExport() { return ipcRenderer.invoke("video-export-start"); },
  writeVideoExportFrame(id, frameIndex, bytes) { return ipcRenderer.invoke("video-export-frame", id, frameIndex, bytes); },
  finishVideoExport(id, fps) { return ipcRenderer.invoke("video-export-finish", id, fps); },
});
