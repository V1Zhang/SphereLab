import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { createDefaultVenueConfig } from "./core/VenueConfig";
import { buildERPSphereGeometry, mediaPlaneDomeRadius, mediaPlaneShapeLabel } from "./core/MediaPlaneGeometry";
import { buildVenueGroup, audienceSeatPosition } from "./core/VenueGeometry";
import { buildDiagnosticsLayers, buildContentOriginMarker, buildEyePositionMarker, buildRayDiagram } from "./diagnostics/DiagnosticsOverlay";
import { buildScene, SceneBundle } from "./scene/SceneBuilder";
import { computeCameraPresets, CameraPreset } from "./scene/CameraPresets";
import { createGUIPanel, GUIParams, DiagnosticsLayerKey } from "./diagnostics/GUIPanel";
import { createPlaceholderERPTexture } from "./content/PlaceholderERP";
import { DEFAULT_ERP_MANIFEST, ERPManifest, ERPProjection, parseManifest, manifestColorSpaceToThree } from "./content/ERPManifest";
import { wrapYawDeg, zUpDirectionToYawPitch, yawPitchToZUpDirection } from "./utils/SphericalMath";
import { estimateMediaPlaneAreaM2, mediaPlaneCoverageFraction } from "./core/ScreenMask";
import { intersectDomeRay, computeSeatCoverage, directionOffsetDeg, runBatchSeatAnalysis, seatAnalysisToCSV, BatchSeatAnalysis } from "./core/SeatMetrics";

// ---------------------------------------------------------------------------
// Bootstrap: renderer / camera / controls
// ---------------------------------------------------------------------------

const appEl = document.getElementById("app")!;
const statsBar = document.getElementById("stats-bar")!;
// Shared feedback line for both media-file loads (unrecognized type, EXR decode failure) and
// manifest.json loads (parse/validation errors) — the two independent 素材 inputs, see
// "素材清单（manifest.json）" below.
const contentStatusEl = document.getElementById("content-status")!;
const modeStatusEl = document.getElementById("mode-status")!;
// Filled in by selectSeat() (see "点击座位查看视角" below) — stays empty/hidden until a seat has
// been clicked at least once.
const seatInfoEl = document.getElementById("seat-info")!;
// Filled in by runFullVenueAnalysis() (see "分析 / 导出" below) — stays empty/hidden until the
// user runs the batch analysis at least once.
const analysisInfoEl = document.getElementById("analysis-info")!;

// Left-stack collapse toggle: starts collapsed (index.html ships #top-left-stack with the
// "collapsed" class already on it) so the description and live stats don't cover the viewport on
// load. Pure CSS-class toggle; the panels' own content is unaffected.
const topLeftStack = document.getElementById("top-left-stack")!;
const infoToggleBtn = document.getElementById("info-toggle") as HTMLButtonElement;
const statusStack = document.getElementById("status-stack")!;
const statusToggleBtn = document.getElementById("status-toggle") as HTMLButtonElement;
infoToggleBtn.addEventListener("click", () => {
  const collapsed = topLeftStack.classList.toggle("collapsed");
  infoToggleBtn.textContent = collapsed ? "展开 ▾" : "收起 ▴";
  infoToggleBtn.setAttribute("aria-expanded", String(!collapsed));
});
statusToggleBtn.addEventListener("click", () => {
  const collapsed = statusStack.classList.toggle("collapsed");
  statusToggleBtn.textContent = collapsed ? "展开 ▾" : "收起 ▴";
  statusToggleBtn.setAttribute("aria-expanded", String(!collapsed));
});
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
  // Needed so "导出当前视角截图" (exportScreenshotPNG, below) can reliably read back the canvas
  // from a GUI button click — without this, the drawing buffer can already be cleared/swapped by
  // the time the click handler runs, between animate()'s rAF-driven render() calls.
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;
appEl.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.5;
controls.maxDistance = 200;

// ---------------------------------------------------------------------------
// Venue config + scene
// ---------------------------------------------------------------------------

const cfg = createDefaultVenueConfig();
const placeholderTexture = createPlaceholderERPTexture(2048);

let bundle: SceneBundle = buildScene(cfg, placeholderTexture);
let presets: CameraPreset[] = computeCameraPresets(cfg);
let activeSeatLabel: string | null = null;

// Content reference origin marker — kept outside bundle.diagnostics (which only rebuilds on venue
// geometry changes) since its position instead tracks the loaded manifest's `originOffset`, see
// DiagnosticsOverlay.ts `buildContentOriginMarker`.
const contentOriginMarker = buildContentOriginMarker();
bundle.scene.add(contentOriginMarker);

// Current eye position marker — same rebuild-independent treatment, but tracks camera state
// (applyPreset / selectSeat) instead of VenueConfig. See DiagnosticsOverlay.ts `buildEyePositionMarker`.
const eyePositionMarker = buildEyePositionMarker();
bundle.scene.add(eyePositionMarker);
function updateEyePositionMarkerPosition(pos: THREE.Vector3) {
  eyePositionMarker.position.copy(pos);
}

// Ray diagram (eq. 7 in the project brief) — live-updated from the Pointer Inspector's hover
// raycast, see the pointermove handler further down.
const rayDiagram = buildRayDiagram();
bundle.scene.add(rayDiagram.group);

const params: GUIParams = {
  radius: cfg.mediaPlane.radius,
  curvature: cfg.mediaPlane.curvature,
  centerHeight: cfg.mediaPlane.centerHeight,
  // 内屏（Media Plane）水平偏移。X 被锁定在座位中轴线，Z 仍可通过 GUI 和拖拽调整。
  centerOffsetX: cfg.mediaPlane.centerOffsetX,
  centerOffsetZ: cfg.mediaPlane.centerOffsetZ,
  // 内屏俯仰角（仰角）——绕局部 X 轴的刚体旋转，正值抬高正前方（面向舞台一侧）的仰角。见
  // core/VenueConfig.ts MediaPlaneConfig.tiltDeg 与 docs/SCREEN_DECOUPLING_DESIGN.md。
  tiltDeg: cfg.mediaPlane.tiltDeg,
  buildingCenterHeight: cfg.building.centerHeight,
  featherDeg: cfg.mediaPlane.maskFeatherDeg,
  maskFront: cfg.mediaPlane.maskControlPoints[0].minPitchDeg,
  maskSide: cfg.mediaPlane.maskControlPoints[1].minPitchDeg,
  maskRear: cfg.mediaPlane.maskControlPoints[2].minPitchDeg,
  opacity: 1,
  stageWidth: cfg.stage.width,
  stageDepth: cfg.stage.depth,
  audienceInner: cfg.audience.innerRadius,
  audienceOuter: cfg.audience.outerRadius,
  eyeHeight: cfg.audience.eyeHeight,
  riseHeight: cfg.audience.riseHeight,
  shellRadius: cfg.building.shellRadius,
  // 素材参数 / 清单：默认值 = 完整 360°×180°、无朝向/俯仰偏移、无镜像、sRGB、原点在球心——即历史上
  // 唯一支持的那种素材。载入 manifest.json 或手动调整滑杆都会覆盖这些值（见 ERPManifest.ts）。
  contentProjection: DEFAULT_ERP_MANIFEST.projection,
  contentHFovDeg: DEFAULT_ERP_MANIFEST.hFovDeg,
  contentVFovDeg: DEFAULT_ERP_MANIFEST.vFovDeg,
  contentYawOffsetDeg: DEFAULT_ERP_MANIFEST.yawOffsetDeg,
  contentPitchOffsetDeg: DEFAULT_ERP_MANIFEST.pitchOffsetDeg,
  contentHFlip: DEFAULT_ERP_MANIFEST.hFlip,
  contentVFlip: DEFAULT_ERP_MANIFEST.vFlip,
  contentColorSpace: DEFAULT_ERP_MANIFEST.colorSpace,
  contentOriginX: DEFAULT_ERP_MANIFEST.originOffset.x,
  contentOriginY: DEFAULT_ERP_MANIFEST.originOffset.y,
  contentOriginZ: DEFAULT_ERP_MANIFEST.originOffset.z,
  // Diagnostics default OFF: the first thing a user sees should be the clean concave media plane
  // wrapping the audience (acceptance criterion — "第一眼看到的是包裹观众的凹球面内壁"), not a
  // screen full of wireframes/labels. Diagnostics stay one click away in the GUI panel.
  showReferenceSphere: false,
  showMediaPlane: true,
  showNonScreenArea: false,
  showBoundary: false,
  showGrid: false,
  showCenterMarker: false,
  showAxesHelper: true,
  showInnerAxesHelper: true,
  showContentOrigin: false,
  showEyePosition: false,
  showRayDiagram: false,
  showStageArrow: false,
  showAudienceMarkers: false,
  showVenue: true,
  // LED 像素化预览：默认关闭（第一眼仍是现有的连续贴图），密度默认给一个肉眼可见马赛克块的值——
  // 见 diagnostics/GUIPanel.ts GUIParams 注释与 materials/ERPMaskMaterial.ts 的 setLedPixelate。
  ledPixelateEnabled: false,
  ledCountX: 240,
  ledCountY: 120,
  // 屏幕位置几何校正：默认关闭（内屏偏心时刚性跟随，跟以前行为一致）——见
  // materials/ERPMaskMaterial.ts `setWarpToReferenceEye` 与 docs/SCREEN_DECOUPLING_DESIGN.md。
  contentWarpToEye: false,
  // 修改模式 / 预演模式：外屏 + 观众席永远只能靠滑杆调（跟之前一样）；内屏在"修改模式"下允许
  // 3D 拖拽 + 滑杆改参数，切到"预演模式"后只锁 3D 拖拽，滑杆仍可调参数。
  placementMode: "edit",
};

