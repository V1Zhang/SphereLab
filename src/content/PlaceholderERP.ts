import * as THREE from "three";

/**
 * Procedurally draws a 2:1 equirectangular calibration pattern (no network access needed):
 * yaw/pitch gridlines every 30°/15°, labels, and a horizon band — so that mask alignment,
 * seam position and orientation are visually verifiable without any real content loaded.
 * Row 0 of the canvas = top = zenith (pitch +90), matching the project's ERP convention
 * (see SphericalMath.ts) with texture.flipY = false.
 */
export function createPlaceholderERPTexture(width = 2048): THREE.Texture {
  const height = width / 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  // Base vertical gradient: zenith (top) dark blue -> horizon teal -> nadir (bottom) dark.
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, "#0c1420");
  grad.addColorStop(0.45, "#123642");
  grad.addColorStop(0.5, "#1f5c63");
  grad.addColorStop(0.55, "#123642");
  grad.addColorStop(1, "#120c14");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Yaw gridlines every 30 deg (12 meridians), rear seam (yaw = +-180) highlighted.
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  for (let yaw = -180; yaw <= 180; yaw += 30) {
    const u = (yaw + 180) / 360;
    const x = u * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,120,120,0.55)";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, height);
  ctx.moveTo(width - 1, 0);
  ctx.lineTo(width - 1, height);
  ctx.stroke();

  // Pitch gridlines every 15 deg, horizon (pitch 0) highlighted.
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  for (let pitch = -90; pitch <= 90; pitch += 15) {
    const v = (90 - pitch) / 180;
    const y = v * height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(79,209,197,0.7)";
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  // Labels.
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = `${Math.round(width / 110)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let yaw = -180; yaw <= 180; yaw += 30) {
    const u = (yaw + 180) / 360;
    const x = u * width;
    const label = yaw === -180 || yaw === 180 ? "±180（后方接缝）" : yaw === 0 ? "0（舞台）" : `${yaw}`;
    ctx.fillText(label, Math.min(Math.max(x, 40), width - 40), 6);
  }
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  for (let pitch = -90; pitch <= 90; pitch += 15) {
    const v = (90 - pitch) / 180;
    const y = v * height;
    ctx.fillText(`${pitch}°`, 6, y);
  }

  ctx.textAlign = "center";
  ctx.font = `${Math.round(width / 55)}px sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText("SphereLab ERP 校准图案（2:1）", width / 2, height * 0.5 - 60);
  ctx.font = `${Math.round(width / 90)}px monospace`;
  ctx.fillText("天顶 / 图像顶部 = pitch +90°", width / 2, 40);
  ctx.fillText("天底 / 图像底部 = pitch -90°", width / 2, height - 40);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
