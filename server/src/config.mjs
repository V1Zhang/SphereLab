import fs from "node:fs/promises";

export async function loadConfig() {
  const file = process.env.SPHERELAB_CONFIG || "config.json";
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    return {
      host: parsed.host || process.env.SPHERELAB_HOST || "0.0.0.0",
      port: Number(parsed.port || process.env.SPHERELAB_PORT || 8787),
      media: parsed.media || {},
      renderer: parsed.renderer || {},
      webrtc: parsed.webrtc || {},
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {
      host: process.env.SPHERELAB_HOST || "0.0.0.0",
      port: Number(process.env.SPHERELAB_PORT || 8787),
      media: {},
      renderer: { command: process.env.SPHERELAB_RENDERER_COMMAND || "" },
      webrtc: { iceServers: [] },
    };
  }
}
