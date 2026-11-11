import * as THREE from "three";
import { VenueConfig } from "../core/VenueConfig";
import { audienceSeatWorldPosition } from "../core/VenueGeometry";

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
  near: number;
  far: number;
  /** When true, the building shell should render with its cutaway (vertical) clip plane enabled. */
  cutaway: boolean;
}

/**
 * The five default viewpoints from the 40m 3ds Max scene. 3ds Max commonly stores these values
 * in millimetres with Z-up; SphereLab uses metres with Y-up, so the conversion is applied here:
 * Max [x, y, z] -> SphereLab [x / 1000, z / 1000, y / 1000].
 */
const MAX_ADDITIONAL_CAMERAS = [
  { id: "camera001", label: "Camera001", max: [-103267, -5558.08, -2352.47], fov: 89.4242, near: 1, far: 1000 },
  { id: "camera002", label: "Camera002", max: [-103267, -15199.1, 2650.86], fov: 76.7584, near: 1, far: 1000 },
  { id: "camera003", label: "Camera003", max: [43324.7, -4624.54, -2628.63], fov: 89.4242, near: 1, far: 1000 },
  { id: "camera004", label: "Camera004", max: [43324.7, -14499.2, -2641.7], fov: 100.389, near: 1, far: 1000 },
  { id: "camera005", label: "Camera005", max: [43324.7, -1947.03, -598.847], fov: 100.389, near: 1, far: 1000 },
] as const;

function sphereLabPositionFromMax([x, y, z]: readonly [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(x / 1000, z / 1000, y / 1000);
}

export function computeCameraPresets(cfg: VenueConfig): CameraPreset[] {
  const mediaRadius = cfg.mediaPlane.radius;
  const stageCenterZ = -(cfg.stage.frontOffset + cfg.stage.depth / 2);

  // Original five viewpoints, retained as the first default group.
  const centralFloor = audienceSeatWorldPosition(0, cfg.audience.centralReferenceRadius, cfg);
  const centralEye = centralFloor.clone().add(new THREE.Vector3(0, cfg.audience.eyeHeight, 0));
  const centralTarget = new THREE.Vector3(0, mediaRadius * 0.2, stageCenterZ + cfg.audience.offsetY);
  const frontSeat = audienceSeatWorldPosition(0, cfg.audience.innerRadius, cfg);
  const frontEye = frontSeat.clone().add(new THREE.Vector3(0, cfg.audience.eyeHeight, 0));
  const frontTarget = new THREE.Vector3(0, mediaRadius * 0.15, stageCenterZ + cfg.audience.offsetY);
  const rearRowSeat = audienceSeatWorldPosition(0, cfg.audience.outerRadius, cfg);
  const rearRowEye = rearRowSeat.clone().add(new THREE.Vector3(0, cfg.audience.eyeHeight, 0));
  const rearRowTarget = new THREE.Vector3(0, mediaRadius * 0.25, stageCenterZ + cfg.audience.offsetY);
  const sideRadius = THREE.MathUtils.lerp(cfg.audience.innerRadius, cfg.audience.outerRadius, 0.4);
  const leftSeat = audienceSeatWorldPosition(-45, sideRadius, cfg);
  const leftEye = leftSeat.clone().add(new THREE.Vector3(0, cfg.audience.eyeHeight, 0));
  const rightSeat = audienceSeatWorldPosition(45, sideRadius, cfg);
  const rightEye = rightSeat.clone().add(new THREE.Vector3(0, cfg.audience.eyeHeight, 0));
  const sideTarget = new THREE.Vector3(0, mediaRadius * 0.2, stageCenterZ + cfg.audience.offsetY);
  const defaultClip = { near: 0.1, far: 500 };
  const original = [
    { id: "central", label: "中央观众席", position: centralEye, target: centralTarget, fov: 90 },
    { id: "front-row", label: "前排", position: frontEye, target: frontTarget, fov: 100 },
    { id: "rear-row", label: "后排", position: rearRowEye, target: rearRowTarget, fov: 90 },
    { id: "left-side", label: "左侧", position: leftEye, target: sideTarget, fov: 90 },
    { id: "right-side", label: "右侧", position: rightEye, target: sideTarget, fov: 90 },
  ].map((preset) => ({ ...preset, ...defaultClip, cutaway: false }));

  const additional = MAX_ADDITIONAL_CAMERAS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    position: sphereLabPositionFromMax(preset.max),
    target: new THREE.Vector3(0, mediaRadius * 0.2, stageCenterZ + cfg.audience.offsetY),
    fov: preset.fov,
    near: preset.near,
    far: preset.far,
    cutaway: false,
  }));

  return [...original, ...additional];

}
