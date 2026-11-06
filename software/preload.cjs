const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("sphereLabDesktop", {
  getPathForFile(file) { return webUtils.getPathForFile(file); },
  importMedia(filePath) { return ipcRenderer.invoke("import-media", filePath); },
});
