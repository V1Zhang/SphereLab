# SphereLab 架构

SphereLab 是一个纯前端球幕预演器：用 three.js 渲染参数化场馆、内屏 Media Plane、素材映射、诊断图层和多座位视角分析。没有后端，也不依赖外部服务。

试用步骤见 [`USAGE.md`](./USAGE.md)，阶段规划见 [`ROADMAP.md`](./ROADMAP.md)，场馆数据对接字段见 [`HANDOFF_CHECKLIST.md`](./HANDOFF_CHECKLIST.md)。

## 数据流

```
媒体文件 + 可选 manifest.json
  -> 素材参数解析（projection / FOV / 朝向 / 镜像 / 色彩 / 内容原点）
  -> 内容方向采样（ERP / perspective / fisheye / domemaster / cylindrical）
  -> Media Plane Mask
  -> 3D 球幕预演、座位视角、诊断与导出
```

媒体文件和清单是两个独立输入。清单只描述“这份素材该如何采样”，不描述真实场馆工程参数。

## 主要模块

| 模块 | 文件 | 作用 |
|---|---|---|
| 场馆参数 | `src/core/VenueConfig.ts` | 当前参数化场馆配置：内屏、舞台、观众席、外壳、占位内容尺寸。 |
| Screen Mask | `src/core/ScreenMask.ts` | 用控制点生成内屏有效显示区域边界，并提供面积/覆盖率估算。 |
| Media Plane 几何 | `src/core/MediaPlaneGeometry.ts` | 构建球幕网格，半径和曲率可调。 |
| 场馆几何 | `src/core/VenueGeometry.ts` | 构建舞台、观众席、代表性座位、外壳和可用于遮挡判定的几何。 |
| 座位指标 | `src/core/SeatMetrics.ts` | 单座位覆盖率、视线偏移、批量座位分析和 CSV 序列化。 |
| 素材清单 | `src/content/ERPManifest.ts` | `manifest.json` schema、投影类型、字段校验和默认值。 |
| 占位内容 | `src/content/PlaceholderERP.ts` | 程序生成的校准图。 |
| 内容映射材质 | `src/materials/ERPMaskMaterial.ts` | shader 中完成内容采样、FOV 裁切、Mask、LED 像素化预览和参考眼位校正。 |
| 场景装配 | `src/scene/SceneBuilder.ts` | 创建 three.js scene、内屏、非显示区、场馆和诊断层。 |
| 相机预设 | `src/scene/CameraPresets.ts` | 中央、前排、后排、左右侧、后方仰视、外部剖面等视角。 |
| 诊断图层 | `src/diagnostics/DiagnosticsOverlay.ts` | 边界线、网格、球心、内容原点、当前眼位、射线示意等可视化。 |
| GUI 面板 | `src/diagnostics/GUIPanel.ts` | lil-gui 控制面板、素材载入、参数滑杆、图层开关、分析和导出按钮。 |
| 应用入口 | `src/main.ts` | 渲染循环、文件载入、参数同步、点击座位、拖拽内屏、导出和 HUD 更新。 |

## 素材与清单

`manifest.json` 支持这些字段：

| 字段 | 含义 |
|---|---|
| `projection` | 必填。支持 `equirectangular`、`perspective`、`fisheyeEquidistant`、`fisheyeEquisolid`、`domemaster`、`cylindrical`。 |
| `hFovDeg` / `vFovDeg` | 素材有效水平/垂直视场。 |
| `yawOffsetDeg` / `pitchOffsetDeg` | 素材朝向或虚拟相机朝向。 |
| `hFlip` / `vFlip` | 水平/垂直镜像。 |
| `colorSpace` | `srgb` 或 `linear`。 |
| `originOffset` | 内容参考原点；在 perspective 下等同虚拟相机位置。 |

缺失或不合法的 `projection` 会导致清单载入失败。系统不会根据素材宽高比猜测投影或视场。

## 坐标约定

- 世界坐标：+Y 向上，米制，右手系，地面 `y = 0`。
- 舞台在 -Z，观众在 +Z。
- yaw 0° 面向舞台，范围 `(-180°, 180°]`。
- pitch 0° 是球心水平面，+90° 是天顶。
- ERP UV：`u = (yaw + 180) / 360`，`v = (90 - pitch) / 180`。
- 所有贴图统一 `texture.flipY = false`。

## UI 布局

- 左上角：标题与实时统计，默认收起。
- 右上角：lil-gui 控制面板，默认收起。
- 左下角：相机机位切换。
- 右下角：Pointer Inspector。
- 状态面板：素材/清单报错、模式状态、已选座位、全场座位分析，只在有内容时显示。

## 已知边界

- 当前场馆、座位和 Mask 都是参数化近似，真实数据应通过 V2 的 Venue Profile / mesh / 座位表替换。
- 单座位和批量分析只基于当前几何，不包含未建模遮挡物，也不知道素材本身是否在该方向有内容。
- 内屏 tilt 的可视化和 shader 已支持；部分诊断统计仍以未倾斜的球幕近似计算。
- 导出目前只有座位 CSV、当前配置 JSON、当前视角 PNG。

## 目录

```
src/
├── core/
├── materials/
├── content/
├── scene/
├── diagnostics/
├── utils/
└── main.ts
docs/
├── ARCHITECTURE.md
├── ROADMAP.md
├── USAGE.md
├── HANDOFF_CHECKLIST.md
├── SCREEN_DECOUPLING_DESIGN.md
└── examples/
```
