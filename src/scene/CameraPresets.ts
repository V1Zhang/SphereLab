import * as THREE from "three";
import { VenueConfig } from "../core/VenueConfig";
import { audienceSeatPosition } from "../core/VenueGeometry";
import { yawPitchToDirection } from "../utils/SphericalMath";

/**
 * Standard audience/exterior viewpoints, treated as the V1 acceptance cases the brief asks for.
 * Covers the "at least 5 representative viewpoints" recommendation in
 * docs/HANDOFF_CHECKLIST.md D-06 (Central / Front Row / Rear Row / Left+Right Side / Rear
 * Look-Up), plus Exterior Cutaway for the structure-vs-media-plane-vs-seating overview.
 */

export interface CameraPreset {
  id: string;
  label: string;
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  /** When true, the building shell should render with its cutaway (vertical) clip plane enabled. */
  cutaway: boolean;
}

export function computeCameraPresets(cfg: VenueConfig): CameraPreset[] {
  const centerHeight = cfg.mediaPlane.centerHeight;
  const mediaRadius = cfg.mediaPlane.radius;
  const stageCenterZ = -(cfg.stage.frontOffset + cfg.stage.depth / 2);

  // Central Audience uses the literal reference eye position (D-06 / brief default), not the
  // rake-derived floor height — the brief pins this to an exact world-space point so the default
  // view is reproducible regardless of how the seating-bowl rake is tuned elsewhere.
  const centralEye = new THREE.Vector3(0, cfg.audience.eyeHeight, cfg.audience.centralReferenceRadius);
  const centralTarget = new THREE.Vector3(0, mediaRadius * 0.2, stageCenterZ);

  // Front Row: closest to the stage, low in the rake — the tightest, most "under the wrap" view.
  const frontSeat = audienceSeatPosition(0, cfg.audience.innerRadius, cfg.audience);
  const frontEye = frontSeat.clone().add(new THREE.Vector3(0, cfg.audience.eyeHeight, 0));
  const frontTarget = new THREE.Vector3(0, mediaRadius * 0.15, stageCenterZ);

  // Rear Row: back of the bowl, looking forward at the stage (distinct from Rear Look-Up, which
  // turns around to check coverage behind/above instead).
  const rearRowSeat = audienceSeatPosition(0, cfg.audience.outerRadius, cfg.audience);
  const rearRowEye = rearRowSeat.clone().add(new THREE.Vector3(0, cfg.audience.eyeHeight, 0));
  const rearRowTarget = new THREE.Vector3(0, mediaRadius * 0.25, stageCenterZ);

  // Left / Right Side: off-centerline, mid-bowl, still facing roughly toward the stage — checks
  // the mask's side (yaw ~90°) coverage from an actual seat rather than head-on.
  const sideRadius = THREE.MathUtils.lerp(cfg.audience.innerRadius, cfg.audience.outerRadius, 0.4);
  const leftSeat = audienceSeatPosition(-45, sideRadius, cfg.audience);
  const leftEye = leftSeat.clone().add(new THREE.Vector3(0, cfg.audience.eyeHeight, 0));
  const rightSeat = audienceSeatPosition(45, sideRadius, cfg.audience);
  const rightEye = rightSeat.clone().add(new THREE.Vector3(0, cfg.audience.eyeHeight, 0));
  const sideTarget = new THREE.Vector3(0, mediaRadius * 0.2, stageCenterZ);

  const rearSeat = audienceSeatPosition(0, cfg.audience.outerRadius, cfg.audience);
  const rearEye = rearSeat.clone().add(new THREE.Vector3(0, cfg.audience.eyeHeight, 0));
  // Aim well inside the rear mask region (yaw 180, pitch 55°) rather than at an arbitrary offset —
  // the old (centerHeight + 0.45R, eye.z + 0.6R) point landed almost exactly ON the rear boundary
  // (minPitchForYaw(180) ≈ 22°), so the preset showed mostly empty background instead of the
  // wrap-around screen it's supposed to demonstrate.
  const mediaCenter = new THREE.Vector3(cfg.mediaPlane.centerOffsetX, centerHeight, cfg.mediaPlane.centerOffsetZ);
  const rearTarget = yawPitchToDirection(180, 55).multiplyScalar(mediaRadius).add(mediaCenter);

  const shellR = cfg.building.shellRadius;
  const exteriorPos = new THREE.Vector3(shellR * 1.5, shellR * 1.0, shellR * 1.7);
  const exteriorTarget = mediaCenter.clone();

  return [
    {
      id: "central",
      label: "中央观众席",
      position: centralEye,
      target: centralTarget,
      fov: 90,
      cutaway: false,
    },
    {
      id: "front-row",
      label: "前排",
      position: frontEye,
      target: frontTarget,
      fov: 100,
      cutaway: false,
    },
    {
      id: "rear-row",
      label: "后排",
      position: rearRowEye,
      target: rearRowTarget,
      fov: 90,
      cutaway: false,
    },
    {
      id: "left-side",
      label: "左侧",
      position: leftEye,
      target: sideTarget,
      fov: 90,
      cutaway: false,
    },
    {
      id: "right-side",
      label: "右侧",
      position: rightEye,
      target: sideTarget,
      fov: 90,
      cutaway: false,
    },
    {
      id: "rear-look-up",
      label: "后方仰视",
      position: rearEye,
      target: rearTarget,
      fov: 100,
      cutaway: false,
    },
    {
      id: "exterior-cutaway",
      label: "外部剖面",
      position: exteriorPos,
      target: exteriorTarget,
      fov: 50,
      cutaway: true,
    },
  ];
}
