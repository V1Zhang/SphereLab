import fs from "node:fs";

export function rendererStatus(config) {
  const renderer = config.renderer || {};
  let executable = false;
  if (renderer.command) {
    try {
      executable = fs.statSync(renderer.command).isFile();
      fs.accessSync(renderer.command, fs.constants.X_OK);
    } catch {
      executable = false;
    }
  }
  return {
    configured: Boolean(renderer.command),
    executable,
    command: renderer.command || null,
    output: {
      width: Number(renderer.width || 3840),
      height: Number(renderer.height || 2160),
      fps: Number(renderer.fps || 30),
    },
    backend: "native-linux-nvidia-adapter",
  };
}

export function requireRenderer(config) {
  const status = rendererStatus(config);
  if (!status.executable) {
    const error = new Error("Linux/NVIDIA renderer adapter is not configured");
    error.code = "renderer_adapter_unavailable";
    throw error;
  }
}