function applyVisibilityFromParams() {
  bundle.mediaPlaneMesh.visible = params.showMediaPlane;
  bundle.nonScreenMesh.visible = params.showNonScreenArea;
  bundle.diagnostics.referenceSphere.visible = params.showReferenceSphere;
  bundle.diagnostics.boundaryLine.visible = params.showBoundary;
  bundle.diagnostics.yawPitchGrid.visible = params.showGrid;
  bundle.diagnostics.sphereCenterMarker.visible = params.showCenterMarker;
  bundle.diagnostics.axesHelper.visible = params.showAxesHelper;
  bundle.diagnostics.innerAxesHelper.visible = params.showInnerAxesHelper;
  contentOriginMarker.visible = params.showContentOrigin;
  eyePositionMarker.visible = params.showEyePosition;
  // The ray diagram is pointer-driven (see the pointermove handler) — force-hide it here when the
  // layer is switched off; when switched on, it reappears on the next hover over the media plane.
  if (!params.showRayDiagram) rayDiagram.group.visible = false;
  bundle.diagnostics.stageDirectionArrow.visible = params.showStageArrow;
  bundle.diagnostics.audienceMarkers.visible = params.showAudienceMarkers;
  bundle.venue.group.visible = params.showVenue;
}
applyVisibilityFromParams();

function syncCfgFromParams() {
  // Keep the inner dome's centerline aligned to the seating bowl's centerline. The audience is
  // built symmetrically around world X=0 (see VenueGeometry.ts audienceSeatPosition), so X is no
  // longer an editable placement degree of freedom; movement is limited to height and front/back.
  params.centerOffsetX = 0;
  cfg.mediaPlane.radius = params.radius;
  cfg.mediaPlane.curvature = params.curvature;
  cfg.mediaPlane.centerHeight = params.centerHeight;
  cfg.mediaPlane.centerOffsetX = 0;
  cfg.mediaPlane.centerOffsetZ = params.centerOffsetZ;
  cfg.mediaPlane.tiltDeg = params.tiltDeg;
  cfg.building.centerHeight = params.buildingCenterHeight;
  cfg.mediaPlane.maskFeatherDeg = params.featherDeg;
  cfg.mediaPlane.maskControlPoints = [
    { yawDeg: 0, minPitchDeg: params.maskFront },
    { yawDeg: 90, minPitchDeg: params.maskSide },
    { yawDeg: 180, minPitchDeg: params.maskRear },
  ];
  cfg.stage.width = params.stageWidth;
  cfg.stage.depth = params.stageDepth;
  cfg.audience.innerRadius = params.audienceInner;
  cfg.audience.outerRadius = params.audienceOuter;
  cfg.audience.riseHeight = params.riseHeight;
  cfg.audience.eyeHeight = params.eyeHeight;
  cfg.building.shellRadius = params.shellRadius;
}

function rebuildDiagnostics() {
  bundle.scene.remove(bundle.diagnostics.group);
  bundle.diagnostics.dispose();
  bundle.diagnostics = buildDiagnosticsLayers(cfg);
  bundle.scene.add(bundle.diagnostics.group);
}

function refreshCameraPresets() {
  presets = computeCameraPresets(cfg);
  renderCameraBar();
}

function updateStats() {
  const area = estimateMediaPlaneAreaM2(cfg.mediaPlane.radius, cfg.mediaPlane.maskControlPoints);
  const coverage = mediaPlaneCoverageFraction(cfg.mediaPlane.radius, cfg.mediaPlane.maskControlPoints) * 100;
  const offsetH = Math.hypot(cfg.mediaPlane.centerOffsetX, cfg.mediaPlane.centerOffsetZ);
  const domeRadius = mediaPlaneDomeRadius(cfg.mediaPlane.curvature);
  const shape = mediaPlaneShapeLabel(cfg.mediaPlane.radius, cfg.mediaPlane.curvature);
  statsBar.innerHTML = `面积估算：<b>${area.toFixed(0)} m²</b><br/>球面覆盖率：<b>${coverage.toFixed(1)}%</b><br/>形态：<b>${shape}</b> · X'Y'圆形截面半径：<b>${cfg.mediaPlane.radius.toFixed(1)} m</b> · Z'穹顶半径：<b>${domeRadius.toFixed(1)} m</b><br/>曲率：<b>${cfg.mediaPlane.curvature.toFixed(1)} 1/km</b><br/>球心高度：<b>${cfg.mediaPlane.centerHeight.toFixed(1)} m</b><br/>内屏水平偏移：<b>${offsetH.toFixed(1)} m</b>（X 轴锁定）`;
}

/** Content reference origin = dome center (cfg.mediaPlane's full 3D center, including the
 *  drag-adjustable horizontal offset) + the manifest's originOffset. Repositioning it (not
 *  rebuilding) keeps this cheap enough to call on every content-param slider drag, matching the
 *  shader's own uOriginOffset uniform (which is object-space and so already automatically follows
 *  the media-plane mesh's world position without needing this adjustment itself). */
function updateContentOriginMarkerPosition() {
  contentOriginMarker.position.set(
    cfg.mediaPlane.centerOffsetX + params.contentOriginX,
    cfg.mediaPlane.centerHeight + params.contentOriginY,
    cfg.mediaPlane.centerOffsetZ + params.contentOriginZ,
  );
}
updateContentOriginMarkerPosition();

/** The fixed point the "屏幕位置几何校正" (ERPMaskMaterial `setWarpToReferenceEye`) keeps
 *  undistorted — literally the same seat CameraPresets.ts computes as `centralEye` (D-06's central
 *  audience reference position), so "turn on the correction" and "look from Central Audience" refer
 *  to the same physical point. Recomputed fresh (cheap) rather than cached so it always reflects the
 *  current `cfg.audience.*` sliders. */
function referenceEyeWorldPosition(): THREE.Vector3 {
  return new THREE.Vector3(0, cfg.audience.eyeHeight, cfg.audience.centralReferenceRadius);
}

/** Pushes the media plane's current world position + rotation, and the (possibly just-changed)
 *  reference eye position, into the shader — see ERPMaskMaterial.ts `setWarpToReferenceEye` doc
 *  comment. Called from every place the mesh moves/tilts (drag, slider, venue rebuild) and from the
 *  correction's own GUI toggle, so none of them can drift out of sync with whichever is currently
 *  true. */
function applyContentWarp() {
  bundle.mediaMaterial.setWarpToReferenceEye(
    params.contentWarpToEye,
    bundle.mediaPlaneMesh.position,
    bundle.mediaPlaneMesh.rotation.x,
    referenceEyeWorldPosition(),
  );
}

/** The expensive path: rebuilds the media-plane/non-screen sphere geometry (needed whenever radius
 *  changes) AND the full diagnostics layer (reference sphere, yaw/pitch grid, boundary line —
 *  hundreds to thousands of trig-computed vertices) AND camera presets/stats. Used by the GUI
 *  geometry sliders (radius/curvature/mask-affecting center changes) and once at the END of a
 *  3D-handle drag (pointerup) to settle everything to the final position — NOT on every
 *  pointermove during the drag itself, see `applyMediaPlaneTransformOnly` below for why. */
function rebuildMediaPlaneVisuals() {
  const domeRadius = mediaPlaneDomeRadius(cfg.mediaPlane.curvature);
  const oldGeo = bundle.mediaPlaneMesh.geometry;
  bundle.mediaPlaneMesh.geometry = buildERPSphereGeometry(cfg.mediaPlane.radius, cfg.mediaPlane.curvature, cfg.mediaPlane.yawSegments, cfg.mediaPlane.pitchSegments);
  oldGeo.dispose();
  bundle.mediaMaterial.setSurfaceAxes(cfg.mediaPlane.radius, domeRadius);
  bundle.mediaPlaneMesh.position.set(cfg.mediaPlane.centerOffsetX, cfg.mediaPlane.centerHeight, cfg.mediaPlane.centerOffsetZ);
  bundle.mediaPlaneMesh.rotation.x = THREE.MathUtils.degToRad(cfg.mediaPlane.tiltDeg);

  const oldNonGeo = bundle.nonScreenMesh.geometry;
  bundle.nonScreenMesh.geometry = buildERPSphereGeometry(cfg.mediaPlane.radius, cfg.mediaPlane.curvature, 96, 48);
  oldNonGeo.dispose();
  bundle.nonScreenMaterial.setSurfaceAxes(cfg.mediaPlane.radius, domeRadius);
  bundle.nonScreenMesh.position.copy(bundle.mediaPlaneMesh.position);
  bundle.nonScreenMesh.rotation.copy(bundle.mediaPlaneMesh.rotation);

  rebuildDiagnostics();
  applyVisibilityFromParams();
  refreshCameraPresets();
  updateContentOriginMarkerPosition();
  updateStats();
  updatePlacementHandles();
  applyContentWarp();
}

