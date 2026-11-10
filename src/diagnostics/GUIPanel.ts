import GUI, { Controller } from "lil-gui";
import { ERPProjection, SUPPORTED_PROJECTIONS } from "../content/ERPManifest";
import { mediaPlaneCurvatureForSphere } from "../core/MediaPlaneGeometry";

export type DiagnosticsLayerKey =
  | "mediaPlane"
  | "nonScreenArea"
  | "referenceSphere"
  | "boundary"
  | "grid"
  | "centerMarker"
  | "axesHelper"
  | "innerAxesHelper"
  | "contentOrigin"
  | "eyePosition"
  | "rayDiagram"
  | "stageArrow"
  | "audienceMarkers"
  | "venue";

export interface GUIParams {
  radius: number;
  curvature: number;
  centerHeight: number;
  // 内屏（Media Plane）水平偏移。X 固定在外球幕中心线，Z 仍可用滑杆/拖拽调整；内屏还可以
  // 在 3D 视口里直接拖拽高度和前后位置，见 main.ts
  // "内屏摆放：拖拽移动中心" 与 docs/SCREEN_DECOUPLING_DESIGN.md。
  centerOffsetX: number;
  audienceOffsetY: number;
  centerOffsetZ: number;
  /** 内屏俯仰角（仰角）——绕局部 X 轴的刚体旋转，度，正值抬高正前方仰角。三个"中心/半径"字段是
   *  纯平移，这个是内屏第一个真正的旋转自由度，见 core/VenueConfig.ts MediaPlaneConfig.tiltDeg。 */
  tiltDeg: number;
  featherDeg: number;
  maskFront: number;
  maskSide: number;
  maskRear: number;
  opacity: number;
  stageWidth: number;
  stageDepth: number;
  stageVisible: boolean;
  audienceInner: number;
  audienceOuter: number;
  eyeHeight: number;
  riseHeight: number;
  shellRadius: number;
  /** 外屏自己的中心高度——独立于内屏的 centerHeight（否则拖内屏高度会连带把"只能参数化固定"的
   *  外屏也移动，见 docs/SCREEN_DECOUPLING_DESIGN.md C-08）。只能通过这个滑杆调，不可拖拽。 */
  buildingCenterHeight: number;
  // 素材参数 / manifest（见 src/content/ERPManifest.ts）：projection 声明 2D 素材的预变形格式；
  // FOV/朝向/原点保持同一套控制，用来公平比较 ERP、鱼眼、柱面、透视等输出。
  contentProjection: ERPProjection;
  contentHFovDeg: number;
  contentVFovDeg: number;
  contentYawOffsetDeg: number;
  contentPitchOffsetDeg: number;
  contentHFlip: boolean;
  contentVFlip: boolean;
  contentColorSpace: "srgb" | "linear";
  contentOriginX: number;
  contentOriginY: number;
  contentOriginZ: number;
  showReferenceSphere: boolean;
  showMediaPlane: boolean;
  showNonScreenArea: boolean;
  showBoundary: boolean;
  showGrid: boolean;
  showCenterMarker: boolean;
  showAxesHelper: boolean;
  showInnerAxesHelper: boolean;
  showContentOrigin: boolean;
  showEyePosition: boolean;
  showRayDiagram: boolean;
  showStageArrow: boolean;
  showAudienceMarkers: boolean;
  showVenue: boolean;
  // LED 像素化预览（诊断专用，见 ERPMaskMaterial.ts 顶部注释）：把内容采样方向吸附到
  // (ledCountX × ledCountY) 网格的格心，同一格内所有像素强制取同一个颜色，模拟"一整颗 LED 只发一个
  // 颜色"而不是现有连续插值贴图。密度是可视化验证用的旋钮，不代表场馆真实像素间距。
  ledPixelateEnabled: boolean;
  ledCountX: number;
  ledCountY: number;
  // 屏幕位置几何校正（见 materials/ERPMaskMaterial.ts `setWarpToReferenceEye`）：内屏偏心时，是否
  // 按固定的观众参考眼位重新计算内容方向，而不是内容刚性跟着内屏一起平移。默认关闭。
  contentWarpToEye: boolean;
  /** 修改模式（可拖拽 + 滑杆改参数）/ 预演模式（拖拽 handle 隐藏，滑杆仍可改参数）。
   *  外屏/观众席/舞台永远只能滑杆调，不受这个开关影响。 */
  placementMode: "edit" | "preview";
  ledPixelPitchMm: number;
  ledPackageType: string;
  ledMountingMethod: string;
  ledContrastRatio: number;
  ledBrightnessNits: number;
  ledRefreshRateHz: number;
  ledGrayscaleBits: number;
  ledReflectancePct: number;
  ledColorTempMinK: number;
  ledColorTempMaxK: number;
  ledAveragePowerWPerM2: number;
  ledMaximumPowerWPerM2: number;
  ledViewingAngleH: number;
  ledViewingAngleV: number;
  ledLifetimeHours: number;
  signalFrameRateFps: number;
  signalScanMode: string;
  signalBitDepth: number;
  signalChroma: string;
  signalColorGamut: string;
  signalGamma: number;
  signalAudioContainer: string;
  signalAudioChannels: string;
  signalAudioFormat: string;
  signalLoudnessLufs: number;
}

