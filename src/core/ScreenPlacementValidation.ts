import { VenueConfig } from "./VenueConfig";

/**
 * Reasonableness constraints for dragging the inner screen (Media Plane) independently of the
 * outer shell / audience / stage — see docs/SCREEN_DECOUPLING_DESIGN.md for the full design and
 * the rationale behind each constant. Constraint IDs (C-01..C-09) match that document; reference
 * them by ID wherever this module is cited, same convention as HANDOFF_CHECKLIST.md's D-01~D-10.
 *
 * Pure math only (no three.js), per the `core/` convention (see ARCHITECTURE.md module table) —
 * points are plain {x,y,z} objects, not THREE.Vector3, so this stays usable from anywhere without
 * pulling in the renderer.
 */

export const CLEARANCE_SHELL_M = 2;
export const OFFSET_TOLERANCE_RATIO = 0.1; // C-02 — the "10%" the user asked for
export const OFFSET_WARNING_RATIO = 0.05; // C-09 — a second, lower heads-up threshold
export const CLEARANCE_AUDIENCE_M = 1;
export const CLEARANCE_STAGE_M = 1;
export const MAX_EMBED_M = 0;
export const MIN_ABS_RADIUS_M = 10;

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** The subset of MediaPlaneConfig this module reads/writes — radius + full 3D center. */
export interface MediaPlaneCandidate {
  radius: number;
  centerHeight: number;
  centerOffsetX: number;
  centerOffsetZ: number;
}

export interface PlacementViolation {
  /** C-01..C-09, see docs/SCREEN_DECOUPLING_DESIGN.md. */
  code: string;
  message: string;
  /** hard = the candidate was clamped to restore this constraint. soft = reported only, never clamped. */
  severity: "hard" | "soft";
}

export interface PlacementCheckResult {
  clamped: MediaPlaneCandidate;
  /** What was found (and, for "hard" entries, corrected) while reconciling the candidate. Empty
   *  when the candidate was already fully inside every constraint. */
  violations: PlacementViolation[];
}