function onMediaPlaneGeometryChange() {
  syncCfgFromParams();
  rebuildMediaPlaneVisuals();
}

function onMediaPlaneCurvatureChange() {
  syncCfgFromParams();
  rebuildMediaPlaneVisuals();
}

/** The cheap path for a LIVE center- or tilt-drag (radius never changes on either path — the radius
 *  drag handle was tried and removed, radius is GUI-slider-only again, see
 *  docs/SCREEN_DECOUPLING_DESIGN.md): just repositions/re-rotates the already-built sphere meshes +
 *  handles + content-origin marker, skipping the diagnostics/camera-preset/stats rebuild
 *  `rebuildMediaPlaneVisuals` does. That rebuild — recomputing the reference-sphere/grid line
 *  geometry (thousands of vertices, mostly hidden diagnostics layers anyway, see `params`' defaults)
 *  on every single pointermove event — was the actual cause of a drag feeling unresponsive
 *  ("拖拽不灵敏"): a per-frame performance problem, not a hit-testing or math one. */
function applyMediaPlaneTransformOnly() {
  bundle.mediaPlaneMesh.position.set(cfg.mediaPlane.centerOffsetX, cfg.mediaPlane.centerHeight, cfg.mediaPlane.centerOffsetZ);
  bundle.mediaPlaneMesh.rotation.x = THREE.MathUtils.degToRad(cfg.mediaPlane.tiltDeg);
  bundle.nonScreenMesh.position.copy(bundle.mediaPlaneMesh.position);
  bundle.nonScreenMesh.rotation.copy(bundle.mediaPlaneMesh.rotation);
  bundle.diagnostics.innerAxesHelper.position.copy(bundle.mediaPlaneMesh.position);
  bundle.diagnostics.innerAxesHelper.rotation.copy(bundle.mediaPlaneMesh.rotation);
  updateContentOriginMarkerPosition();
  updatePlacementHandles();
  applyContentWarp();
}

/** Any 素材参数 field changed (FOV/offset/flip/origin/colorSpace) — applies live, no geometry
 *  rebuild needed. Geometric fields go straight to the shader uniform; colorSpace applies to
 *  whichever texture is currently mounted (placeholder or loaded media). */
function onContentParamsChange() {
  bundle.mediaMaterial.setContentMapping({
    projection: params.contentProjection,
    hFovDeg: params.contentHFovDeg,
    vFovDeg: params.contentVFovDeg,
    yawOffsetDeg: params.contentYawOffsetDeg,
    pitchOffsetDeg: params.contentPitchOffsetDeg,
    hFlip: params.contentHFlip,
    vFlip: params.contentVFlip,
    originOffset: { x: params.contentOriginX, y: params.contentOriginY, z: params.contentOriginZ },
  });
  currentTexture.colorSpace = manifestColorSpaceToThree(params.contentColorSpace);
  currentTexture.needsUpdate = true;
  updateContentOriginMarkerPosition();
}

/** The 投影类型 dropdown changed. Re-seeds hFov/vFov to a sane default for the NEW projection —
 *  360×180 makes no sense for a perspective camera (no real lens has a 360° FOV) and a narrow
 *  lens FOV makes no sense for a full equirect panorama. This is a visible starting point on the
 *  sliders the user can immediately override, not a silent inference. */
function onProjectionChange(newProjection: ERPProjection) {
  switch (newProjection) {
    case "perspective":
      params.contentHFovDeg = 90;
      params.contentVFovDeg = 60;
      break;
    case "fisheyeEquidistant":
    case "fisheyeEquisolid":
    case "domemaster":
      params.contentHFovDeg = 180;
      params.contentVFovDeg = 180;
      break;
    case "cylindrical":
      params.contentHFovDeg = 220;
      params.contentVFovDeg = 100;
      break;
    case "equirectangular":
    default:
      params.contentHFovDeg = 360;
      params.contentVFovDeg = 180;
      break;
  }
  guiHandle.refreshContentControllers();
  onContentParamsChange();
}

function onLedPixelateChange() {
  bundle.mediaMaterial.setLedPixelate(params.ledPixelateEnabled, params.ledCountX, params.ledCountY);
}

/** The "屏幕位置几何校正" toggle changed — see ERPMaskMaterial.ts `setWarpToReferenceEye` doc
 *  comment and docs/SCREEN_DECOUPLING_DESIGN.md "内屏偏心与观众视觉校正". */
function onContentWarpChange() {
  applyContentWarp();
}

function onMaskUniformsChange() {
  syncCfgFromParams();
  bundle.mediaMaterial.setMaskControlPoints(cfg.mediaPlane.maskControlPoints);
  bundle.mediaMaterial.setFeatherDeg(cfg.mediaPlane.maskFeatherDeg);
  applyMediaOpacity();
  bundle.nonScreenMaterial.setMaskControlPoints(cfg.mediaPlane.maskControlPoints);
  bundle.nonScreenMaterial.setFeatherDeg(cfg.mediaPlane.maskFeatherDeg);

  rebuildDiagnostics();
  applyVisibilityFromParams();
  updateStats();
}

function onVenueChange() {
  syncCfgFromParams();
  bundle.scene.remove(bundle.venue.group);
  bundle.venue.dispose();
  bundle.venue = buildVenueGroup(cfg);
  bundle.scene.add(bundle.venue.group);
  applyVisibilityFromParams();
  refreshCameraPresets();
  // Rebuilding the venue creates a brand-new shell mesh (default visible=true) — reapply the
  // currently active preset's shell visibility/clip state so a slider tweak doesn't leak the
  // exterior shell into a normal audience view.
  const activeCutaway = presets.find((p) => p.id === activePresetId)?.cutaway ?? false;
  syncCutawayState(activeCutaway);
  // audience.eyeHeight/centralReferenceRadius feed referenceEyeWorldPosition() — re-push it even
  // when the media plane itself doesn't need a rebuild below (the correction still needs to track a
  // moved audience reference seat).
  applyContentWarp();

}

function onToggleLayer(key: DiagnosticsLayerKey, visible: boolean) {
  switch (key) {
    case "mediaPlane":
      bundle.mediaPlaneMesh.visible = visible;
      break;
    case "nonScreenArea":
      bundle.nonScreenMesh.visible = visible;
      break;
    case "referenceSphere":
      bundle.diagnostics.referenceSphere.visible = visible;
      break;
    case "boundary":
      bundle.diagnostics.boundaryLine.visible = visible;
      break;
    case "grid":
      bundle.diagnostics.yawPitchGrid.visible = visible;
      break;
    case "centerMarker":
      bundle.diagnostics.sphereCenterMarker.visible = visible;
      break;
    case "axesHelper":
      bundle.diagnostics.axesHelper.visible = visible;
      break;
    case "innerAxesHelper":
      bundle.diagnostics.innerAxesHelper.visible = visible;
      break;
    case "contentOrigin":
      contentOriginMarker.visible = visible;
      break;
    case "eyePosition":
      eyePositionMarker.visible = visible;
      break;
    case "rayDiagram":
      if (!visible) rayDiagram.group.visible = false; // re-appears on the next hover when re-enabled
      break;
    case "stageArrow":
      bundle.diagnostics.stageDirectionArrow.visible = visible;
      break;
    case "audienceMarkers":
      bundle.diagnostics.audienceMarkers.visible = visible;
      break;
    case "venue":
      bundle.venue.group.visible = visible;
      break;
  }
}

// ---------------------------------------------------------------------------
// ERP content input: video / image file loading
// ---------------------------------------------------------------------------

let currentVideoEl: HTMLVideoElement | null = null;
let currentTexture: THREE.Texture = placeholderTexture;

const fileInput = document.createElement("input");
fileInput.type = "file";
// Some OS/browser file pickers do not classify .mov as `video/*`, and .exr/.hdr do not have a
// reliable registered image MIME type. List common extensions explicitly so they can be selected;
// actual playback/decoding still depends on the browser's native media support.
fileInput.accept = "video/*,image/*,.mov,.m4v,.mp4,.webm,.exr,.hdr";
fileInput.style.display = "none";
document.body.appendChild(fileInput);

function disposeCurrentContent() {
  if (currentTexture !== placeholderTexture) currentTexture.dispose();
  if (currentVideoEl) {
    currentVideoEl.pause();
    URL.revokeObjectURL(currentVideoEl.src);
    currentVideoEl = null;
  }
}