export interface GUIPanelDeps {
  params: GUIParams;
  onMediaPlaneGeometryChange: () => void;
  onMediaPlaneCurvatureChange: () => void;
  onMaskUniformsChange: () => void;
  onVenueChange: () => void;
  /** Loads a video/image/EXR/HDR onto the dome — equirectangular panorama or a flat perspective
   *  render, per the projection selected in 素材参数 below. */
  onRequestFile: () => void;
  onResetPlaceholder: () => void;
  onTogglePlayback: () => void;
  /** Opens the unified JSON/MAX venue and content parameter picker. */
  onRequestManifestFile: () => void;
  /** Opens a file picker for the JSON produced by "导出当前配置（JSON）" and restores both
   *  venueConfig and contentManifest from that same envelope. */
  onRequestConfigFile: () => void;
  /** Camera locations are editable, user-managed viewpoints shown in the right panel. */
  cameraLocations: CameraLocationGUI[];
  onCameraLocationChange: (location: CameraLocationGUI) => void;
  onSelectCameraLocation: (id: string) => void;
  onAddCameraLocation: () => void;
  onRemoveCameraLocation: (id: string) => void;
  onToggleDefaultCameras: (visible: boolean) => void;
  /** Any 素材参数 slider/dropdown changed — geometric mapping (FOV/offset/flip/origin) applies
   *  live to the shader; colorSpace applies to the currently-loaded texture. Both are cheap, so
   *  one combined handler covers every field instead of six near-identical callbacks. */
  onContentParamsChange: () => void;
  /** LED 像素化预览的启用状态或网格密度变了——纯 uniform 写入，实时生效。 */
  onLedPixelateChange: () => void;
  /** "屏幕位置几何校正" 开关变了——纯 uniform 写入，实时生效。 */
  onContentWarpChange: () => void;
  /** 修改模式 / 预演模式切换了——main.ts 负责隐藏/显示 3D 拖拽 handle、更新模式状态与外观。 */
  onPlacementModeChange: () => void;
  onDisplaySpecChange: () => void;
  /** The 投影类型 dropdown changed. Separate from `onContentParamsChange` because switching
   *  projection also re-seeds hFov/vFov to a sane default for the NEW mode — see
   *  main.ts `onProjectionChange`. */
  onProjectionChange: (projection: ERPProjection) => void;
  /** Routed through main.ts so toggles always act on the CURRENT scene objects, even after a
   *  geometry/venue rebuild replaces the underlying Object3D instances. */
  onToggleLayer: (key: DiagnosticsLayerKey, visible: boolean) => void;
  /** Runs SeatMetrics.ts `runBatchSeatAnalysis` over every representative seat and renders a
   *  summary into `#analysis-info` (see main.ts) — the "分析工具" half of the module checklist. */
  onRunBatchAnalysis: () => void;
  /** Re-runs the batch analysis fresh and downloads it as CSV (one row per seat). */
  onExportSeatCSV: () => void;
  /** Downloads the current VenueConfig + content manifest as one JSON file. */
  onExportConfigJSON: () => void;
  /** Downloads the current 3D view as a PNG screenshot. */
  onExportScreenshot: () => void;
  /** Downloads the current content converted to a standard 2:1 equirectangular PNG. */
  onExportAdjustedERP: () => void;
  /** Records the current video after converting it to a standard 2:1 ERP video. */
  onExportAdjustedVideo: () => void;
}

