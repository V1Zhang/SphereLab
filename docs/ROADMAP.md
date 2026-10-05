# Roadmap

对齐外部资料管理表中的 P0/P1/P2 分级（分级细节见 [`HANDOFF_CHECKLIST.md`](./HANDOFF_CHECKLIST.md)）。架构与模块状态见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。

```
V1 — Concept Previsualization（当前阶段，已完成）
├─ Sphere-like Media Plane Geometry        ✅
├─ Screen Mask（3 控制点近似）              ✅
├─ ERP Mapping shader                       ✅
├─ 占位 ERP 校准内容                        ✅
├─ 视频 / 图片文件上传（拖入即播）           ✅
├─ Stage + Audience + Venue geometry        ✅
├─ Audience Camera Presets（6 个观众机位，满足 D-06 建议）✅
├─ Geometry Diagnostics                     ✅
├─ 素材载入（视频 / 图片 / EXR / HDR，拖入即播） ✅
├─ 素材清单（Manifest）：多投影格式 + 自定义 FOV / 朝向 / 镜像 / 色彩解释 / 参考原点·相机位置 ✅
├─ 点击座位拾取 + 座位观众模式 + 座位视角量化指标（覆盖率 / 视线偏移，几何近似）✅
├─ 批量座位分析（全场分布统计）+ 导出（座位分析 CSV / 配置 JSON / 视角截图 PNG，纯前端）✅
├─ 视线示意图（eq.7 可视化：射线 + 采样方向 + 遮挡判定）+ 当前眼位标记 ✅
└─ 内屏（Media Plane）/ 外屏（Building Shell）解耦：外屏 + 观众席保持仅参数化调整，内屏中心可 3D 拖拽（半径改用滑杆），配套摆放合理性约束（C-01~C-09，见 [`SCREEN_DECOUPLING_DESIGN.md`](./SCREEN_DECOUPLING_DESIGN.md)） ✅

V2 — Venue-Aware Previsualization
├─ 导入真实场馆 / 屏幕 Mesh
├─ 导入真实座位 / 眼位数据
├─ 自定义 Screen Mask（替代 3 控制点近似）
├─ Safe Zone、多座位评估、畸变分析
└─ Venue Profile（可切换的场馆参数集）

V3 — Production Adaptation
├─ Composition Guide / Edge Stretch Analysis
├─ ERP Region Analysis
├─ Motion / Comfort Evaluation
└─ Approved Preview

V4 — Engineering Integration
├─ LED Partition / Cabinet / Pixel Mapping
├─ Warp / LUT
└─ Venue / Media Server Validation
```

## 范围边界

SphereLab 的核心是「球幕适配 → 数字预演 → 视觉校正」，具体包括：

- 场馆几何建模（近似 → V2 起替换为真实数据）
- ERP 球面映射与 Screen Mask
- 多观众视角模拟
- 几何诊断
- 载入多种投影/预变形格式的素材（视频 / 图片 / EXR / HDR）+ 清单驱动的自定义参数（FOV、朝向、镜像、色彩解释、参考原点/相机位置），贴到球幕预览：**equirectangular**、**perspective**、**fisheyeEquidistant**、**fisheyeEquisolid**、**domemaster**、**cylindrical**，见 [`ARCHITECTURE.md`](./ARCHITECTURE.md) 「多种采样」一节。
- 点击观众席任意代表性座位，跳转到该座位视角；拖拽时固定该座位眼位转头，并给出基础量化读数（视锥球幕覆盖率、与中央参考位的视线朝向偏移）。
- 批量跑全场代表性座位的分析（分布统计：均值/P95/极值，不产出单一平均分），并导出座位分析 CSV、当前配置 JSON、当前视角 PNG 截图——全部纯前端下载，无后端（见 [`ARCHITECTURE.md`](./ARCHITECTURE.md) 「批量座位分析 + 导出」一节）。
- 视线示意图：鼠标悬停实时画出 e→p 射线（对已建模的舞台/座椅/后方控制区做遮挡判定）与 o→p 采样方向，可视化项目说明式 (7) 的几何关系（见 [`ARCHITECTURE.md`](./ARCHITECTURE.md) 「视线示意图」一节）。

**不在范围内**：

- 素材生成 / 转换：把普通 2D / 平面素材转成 ERP、超分、扩图、内容分析、去闪烁/调色、360° outpainting、接缝修复、视觉增强（Motion Parallax / 2.5D 分层）——素材需在系统外处理成本系统支持的投影格式后再载入，本系统只负责按清单把它正确贴到球幕，不做投影转换。
- 完整的遮挡物建模与遮挡判定：座位视角的覆盖率计算（单座位和批量都一样）只问"这个方向有没有屏幕"，不检查遮挡；视线示意图的遮挡判定只查已建模的舞台/座椅/后方控制区，不含吊挂体等尚未建模的遮挡物（见 [`HANDOFF_CHECKLIST.md`](./HANDOFF_CHECKLIST.md) D-09）。
- 更精细的几何评价指标：局部形状畸变的雅可比奇异值比、按真实座位权重统计的满意度——目前的批量分析只有覆盖率和视线偏移两项分布，没有形状畸变指标，也没有座位权重（因为还没有真实座位表，见 D-07）。
- 分析结果的可视化图表、自动排版的图文报告：批量分析目前只有数字汇总 + 可下载 CSV，没有图表或成文报告，需要自己拿 CSV 去做。
- 除截图外更完整的渲染输出（比如离线序列渲染、批量多机位导出）：导出模块目前只有一张当前视角的 PNG，分辨率就是当前浏览器窗口大小，不是独立可配的母版分辨率。
- V4 才需要的 LED 播控 / 像素映射系统（Pixel pitch、LED 分区、箱体排列、Pixel/Cabinet Mapping、Brightness/Color Calibration LUT、Genlock、Processor Topology）。

## V1 → V2 的具体迁移点

V1 用 `VenueConfig`（`src/core/VenueConfig.ts`）里的少量参数近似场馆——半径、球心高度、3 个 mask 控制点、简单的扇形观众席。V2 需要替换的地方：

1. `MediaPlaneGeometry.ts` 的完整 UV 球 → 替换/叠加真实屏幕 Mesh（来自 LED 供应商的 3D 模型）。
2. `ScreenMask.ts` 的 3 控制点 cosine 插值 → 替换为真实 Screen Mask（来自场馆设计方的实际显示边界，可能需要从每 yaw 一个值升级为 2D 遮罩纹理）。
3. `VenueGeometry.ts` 的参数化舞台/观众席 → 替换为真实座位表 / 眼位数据。
4. `CameraPresets.ts` 已有 Central / Front Row / Rear Row / Left / Right Side / Rear Look-Up 6 个近似观众机位 —— V2 要做的不是新增视角类型，而是把这些机位的坐标从参数化近似换成 D-07 真实座位/眼位数据，用于比较不同座位的主体大小、畸变程度、安全区。
