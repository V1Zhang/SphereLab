export function rendererStatus(config) {
  return {
    configured: Boolean(config.renderer?.command),
    command: config.renderer?.command || null,
    output: {
      width: Number(config.renderer?.width || 3840),
      height: Number(config.renderer?.height || 2160),
      fps: Number(config.renderer?.fps || 30),
    },
    backend: "native-linux-nvidia-adapter",
  };
}

export function requireRenderer(config) {
  if (!config.renderer?.command) {
    const error = new Error("Linux/NVIDIA renderer adapter is not configured");
    error.code = "renderer_not_configured";
    throw error;
  }
}
