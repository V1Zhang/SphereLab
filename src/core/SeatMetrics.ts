import * as THREE from "three";
import { MaskControlPoint, VenueConfig } from "./VenueConfig";
import { isInsideMask } from "./ScreenMask";
import { directionToYawPitch } from "../utils/SphericalMath";
import { SeatMeta, audienceSeatPosition } from "./VenueGeometry";

/**
 * Per-seat viewpoint math for the "click a seat to preview its view" feature (main.ts
 * `selectSeat`). Answers the two questions docs/ARCHITECTURE.md's "how a seat's view is
 * evaluated" (mirroring the project brief's eq. 7-8): does the screen actually fill this seat's
 * forward view, and how far does its line of sight to a fixed screen point diverge from the
 * central reference seat's? Both are geometric approximations computed here in JS against the
 * SAME screen-mask boundary the shader renders (ScreenMask.ts `isInsideMask`) — neither accounts
 * for occluders (seat backs, structure — unmodeled in V1, see docs/HANDOFF_CHECKLIST.md D-09) or
 * for the loaded content's own coverage window (ERPManifest hFov/vFov): this measures "is there
 * *screen* here", not "is there *content* here".
 */

/**
 * Nearest point where a ray from `origin` along the unit direction `dir` crosses the sphere of
 * the given radius centered at `center`. Returns null only if the ray points entirely away from
 * the sphere; for an eye inside the dome (the normal audience case) a positive root always exists.
 */
export function intersectDomeRay(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  center: THREE.Vector3,
  radiusM: number,
): THREE.Vector3 | null {
  const oc = origin.clone().sub(center);
  const b = oc.dot(dir); // dir is assumed unit length, so the quadratic's "a" term is 1
  const c = oc.lengthSq() - radiusM * radiusM;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sqrtDisc = Math.sqrt(disc);
  const t1 = -b - sqrtDisc;
  const t2 = -b + sqrtDisc;
  const t = t1 > 1e-6 ? t1 : t2 > 1e-6 ? t2 : null;
  if (t === null) return null;
  return origin.clone().addScaledVector(dir, t);
}

export interface SeatCoverageOptions {
  /** Half-width of the sampled viewing cone, degrees (horizontal). Default 55°. */
  hHalfFovDeg?: number;
  /** Half-height of the sampled viewing cone, degrees (vertical). Default 35°. */
  vHalfFovDeg?: number;
  /** Sample grid resolution along each axis (steps × steps rays total). Default 15. */
  steps?: number;
}

export interface SeatCoverageResult {
  /** Fraction (0-1) of the sampled cone whose rays land inside the screen mask. */
  coverageFraction: number;
  sampleCount: number;
}

/**
 * Approximates how much of a representative forward viewing cone from `eye` (aimed at
 * `forwardDir`) actually shows screen: ray-casts a sample grid onto the dome sphere and checks
 * each hit's yaw/pitch against the screen mask. A coarse survey, not a per-pixel measurement —
 * see the module doc comment above for what it deliberately leaves out.
 */
export function computeSeatCoverage(
  eye: THREE.Vector3,
  forwardDir: THREE.Vector3,
  domeCenter: THREE.Vector3,
  domeRadiusM: number,
  maskControlPoints: MaskControlPoint[],
  opts: SeatCoverageOptions = {},
): SeatCoverageResult {
  const hHalf = opts.hHalfFovDeg ?? 55;
  const vHalf = opts.vHalfFovDeg ?? 35;
  const steps = Math.max(2, opts.steps ?? 15);

  const forward = forwardDir.clone().normalize();
  // Any stable "up" not parallel to forward works here — the sampled cone doesn't need to match
  // the eventual camera's actual roll, it just needs to sweep a consistent forward-facing patch.
  const worldUp = Math.abs(forward.y) > 0.98 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  let inside = 0;
  let total = 0;
  const dir = new THREE.Vector3();
  for (let i = 0; i < steps; i++) {
    const h = THREE.MathUtils.lerp(-hHalf, hHalf, steps === 1 ? 0.5 : i / (steps - 1));
    const hr = THREE.MathUtils.degToRad(h);
    for (let j = 0; j < steps; j++) {
      const v = THREE.MathUtils.lerp(-vHalf, vHalf, steps === 1 ? 0.5 : j / (steps - 1));
      const vr = THREE.MathUtils.degToRad(v);
      dir
        .copy(forward)
        .addScaledVector(right, Math.tan(hr))
        .addScaledVector(up, Math.tan(vr))
        .normalize();
      total++;
      const hit = intersectDomeRay(eye, dir, domeCenter, domeRadiusM);
      if (!hit) continue;
      const physDir = hit.clone().sub(domeCenter).normalize();
      const { yawDeg, pitchDeg } = directionToYawPitch(physDir);
      if (isInsideMask(yawDeg, pitchDeg, maskControlPoints)) inside++;
    }
  }
  return { coverageFraction: total > 0 ? inside / total : 0, sampleCount: total };
}