/** Placement-testing look (per explicit request): "起初两个球都是透明的，拖到合适位置后再导入
 *  素材填充图片" — before any REAL media has been loaded, the inner dome shows as the same kind of
 *  flat transparent ball as the outer shell (`VenueGeometry.ts` `buildFlatTransparentMaterial`),
 *  not the placeholder's calibration grid, so dragging/resizing it isn't fighting a busy texture for
 *  attention. The moment real media loads, it switches back to showing actual content. Reuses
 *  `ERPMaskMaterial`'s existing `setSolid()` — the same flat-color mechanism the "Non-Screen Area"
 *  diagnostic layer already uses — rather than inventing a second one-off toggle; unlike the outer
 *  shell (rendered as a full sphere), this fills the media plane's actual screen-mask SHAPE, since
 *  that shape (not a full sphere) is what the inner screen really is. */
const PLACEMENT_PLACEHOLDER_COLOR = 0x4fd1c5;
const PLACEMENT_PLACEHOLDER_OPACITY = 0.22;

/** True whenever the media plane should show as the flat placement-testing ball instead of its
 *  actual content. Once any real media is loaded, it should remain visible in both 修改模式 and
 *  预演模式; the mode switch only controls whether the 3D drag handles are active. */
function shouldShowMediaAsSimpleBall(): boolean {
  return currentTexture === placeholderTexture;
}

/** Single source of truth for the media plane's opacity uniform: while showing the simple ball
 *  (see `shouldShowMediaAsSimpleBall`), force the flat placement-testing opacity regardless of the
 *  "球幕不透明度" GUI slider; otherwise that slider's value (`params.opacity`) governs normally.
 *  Called from `setTexture`, `onMaskUniformsChange`, and `onPlacementModeChange` so none of the three
 *  can leave the other two out of sync. */
function applyMediaOpacity() {
  bundle.mediaMaterial.setOpacity(shouldShowMediaAsSimpleBall() ? PLACEMENT_PLACEHOLDER_OPACITY : params.opacity);
}

/** Refreshes both the solid-color toggle and the opacity together — call after anything that could
 *  change `shouldShowMediaAsSimpleBall()`'s result (content load/reset, or a placement-mode switch). */
function applyMediaSolidLook() {
  bundle.mediaMaterial.setSolid(shouldShowMediaAsSimpleBall(), PLACEMENT_PLACEHOLDER_COLOR);
  applyMediaOpacity();
}

function setTexture(tex: THREE.Texture) {
  // colorSpace comes from the current 素材参数, not a hardcoded assumption — a manifest loaded
  // before or after this media picks "srgb" vs "linear" (see ERPManifest.ts `colorSpace`).
  tex.colorSpace = manifestColorSpaceToThree(params.contentColorSpace);
  currentTexture = tex;
  bundle.mediaMaterial.setMap(tex);
  applyMediaSolidLook();
}

function loadVideoFile(file: File) {
  disposeCurrentContent();
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.crossOrigin = "anonymous";
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.preload = "auto";
  contentStatusEl.innerHTML = `正在载入视频：<b>${file.name}</b>`;

  let mounted = false;
  const isMov = file.name.toLowerCase().endsWith(".mov");
  const decodeHint = isMov
    ? "MOV 容器已识别，但当前浏览器可能不支持其中的视频编码；建议转为 MP4 / H.264。"
    : "当前浏览器可能不支持该视频编码。";
  const mountTextureOnce = () => {
    if (mounted || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    mounted = true;
    currentVideoEl = video;
    const tex = new THREE.VideoTexture(video);
    tex.flipY = false; // matches this project's ERP v-convention (v=0 top row), see SphericalMath.ts
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    setTexture(tex);
    contentStatusEl.innerHTML = `已载入视频：<b>${file.name}</b>`;
    video.play().catch(() => {
      contentStatusEl.innerHTML = `已载入视频：<b>${file.name}</b>（浏览器阻止自动播放，请点“播放 / 暂停视频”继续）`;
    });
  };
  const failDecode = () => {
    if (mounted) return;
    contentStatusEl.innerHTML = `<span class="err">视频解码失败或没有可用画面：${file.name}。${decodeHint}</span>`;
    URL.revokeObjectURL(url);
  };
  video.addEventListener("loadeddata", mountTextureOnce, { once: true });
  video.addEventListener("canplay", mountTextureOnce, { once: true });
  video.addEventListener("error", failDecode, { once: true });
  window.setTimeout(() => {
    if (!mounted && currentVideoEl !== video) failDecode();
  }, 5000);
  video.load();
}

function loadImageFile(file: File) {
  disposeCurrentContent();
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const tex = new THREE.Texture(img);
    tex.flipY = false;
    tex.needsUpdate = true;
    setTexture(tex);
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

/** OpenEXR has no native browser decoder (no `<img>`/`<video>` support), so this goes through
 *  three.js's own EXRLoader instead of the `<img>` path loadImageFile() uses. Raw EXR pixel data
 *  is scene-linear by construction — not a size/extension-based guess, the format itself has no
 *  other reasonable interpretation — so this is the one loader that sets 素材参数 → 色彩解释 to
 *  "linear" for the user rather than leaving whatever was there before (still overridable
 *  afterwards, same as any other GUI field). */
function loadExrFile(file: File) {
  disposeCurrentContent();
  const url = URL.createObjectURL(file);
  new EXRLoader().load(
    url,
    (tex) => {
      // EXRLoader already sets tex.flipY = false and a linear colorSpace on load; syncing
      // params.contentColorSpace to match keeps the GUI honest about what's actually applied
      // (setTexture() re-applies colorSpace from params, so this also determines the final value).
      params.contentColorSpace = "linear";
      guiHandle.refreshContentControllers();
      setTexture(tex);
      contentStatusEl.innerHTML = `已载入 EXR：<b>${file.name}</b>（色彩解释已设为 linear）`;
      URL.revokeObjectURL(url);
    },
    undefined,
    () => {
      contentStatusEl.innerHTML = `<span class="err">EXR 解码失败：${file.name}（可能不是受支持的 OpenEXR 压缩格式）</span>`;
      URL.revokeObjectURL(url);
    },
  );
}

/** Radiance HDR (.hdr) — same reasoning as loadExrFile(): no native browser decoder, goes through
 *  three.js's RGBELoader, and the raw pixel data is scene-linear so 色彩解释 gets set to "linear".
 *  Unlike EXRLoader, RGBELoader defaults `texture.flipY` to TRUE (its own load() override sets it
 *  explicitly) — overridden back to `false` here to match this project's convention (row 0 of
 *  source = v=0 = zenith, same as every other loader in this file). */
function loadHdrFile(file: File) {
  disposeCurrentContent();
  const url = URL.createObjectURL(file);
  new RGBELoader().load(
    url,
    (tex) => {
      tex.flipY = false;
      params.contentColorSpace = "linear";
      guiHandle.refreshContentControllers();
      setTexture(tex);
      contentStatusEl.innerHTML = `已载入 HDR：<b>${file.name}</b>（色彩解释已设为 linear）`;
      URL.revokeObjectURL(url);
    },
    undefined,
    () => {
      contentStatusEl.innerHTML = `<span class="err">HDR 解码失败：${file.name}</span>`;
      URL.revokeObjectURL(url);
    },
  );
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const name = file.name.toLowerCase();
  const isVideoByExtension = [".mov", ".m4v", ".mp4", ".webm"].some((ext) => name.endsWith(ext));
  if (name.endsWith(".exr")) loadExrFile(file);
  else if (name.endsWith(".hdr")) loadHdrFile(file);
  else if (file.type.startsWith("video/") || isVideoByExtension) loadVideoFile(file);
  else if (file.type.startsWith("image/")) loadImageFile(file);
  else contentStatusEl.innerHTML = `<span class="err">无法识别的文件类型：${file.name}</span>`;
  fileInput.value = "";
});

function requestFile() {
  fileInput.click();
}

function resetPlaceholder() {
  disposeCurrentContent();
  // The calibration grid is procedurally drawn as a full, centered 360×180 ERP (see
  // PlaceholderERP.ts) — any leftover partial-FOV/offset/origin 素材参数 would misalign it and
  // defeat its purpose as an alignment reference, so this is the one action that also resets them.
  applyManifest(DEFAULT_ERP_MANIFEST);
  setTexture(placeholderTexture);
}

function togglePlayback() {
  if (!currentVideoEl) return;
  if (currentVideoEl.paused) currentVideoEl.play();
  else currentVideoEl.pause();
}

// ---------------------------------------------------------------------------
// 素材清单（manifest.json）：媒体文件本身之外的第二个输入，声明投影、视场、朝向、内容原点、色彩
// 解释（见 src/content/ERPManifest.ts）。载入与载入媒体文件是两个独立、可任意顺序的动作——清单
// 只负责覆盖下面这些参数，不会替用户选择或触发媒体文件的载入。
// ---------------------------------------------------------------------------

const manifestFileInput = document.createElement("input");
manifestFileInput.type = "file";
manifestFileInput.accept = "application/json,.json";
manifestFileInput.style.display = "none";
document.body.appendChild(manifestFileInput);

function applyManifest(m: ERPManifest) {
  params.contentProjection = m.projection;
  params.contentHFovDeg = m.hFovDeg;
  params.contentVFovDeg = m.vFovDeg;
  params.contentYawOffsetDeg = m.yawOffsetDeg;
  params.contentPitchOffsetDeg = m.pitchOffsetDeg;
  params.contentHFlip = m.hFlip;
  params.contentVFlip = m.vFlip;
  params.contentColorSpace = m.colorSpace;
  params.contentOriginX = m.originOffset.x;
  params.contentOriginY = m.originOffset.y;
  params.contentOriginZ = m.originOffset.z;
  guiHandle.refreshContentControllers();
  onContentParamsChange();
}

manifestFileInput.addEventListener("change", () => {
  const file = manifestFileInput.files?.[0];
  manifestFileInput.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let raw: unknown;
    try {
      raw = JSON.parse(String(reader.result));
    } catch (err) {
      contentStatusEl.innerHTML = `<span class="err">清单不是合法 JSON：${err instanceof Error ? err.message : String(err)}</span>`;
      return;
    }
    const result = parseManifest(raw);
    if (!result.ok) {
      // 缺投影类型 / 字段非法都在这里截住——不会退回到"按宽高比猜一个"，而是保留当前参数不变。
      contentStatusEl.innerHTML = `<span class="err">清单 ${file.name} 无效：${result.error}</span>`;
      return;
    }
    applyManifest(result.manifest);
    contentStatusEl.innerHTML = `已载入清单：<b>${file.name}</b>`;
  };
  reader.onerror = () => {
    contentStatusEl.innerHTML = `<span class="err">读取 ${file.name} 失败</span>`;
  };
  reader.readAsText(file);
});

