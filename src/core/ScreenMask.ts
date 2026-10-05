import { MaskControlPoint } from "./VenueConfig";
import { cosineEase, wrapYawDeg } from "../utils/SphericalMath";

/**
 * The screen mask is the concept described in the brief: the media plane is NOT a full sphere,
 * a flat wall, a standard hemisphere, or a 270° cylinder. It is a concave spherical LED wall whose
 * lower boundary rises smoothly from the stage (deepest, most negative pitch) around the sides
 * up to the rear (shallowest), with a soft (smoothstep/cosine) edge rather than a hard rectangular
 * cut. `minPitchForYaw` is the analytic approximation of that boundary, driven by a handful of
 * control points instead of a real screen-boundary mesh (which only becomes available in V2).
 */

/**
 * Returns the lower pitch bound of the media plane at a given yaw: the screen exists wherever
 * pitch >= minPitchForYaw(yaw). Interpolates with a cosine ease between the supplied control
 * points (folded onto absolute yaw so the mask is left/right symmetric), which keeps the boundary
 * curve continuous and C1-smooth instead of a piecewise-linear or hard-cut shape.
 */
export function minPitchForYaw(yawDeg: number, controlPoints: MaskControlPoint[]): number {
  if (controlPoints.length === 0) return -90;
  const absYaw = Math.abs(wrapYawDeg(yawDeg));
  const pts = [...controlPoints].sort((a, b) => a.yawDeg - b.yawDeg);

  if (absYaw <= pts[0].yawDeg) return pts[0].minPitchDeg;
  if (absYaw >= pts[pts.length - 1].yawDeg) return pts[pts.length - 1].minPitchDeg;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (absYaw >= a.yawDeg && absYaw <= b.yawDeg) {
      const t = (absYaw - a.yawDeg) / (b.yawDeg - a.yawDeg);
      return cosineEase(a.minPitchDeg, b.minPitchDeg, t);
    }
  }
  return pts[pts.length - 1].minPitchDeg;
}

/** True if the given yaw/pitch (in degrees) falls within the masked (visible) media-plane region. */
export function isInsideMask(yawDeg: number, pitchDeg: number, controlPoints: MaskControlPoint[]): boolean {
  return pitchDeg >= minPitchForYaw(yawDeg, controlPoints);
}

/** Samples the boundary curve as [yawDeg, minPitchDeg] pairs, for diagnostics line rendering. */
export function sampleBoundaryCurve(controlPoints: MaskControlPoint[], steps = 180): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const yawDeg = -180 + (360 * i) / steps;
    out.push([yawDeg, minPitchForYaw(yawDeg, controlPoints)]);
  }
  return out;
}

/**
 * Numerically integrates the visible media-plane surface area on a sphere of the given radius.
 * Coarse but adequate for a diagnostics readout — recompute only when mask/radius params change.
 */
export function estimateMediaPlaneAreaM2(
  radiusM: number,
  controlPoints: MaskControlPoint[],
  yawSteps = 360,
  pitchSteps = 180
): number {
  const R2 = radiusM * radiusM;
  const dYaw = (2 * Math.PI) / yawSteps;
  const dPitch = Math.PI / pitchSteps;
  let area = 0;
  for (let i = 0; i < yawSteps; i++) {
    const yawDeg = -180 + (360 * (i + 0.5)) / yawSteps;
    const minPitchDeg = minPitchForYaw(yawDeg, controlPoints);
    const minPitchRad = (minPitchDeg * Math.PI) / 180;
    for (let j = 0; j < pitchSteps; j++) {
      const pitchRad = -Math.PI / 2 + (j + 0.5) * dPitch;
      if (pitchRad < minPitchRad) continue;
      area += R2 * Math.cos(pitchRad) * dPitch * dYaw;
    }
  }
  return area;
}

/** Fraction (0-1) of the full sphere's surface that the media plane occupies. */
export function mediaPlaneCoverageFraction(radiusM: number, controlPoints: MaskControlPoint[]): number {
  const full = 4 * Math.PI * radiusM * radiusM;
  return estimateMediaPlaneAreaM2(radiusM, controlPoints) / full;
}