/**
 * Angular difference, in degrees, between two eyes' viewing directions toward the SAME fixed
 * screen point `p` — eq. (8) in the project brief: Δe = 2·arcsin(‖p̂−eA − p̂−eB‖ / 2), using the
 * chord length between the two unit direction vectors rather than acos(dot) directly, which loses
 * precision for small angles.
 */
export function directionOffsetDeg(p: THREE.Vector3, eyeA: THREE.Vector3, eyeB: THREE.Vector3): number {
  const a = p.clone().sub(eyeA).normalize();
  const b = p.clone().sub(eyeB).normalize();
  const chord = a.sub(b).length();
  const rad = 2 * Math.asin(THREE.MathUtils.clamp(chord / 2, 0, 1));
  return THREE.MathUtils.radToDeg(rad);
}

// ---------------------------------------------------------------------------
// Batch analysis across every representative seat — the "analysis tools" module in the
// docs/ARCHITECTURE.md checklist. Runs the same per-seat math as `selectSeat` (main.ts) over
// every entry in VenueGeometry.ts's `seatMeta` instead of just the one the user clicked.
// ---------------------------------------------------------------------------

export interface SeatSample {
  row: number;
  azDeg: number;
  radiusM: number;
  eye: THREE.Vector3;
  coverageFraction: number;
  offsetDeg: number;
}

export interface DistributionStat {
  mean: number;
  p95: number;
  min: number;
  max: number;
}

export interface BatchSeatAnalysis {
  samples: SeatSample[];
  coverage: DistributionStat;
  offsetDeg: DistributionStat;
}

/** Mean + P95 + min/max — deliberately NOT a single averaged score. Per the project brief: a
 *  handful of geometric samples must never be collapsed into one number that reads as "overall
 *  audience satisfaction" (see docs/ARCHITECTURE.md "每个座位的视角" 局限 list). P95 uses the
 *  nearest-rank method (ceil), consistent with how the project brief's own table 4 reports it. */
function summarizeDistribution(values: number[]): DistributionStat {
  if (values.length === 0) return { mean: 0, p95: 0, min: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const p95Index = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return { mean, p95: sorted[p95Index], min: sorted[0], max: sorted[sorted.length - 1] };
}

/**
 * Runs `computeSeatCoverage` + `directionOffsetDeg` for every representative seat in `seatMeta`.
 * `seatTarget` is the shared "aim toward the stage" point (same one `selectSeat` uses — see
 * main.ts) and `referencePoint` / `centralEye` are the fixed screen point and central reference
 * eye that every seat's offset is measured against (also shared with `selectSeat`, computed once
 * by main.ts's `getSeatReferenceFrame()` so both paths never drift apart).
 *
 * Geometric approximation only — same caveats as `computeSeatCoverage` (no occluders, doesn't
 * know the loaded content's own FOV window) — and seat coordinates are still VenueConfig's
 * parametric grid, not a real seat table (see docs/HANDOFF_CHECKLIST.md D-07).
 */
export function runBatchSeatAnalysis(
  cfg: VenueConfig,
  seatMeta: SeatMeta[],
  domeCenter: THREE.Vector3,
  seatTarget: THREE.Vector3,
  referencePoint: THREE.Vector3,
  centralEye: THREE.Vector3,
): BatchSeatAnalysis {
  const samples: SeatSample[] = seatMeta.map((meta) => {
    const floorPos = audienceSeatPosition(meta.azDeg, meta.radius, cfg.audience);
    const eye = floorPos.clone().add(new THREE.Vector3(0, cfg.audience.eyeHeight, 0));
    const forward = seatTarget.clone().sub(eye).normalize();
    const { coverageFraction } = computeSeatCoverage(eye, forward, domeCenter, cfg.mediaPlane.radius, cfg.mediaPlane.maskControlPoints);
    const offsetDeg = directionOffsetDeg(referencePoint, eye, centralEye);
    return { row: meta.row, azDeg: meta.azDeg, radiusM: meta.radius, eye, coverageFraction, offsetDeg };
  });

  return {
    samples,
    coverage: summarizeDistribution(samples.map((s) => s.coverageFraction)),
    offsetDeg: summarizeDistribution(samples.map((s) => s.offsetDeg)),
  };
}

/** Serializes a batch analysis to CSV — one row per representative seat. */
export function seatAnalysisToCSV(result: BatchSeatAnalysis): string {
  const header = "row,azimuthDeg,radiusM,eyeX,eyeY,eyeZ,coverageFraction,offsetDeg";
  const rows = result.samples.map(
    (s) =>
      `${s.row},${s.azDeg.toFixed(2)},${s.radiusM.toFixed(2)},${s.eye.x.toFixed(3)},${s.eye.y.toFixed(3)},${s.eye.z.toFixed(3)},${s.coverageFraction.toFixed(4)},${s.offsetDeg.toFixed(3)}`,
  );
  return [header, ...rows].join("\n") + "\n";
}