function requestManifestFile() {
  manifestFileInput.click();
}

// ---------------------------------------------------------------------------
// Camera presets UI
// ---------------------------------------------------------------------------

const cameraBar = document.getElementById("camera-bar")!;
let activePresetId: string | null = null;

/** The outer shell remains visible as a reference from every camera position. The cutaway hook
 * remains available for any future view that requests it. */
function syncCutawayState(cutaway: boolean) {
  const shell = bundle.venue.group.children.find((c) => (c as any).userData?.isBuildingShell) as THREE.Mesh | undefined;
  if (shell) {
    shell.visible = true;
    const mat = shell.material as THREE.Material; // rim-outline ShaderMaterial now (VenueGeometry.ts) — only .clippingPlanes is touched here
    const clips: THREE.Plane[] = [];
    if (cutaway) clips.push(bundle.cutawayPlane);
    mat.clippingPlanes = clips;
  }
  bundle.mediaMaterial.clippingPlanes = cutaway ? [bundle.cutawayPlane] : [];
  bundle.nonScreenMaterial.clippingPlanes = cutaway ? [bundle.cutawayPlane] : [];
}

let audienceView:
  | {
      eye: THREE.Vector3;
      yaw: number;
      pitch: number;
      dragging: boolean;
      lastX: number;
      lastY: number;
    }
  | null = null;

const AUDIENCE_LOOK_DISTANCE = 10;
const AUDIENCE_LOOK_SENSITIVITY = 0.003;
const AUDIENCE_MIN_PITCH = THREE.MathUtils.degToRad(-80);
const AUDIENCE_MAX_PITCH = THREE.MathUtils.degToRad(80);

function applyAudienceLook() {
  if (!audienceView) return;
  const cp = Math.cos(audienceView.pitch);
  const forward = new THREE.Vector3(Math.sin(audienceView.yaw) * cp, Math.sin(audienceView.pitch), -Math.cos(audienceView.yaw) * cp);
  camera.position.copy(audienceView.eye);
  controls.target.copy(audienceView.eye.clone().add(forward.multiplyScalar(AUDIENCE_LOOK_DISTANCE)));
  camera.lookAt(controls.target);
  updateEyePositionMarkerPosition(audienceView.eye);
}

function enterAudienceView(eye: THREE.Vector3, target: THREE.Vector3) {
  const forward = target.clone().sub(eye).normalize();
  audienceView = {
    eye: eye.clone(),
    yaw: Math.atan2(forward.x, -forward.z),
    pitch: Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)),
    dragging: false,
    lastX: 0,
    lastY: 0,
  };
  controls.enabled = false;
  applyAudienceLook();
}

function exitAudienceView() {
  if (!audienceView) return;
  audienceView = null;
  controls.enabled = true;
}

function applyPreset(preset: CameraPreset) {
  exitAudienceView();
  activeSeatLabel = null;
  camera.position.copy(preset.position);
  camera.fov = preset.fov;
  camera.updateProjectionMatrix();
  controls.target.copy(preset.target);
  controls.update();

  syncCutawayState(preset.cutaway);
  updateEyePositionMarkerPosition(preset.position);

  activePresetId = preset.id;
  renderCameraBar();
}

function renderCameraBar() {
  cameraBar.innerHTML = "";
  for (const preset of presets) {
    const btn = document.createElement("button");
    btn.textContent = preset.label;
    if (preset.id === activePresetId) btn.classList.add("active");
    btn.addEventListener("click", () => applyPreset(preset));
    cameraBar.appendChild(btn);
  }
  const freeBtn = document.createElement("button");
  freeBtn.textContent = "自由环视";
  if (!activePresetId && !activeSeatLabel) freeBtn.classList.add("active");
  freeBtn.addEventListener("click", () => {
    exitAudienceView();
    activeSeatLabel = null;
    activePresetId = null;
    renderCameraBar();
  });
  cameraBar.appendChild(freeBtn);
  if (activeSeatLabel) {
    const seatBtn = document.createElement("button");
    seatBtn.textContent = activeSeatLabel;
    seatBtn.classList.add("active");
    seatBtn.title = "当前为座位观众模式：拖拽只会在该座位转头";
    cameraBar.appendChild(seatBtn);
  }
}
renderCameraBar();
applyPreset(presets[0]);

// ---------------------------------------------------------------------------
// 点击座位查看视角：预设相机机位之外，观众席里任意一块代表性座椅（VenueGeometry.ts 的
// seatInstancedMesh）都可以点击，相机立刻跳到那个座位的眼位，并在右侧面板给出与中央参考位相比
// 的量化读数（视线朝向偏移、代表性视锥内的球幕覆盖率，见 core/SeatMetrics.ts）。
// ---------------------------------------------------------------------------

const seatRaycaster = new THREE.Raycaster();
const seatPointerNDC = new THREE.Vector2();
let seatPointerDown: { x: number; y: number } | null = null;

/** The shared frame every per-seat and batch metric is measured against — computed fresh each
 *  time (cheap) so it always reflects the current VenueConfig, never a stale snapshot from
 *  whenever the geometry last changed. `seatTarget` mirrors CameraPresets.ts's centralTarget/
 *  sideTarget aim point; `referencePoint` is where the CENTRAL reference eye's own default gaze
 *  lands on the dome — every seat's offset is measured against this ONE fixed physical point, not
 *  against each seat's own (differently-aimed) target (eq. 7-8 in the project brief's sense). */
function getSeatReferenceFrame() {
  const domeCenter = new THREE.Vector3(cfg.mediaPlane.centerOffsetX, cfg.mediaPlane.centerHeight, cfg.mediaPlane.centerOffsetZ);
  const stageCenterZ = -(cfg.stage.frontOffset + cfg.stage.depth / 2);
  const seatTarget = new THREE.Vector3(0, cfg.mediaPlane.radius * 0.2, stageCenterZ);
  const central = presets.find((p) => p.id === "central")!;
  const centralForward = central.target.clone().sub(central.position).normalize();
  const referencePoint = intersectDomeRay(central.position, centralForward, domeCenter, cfg.mediaPlane.radius) ?? central.target;
  return { domeCenter, seatTarget, referencePoint, centralEye: central.position };
}

function selectSeat(instanceId: number) {
  const meta = bundle.venue.seatMeta[instanceId];
  if (!meta) return;

  const seatFloorPos = audienceSeatPosition(meta.azDeg, meta.radius, cfg.audience);
  const eye = seatFloorPos.clone().add(new THREE.Vector3(0, cfg.audience.eyeHeight, 0));
  const { domeCenter, seatTarget, referencePoint, centralEye } = getSeatReferenceFrame();

  camera.position.copy(eye);
  camera.fov = 100;
  camera.updateProjectionMatrix();
  enterAudienceView(eye, seatTarget);
  syncCutawayState(false);
  activePresetId = null; // this is a seat, not one of the named presets.
  activeSeatLabel = `座位观众 ${meta.azDeg.toFixed(0)}° / ${meta.radius.toFixed(1)}m`;
  renderCameraBar();

  const forward = seatTarget.clone().sub(eye).normalize();
  const coverage = computeSeatCoverage(eye, forward, domeCenter, cfg.mediaPlane.radius, cfg.mediaPlane.maskControlPoints);
  const offsetDeg = directionOffsetDeg(referencePoint, eye, centralEye);
  const distToCenter = eye.distanceTo(domeCenter);

  seatInfoEl.innerHTML = `
    <h2>已选座位</h2>
    <div class="row"><span>方位角 / 半径</span><b>${meta.azDeg.toFixed(0)}° · ${meta.radius.toFixed(1)} m</b></div>
    <div class="row"><span>眼位坐标</span><b>${eye.x.toFixed(1)}, ${eye.y.toFixed(1)}, ${eye.z.toFixed(1)}</b></div>
    <div class="row"><span>距球心距离</span><b>${distToCenter.toFixed(1)} m</b></div>
    <div class="row"><span>视锥球幕覆盖率</span><b>${(coverage.coverageFraction * 100).toFixed(0)}%</b></div>
    <div class="row"><span>与中央参考位视线偏移</span><b>${offsetDeg.toFixed(1)}°</b></div>
    <div class="hint">观众模式：拖拽画面会固定在该座位眼位转头，不再绕场景环视。几何近似：未建模座椅/结构遮挡物，覆盖率为该座位前方代表性视锥（110°×70°）的采样估计，不是渲染像素结果；样本量小，不代表全体观众满意度。</div>
  `;
}

