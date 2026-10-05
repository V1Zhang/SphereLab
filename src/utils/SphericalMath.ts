import * as THREE from "three";

/**
 * Unified coordinate & angle convention for the whole project (frozen for V1, see docs/COORDINATE_SYSTEM.md):
 *
 *  - World space: +Y up, meters, right-handed. Ground = y 0.
 *  - Stage sits toward -Z ("front"). Audience sits toward +Z ("rear").
 *  - yaw (deg): 0 = facing the stage (-Z). Increases toward +X (audience's right when facing the stage).
 *               Range (-180, 180], wrapping at the rear (+Z).
 *  - pitch (deg): 0 = horizon through the media-plane sphere center. +90 = zenith. Range [-90, 90].
 *  - ERP UV (equirectangular, 2:1, matches erp.aspect = 2):
 *        u = (yaw + 180) / 360        (0 = rear-left seam, 0.5 = stage center)
 *        v = (90 - pitch) / 180       (0 = zenith / top row of the image, 1 = nadir / bottom row)
 *
 * This file is the single source of truth for yaw/pitch <-> direction <-> ERP UV conversions.
 * Every geometry, shader and diagnostics readout must go through these functions so the mapping
 * never drifts between modules.
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export interface YawPitch {
  yawDeg: number;
  pitchDeg: number;
}

export interface UV {
  u: number;
  v: number;
}

/** Unit direction vector on the sphere for a given yaw/pitch, in the project's world convention. */
export function yawPitchToDirection(yawDeg: number, pitchDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const yaw = yawDeg * DEG2RAD;
  const pitch = pitchDeg * DEG2RAD;
  const cp = Math.cos(pitch);
  out.set(cp * Math.sin(yaw), Math.sin(pitch), -cp * Math.cos(yaw));
  return out;
}

/** Inverse of yawPitchToDirection. `dir` need not be normalized. */
export function directionToYawPitch(dir: THREE.Vector3): YawPitch {
  const d = dir.clone().normalize();
  const yawDeg = Math.atan2(d.x, -d.z) * RAD2DEG;
  const pitchDeg = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) * RAD2DEG;
  return { yawDeg, pitchDeg };
}

/** Yaw/pitch convention for the inner dome's Z-up local frame (X/Y cross-section, +Z dome). */
export function yawPitchToZUpDirection(yawDeg: number, pitchDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const yaw = yawDeg * DEG2RAD;
  const pitch = pitchDeg * DEG2RAD;
  const cp = Math.cos(pitch);
  out.set(cp * Math.sin(yaw), -cp * Math.cos(yaw), Math.sin(pitch));
  return out;
}

/** Inverse of `yawPitchToZUpDirection`; input is in the dome's logical Z-up frame. */
export function zUpDirectionToYawPitch(dir: THREE.Vector3): YawPitch {
  const d = dir.clone().normalize();
  return {
    yawDeg: Math.atan2(d.x, -d.y) * RAD2DEG,
    pitchDeg: Math.asin(THREE.MathUtils.clamp(d.z, -1, 1)) * RAD2DEG,
  };
}

export function yawPitchToUV(yawDeg: number, pitchDeg: number): UV {
  const u = (yawDeg + 180) / 360;
  const v = (90 - pitchDeg) / 180;
  return { u, v };
}

export function uvToYawPitch(u: number, v: number): YawPitch {
  return {
    yawDeg: u * 360 - 180,
    pitchDeg: 90 - v * 180,
  };
}

/** Folds any yaw into (-180, 180]. */
export function wrapYawDeg(yawDeg: number): number {
  let y = yawDeg % 360;
  if (y <= -180) y += 360;
  if (y > 180) y -= 360;
  return y;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth ease (cosine) interpolation, C1 continuous — used for the mask boundary, not a hard cut. */
export function cosineEase(a: number, b: number, t: number): number {
  const tt = 0.5 - 0.5 * Math.cos(THREE.MathUtils.clamp(t, 0, 1) * Math.PI);
  return lerp(a, b, tt);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
