import * as THREE from "three";
import { VenueConfig } from "../core/VenueConfig";
import { audienceSeatPosition } from "../core/VenueGeometry";
import { sampleBoundaryCurve } from "../core/ScreenMask";
import { yawPitchToDirection } from "../utils/SphericalMath";

/**
 * Pure visualization layer answering the questions the brief calls out explicitly:
 * "why is there a screen here / not there", "sphere center", "yaw/pitch of this point". Every
 * element here is toggle-able and non-interactive (no raycasting) — the pointer inspector in
 * main.ts handles the "what ERP pixel is under my cursor" question directly on the media plane.
 */

export interface DiagnosticsLayers {
  group: THREE.Group;
  referenceSphere: THREE.Object3D;
  boundaryLine: THREE.Object3D;
  yawPitchGrid: THREE.Object3D;
  sphereCenterMarker: THREE.Object3D;
  axesHelper: THREE.Object3D;
  innerAxesHelper: THREE.Object3D;
  stageDirectionArrow: THREE.Object3D;
  audienceMarkers: THREE.Object3D;
  dispose: () => void;
}

function makeTextSprite(text: string, color = "#e6e9ef"): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const scale = 4;
  canvas.width = 256 * scale;
  canvas.height = 64 * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.font = "600 22px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(10,12,16,0.55)";
  ctx.fillRect(0, 8, 256, 48);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(4, 1, 1);
  sprite.renderOrder = 999;
  return sprite;
}

function buildReferenceSphere(radius: number, center: THREE.Vector3): THREE.Object3D {
  const geo = new THREE.SphereGeometry(radius, 48, 32);
  const mat = new THREE.MeshBasicMaterial({ color: 0x8899aa, wireframe: true, transparent: true, opacity: 0.12 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(center);
  return mesh;
}

function buildBoundaryLine(cfg: VenueConfig, center: THREE.Vector3): THREE.Object3D {
  const r = cfg.mediaPlane.radius * 1.004;
  const pts = sampleBoundaryCurve(cfg.mediaPlane.maskControlPoints, 240).map(([yaw, pitch]) => {
    const d = yawPitchToDirection(yaw, pitch).multiplyScalar(r);
    return d.add(center);
  });
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color: 0xffb454, linewidth: 2 });
  return new THREE.Line(geo, mat);
}

function buildYawPitchGrid(radius: number, center: THREE.Vector3): THREE.Object3D {
  const r = radius * 1.001;
  const points: THREE.Vector3[] = [];

  // Meridians every 30 deg.
  for (let yaw = -180; yaw < 180; yaw += 30) {
    for (let p = -85; p < 90; p += 5) {
      const a = yawPitchToDirection(yaw, p).multiplyScalar(r).add(center);
      const b = yawPitchToDirection(yaw, p + 5).multiplyScalar(r).add(center);
      points.push(a, b);
    }
  }
  // Parallels every 15 deg.
  for (let pitch = -75; pitch <= 90; pitch += 15) {
    for (let y = -180; y < 180; y += 5) {
      const a = yawPitchToDirection(y, pitch).multiplyScalar(r).add(center);
      const b = yawPitchToDirection(y + 5, pitch).multiplyScalar(r).add(center);
      points.push(a, b);
    }
  }

  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({ color: 0x6f8aa8, transparent: true, opacity: 0.35 });
  return new THREE.LineSegments(geo, mat);
}

function buildSphereCenterMarker(center: THREE.Vector3): THREE.Object3D {
  const group = new THREE.Group();
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  group.add(marker);
  const label = makeTextSprite("球心");
  label.position.set(0, 1.2, 0);
  group.add(label);
  group.position.copy(center);
  return group;
}