renderer.domElement.addEventListener(
  "pointerdown",
  (ev) => {
    if (!audienceView || ev.button !== 0) return;
    audienceView.dragging = true;
    audienceView.lastX = ev.clientX;
    audienceView.lastY = ev.clientY;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  },
  { capture: true },
);

window.addEventListener(
  "pointermove",
  (ev) => {
    if (!audienceView?.dragging) return;
    const dx = ev.clientX - audienceView.lastX;
    const dy = ev.clientY - audienceView.lastY;
    audienceView.lastX = ev.clientX;
    audienceView.lastY = ev.clientY;
    audienceView.yaw -= dx * AUDIENCE_LOOK_SENSITIVITY;
    audienceView.pitch = THREE.MathUtils.clamp(audienceView.pitch - dy * AUDIENCE_LOOK_SENSITIVITY, AUDIENCE_MIN_PITCH, AUDIENCE_MAX_PITCH);
    applyAudienceLook();
    ev.preventDefault();
    ev.stopImmediatePropagation();
  },
  { capture: true },
);

window.addEventListener(
  "pointerup",
  (ev) => {
    if (!audienceView?.dragging) return;
    audienceView.dragging = false;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  },
  { capture: true },
);

renderer.domElement.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return; // left button only — right/middle drag OrbitControls' pan, not a pick
  if (draggingHandle) return; // an inner-screen placement handle grabbed this pointerdown instead
  seatPointerDown = { x: ev.clientX, y: ev.clientY };
});

renderer.domElement.addEventListener("pointerup", (ev) => {
  const down = seatPointerDown;
  seatPointerDown = null;
  if (!down) return;
  if (draggingHandle) return; // still mid-drag (or was) — never a seat click
  // Only a genuine click selects a seat — OrbitControls' drag-to-orbit also fires pointerdown/up
  // on this same element, and treating that as a seat pick would fight the camera on every drag.
  if (Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4) return;

  const seatMesh = bundle.venue.seatInstancedMesh;
  // Raycaster doesn't check .visible on its own — skip explicitly when the seat mesh or its
  // parent venue group is hidden (GUI "场馆" / individual layer toggles), so a click can't select
  // an invisible seat.
  if (!bundle.venue.group.visible || !seatMesh.visible) return;

  const rect = renderer.domElement.getBoundingClientRect();
  seatPointerNDC.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  seatPointerNDC.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  seatRaycaster.setFromCamera(seatPointerNDC, camera);

  const hits = seatRaycaster.intersectObject(seatMesh, false);
  if (hits.length === 0 || hits[0].instanceId === undefined) return;
  selectSeat(hits[0].instanceId);
});

// ---------------------------------------------------------------------------
// 内屏摆放：拖拽移动高度和前后位置（圆圈）/ 改俯仰角（三角）；半径和曲率用右侧面板滑杆调整（外屏、
// 观众席、舞台同样保持仅参数化滑杆可调，不可拖拽）。
// 所有内屏几何参数均按用户输入直接更新，不受外壳、舞台或座席位置的自动夹紧。
// ---------------------------------------------------------------------------

function mediaPlaneCenter(): THREE.Vector3 {
  return new THREE.Vector3(cfg.mediaPlane.centerOffsetX, cfg.mediaPlane.centerHeight, cfg.mediaPlane.centerOffsetZ);
}

// Guaranteed-on-top rendering, the same trick real 3D-editor gizmos use: `depthTest:false` alone
// is NOT enough here, because a plain MeshBasicMaterial (transparent defaults to false) belongs to
// three.js's OPAQUE render pass, which always runs BEFORE the transparent pass that draws the
// (transparent) media plane — so the dome could still paint over the handle depending on view
// angle even with depthTest off. Marking the handle `transparent:true` moves it into the
// TRANSPARENT pass instead, and a `renderOrder` higher than everything else (media plane, venue
// geometry all default to 0) makes it the LAST thing drawn in that pass — combined with
// depthTest:false it then wins against every other object in the scene unconditionally, so the
// handle can never again become unreachable because something else happened to be in front of it.
// Two handles only, both only usable in "修改模式"（Edit Mode）— 圆圈(centerHandle) moves the full
  // center position (Y/Z only; X is locked to the seating centerline, via a camera-facing drag plane
  // — see the pointermove handler below),
// 三角(tiltHandle) changes the tilt/elevation angle (`tiltDeg`, a rigid rotation around the local X
// axis — see VenueConfig.ts). Radius has no drag handle, slider-only (WAS draggable via a third
// handle at one point, removed after feedback — see docs/SCREEN_DECOUPLING_DESIGN.md for why this
// settled on exactly two handles).
const placementHandleMaterial = new THREE.MeshBasicMaterial({
  color: 0xff8a3d,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});
const centerHandle = new THREE.Mesh(new THREE.SphereGeometry(1.6, 20, 14), placementHandleMaterial);
const tiltHandle = new THREE.Mesh(new THREE.ConeGeometry(1.0, 2.4, 16), placementHandleMaterial);
centerHandle.renderOrder = tiltHandle.renderOrder = 998;
bundle.scene.add(centerHandle, tiltHandle);

// Fixed, small visual arm for the tilt handle — deliberately NOT tied to the sphere's own radius
// (unlike the old radius handle, which sat out at the equator): per explicit request the two
// handles should sit together near the center, not one at the core and one way out at the edge.
const TILT_HANDLE_ARM = 3;

function updatePlacementHandles() {
  const center = mediaPlaneCenter();
  centerHandle.position.copy(center);
  // Traces a small vertical arc around `center`, in the plane perpendicular to the tilt axis (local
  // X) — at tiltDeg=0 this sits straight up (matching the old fixed "+Y" look), and swings toward/
  // away from the audience as tiltDeg changes, giving a continuous visual readout of the current
  // angle. Must match the forward rotation main.ts applies to the mesh (`rotation.x = tiltRad`) and
  // the inverse the pointermove handler below solves for — see that handler's comment.
  const tiltRad = THREE.MathUtils.degToRad(cfg.mediaPlane.tiltDeg);
  const arm = new THREE.Vector3(0, Math.cos(tiltRad), Math.sin(tiltRad)).multiplyScalar(TILT_HANDLE_ARM);
  tiltHandle.position.copy(center).add(arm);
}
updatePlacementHandles();

function updateModeStatus() {
  const editing = params.placementMode === "edit";
  modeStatusEl.className = editing ? "edit" : "preview";
  modeStatusEl.innerHTML = editing
    ? `<b>修改模式</b><span>可拖拽内屏，也可修改参数</span>`
    : `<b>预演模式</b><span>拖拽已锁定，参数仍可修改</span>`;
}

/** Shows/hides the two drag handles for the 修改/预演 mode switch. Real loaded media remains
 *  visible in both modes; before loading media, the placeholder still uses the simple-ball look. */
function onPlacementModeChange() {
  const editing = params.placementMode === "edit";
  centerHandle.visible = editing;
  tiltHandle.visible = editing;
  updateModeStatus();
  applyMediaSolidLook();
}

type PlacementHandleKind = "center" | "tilt";
let draggingHandle: PlacementHandleKind | null = null;
const placementRaycaster = new THREE.Raycaster();
const placementPointerNDC = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const dragPlaneHit = new THREE.Vector3();

function placementNDCFromEvent(ev: PointerEvent): THREE.Vector2 {
  const rect = renderer.domElement.getBoundingClientRect();
  placementPointerNDC.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  placementPointerNDC.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  return placementPointerNDC;
}

renderer.domElement.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return;
  // 预演模式下位置锁定 — the handles are also `.visible = false` (onPlacementModeChange), but
  // Raycaster does NOT check `.visible` on its own (same gotcha noted for seat-picking above), so
  // this explicit mode guard is the thing that actually prevents a drag from starting, not the
  // visibility flag by itself.
  if (params.placementMode !== "edit") return;
  placementRaycaster.setFromCamera(placementNDCFromEvent(ev), camera);
  const hits = placementRaycaster.intersectObjects([centerHandle, tiltHandle], false);
  if (hits.length === 0) return;
  draggingHandle = hits[0].object === tiltHandle ? "tilt" : "center";
  controls.enabled = false; // otherwise OrbitControls' own pointer handlers would also rotate the camera
});

