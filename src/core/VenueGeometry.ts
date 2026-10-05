import * as THREE from "three";
import { VenueConfig } from "./VenueConfig";

/**
 * Non-display venue geometry: stage, audience seating bowl and an outer building shell.
 * These exist only as spatial/visual reference for the previs — they are what the media plane's
 * screen mask is deliberately excluding (see ScreenMask.ts). None of this feeds the ERP mapping.
 *
 * Audience layout: a fan-shaped raked bowl facing the stage (not a full 360° ring) — matching
 * real in-the-round dome venues where seating fills a bowl in front of the stage while the LED
 * media plane wraps overhead and behind the last row. `audienceFanHalfAngleDeg` controls the fan
 * width; a seat's azimuth of 0 sits on the centerline directly facing the stage.
 */

export const AUDIENCE_FAN_HALF_ANGLE_DEG = 62;
/** Half-width, in degrees of azimuth, of the center aisle left open down the middle of the bowl. */
const CENTER_AISLE_HALF_ANGLE_DEG = 3;

/** One representative seat instance's (azimuth, radius) — enough to recompute its exact world
 *  position via `audienceSeatPosition()` (which also derives the rake-height y). Indexed the same
 *  as the InstancedMesh's instances, so `intersection.instanceId` from a raycast against
 *  `seatInstancedMesh` looks straight into this array — see SeatMetrics.ts / main.ts "click a
 *  seat to preview its view". */
export interface SeatMeta {
  azDeg: number;
  radius: number;
  row: number;
}

export interface VenueGroup {
  group: THREE.Group;
  stageTopY: number;
  /** The representative seat blocks (see buildAudience) exposed separately so main.ts can raycast
   *  against exactly this mesh (not the whole venue group) to pick a seat to preview. */
  seatInstancedMesh: THREE.InstancedMesh;
  seatMeta: SeatMeta[];
  /** Solid meshes a sightline could plausibly be blocked by: the stage platform, the seat blocks,
   *  and the rear control-room box (see project brief "坐席碗、舞台和吊挂体可以先使用简化遮挡网
   *  格"). Used by main.ts's ray-diagram occlusion check (eq. 7's "检查场馆遮挡物是否在 e 与 p 之
   *  间"). Deliberately excludes the ground disc and building shell — a sightline to the dome
   *  isn't expected to pass through either — and there is no rigging/hanging-object geometry to
   *  include yet (see docs/HANDOFF_CHECKLIST.md D-09, unmodeled in V1). */
  occluderMeshes: THREE.Object3D[];
  dispose: () => void;
}

function floorHeight(radius: number, cfg: VenueConfig["audience"]): number {
  const t = THREE.MathUtils.clamp((radius - cfg.innerRadius) / (cfg.outerRadius - cfg.innerRadius), 0, 1);
  return t * cfg.riseHeight;
}

/** World position of a seat given its azimuth (deg, 0 = centerline facing stage) and radius (m). */
export function audienceSeatPosition(azimuthDeg: number, radius: number, cfg: VenueConfig["audience"]): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(azimuthDeg);
  return new THREE.Vector3(radius * Math.sin(a), floorHeight(radius, cfg), radius * Math.cos(a));
}

function buildStage(cfg: VenueConfig): { object: THREE.Object3D; platform: THREE.Mesh } {
  const group = new THREE.Group();
  const centerZ = -(cfg.stage.frontOffset + cfg.stage.depth / 2);

  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.stage.width, cfg.stage.height, cfg.stage.depth),
    new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.85, metalness: 0.05 })
  );
  platform.position.set(0, cfg.stage.height / 2, centerZ);
  group.add(platform);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(platform.geometry),
    new THREE.LineBasicMaterial({ color: 0x4fd1c5, transparent: true, opacity: 0.35 })
  );
  edge.position.copy(platform.position);
  group.add(edge);

  return { object: group, platform };
}

