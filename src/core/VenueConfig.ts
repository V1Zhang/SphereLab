/**
 * VenueConfig is the P0 "frozen parameter" schema described in the handoff checklist
 * (docs/HANDOFF_CHECKLIST.md): the minimum a venue/screen design partner and an LED vendor
 * need to agree on before this tool can previsualize anything. Everything in here is a
 * *concept-stage approximation* (V1). Real venue meshes, seat lists and screen masks arrive
 * in V2 and should replace these fields without changing how the rest of the app consumes them.
 */

export interface MaskControlPoint {
  /** Absolute yaw in degrees, 0 = stage front, 180 = rear. Must be ascending, first entry 0, last entry 180. */
  yawDeg: number;
  /** Lower pitch boundary of the media plane at this yaw, in degrees. Screen exists where pitch >= this value. */
  minPitchDeg: number;
}

export interface MediaPlaneConfig {
  /** Circular center cross-section radius in the local X'/Y' plane, in meters. */
  radius: number;
  /** Dome curvature, displayed as 1/km. It independently determines the local Z' dome radius. */
  curvature: number;
  /** Height of the media-plane sphere's center above the ground (y = 0), in meters. */
  centerHeight: number;
  /** Horizontal offset of the media-plane sphere's center from the world X/Z origin, in meters.
   *  Together with `centerHeight` this lets the inner screen sit off-center from the outer shell /
   *  audience (both of which stay parametric-only, never dragged) — see
   *  docs/SCREEN_DECOUPLING_DESIGN.md. Zero reproduces the old always-concentric behavior. */
  centerOffsetX: number;
  centerOffsetZ: number;
  /** Rigid-body tilt of the media-plane sphere around the local X axis (the left/right horizontal
   *  axis), in degrees — positive raises the front (stage-facing, -Z) edge's elevation, matching the
   *  "standard elevation angle" convention (see docs/SCREEN_DECOUPLING_DESIGN.md). Zero means
   *  upright, same as all prior behavior. Unlike centerOffsetX/Z/centerHeight (pure translation),
   *  this is a genuinely new degree of freedom — the media-plane mesh was previously translation-only
   *  (see SceneBuilder.ts / materials/ERPMaskMaterial.ts, both updated alongside this field). Screen
   *  Mask shape and content mapping both rotate rigidly with it for free (both are computed in the
   *  mesh's own object space already); diagnostics overlays (reference sphere / grid / boundary line)
   *  and SeatMetrics.ts's coverage sampling do NOT yet account for it — a known V1 gap, not modeled
   *  as "always upright" like everything else pre-decoupling. */
  tiltDeg: number;
  /** Screen-mask control points, symmetric left/right by construction (see ScreenMask.ts). */
  maskControlPoints: MaskControlPoint[];
  /** Soft-edge width, in degrees of pitch, for the mask's smooth (non hard-cut) boundary. */
  maskFeatherDeg: number;
  /** Tessellation of the underlying ERP sphere geometry. */
  yawSegments: number;
  pitchSegments: number;
}

export interface StageConfig {
  width: number;
  depth: number;
  height: number;
  /** Distance of the stage's front edge from world origin, along -Z. */
  frontOffset: number;
}

export interface AudienceConfig {
  innerRadius: number;
  outerRadius: number;
  rows: number;
  /** Representative average eye height above the local (raked) floor, in meters. */
  eyeHeight: number;
  /** Rake: how much the floor rises from inner to outer radius, in meters. */
  riseHeight: number;
  /** Distance from world origin (along the centerline, +Z) of the "Central Audience" reference
   *  seat used by CameraPresets.ts — a literal reference point (see D-06), not derived from
   *  innerRadius/outerRadius, so it stays stable even as the seating-bowl extents are tuned. */
  centralReferenceRadius: number;
}

export interface BuildingConfig {
  shellRadius: number;
  shellHeight: number;
  /** Height of the shell sphere's own center above the ground, in meters — independent of
   *  `MediaPlaneConfig.centerHeight` (previously the shell borrowed that field directly, which
   *  would have dragged the "fixed, parametric-only" outer shell along with the now-draggable inner
   *  screen — see docs/SCREEN_DECOUPLING_DESIGN.md §3/C-08). Only ever set via the GUI slider. */
  centerHeight: number;
}

export interface ERPConfig {
  /** Frozen convention for V1 placeholder content: ERP is a 2:1 proxy content format for previs. */
  aspect: 2;
  placeholderWidth: number;
}

export interface VenueConfig {
  mediaPlane: MediaPlaneConfig;
  stage: StageConfig;
  audience: AudienceConfig;
  building: BuildingConfig;
  erp: ERPConfig;
}

/**
 * Default demo venue. This is a concept-stage parameter set, not official venue engineering data.
 * Swap via VenueConfig import once real screen-boundary and stage/audience data are available (V2).
 */
export function createDefaultVenueConfig(): VenueConfig {
  return {
    mediaPlane: {
      radius: 52,
      curvature: 19.2,
      centerHeight: 0,
      centerOffsetX: 0,
      centerOffsetZ: 0,
      tiltDeg: 0,
      maskControlPoints: [
        { yawDeg: 0, minPitchDeg: -25 },
        { yawDeg: 90, minPitchDeg: 5 },
        { yawDeg: 180, minPitchDeg: 22 },
      ],
      maskFeatherDeg: 2.5,
      yawSegments: 192,
      pitchSegments: 96,
    },
    stage: {
      width: 32,
      depth: 12,
      height: 1.2,
      frontOffset: 12,
    },
    audience: {
      innerRadius: 5,
      outerRadius: 28,
      rows: 16,
      eyeHeight: 1.2,
      riseHeight: 9,
      centralReferenceRadius: 7,
    },
    building: {
      // Same as mediaPlane.radius by default — the two spheres start exactly coincident.
      // Direct inner-screen radius/curvature edits remain free-form; placement is reconciled only
      // when fixed reference geometry (shell/audience/stage) changes.
      shellRadius: 52,
      shellHeight: 55,
      centerHeight: 0,
    },
    erp: {
      aspect: 2,
      placeholderWidth: 4096,
    },
  };
}