/** Applies one live drag tick: writes the new params straight through to `cfg.mediaPlane` without
 *  automatic placement clamping. Inner-screen GUI edits and venue geometry edits are also free-form.
 *  Neither center- nor
 *  tilt-drag ever touches radius, so both
 *  always take the cheap position/rotation-only path — no geometry rebuild needed for either. This
 *  is NOT the same as the numerical sanity guards in the pointermove handler below (rejecting a
 *  grazing-angle ray/plane intersection) — that isn't a "reasonableness" restriction, it's
 *  preventing an actual math blow-up from ever reaching `params` at all, and stays in place
 *  regardless of how free-form the drag itself is. */
function applyPlacementDragTick() {
  syncCfgFromParams();
  applyMediaPlaneTransformOnly();
}

// Listen on `window` (not the canvas) for move/up so the drag keeps tracking even if the pointer
// leaves the canvas mid-gesture — standard behavior for a drag handle.
window.addEventListener("pointermove", (ev) => {
  if (!draggingHandle) return;

  if (draggingHandle === "tilt") {
    // Intersect the pointer ray with the vertical plane (normal = local X axis, i.e. the tilt axis)
    // through the dome's center — the same "drag through a plane" technique the center handle uses,
    // just a different plane — then read the angle of the hit point off that plane's own (y,z) axes
    // via atan2. This is the exact inverse of `updatePlacementHandles`' forward formula
    // (arm = (0, cos, sin) * ARM), so dragging the handle to a given position always recovers the
    // angle that would have put it there.
    placementRaycaster.setFromCamera(placementNDCFromEvent(ev), camera);
    const center = mediaPlaneCenter();
    dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(1, 0, 0), center);
    if (placementRaycaster.ray.intersectPlane(dragPlane, dragPlaneHit)) {
      const local = dragPlaneHit.clone().sub(center);
      if (Number.isFinite(local.y) && Number.isFinite(local.z)) {
        params.tiltDeg = THREE.MathUtils.radToDeg(Math.atan2(local.z, local.y));
        applyPlacementDragTick();
      }
    }
    return;
  }

  // "center": drag against a plane that FACES THE CAMERA (normal = view direction) through the
  // dome's current center, instead of the world's horizontal ground plane. This is the standard
  // "billboard"/view-plane translate technique precisely because it sidesteps the grazing-angle
  // problem the old horizontal-plane version had structurally: a ray from the camera through a
  // screen pixel is essentially never near-parallel to a plane whose normal IS that camera's own
  // forward direction (you'd need a pixel right at the edge of an extremely wide FOV), so there's no
  // near-horizon blowup to guard against — motion stays confined to exactly what's visible on
  // screen ("拖拽应该只能在当前的2D屏幕上进行，不能有前后的变化"), never runs away in depth. X is
  // intentionally discarded below so the inner dome centerline stays aligned with the seating
  // centerline; the circle handle only updates height and front/back offset.
  placementRaycaster.setFromCamera(placementNDCFromEvent(ev), camera);
  const viewDir = new THREE.Vector3();
  camera.getWorldDirection(viewDir);
  dragPlane.setFromNormalAndCoplanarPoint(viewDir, mediaPlaneCenter());
  const shellGuardRadius = cfg.building.shellRadius * 3; // defense-in-depth only now, not the primary fix
  if (
    placementRaycaster.ray.intersectPlane(dragPlane, dragPlaneHit) &&
    Number.isFinite(dragPlaneHit.x) &&
    Number.isFinite(dragPlaneHit.y) &&
    Number.isFinite(dragPlaneHit.z) &&
    dragPlaneHit.length() <= shellGuardRadius
  ) {
    params.centerOffsetX = 0;
    params.centerHeight = dragPlaneHit.y;
    params.centerOffsetZ = dragPlaneHit.z;
    applyPlacementDragTick();
  }
});

window.addEventListener("pointerup", () => {
  if (!draggingHandle) return;
  draggingHandle = null;
  controls.enabled = true;
  // Settle diagnostics/camera-presets/stats to the final position once, now that the drag is over
  // — see rebuildMediaPlaneVisuals' doc comment for why this is deferred instead of running on
  // every pointermove tick above.
  rebuildMediaPlaneVisuals();
});

// ---------------------------------------------------------------------------
// 分析 / 导出：批量座位分析（"分析工具"）+ 纯前端下载（"导出模块"）。两者都是几何近似之上的
// 只读产物——不改场景状态，随时可以重新跑，见 docs/ARCHITECTURE.md 模块对照表。
// ---------------------------------------------------------------------------

/** Runs SeatMetrics.ts `runBatchSeatAnalysis` over every representative seat currently in the
 *  scene, using the same reference frame `selectSeat` uses (so a single-seat click and this batch
 *  run are always measuring against the identical fixed screen point / central eye). */
function runFullVenueAnalysis(): BatchSeatAnalysis {
  const { domeCenter, seatTarget, referencePoint, centralEye } = getSeatReferenceFrame();
  return runBatchSeatAnalysis(cfg, bundle.venue.seatMeta, domeCenter, seatTarget, referencePoint, centralEye);
}

function renderAnalysisSummary(result: BatchSeatAnalysis) {
  const c = result.coverage;
  const o = result.offsetDeg;
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const deg = (v: number) => `${v.toFixed(1)}°`;
  analysisInfoEl.innerHTML = `
    <h2>全场座位分析（${result.samples.length} 个代表性座位）</h2>
    <table>
      <tr><td>指标</td><td>均值</td><td>P95</td><td>范围</td></tr>
      <tr><td>视锥球幕覆盖率</td><td>${pct(c.mean)}</td><td>${pct(c.p95)}</td><td>${pct(c.min)} – ${pct(c.max)}</td></tr>
      <tr><td>与中央参考位视线偏移</td><td>${deg(o.mean)}</td><td>${deg(o.p95)}</td><td>${deg(o.min)} – ${deg(o.max)}</td></tr>
    </table>
    <div class="hint">分布读数，不是单一满意度分数——座位仍是 VenueConfig 参数化网格，非真实座位表；不含遮挡物；覆盖率不知道当前素材本身的 FOV。见「导出座位分析（CSV）」拿到逐座位明细。</div>
  `;
}