function buildAudience(
  cfg: VenueConfig
): { object: THREE.Object3D; floorTopAtOuter: number; seatInstancedMesh: THREE.InstancedMesh; seatMeta: SeatMeta[] } {
  const group = new THREE.Group();
  const { rows } = cfg.audience;
  const azSteps = 48;
  const halfAngle = AUDIENCE_FAN_HALF_ANGLE_DEG;

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const rowColorA = new THREE.Color(0x1a1d24);
  const rowColorB = new THREE.Color(0x22262f);
  const aisleColor = new THREE.Color(0x0c0e12);

  for (let r = 0; r <= rows; r++) {
    const radius = THREE.MathUtils.lerp(cfg.audience.innerRadius, cfg.audience.outerRadius, r / rows);
    const y = floorHeight(radius, cfg.audience);
    const rowColor = r % 2 === 0 ? rowColorA : rowColorB;
    for (let a = 0; a <= azSteps; a++) {
      const az = THREE.MathUtils.lerp(-halfAngle, halfAngle, a / azSteps);
      const rad = THREE.MathUtils.degToRad(az);
      positions.push(radius * Math.sin(rad), y, radius * Math.cos(rad));
      const color = Math.abs(az) <= CENTER_AISLE_HALF_ANGLE_DEG ? aisleColor : rowColor;
      colors.push(color.r, color.g, color.b);
    }
  }
  const rowSize = azSteps + 1;
  for (let r = 0; r < rows; r++) {
    for (let a = 0; a < azSteps; a++) {
      const i0 = r * rowSize + a;
      const i1 = i0 + 1;
      const i2 = i0 + rowSize;
      const i3 = i2 + 1;
      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }
  const floorGeo = new THREE.BufferGeometry();
  floorGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  floorGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  floorGeo.setIndex(indices);
  floorGeo.computeVertexNormals();
  const floorMesh = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  group.add(floorMesh);

  // Representative seat blocks — a sampled subset, not a real seat map (that's a V2 import).
  const seatGeo = new THREE.BoxGeometry(0.5, 0.5, 0.45);
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x394152, roughness: 0.8 });
  const seatAzStep = 4; // every Nth azimuth sample
  const seatCount = (rows + 1) * Math.floor(azSteps / seatAzStep + 1);
  const instanced = new THREE.InstancedMesh(seatGeo, seatMat, seatCount);
  const seatMeta: SeatMeta[] = [];
  const m = new THREE.Matrix4();
  let idx = 0;
  for (let r = 0; r <= rows; r++) {
    const radius = THREE.MathUtils.lerp(cfg.audience.innerRadius, cfg.audience.outerRadius, r / rows);
    const y = floorHeight(radius, cfg.audience);
    for (let a = 0; a <= azSteps; a += seatAzStep) {
      const az = THREE.MathUtils.lerp(-halfAngle, halfAngle, a / azSteps);
      if (Math.abs(az) <= CENTER_AISLE_HALF_ANGLE_DEG) continue; // leave the center aisle clear
      const pos = audienceSeatPosition(az, radius, cfg.audience);
      m.makeTranslation(pos.x, y + 0.25, pos.z);
      instanced.setMatrixAt(idx, m);
      seatMeta[idx] = { azDeg: az, radius, row: r };
      idx++;
    }
  }
  instanced.count = idx;
  instanced.instanceMatrix.needsUpdate = true;
  group.add(instanced);

  return {
    object: group,
    floorTopAtOuter: floorHeight(cfg.audience.outerRadius, cfg.audience),
    seatInstancedMesh: instanced,
    seatMeta,
  };
}

/** Simplified rear control-room / entrance block — occupies the non-display space directly
 *  behind the last row, where the media plane's mask leaves the lower rear area open. */
