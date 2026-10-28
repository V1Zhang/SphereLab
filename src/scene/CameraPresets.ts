import * as THREE from "three";
import { VenueConfig } from "../core/VenueConfig";
import { audienceSeatPosition } from "../core/VenueGeometry";

/**
 * Standard audience viewpoints, treated as the V1 acceptance cases the brief asks for. Covers the
 * "at least 5 representative viewpoints" recommendation in docs/HANDOFF_CHECKLIST.md D-06.
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
  ];
}