function runBatchAnalysis() {
  renderAnalysisSummary(runFullVenueAnalysis());
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function exportSeatCSV() {
  const result = runFullVenueAnalysis();
  renderAnalysisSummary(result); // keep the on-screen summary in sync with what got exported
  downloadBlob(new Blob([seatAnalysisToCSV(result)], { type: "text/csv;charset=utf-8" }), `spherelab-seat-analysis-${timestampForFilename()}.csv`);
}

function exportConfigJSON() {
  const payload = {
    exportedAt: new Date().toISOString(),
    venueConfig: cfg,
    contentManifest: {
      projection: params.contentProjection,
      hFovDeg: params.contentHFovDeg,
      vFovDeg: params.contentVFovDeg,
      yawOffsetDeg: params.contentYawOffsetDeg,
      pitchOffsetDeg: params.contentPitchOffsetDeg,
      hFlip: params.contentHFlip,
      vFlip: params.contentVFlip,
      colorSpace: params.contentColorSpace,
      originOffset: { x: params.contentOriginX, y: params.contentOriginY, z: params.contentOriginZ },
    },
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `spherelab-config-${timestampForFilename()}.json`);
}

function exportScreenshotPNG() {
  // Force one more render right before capture — animate()'s rAF loop keeps the buffer current,
  // but a render triggered synchronously from this click handler guarantees the frame in the
  // buffer matches the CURRENT camera/scene state at the instant of export (preserveDrawingBuffer
  // on the renderer, set at construction, is what makes the readback itself reliable — see above).
  renderer.render(bundle.scene, camera);
  renderer.domElement.toBlob((blob) => {
    if (!blob) {
      contentStatusEl.innerHTML = `<span class="err">截图导出失败：浏览器没能生成 PNG（canvas.toBlob 返回空）</span>`;
      return;
    }
    downloadBlob(blob, `spherelab-view-${timestampForFilename()}.png`);
  }, "image/png");
}

// ---------------------------------------------------------------------------
// GUI panel
// ---------------------------------------------------------------------------

const guiHandle = createGUIPanel({
  params,
  onMediaPlaneGeometryChange,
  onMediaPlaneCurvatureChange,
  onMaskUniformsChange,
  onVenueChange,
  onRequestFile: requestFile,
  onResetPlaceholder: resetPlaceholder,
  onTogglePlayback: togglePlayback,
  onRequestManifestFile: requestManifestFile,
  onContentParamsChange,
  onLedPixelateChange,
  onContentWarpChange,
  onPlacementModeChange,
  onProjectionChange,
  onToggleLayer,
  onRunBatchAnalysis: runBatchAnalysis,
  onExportSeatCSV: exportSeatCSV,
  onExportConfigJSON: exportConfigJSON,
  onExportScreenshot: exportScreenshotPNG,
});

updateStats();
// buildScene() constructed the media plane material directly with the placeholder texture (see
// `buildScene(cfg, placeholderTexture)` above), bypassing setTexture() entirely — call it once here
// so the initial page load also gets the flat transparent-ball placement-testing look instead of
// the placeholder's calibration grid at full opacity.
setTexture(placeholderTexture);
onPlacementModeChange(); // applies the default "修改模式" handle visibility explicitly

// ---------------------------------------------------------------------------
// Pointer inspector: yaw / pitch / ERP UV under the cursor
// ---------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const inspectorBody = document.getElementById("inspector-body")!;
const occlusionRaycaster = new THREE.Raycaster();

function contentRayDirection(localPos: THREE.Vector3, origin = new THREE.Vector3()): THREE.Vector3 {
  const rel = localPos.clone().sub(origin);
  const logicalRay = new THREE.Vector3(rel.x, rel.z, rel.y);
  return logicalRay.lengthSq() > 1e-12 ? logicalRay.normalize() : new THREE.Vector3(0, 0, 1);
}

function contentCameraBasis() {
  const forward = yawPitchToZUpDirection(params.contentYawOffsetDeg, params.contentPitchOffsetDeg);
  const worldUp = Math.abs(forward.z) > 0.98 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const right = new THREE.Vector3().crossVectors(worldUp, forward).normalize();
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();
  return { forward, right, up };
}

function applyContentFlips(u: number, v: number): { u: number; v: number } {
  return {
    u: params.contentHFlip ? 1 - u : u,
    v: params.contentVFlip ? 1 - v : v,
  };
}

/** Mirrors ERPMaskMaterial's fragment-shader content mapping in JS, so the inspector reads off
 *  the SAME sample the shader would take — including the current manifest's projection/origin/
 *  FOV/offset/flip — rather than the dome's own physical yaw/pitch (which is a different,
 *  unrelated direction whenever `originOffset` ≠ 0; see src/content/ERPManifest.ts). */
function computeContentUV(localPos: THREE.Vector3): { u: number; v: number; inBounds: boolean } {
  const origin = new THREE.Vector3(params.contentOriginX, params.contentOriginY, params.contentOriginZ);
  if (params.contentWarpToEye) {
    const eyeObjectSpace = referenceEyeWorldPosition()
      .sub(bundle.mediaPlaneMesh.position)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), -bundle.mediaPlaneMesh.rotation.x);
    origin.add(eyeObjectSpace);
  }
  const dContent = contentRayDirection(localPos, origin);

  if (params.contentProjection === "perspective") {
    const { forward, right, up } = contentCameraBasis();
    const zCam = dContent.dot(forward);
    const xCam = dContent.dot(right);
    const yCam = dContent.dot(up);
    if (zCam <= 1e-4) return { u: -1, v: -1, inBounds: false }; // behind the virtual camera
    const halfW = Math.tan(THREE.MathUtils.degToRad(params.contentHFovDeg) / 2);
    const halfH = Math.tan(THREE.MathUtils.degToRad(params.contentVFovDeg) / 2);
    const { u, v } = applyContentFlips(0.5 + xCam / zCam / (2 * halfW), 0.5 - yCam / zCam / (2 * halfH));
    return { u, v, inBounds: u >= 0 && u <= 1 && v >= 0 && v <= 1 };
  }

  if (params.contentProjection === "fisheyeEquidistant" || params.contentProjection === "fisheyeEquisolid" || params.contentProjection === "domemaster") {
    const { forward, right, up } =
      params.contentProjection === "domemaster"
        ? { forward: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) }
        : contentCameraBasis();
    const zCam = dContent.dot(forward);
    const xCam = dContent.dot(right);
    const yCam = dContent.dot(up);
    const theta = Math.acos(THREE.MathUtils.clamp(zCam, -1, 1));
    const xyLen = Math.hypot(xCam, yCam);
    const cosPhi = xyLen > 1e-6 ? xCam / xyLen : 0;
    const sinPhi = xyLen > 1e-6 ? yCam / xyLen : 0;
    const halfW = THREE.MathUtils.degToRad(params.contentHFovDeg) / 2;
    const halfH = THREE.MathUtils.degToRad(params.contentVFovDeg) / 2;
    const equisolid = params.contentProjection === "fisheyeEquisolid";
    const radial = equisolid ? Math.sin(theta / 2) : theta;
    const maxX = equisolid ? Math.sin(halfW / 2) : halfW;
    const maxY = equisolid ? Math.sin(halfH / 2) : halfH;
    const { u, v } = applyContentFlips(
      0.5 + 0.5 * (radial * cosPhi) / Math.max(maxX, 1e-5),
      0.5 - 0.5 * (radial * sinPhi) / Math.max(maxY, 1e-5),
    );
    return { u, v, inBounds: theta <= Math.max(halfW, halfH) + 1e-5 && u >= 0 && u <= 1 && v >= 0 && v <= 1 };
  }

  if (params.contentProjection === "cylindrical") {
    const { forward, right, up } = contentCameraBasis();
    const zCam = dContent.dot(forward);
    const xCam = dContent.dot(right);
    const yCam = dContent.dot(up);
    const horizontalLen = Math.hypot(xCam, zCam);
    if (horizontalLen <= 1e-5) return { u: -1, v: -1, inBounds: false };
    const yaw = Math.atan2(xCam, zCam);
    const halfW = THREE.MathUtils.degToRad(params.contentHFovDeg) / 2;
    const halfH = THREE.MathUtils.degToRad(params.contentVFovDeg) / 2;
    const { u, v } = applyContentFlips(
      0.5 + yaw / Math.max(THREE.MathUtils.degToRad(params.contentHFovDeg), 1e-5),
      0.5 - (yCam / horizontalLen) / (2 * Math.tan(Math.max(halfH, 1e-5))),
    );
    return { u, v, inBounds: u >= 0 && u <= 1 && v >= 0 && v <= 1 };
  }

  const { yawDeg, pitchDeg } = zUpDirectionToYawPitch(dContent);
  const cYawDeg = wrapYawDeg(yawDeg - params.contentYawOffsetDeg);
  const cPitchDeg = pitchDeg - params.contentPitchOffsetDeg;
  let u = 0.5 + cYawDeg / params.contentHFovDeg;
  let v = 0.5 - cPitchDeg / params.contentVFovDeg;
  ({ u, v } = applyContentFlips(u, v));
  return { u, v, inBounds: u >= 0 && u <= 1 && v >= 0 && v <= 1 };
}

/** Eq. (7)'s "检查场馆遮挡物是否在 e 与 p 之间" — casts a ray from `eye` toward `p` and stops just
 *  short of `p` itself, checking only the venue's solid occluders (stage platform, seat blocks,
 *  rear control box — see VenueGeometry.ts `occluderMeshes`). Not the ground disc or shell (a
 *  sightline to the dome isn't expected to pass through either), and there's no rigging/hanging-
 *  object geometry yet to check against (see docs/HANDOFF_CHECKLIST.md D-09). */
function checkOcclusion(eye: THREE.Vector3, p: THREE.Vector3): boolean {
  const toP = p.clone().sub(eye);
  const dist = toP.length();
  if (dist < 1e-4) return false;
  const dir = toP.normalize();
  occlusionRaycaster.set(eye, dir);
  occlusionRaycaster.near = 0.05;
  occlusionRaycaster.far = Math.max(0.05, dist - 0.05);
  return occlusionRaycaster.intersectObjects(bundle.venue.occluderMeshes, false).length > 0;
}

renderer.domElement.addEventListener("pointermove", (ev) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObject(bundle.mediaPlaneMesh, false);
  if (hits.length === 0 || !bundle.mediaPlaneMesh.visible) {
    inspectorBody.innerHTML = `<span class="miss">移动鼠标到球幕上查看 yaw / pitch / 素材采样 UV</span>`;
    if (!params.showRayDiagram) return;
    rayDiagram.group.visible = false;
    return;
  }
  const hit = hits[0];
  const local = bundle.mediaPlaneMesh.worldToLocal(hit.point.clone());
  const physicalDirection = contentRayDirection(local);
  const { yawDeg, pitchDeg } = zUpDirectionToYawPitch(physicalDirection);
  const { u, v, inBounds } = computeContentUV(local);
  inspectorBody.innerHTML = `
    <div class="row"><span>偏航角 yaw（球幕物理方向）</span><span>${yawDeg.toFixed(1)}°</span></div>
    <div class="row"><span>俯仰角 pitch（球幕物理方向）</span><span>${pitchDeg.toFixed(1)}°</span></div>
    <div class="row"><span>素材采样 u,v</span><span>${u.toFixed(3)}, ${v.toFixed(3)}${inBounds ? "" : " （超出素材视场）"}</span></div>
    <div class="row"><span>距离</span><span>${hit.distance.toFixed(1)} m</span></div>
  `;

  if (params.showRayDiagram) {
    const occluded = checkOcclusion(camera.position, hit.point);
    rayDiagram.update(camera.position, hit.point, contentOriginMarker.position, occluded);
    rayDiagram.group.visible = true;
  } else {
    rayDiagram.group.visible = false;
  }
});

renderer.domElement.addEventListener("pointerleave", () => {
  rayDiagram.group.visible = false;
});

// ---------------------------------------------------------------------------
// Resize + render loop
// ---------------------------------------------------------------------------

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const loadingEl = document.getElementById("loading")!;
loadingEl.style.opacity = "0";
setTimeout(() => loadingEl.remove(), 350);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(bundle.scene, camera);
}
animate();