function buildRearControlArea(cfg: VenueConfig): { object: THREE.Object3D; box: THREE.Mesh } {
  const width = 12;
  const depth = 6;
  const height = 3.2;
  const z = cfg.audience.outerRadius + depth / 2 + 1;
  const y = floorHeight(cfg.audience.outerRadius, cfg.audience);

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.9 })
  );
  box.position.set(0, y + height / 2, z);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(box.geometry),
    new THREE.LineBasicMaterial({ color: 0x4fd1c5, transparent: true, opacity: 0.2 })
  );
  edge.position.copy(box.position);

  const group = new THREE.Group();
  group.add(box, edge);
  return { object: group, box };
}

/** Flat, evenly transparent fill — no wireframe grid, no rim/Fresnel glow gradient. A plain
 *  constant-opacity color so the sphere reads as "a simple see-through ball," and the only thing
 *  telling two such spheres apart is their `color`, per explicit request (see `buildShell` below,
 *  which is currently the only caller, but any other reference-sphere outline should reuse this
 *  rather than inventing another one-off treatment). */
function buildFlatTransparentMaterial(color: THREE.ColorRepresentation, opacity: number, clippingPlanes: THREE.Plane[]): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    // side defaults to FrontSide, which WebGL backface-culls — a sphere's triangles face outward,
    // so EVERY triangle you'd see from inside it (the normal audience viewpoint, since the shell is
    // bigger than the room) is back-facing and would be silently culled, i.e. this mesh would draw
    // nothing at all from inside without this. DoubleSide is the same fix ERPMaskMaterial already
    // uses for the media plane, and the same reason: "viewed from inside the concave sphere, but
    // Exterior Cutaway looks at it from outside" — see that file's comment.
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    clippingPlanes,
  });
}

function buildShell(cfg: VenueConfig): THREE.Object3D {
  // Own center, independent of mediaPlane.centerHeight — see VenueConfig.ts BuildingConfig
  // `centerHeight` comment and docs/SCREEN_DECOUPLING_DESIGN.md C-08.
  const center = new THREE.Vector3(0, cfg.building.centerHeight, 0);

  const geo = new THREE.SphereGeometry(cfg.building.shellRadius, 48, 32);
  // From the default in-dome audience viewpoints the media plane's own (much closer, effectively
  // opaque) surface would normally hide any outer-shell indicator entirely — you'd only ever see
  // the inner dome and have no visual reference for how close the draggable inner screen is to the
  // outer boundary (see docs/SCREEN_DECOUPLING_DESIGN.md — this is exactly what the placement
  // constraints are checking, so it should be visible while dragging, not just from Exterior
  // Cutaway). depthTest:false + a renderOrder above the media plane's (0) but below the placement
  // handles' (998) makes it show through from any camera position, same always-on-top trick as the
  // handles in main.ts, without ever blocking the handles. Color is the ONLY thing distinguishing
  // this from the inner media plane — no glow, no grid, just a flat tinted transparency.
  const mat = buildFlatTransparentMaterial(0x9aa5b8, 0.22, []);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(center);
  mesh.renderOrder = 500;
  mesh.userData.isBuildingShell = true;
  return mesh;
}

export function buildVenueGroup(cfg: VenueConfig): VenueGroup {
  const group = new THREE.Group();
  group.name = "venue";

  const { object: stage, platform } = buildStage(cfg);
  const { object: audience, seatInstancedMesh, seatMeta } = buildAudience(cfg);
  const { object: rearControl, box: rearControlBox } = buildRearControlArea(cfg);
  const shell = buildShell(cfg);

  group.add(stage, audience, rearControl, shell);

  const dispose = () => {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh | THREE.InstancedMesh;
      if ((mesh as THREE.Mesh).geometry) (mesh as THREE.Mesh).geometry.dispose();
      const mat = (mesh as THREE.Mesh).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    });
  };

  return {
    group,
    stageTopY: cfg.stage.height,
    seatInstancedMesh,
    seatMeta,
    occluderMeshes: [platform, seatInstancedMesh, rearControlBox],
    dispose,
  };
}
