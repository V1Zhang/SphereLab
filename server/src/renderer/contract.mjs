export function rendererStatus(config) {
  const renderer = config.renderer || {};
  return {
    configured: Boolean(renderer.command),
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
  if (!config.renderer || !config.renderer.command) {
    const error = new Error("Linux/NVIDIA renderer adapter is not configured");
    error.code = "renderer_not_configured";
    throw error;
  }
}