export interface CameraLocationGUI {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  fov: number;
  visible: boolean;
  isDefault: boolean;
}

export interface GUIPanelHandle {
  gui: GUI;
  refreshCameraLocations: () => void;
  /** Call after programmatically overwriting `params.content*` (e.g. a manifest.json just loaded)
   *  so the sliders/dropdowns reflect the new values — lil-gui doesn't watch the bound object. */
  refreshContentControllers: () => void;
  /** Refreshes every visible controller after a configuration file replaces multiple params. */
  refreshAllControllers: () => void;
}

export function createGUIPanel(deps: GUIPanelDeps): GUIPanelHandle {
  const gui = new GUI({ title: "SphereLab · 控制面板" });
  // Starts collapsed to just the title bar — a fully expanded panel (5 folders, 30+ controls) eats
  // a big chunk of the right side of the viewport, and the first thing a user should see is the
  // clean media plane (see main.ts params comment), not a wall of sliders. Click the title bar to
  // expand; lil-gui remembers each folder's own open/closed state independently of this.
  gui.close();
  const p = deps.params;

  // 载入一份等距柱状（ERP）全景视频/图片直接贴到球幕；未加载时显示程序生成的校准占位图。
  const content = gui.addFolder("素材 / 占位图").open();
  content.add({ load: deps.onRequestFile }, "load").name("载入素材（视频 / 图片 / EXR / HDR）");
  content.add({ loadParameters: deps.onRequestManifestFile }, "loadParameters").name("载入场馆 / 素材参数（JSON / MAX）…");
  content.add({ reset: deps.onResetPlaceholder }, "reset").name("恢复占位校准图");
  content.add({ toggle: deps.onTogglePlayback }, "toggle").name("播放 / 暂停视频");

  const cameras = gui.addFolder("摄像机位置").close();
  cameras.add({ add: deps.onAddCameraLocation }, "add").name("新增摄像机位置");
  const defaultCameraVisibility = { visible: deps.cameraLocations.some((camera) => camera.isDefault && camera.visible) };
  cameras
    .add(defaultCameraVisibility, "visible")
    .name("显示默认摄像机")
    .onChange((visible: boolean) => deps.onToggleDefaultCameras(visible));
  const cameraControllers: Controller[] = [];
  const cameraFolders: GUI[] = [];

  const addVectorRow = (
    folder: GUI,
    label: string,
    fields: ["x", "y", "z"] | ["targetX", "targetY", "targetZ"],
    location: CameraLocationGUI,
    notify: () => void,
  ) => {
    const children = folder.domElement.querySelector(".children");
    if (!children) return;
    const row = document.createElement("div");
    row.className = "controller camera-vector-row";
    const labelEl = document.createElement("span");
    labelEl.className = "name";
    labelEl.textContent = label;
    row.appendChild(labelEl);
    for (const field of fields) {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.value = String(location[field]);
      input.title = field;
      input.addEventListener("change", () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        location[field] = value;
        notify();
      });
      row.appendChild(input);
    }
    children.appendChild(row);
  };

  const renderCameraLocations = () => {
    defaultCameraVisibility.visible = deps.cameraLocations.some((camera) => camera.isDefault && camera.visible);
    for (const controller of cameraControllers.splice(0)) controller.destroy();
    for (const folder of cameraFolders.splice(0)) folder.destroy();
    for (const location of deps.cameraLocations) {
      const folder = cameras.addFolder(location.label || "未命名摄像机").close();
      cameraFolders.push(folder);
      const notify = () => deps.onCameraLocationChange(location);
      cameraControllers.push(
        folder.add(location, "visible").name("启用").onChange(notify),
        folder.add(location, "label").name("名称").onFinishChange(notify),
        folder.add(location, "fov").name("视场 FOV（°）").onFinishChange(notify),
      );
      addVectorRow(folder, "位置 XYZ（m）", ["x", "y", "z"], location, notify);
      addVectorRow(folder, "目标 XYZ（m）", ["targetX", "targetY", "targetZ"], location, notify);
      const actions = document.createElement("div");
      actions.className = "camera-actions-row";
      const select = document.createElement("button");
      select.type = "button";
      select.textContent = "选中";
      select.addEventListener("click", () => deps.onSelectCameraLocation(location.id));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "删除此摄像机";
      remove.addEventListener("click", () => deps.onRemoveCameraLocation(location.id));
      actions.append(select, remove);
      folder.domElement.querySelector(".children")?.appendChild(actions);
    }
  };
  renderCameraLocations();

  // 素材参数 / 清单（Manifest）：投影类型描述 2D 素材自身的预变形格式；同一批 FOV/朝向/原点参数
  // 会按该格式解释，便于把 ERP、鱼眼、柱面等离线变形结果投到同一个 3D 球幕上比较。
  const manifest = gui.addFolder("素材参数（清单）");
  manifest.add(p, "contentProjection", [...SUPPORTED_PROJECTIONS]).name("投影类型").onChange(deps.onProjectionChange);
  const contentControllers: Controller[] = [
    manifest.add(p, "contentHFovDeg", 1, 360, 1).name("水平视场 FOV（°）").onChange(deps.onContentParamsChange),
    manifest.add(p, "contentVFovDeg", 1, 180, 1).name("垂直视场 FOV（°）").onChange(deps.onContentParamsChange),
    manifest.add(p, "contentHFlip").name("水平镜像翻转").onChange(deps.onContentParamsChange),
    manifest.add(p, "contentVFlip").name("垂直镜像翻转（上下颠倒）").onChange(deps.onContentParamsChange),
    manifest.add(p, "contentColorSpace", ["srgb", "linear"]).name("色彩解释").onChange(deps.onContentParamsChange),
    manifest.add(p, "contentOriginX", -10, 10, 0.1).name("参考原点 / 相机位置 X（m）").onChange(deps.onContentParamsChange),
    manifest.add(p, "contentOriginY", -10, 10, 0.1).name("参考原点 / 相机位置 Y（m）").onChange(deps.onContentParamsChange),
    manifest.add(p, "contentOriginZ", -10, 10, 0.1).name("参考原点 / 相机位置 Z（m）").onChange(deps.onContentParamsChange),
  ];

  // Keep the two most common framing controls in their own open folder so operators can move the
  // projected video without hunting through the manifest/technical settings. These are angular
  // content offsets, not physical movement of the dome or the audience camera.
  const contentOffset = gui.addFolder("画面角度偏移").open();
  const contentOffsetControllers: Controller[] = [
    contentOffset
      .add(p, "contentYawOffsetDeg", -180, 180, 1)
      .name("水平偏移 Horizon / Yaw（°）")
      .onChange(deps.onContentParamsChange),
    contentOffset
      .add(p, "contentPitchOffsetDeg", -90, 90, 1)
      .name("垂直偏移 Vertical / Pitch（°）")
      .onChange(deps.onContentParamsChange),
  ];

  // LED 像素化预览（诊断）：验证"每个采样格实际会显示什么颜色"是否合理，而不是看连续贴图永远看不出
  // 颗粒感的平滑结果。密度默认给一个肉眼能看出马赛克块的值；高密度按钮用于快速对比连续贴图观感。
  const ledPixelate = gui.addFolder("LED 像素化预览（诊断）");
  const ledControllers: Controller[] = [];
  ledControllers.push(
    ledPixelate.add(p, "ledPixelateEnabled").name("启用").onChange(deps.onLedPixelateChange),
    ledPixelate.add(p, "ledCountX", 4, 4096, 1).name("采样列数（横跨 360°）").onChange(deps.onLedPixelateChange),
    ledPixelate.add(p, "ledCountY", 4, 2048, 1).name("采样行数（横跨 180°）").onChange(deps.onLedPixelateChange),
  );
  ledPixelate
    .add(
      {
        snapToHighDensity: () => {
          p.ledCountX = 4096;
          p.ledCountY = 2048;
          for (const c of ledControllers) c.updateDisplay();
          deps.onLedPixelateChange();
        },
      },
      "snapToHighDensity",
    )
    .name("跳到高密度 4096×2048");

  const mask = gui.addFolder("球幕几何与 Mask");
  // 修改模式（可拖拽 + 滑杆都能改参数）/ 预演模式（3D 拖拽 handle 隐藏，但滑杆仍可改参数）——
  // 外屏/观众席/舞台的滑杆不受这个开关影响，永远可调。
  mask
    .add(p, "placementMode", { 修改模式: "edit", 预演模式: "preview" })
    .name("内屏模式")
    .onChange(() => {
      deps.onPlacementModeChange();
    });
  // 内屏摆放——只在修改模式下可拖拽：橙色球（圆圈）贴着屏幕平面拖动球心高度和前后位置（Y/Z；
  // X 轴仍由上面的滑杆精确控制，见
  // main.ts pointermove 里的"camera-facing drag plane"实现——不是老版本那种水平面求交，不会有
  // 前后跳动/看起来变大变小的问题），橙色圆锥（三角，跟圆圈放在一起，不在球面边缘）拖动改俯仰角/
  // 仰角（tiltDeg，绕局部 X 轴的刚体旋转）。半径只能用滑杆调，没有对应的拖拽 handle（半径拖拽
  // handle 试过又按反馈去掉了，3D 视口里只保留这两个 handle，不再堆第三个）。这里只建模球体/椭球体：
  // 半径控制内球幕局部 X'/Y' 中心圆截面；曲率换算成独立的 Z' 穹顶半径，仰角只负责刚体转动这套局部坐标。
  const mediaPlaneControllers: Controller[] = [
    mask.add(p, "radius", 10, 60, 0.5).name("水平截面半径（m）").onChange(deps.onMediaPlaneGeometryChange),
    mask.add(p, "curvature", 2, 100, 0.1).name("穹顶曲率（1/km）").onChange(deps.onMediaPlaneCurvatureChange),
    mask.add(p, "centerHeight", 0, 30, 0.5).name("球心高度（m，或拖圆圈）").onChange(deps.onMediaPlaneGeometryChange),
    mask.add(p, "centerOffsetZ", -20, 20, 0.5).name("球心前后偏移 Y（m，或拖圆圈）").onChange(deps.onMediaPlaneGeometryChange),
    mask.add(p, "tiltDeg", -80, 80, 1).name("俯仰角 / 仰角（°，或拖三角）").onChange(deps.onMediaPlaneGeometryChange),
  ];
  mask
    .add(
      {
        matchSphere: () => {
          p.curvature = mediaPlaneCurvatureForSphere(p.radius);
          for (const c of mediaPlaneControllers) c.updateDisplay();
          deps.onMediaPlaneCurvatureChange();
        },
      },
      "matchSphere",
    )
    .name("匹配为球体（垂直 = 截面）");
  // 内屏偏心后，是否按固定的观众参考眼位重新计算内容方向（几何校正），而不是内容刚性跟着内屏一起
  // 平移——见 materials/ERPMaskMaterial.ts `setWarpToReferenceEye` 与
  // docs/SCREEN_DECOUPLING_DESIGN.md「内屏偏心与观众视觉校正」。默认关闭。
  mask.add(p, "contentWarpToEye").name("按观众参考眼位校正内容（几何校正）").onChange(deps.onContentWarpChange);
  mask.add(p, "maskFront", -90, 30, 1).name("正前方下边界（yaw 0°）").onChange(deps.onMaskUniformsChange);
  mask.add(p, "maskSide", -90, 45, 1).name("两侧下边界（yaw 90°）").onChange(deps.onMaskUniformsChange);
  mask.add(p, "maskRear", -90, 60, 1).name("后方下边界（yaw 180°）").onChange(deps.onMaskUniformsChange);
  mask.add(p, "featherDeg", 0, 10, 0.1).name("Mask 羽化宽度（度）").onChange(deps.onMaskUniformsChange);
  mask.add(p, "opacity", 0, 1, 0.01).name("球幕不透明度").onChange(deps.onMaskUniformsChange);

  const venue = gui.addFolder("场馆几何");
  venue.add(p, "audienceOffsetY", -20, 20, 0.5).name("观众席+前后舞台偏移 Y（m）").onChange(deps.onVenueChange);
  venue.add(p, "stageWidth", 8, 40, 1).name("舞台宽度（m）").onChange(deps.onVenueChange);
  venue.add(p, "stageDepth", 4, 20, 1).name("舞台进深（m）").onChange(deps.onVenueChange);
  venue.add(p, "stageVisible").name("显示前方舞台").onChange(deps.onVenueChange);
  venue.add(p, "audienceInner", 4, 20, 0.5).name("观众席内径（m）").onChange(deps.onVenueChange);
  venue.add(p, "audienceOuter", 12, 40, 0.5).name("观众席外径（m）").onChange(deps.onVenueChange);
  venue.add(p, "riseHeight", 0, 15, 0.5).name("观众席抬升高度（m）").onChange(deps.onVenueChange);
  venue.add(p, "eyeHeight", 0.8, 1.6, 0.05).name("观众眼高（m）").onChange(deps.onVenueChange);
  venue.add(p, "shellRadius", 25, 70, 1).name("建筑外壳半径（m）").onChange(deps.onVenueChange);
  venue.add(p, "buildingCenterHeight", 0, 30, 0.5).name("外壳中心高度（m）").onChange(deps.onVenueChange);

  const diag = gui.addFolder("诊断图层");
  diag.add(p, "showMediaPlane").name("实际球幕（Media Plane）").onChange((v: boolean) => deps.onToggleLayer("mediaPlane", v));
  diag.add(p, "showNonScreenArea").name("非显示区域").onChange((v: boolean) => deps.onToggleLayer("nonScreenArea", v));
  diag.add(p, "showReferenceSphere").name("参考球体").onChange((v: boolean) => deps.onToggleLayer("referenceSphere", v));
  diag.add(p, "showBoundary").name("屏幕边界线").onChange((v: boolean) => deps.onToggleLayer("boundary", v));
  diag.add(p, "showGrid").name("Yaw / Pitch 网格").onChange((v: boolean) => deps.onToggleLayer("grid", v));
  diag.add(p, "showCenterMarker").name("球心标记").onChange((v: boolean) => deps.onToggleLayer("centerMarker", v));
  diag.add(p, "showAxesHelper").name("世界 XYZ 辅助线").onChange((v: boolean) => deps.onToggleLayer("axesHelper", v));
  diag.add(p, "showInnerAxesHelper").name("内球幕 X'Y'Z' 辅助线").onChange((v: boolean) => deps.onToggleLayer("innerAxesHelper", v));
  diag
    .add(p, "showContentOrigin")
    .name("内容原点标记")
    .onChange((v: boolean) => deps.onToggleLayer("contentOrigin", v));
  diag
    .add(p, "showEyePosition")
    .name("当前眼位标记")
    .onChange((v: boolean) => deps.onToggleLayer("eyePosition", v));
  diag
    .add(p, "showRayDiagram")
    .name("视线示意（射线 + 采样方向）")
    .onChange((v: boolean) => deps.onToggleLayer("rayDiagram", v));
  diag.add(p, "showStageArrow").name("舞台方向箭头").onChange((v: boolean) => deps.onToggleLayer("stageArrow", v));
  diag
    .add(p, "showAudienceMarkers")
    .name("观众前方 / 后方标注")
    .onChange((v: boolean) => deps.onToggleLayer("audienceMarkers", v));
  diag.add(p, "showVenue").name("场馆（舞台/座席/外壳）").onChange((v: boolean) => deps.onToggleLayer("venue", v));

  // 分析 / 导出：批量跑一遍全场代表性座位（VenueGeometry.ts seatMeta）的视锥覆盖率 + 视线偏移，
  // 汇总成分布（均值/P95/极值，不是单一平均分——见 SeatMetrics.ts）；导出走纯前端下载，没有后端。
  const analysis = gui.addFolder("分析 / 导出");
  analysis.add({ run: deps.onRunBatchAnalysis }, "run").name("运行全场座位分析");
  analysis.add({ exportCsv: deps.onExportSeatCSV }, "exportCsv").name("导出座位分析（CSV）");
  analysis.add({ exportCfg: deps.onExportConfigJSON }, "exportCfg").name("导出当前配置（JSON）");
  analysis.add({ exportERP: deps.onExportAdjustedERP }, "exportERP").name("导出调整后 ERP（PNG）");
  analysis.add({ exportVideo: deps.onExportAdjustedVideo }, "exportVideo").name("导出 ERP 视频（MP4）");
  analysis.add({ exportPng: deps.onExportScreenshot }, "exportPng").name("导出当前视角截图（PNG）");

  const ledSpec = gui.addFolder("LED 设备规格").close();
  ledSpec.add(p, "ledPixelPitchMm", 0.1, 20, 0.01).name("物理点间距（mm）").onChange(deps.onDisplaySpecChange);
  ledSpec.add(p, "ledPackageType").name("LED 封装").onChange(deps.onDisplaySpecChange);
  ledSpec.add(p, "ledMountingMethod").name("模组固定方式").onChange(deps.onDisplaySpecChange);
  ledSpec.add(p, "ledContrastRatio", 1, 100000, 1).name("对比度").onChange(deps.onDisplaySpecChange);
  ledSpec.add(p, "ledBrightnessNits", 0, 5000, 1).name("白平衡亮度（nits）").onChange(deps.onDisplaySpecChange);
  ledSpec.add(p, "ledRefreshRateHz", 1, 20000, 1).name("刷新频率（Hz）").onChange(deps.onDisplaySpecChange);
  ledSpec.add(p, "ledGrayscaleBits", 1, 24, 1).name("灰度位深（bit）").onChange(deps.onDisplaySpecChange);
  ledSpec.add(p, "ledReflectancePct", 0, 100, 0.1).name("表面反光率（%）").onChange(deps.onDisplaySpecChange);
  ledSpec.add(p, "ledColorTempMinK", 1000, 20000, 100).name("色温下限（K）").onChange(deps.onDisplaySpecChange);
  ledSpec.add(p, "ledColorTempMaxK", 1000, 20000, 100).name("色温上限（K）").onChange(deps.onDisplaySpecChange);
  ledSpec.add(p, "ledAveragePowerWPerM2", 0, 1000, 1).name("平均功耗（W/m²）").onChange(deps.onDisplaySpecChange);
  ledSpec.add(p, "ledMaximumPowerWPerM2", 0, 2000, 1).name("最大功耗（W/m²）").onChange(deps.onDisplaySpecChange);
  ledSpec.add(p, "ledViewingAngleH", 0, 180, 1).name("水平可视角（°）").onChange(deps.onDisplaySpecChange);
  ledSpec.add(p, "ledViewingAngleV", 0, 180, 1).name("垂直可视角（°）").onChange(deps.onDisplaySpecChange);
  ledSpec.add(p, "ledLifetimeHours", 0, 200000, 1000).name("LED 寿命（小时）").onChange(deps.onDisplaySpecChange);

  const signalSpec = gui.addFolder("视频 / 音频信号规格").close();
  signalSpec.add(p, "signalFrameRateFps", 1, 240, 0.01).name("视频帧率（FPS）").onChange(deps.onDisplaySpecChange);
  signalSpec.add(p, "signalScanMode").name("扫描方式").onChange(deps.onDisplaySpecChange);
  signalSpec.add(p, "signalBitDepth", 1, 32, 1).name("位深（bit）").onChange(deps.onDisplaySpecChange);
  signalSpec.add(p, "signalChroma").name("色度采样").onChange(deps.onDisplaySpecChange);
  signalSpec.add(p, "signalColorGamut").name("色域").onChange(deps.onDisplaySpecChange);
  signalSpec.add(p, "signalGamma", 0.1, 5, 0.01).name("Gamma").onChange(deps.onDisplaySpecChange);
  signalSpec.add(p, "signalAudioContainer").name("音频封装").onChange(deps.onDisplaySpecChange);
  signalSpec.add(p, "signalAudioChannels").name("音频声道").onChange(deps.onDisplaySpecChange);
  signalSpec.add(p, "signalAudioFormat").name("音频规格").onChange(deps.onDisplaySpecChange);
  signalSpec.add(p, "signalLoudnessLufs", -60, 0, 0.1).name("响度（LUFS）").onChange(deps.onDisplaySpecChange);

  // 只读的 3ds Max 场景信息放在所有可编辑控制项之后，作为参数参考目录。
  // 当前 WebGL 预演器不直接复现 Corona 材质，因此不会把这些说明误认为可编辑参数。
  const addReadOnly = (folder: GUI, label: string, value: string) => {
    const controller = folder.add({ value }, "value").name(label);
    controller.disable();
  };
  const maxScene = gui.addFolder("3ds Max 场景信息").close();
  const sceneInfo = maxScene.addFolder("场景与文件").close();
  addReadOnly(sceneInfo, "3ds Max 版本", "24.00");
  addReadOnly(sceneInfo, "Build", "24.3.0.3404");
  addReadOnly(sceneInfo, "顶点数", "6785");
  addReadOnly(sceneInfo, "场景状态集", "State01");
  addReadOnly(sceneInfo, "渲染器", "Corona 11");
  addReadOnly(sceneInfo, "动画范围", "第 0 帧 – 第 0 帧（静帧）");

  const outputInfo = maxScene.addFolder("渲染输出").close();
  addReadOnly(outputInfo, "输出尺寸", "4000 × 2000 px");
  addReadOnly(outputInfo, "文件格式", "TGA");
  addReadOnly(outputInfo, "输出路径模板", "renderoutput\\<StateName>\\<StateName>_output.tga");
  addReadOnly(outputInfo, "渲染相机", "Camera001、Camera002、Camera003、Camera004、Camera005");

  const materialInfo = maxScene.addFolder("材质参数目录").close();
  addReadOnly(materialInfo, "材质类型", "Physical Material、CoronaLightMtl、Standard Material");
  addReadOnly(materialInfo, "基础与表面", "Base Color、Metalness、Roughness、Reflection、Refraction、IOR、Opacity、Glossiness、Anisotropy、Anisotropy Rotation");
  addReadOnly(materialInfo, "高级表面", "Clearcoat、Sheen、SSS、Volume Absorption、Volume Scattering、Bump、Displacement、Self-Illumination");
  addReadOnly(materialInfo, "材质贴图", "色彩、透明度、反射、折射贴图");

  const textureInfo = maxScene.addFolder("纹理与贴图参数").close();
  addReadOnly(textureInfo, "坐标变换", "U/V Offset、U/V Tiling、U/V/W Angle");
  addReadOnly(textureInfo, "纹理处理", "Blur、Noise Amount、Noise Size、Noise Levels、Phase");
  addReadOnly(textureInfo, "输出控制", "RGB Level、RGB Offset、Output Amount、Bump Amount");
  addReadOnly(textureInfo, "裁切与抖动", "Clip U/V Offset、Clip U/V Width、Jitter Placement");

  const coronaInfo = maxScene.addFolder("Corona 灯光参数").close();
  addReadOnly(coronaInfo, "光源属性", "Intensity、Color、Directionality");
  addReadOnly(coronaInfo, "发光方式", "Emit Light、Emit on Both Sides");
  addReadOnly(coronaInfo, "可见性", "显示在反射中、显示在折射中、直接可见、参与焦散");
  addReadOnly(coronaInfo, "遮挡与透明度", "遮挡其他灯光、可见性与透明度控制");

  const refreshContentControllers = () => {
    for (const c of contentControllers) c.updateDisplay();
    for (const c of contentOffsetControllers) c.updateDisplay();
  };
  const refreshAllControllers = () => {
    for (const c of gui.controllersRecursive()) c.updateDisplay();
  };
  return { gui, refreshCameraLocations: renderCameraLocations, refreshContentControllers, refreshAllControllers };
}