function buildAxesHelper(
  cfg: VenueConfig,
  center: THREE.Vector3,
  tiltDeg: number,
  axisLabels: [string, string, string],
  lengthScale = 1,
): THREE.Object3D {
  // The dome's logical X/Y/Z axes map to Three.js object-space X/Z/Y respectively.
  const domeRadius = 1000 / Math.max(0.001, cfg.mediaPlane.curvature);
  const length = Math.max(cfg.mediaPlane.radius, domeRadius) * 1.15 * lengthScale;
  const axes = new THREE.Group();
  axes.position.copy(center);
  axes.rotation.x = THREE.MathUtils.degToRad(tiltDeg);
  axes.name = axisLabels[0] === "X" ? "worldAxesXYZ" : "mediaPlaneAxesXYZ";
  const labelOffset = length * 1.06;
  const axisDefs: Array<{ dir: THREE.Vector3; color: number; labelColor: string; text: string }> = [
    { dir: new THREE.Vector3(1, 0, 0), color: 0xff4d4d, labelColor: "#ff4d4d", text: axisLabels[0] },
    { dir: new THREE.Vector3(0, 0, 1), color: 0x4da6ff, labelColor: "#4da6ff", text: axisLabels[1] },
    { dir: new THREE.Vector3(0, 1, 0), color: 0x50e36c, labelColor: "#50e36c", text: axisLabels[2] },
  ];
  for (const axis of axisDefs) {
    const end = axis.dir.clone().multiplyScalar(length);
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), end]);
    axes.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: axis.color })));
    const label = makeTextSprite(axis.text, axis.labelColor);
    label.position.copy(axis.dir).multiplyScalar(labelOffset);
    axes.add(label);
  }
  return axes;
}

/**
 * Content reference origin marker — distinct from `sphereCenterMarker` (the dome's geometric
 * center) and from `buildEyePositionMarker()` (the current viewer eye). Kept OUTSIDE
 * `DiagnosticsLayers`/`buildDiagnosticsLayers()` on purpose: that bundle only rebuilds when the
 * venue geometry changes (an expensive re-triangulation), while this marker's position changes on
 * every "内容原点 X/Y/Z" GUI slider tweak — main.ts owns it directly and repositions it in place.
 * A distinct color/label keeps a user from reading it as "the sphere center" when a loaded
 * manifest sets `originOffset` away from (0,0,0) — see src/content/ERPManifest.ts.
 */
export function buildContentOriginMarker(): THREE.Object3D {
  const group = new THREE.Group();
  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.4, 0),
    new THREE.MeshBasicMaterial({ color: 0xffcc33 })
  );
  group.add(marker);
  const label = makeTextSprite("内容原点", "#ffcc33");
  label.position.set(0, -1.2, 0);
  group.add(label);
  return group;
}

/**
 * Current viewer eye marker — the third of the three things the brief says must never be
 * conflated: sphere center (`sphereCenterMarker`, white), content reference origin
 * (`buildContentOriginMarker`, yellow octahedron), and this one (cyan cone), the eye position of
 * whichever camera preset or clicked seat is currently active (see main.ts `applyPreset` /
 * `selectSeat`). Kept OUTSIDE the venue-geometry rebuild cycle for the same reason as the content
 * origin marker — its position tracks camera state, not VenueConfig. A cone (rather than a sphere)
 * gives it a distinct silhouette from the other two markers even at a glance.
 */
export function buildEyePositionMarker(): THREE.Object3D {
  const group = new THREE.Group();
  const marker = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 0.6, 12),
    new THREE.MeshBasicMaterial({ color: 0x5ab4ff })
  );
  group.add(marker);
  const label = makeTextSprite("当前眼位", "#5ab4ff");
  label.position.set(0, 1.1, 0);
  group.add(label);
  return group;
}

/**
 * Visualizes the project brief's eq. (7) for whatever point the pointer is currently hovering on
 * the media plane: p = Intersect(e, r, S) — the cyan sightline from eye `e` to that hit point `p`
 * (red instead of cyan when a venue occluder sits between them, see main.ts `checkOcclusion`) —
 * and d = (p − o) / ‖p − o‖ — the yellow line from the content reference origin `o` to the SAME
 * point `p`, i.e. the actual sampling direction used to pick a texel. Both lines share the one
 * endpoint `p` (marked with a small white dot) so the diagram reads as "two different directions
 * converging on the same screen point" rather than two unrelated segments. Geometry is mutated
 * in place on every `update()` call (a plain two-point line) rather than rebuilt, since this can
 * fire on every `pointermove` while the layer is enabled.
 */
export interface RayDiagram {
  group: THREE.Group;
  update(eye: THREE.Vector3, hitPoint: THREE.Vector3, origin: THREE.Vector3, occluded: boolean): void;
  dispose: () => void;
}