function dist(a: Point3, b: Point3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/** The 8 corners of the stage platform box, in the same world frame VenueGeometry.ts `buildStage`
 *  places it in — kept in sync with that function's math (BoxGeometry centered on its own position,
 *  bottom at y=0 since the box is translated up by half its height). */
function stageCorners(cfg: VenueConfig): Point3[] {
  const { width, depth, height, frontOffset } = cfg.stage;
  const centerZ = -(frontOffset + depth / 2);
  const corners: Point3[] = [];
  for (const sx of [-0.5, 0.5]) {
    for (const sy of [0, 1]) {
      for (const sz of [-0.5, 0.5]) {
        corners.push({ x: sx * width, y: sy * height, z: centerZ + sz * depth });
      }
    }
  }
  return corners;
}

/**
 * Reconciles a candidate inner-screen placement (center + radius) against the outer shell /
 * audience / stage — all three of which are parametric-only per docs/SCREEN_DECOUPLING_DESIGN.md
 * §2, never dragged. Hard constraints (C-01, C-03, C-04, C-05, C-06) are enforced by clamping the
 * candidate back to the nearest legal value (§5 C-07 — "clamp, don't reject", so a drag gesture
 * never gets discarded mid-motion); the soft constraint (C-02) and its warning tier (C-09) are only
 * reported, never clamped — they're an aesthetic "this looks very off-center" signal, not a
 * physical impossibility.
 *
 * The hard constraints interact (e.g. pulling the center back in for C-01 can relax how much radius
 * C-03/C-04 need, and growing the radius for C-03/C-04 can re-violate C-01), so this runs a handful
 * of fixed-point passes rather than solving a closed form — adequate for a V1 concept tool (same
 * tolerance-for-approximation as SeatMetrics.ts's sampled batch analysis), not a general constraint
 * solver.
 */
export function clampMediaPlanePlacement(candidate: MediaPlaneCandidate, cfg: VenueConfig): PlacementCheckResult {
  const shellCenter: Point3 = { x: 0, y: cfg.building.centerHeight, z: 0 };
  const shellR = cfg.building.shellRadius;
  const violations: PlacementViolation[] = [];
  // The fixed-point iteration below can re-trigger the SAME constraint on more than one pass (and
  // C-04 checks 8 stage corners individually) while converging — report each code at most once per
  // call, or the caller ends up rendering the same line 10+ times (see docs/SCREEN_DECOUPLING_DESIGN.md
  // for why a handful of passes is needed at all).
  const reportedCodes = new Set<string>();
  function report(v: PlacementViolation) {
    if (reportedCodes.has(v.code)) return;
    reportedCodes.add(v.code);
    violations.push(v);
  }

  let radius = candidate.radius;
  let centerHeight = candidate.centerHeight;
  let centerOffsetX = candidate.centerOffsetX;
  let centerOffsetZ = candidate.centerOffsetZ;

  // C-06 absolute radius bounds — applied first since the other checks below assume a sane radius.
  const minRadiusAbs = Math.max(cfg.audience.outerRadius + CLEARANCE_AUDIENCE_M, MIN_ABS_RADIUS_M);
  const maxRadiusByShell = shellR - CLEARANCE_SHELL_M;
  if (radius < minRadiusAbs) {
    report({ code: "C-06", message: `半径太小（< ${minRadiusAbs.toFixed(1)}m），已夹紧到下限`, severity: "hard" });
    radius = minRadiusAbs;
  }
  if (radius > maxRadiusByShell) {
    report({ code: "C-06", message: `半径太大（> ${maxRadiusByShell.toFixed(1)}m），已夹紧到外壳允许的上限`, severity: "hard" });
    radius = maxRadiusByShell;
  }

  for (let pass = 0; pass < 4; pass++) {
    const center: Point3 = { x: centerOffsetX, y: centerHeight, z: centerOffsetZ };

    // C-01 — inner screen must stay fully inside the outer shell, with clearance.
    const centerDistToShell = dist(center, shellCenter);
    const maxCenterDist = Math.max(0, shellR - CLEARANCE_SHELL_M - radius);
    if (centerDistToShell > maxCenterDist) {
      report({ code: "C-01", message: "内屏中心偏移过大，会穿出外壳——已夹紧回外壳内部", severity: "hard" });
      const scale = centerDistToShell > 1e-6 ? maxCenterDist / centerDistToShell : 0;
      centerOffsetX = shellCenter.x + (center.x - shellCenter.x) * scale;
      centerOffsetZ = shellCenter.z + (center.z - shellCenter.z) * scale;
      centerHeight = shellCenter.y + (center.y - shellCenter.y) * scale;
    }

    // C-03 — inner screen must fully contain the audience (worst case: offset points straight at
    // the outer seating row, shrinking that side's clearance by the full horizontal offset).
    const horizOffset = Math.sqrt(centerOffsetX ** 2 + centerOffsetZ ** 2);
    const minRadiusForAudience = cfg.audience.outerRadius + horizOffset + CLEARANCE_AUDIENCE_M;
    if (radius < minRadiusForAudience) {
      report({ code: "C-03", message: "半径 / 偏移会让观众席露出内屏之外——已把半径夹紧到能包住观众席", severity: "hard" });
      radius = minRadiusForAudience;
    }

    // C-04 — inner screen must not intersect the stage platform box.
    for (const corner of stageCorners(cfg)) {
      const needed = dist(corner, { x: centerOffsetX, y: centerHeight, z: centerOffsetZ }) + CLEARANCE_STAGE_M;
      if (needed > radius) {
        report({ code: "C-04", message: "内屏与舞台相交——已把半径夹紧到能包住舞台", severity: "hard" });
        radius = needed;
      }
    }

    // C-05 — inner screen's lowest point must not go below the floor.
    const bottomY = centerHeight - radius;
    if (bottomY < -MAX_EMBED_M) {
      report({ code: "C-05", message: "内屏最低点穿地——已把高度夹紧到贴地", severity: "hard" });
      centerHeight = radius - MAX_EMBED_M;
    }
  }

  // Re-check C-06's upper bound: satisfying C-03/C-04/C-05 above may have grown the radius past
  // what the shell allows, which means the requested audience/stage layout plus this offset simply
  // doesn't fit inside the current shell — clamp to the shell limit and say so explicitly rather
  // than silently producing a screen that still overlaps the shell.
  if (radius > maxRadiusByShell) {
    report({
      code: "C-01",
      message: "为了包住观众席/舞台所需的半径超出了外壳限制——配置本身冲突，已夹紧到外壳上限（请增大外壳半径，或减小偏移/观众席）",
      severity: "hard",
    });
    radius = maxRadiusByShell;
  }

  // C-02 / C-09 — horizontal eccentricity, soft (informational only, never clamped).
  const horizOffsetFinal = Math.sqrt(centerOffsetX ** 2 + centerOffsetZ ** 2);
  const offsetRatio = shellR > 0 ? horizOffsetFinal / shellR : 0;
  if (offsetRatio > OFFSET_TOLERANCE_RATIO) {
    report({
      code: "C-02",
      message: `水平偏心达外壳半径的 ${(offsetRatio * 100).toFixed(1)}%，超过建议上限 ${(OFFSET_TOLERANCE_RATIO * 100).toFixed(0)}%`,
      severity: "soft",
    });
  } else if (offsetRatio > OFFSET_WARNING_RATIO) {
    report({
      code: "C-09",
      message: `水平偏心达外壳半径的 ${(offsetRatio * 100).toFixed(1)}%，超过预警阈值 ${(OFFSET_WARNING_RATIO * 100).toFixed(0)}%`,
      severity: "soft",
    });
  }

  return { clamped: { radius, centerHeight, centerOffsetX, centerOffsetZ }, violations };
}