export function buildRayDiagram(): RayDiagram {
  const sightlineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const sightlineMat = new THREE.LineBasicMaterial({ color: 0x4fd1c5 });
  const sightline = new THREE.Line(sightlineGeo, sightlineMat);

  const sampleGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const sampleMat = new THREE.LineBasicMaterial({ color: 0xffcc33, transparent: true, opacity: 0.85 });
  const sampleLine = new THREE.Line(sampleGeo, sampleMat);

  const hitMarker = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));

  const group = new THREE.Group();
  group.add(sightline, sampleLine, hitMarker);

  function update(eye: THREE.Vector3, hitPoint: THREE.Vector3, origin: THREE.Vector3, occluded: boolean) {
    sightlineGeo.setFromPoints([eye, hitPoint]);
    sampleGeo.setFromPoints([origin, hitPoint]);
    hitMarker.position.copy(hitPoint);
    sightlineMat.color.set(occluded ? 0xff5f5f : 0x4fd1c5);
  }

  const dispose = () => {
    sightlineGeo.dispose();
    sightlineMat.dispose();
    sampleGeo.dispose();
    sampleMat.dispose();
    hitMarker.geometry.dispose();
    (hitMarker.material as THREE.Material).dispose();
  };

  return { group, update, dispose };
}

function buildStageDirectionArrow(cfg: VenueConfig, center: THREE.Vector3): THREE.Object3D {
  const dir = new THREE.Vector3(0, 0, -1);
  const length = cfg.mediaPlane.radius * 0.55;
  const arrow = new THREE.ArrowHelper(dir, center, length, 0x4fd1c5, length * 0.12, length * 0.06);
  return arrow;
}

function buildAudienceMarkers(cfg: VenueConfig): THREE.Object3D {
  const group = new THREE.Group();
  const midRadius = (cfg.audience.innerRadius + cfg.audience.outerRadius) / 2;

  // These labels sit on the same representative positions used by CameraPresets.ts, so the
  // visual annotation and the camera buttons always refer to the same four locations.
  const representativePositions = [
    { label: "前排代表位置", azDeg: 0, radius: cfg.audience.innerRadius, color: "#4fd1c5" },
    { label: "后排代表位置", azDeg: 0, radius: cfg.audience.outerRadius, color: "#ffb454" },
    { label: "左侧代表位置", azDeg: -45, radius: midRadius, color: "#8ab4ff" },
    { label: "右侧代表位置", azDeg: 45, radius: midRadius, color: "#c58aff" },
  ];
  for (const marker of representativePositions) {
    const position = audienceSeatPosition(marker.azDeg, marker.radius, cfg.audience);
    const point = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 16, 12),
      new THREE.MeshBasicMaterial({ color: marker.color }),
    );
    point.position.copy(position).add(new THREE.Vector3(0, 0.55, 0));
    group.add(point);

    const label = makeTextSprite(marker.label, marker.color);
    label.position.copy(position).add(new THREE.Vector3(0, 2.3, 0));
    group.add(label);
  }

  const stage = makeTextSprite("舞台", "#ff6b6b");
  stage.position.set(0, cfg.stage.height + 3, -(cfg.stage.frontOffset + cfg.stage.depth / 2));
  group.add(stage);

  return group;
}

export function buildDiagnosticsLayers(cfg: VenueConfig): DiagnosticsLayers {
  const center = new THREE.Vector3(cfg.mediaPlane.centerOffsetX, cfg.mediaPlane.centerHeight, cfg.mediaPlane.centerOffsetZ);

  const referenceSphere = buildReferenceSphere(cfg.mediaPlane.radius, center);
  const boundaryLine = buildBoundaryLine(cfg, center);
  const yawPitchGrid = buildYawPitchGrid(cfg.mediaPlane.radius, center);
  const sphereCenterMarker = buildSphereCenterMarker(center);
  const axesHelper = buildAxesHelper(cfg, new THREE.Vector3(), 0, ["X", "Y", "Z"]);
  const innerAxesHelper = buildAxesHelper(cfg, center, cfg.mediaPlane.tiltDeg, ["X'", "Y'", "Z'"], 0.8);
  const stageDirectionArrow = buildStageDirectionArrow(cfg, center);
  const audienceMarkers = buildAudienceMarkers(cfg);

  const group = new THREE.Group();
  group.name = "diagnostics";
  group.add(referenceSphere, boundaryLine, yawPitchGrid, sphereCenterMarker, axesHelper, innerAxesHelper, stageDirectionArrow, audienceMarkers);

  const dispose = () => {
    group.traverse((obj) => {
      const anyObj = obj as any;
      if (anyObj.geometry) anyObj.geometry.dispose();
      if (anyObj.material) {
        if (anyObj.material.map) anyObj.material.map.dispose();
        anyObj.material.dispose();
      }
    });
  };

  return { group, referenceSphere, boundaryLine, yawPitchGrid, sphereCenterMarker, axesHelper, innerAxesHelper, stageDirectionArrow, audienceMarkers, dispose };
}
