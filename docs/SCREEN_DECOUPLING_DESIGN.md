# 内屏（Media Plane）/ 外屏（Building Shell）解耦设计 + 摆放合理性约束

> **临时状态（按最新反馈）：3D 拖拽（中心/高度）当前不做 C-01~C-09 合理性夹紧，允许自由拖到任意位置**——`main.ts` `applyPlacementDragTick()` 直接把拖拽结果写入 `cfg.mediaPlane`，不再调用 `reconcileMediaPlanePlacement()`。第 5 节的约束依然生效于 GUI 滑杆（`onMediaPlaneGeometryChange`）和 `onVenueChange`，只是拖拽这条路径先按要求放开了。拖拽路径里仍保留的是"数值防炸"检查（水平面求交的掠射角拒绝、单帧像素位移夹紧）——那是防止射线-平面求交在特定角度下把交点算到几千米外这类纯数学 bug，不是"合理性"限制，所以没有一并去掉。
>
> **状态：已实现**（`VenueConfig.ts` / `VenueGeometry.ts` / `SceneBuilder.ts` / `CameraPresets.ts` / `DiagnosticsOverlay.ts` / `GUIPanel.ts` / `main.ts` / 新增 `core/ScreenPlacementValidation.ts`）。本文档最初是设计提案留档，第 7 节列出的开放问题已按文中给出的默认建议拍板并实现，见每条问题后的「✅ 已按此实现」标注；本文档现在同时也是这份实现的规格说明，代码与文档不同步时以代码为准，发现不一致请更新本文档。

文档索引：架构总览见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)；阶段规划见 [`ROADMAP.md`](./ROADMAP.md)。

---

## 1. 背景与目的

现在 `VenueConfig.mediaPlane`（内屏，唯一承载 ERP 内容的球面）和 `VenueConfig.building`（外屏，代表建筑结构的参考壳）、`VenueConfig.audience`（观众席）三者是**隐式同心**的：

- 内屏中心 = `(0, mediaPlane.centerHeight, 0)`。
- 外壳中心直接复用 `cfg.mediaPlane.centerHeight`（见 `VenueGeometry.ts` `buildShell()` 第一行 `const center = new THREE.Vector3(0, cfg.mediaPlane.centerHeight, 0)`）——外壳自己没有独立的中心字段，是"借用"内屏的高度。
- 观众席以世界原点为中心的扇形环，半径由 `audience.innerRadius/outerRadius` 定义，与内屏中心的水平位置（X/Z）没有任何联动或校验。

需求：把**外屏 + 观众席**做成严格只能通过参数（GUI 滑杆）调整的"固定基准"，**内屏**则改成可以在 3D 视口里直接拖拽中心（可以偏出外屏/观众席的几何中心），半径用滑杆精确调整（实现后按实测反馈从"也能拖"改成"只能用滑杆"，见第 7 节）。这样才能预演"内屏和理论外壳/观众布局不完全匹配"的场馆（比如内屏偏心、口径与外壳不成比例），从而看到类似鱼眼镜头那种视距不均匀的观感。但拖拽自由度必须配上合理性约束，否则会拖出物理上不可能的搭建（内屏穿出建筑、观众坐到 LED 墙外面等），也是本文档要点。

---

## 2. 职责划分

| 对象 | 现状字段 | 拖拽？ | 调整方式 |
|---|---|---|---|
| **内屏（Inner Screen / Media Plane）** | `VenueConfig.mediaPlane`（`radius`, `centerHeight`, `centerOffsetX/Z`） | 中心 ✅ / 半径 ❌ | 中心（水平 + 高度）3D 视口拖拽 + GUI 滑杆双向同步；半径只用 GUI 滑杆（实测半径 handle 手感差、容易和中心拖拽混淆，已去掉，见第 4 节） |
| **外屏（Outer Shell / Building）** | `VenueConfig.building`（`shellRadius`, `shellHeight`） | ❌ 否 | 仅 GUI 滑杆 |
| **观众席（Audience）** | `VenueConfig.audience.*` | ❌ 否 | 仅 GUI 滑杆 |
| **舞台（Stage）** | `VenueConfig.stage.*` | ❌ 否 | 仅 GUI 滑杆（与观众席同等对待，作为内屏摆放合理性的校验对象之一） |

---

## 3. 数据模型变更（提案）

1. **`MediaPlaneConfig` 新增水平偏移字段**：`centerOffsetX: number`、`centerOffsetZ: number`（默认 `0`）。内屏世界坐标中心 = `(centerOffsetX, centerHeight, centerOffsetZ)`——`centerHeight` 字段含义不变，继续管 Y。

2. **`BuildingConfig` 需要拥有自己独立的中心高度**，新增 `centerHeight: number`（默认 `0`），**不再**读 `mediaPlane.centerHeight`。这是解耦的前提——否则拖内屏的 Y 会连带把外壳也移动，违反"外屏只能参数化固定"的要求（对应第 5 节 C-08）。`buildShell()` / `buildGroundDisc()` 要相应改成用 `cfg.building.centerHeight`。

3. **新增一个不依赖 three.js 的纯校验模块**（建议 `src/core/ScreenPlacementValidation.ts`，遵循 `core/` 现有"只依赖数学与配置"的约定，参照 `ScreenMask.ts` 的写法）：输入内屏候选中心/半径 + 当前 `building`/`audience`/`stage` 配置，输出每条 C-0x 约束的通过/超限状态，供拖拽时实时夹紧（clamp）和 GUI 里的"当前是否合理"提示读取。

---

## 4. 交互模型（提案）

- **外屏 + 观众席 + 舞台**：维持现状，只有 GUI 滑杆，3D 视口里没有可拖拽的 handle。
- **内屏**：3D 视口有两个可拖拽 handle（拾取方式参照 `main.ts` 现有"点击座位拾取"的 raycast 模式，但用 `depthTest:false` 渲染在最前——handle 常年落在场馆内部/球心附近，如果按正常深度测试会被球幕/座椅/舞台挡住，实测就是"拖拽不灵敏"的根因，不是手势逻辑的问题）：
  1. **中心 handle（橙色球）**——水平面（X/Z）拖拽，改 `centerOffsetX/Z`。
  2. **高度 handle（橙色圆锥，中心正上方）**——屏幕空间纵向拖拽（按距相机距离换算成世界单位），改 `centerHeight`。
  - ~~半径 handle~~（内屏赤道上的径向拖拽点，最初设计里也有）已去掉：实现后实测手感差、容易和中心拖拽混淆，按反馈改成半径只用 GUI「球面半径」滑杆调整，3D 视口只保留中心（水平+高度）可拖拽。
- 拖拽过程中每一帧都跑第 5 节的约束校验；某个方向的拖动会让配置越过硬约束（C-01/C-03/C-04/C-05/C-06）时，把该方向的位移**夹紧**到合法边界，而不是整段拖拽直接失效——避免松手瞬间画面从合法态跳变到不合法态的割裂感。软约束（C-02/C-09）只做视觉提示（比如把 handle 或边界线变黄/变红），不阻止拖拽。触发约束时的文字提示只在 `#placement-info` 面板里出现，且面板只在有违规时才显示（合规时完全隐藏，不常驻占屏幕）；同一次校验里同一条约束编号只报一次，不会因为内部做了好几轮夹紧迭代就重复刷屏。

---

## 5. 摆放合理性约束（C-01 ~ C-09）

编号规则参照 [`HANDOFF_CHECKLIST.md`](./HANDOFF_CHECKLIST.md) 的 D-01~D-10：**引用这份清单里的某一项时用编号**，方便跨文档/代码注释对照。

记号：内屏球心 `O_s = (centerOffsetX, centerHeight, centerOffsetZ)`，半径 `R_s = mediaPlane.radius`；外壳球心 `O_b = (0, building.centerHeight, 0)`，半径 `R_b = building.shellRadius`；水平偏移量 `Δ_h = sqrt(centerOffsetX² + centerOffsetZ²)`。

### C-01（硬约束）内屏必须完整包裹在外屏之内，留结构间距

```
distance(O_s, O_b) + R_s ≤ R_b − CLEARANCE_SHELL_M
```

默认 `CLEARANCE_SHELL_M = 2`（米，预留马道/安装结构间距）。违反后果：内屏物理上会穿出建筑外壳，不是一个能实际搭建的场馆。

### C-02（软约束——对应用户举的"接触点距离 ≤ 10%"例子）内屏相对外屏的水平偏心程度上限

用户的原始描述是"内屏在某轴上的接触点和外屏接触点的距离不能超过 10%"：沿某个水平方向 `û`（比如世界 +X），

```
内屏接触点 = O_s + R_s·û
外壳接触点 = O_b + R_b·û
接触点距离(û) = |O_s − O_b + (R_s − R_b)·û|
```

这个值严格来说随方向 `û` 和半径差 `R_s−R_b` 变化，不是一个纯粹的偏心量。为了做成一条可以在拖拽时实时算的单一约束，建议实现时用**方向无关的简化版**（数学上是上式在偏移方向对齐时的近似上界，也更符合"偏心程度"这个直觉）：

```
Δ_h ≤ OFFSET_TOLERANCE_RATIO × R_b
```

默认 `OFFSET_TOLERANCE_RATIO = 0.10`（10%，直接取用户给的数字）。这是**软约束/合理性建议**而非物理硬限制——超出后画面不会出现穿模，只是偏心感会明显到看起来像"内屏没对准外壳"，所以允许在 GUI 里可调，也允许一个"我知道，就要这么夸张"的显式豁免开关。

### C-03（硬约束）内屏必须完整包住观众席，不能让观众坐到 LED 墙外面

最坏情形是偏移方向正对着观众席最外圈的某个座位，该方向上内屏离那一侧的"净距离"会因为偏心而变小：

```
R_s − Δ_h ≥ audience.outerRadius + CLEARANCE_AUDIENCE_M
```

默认 `CLEARANCE_AUDIENCE_M = 1`。等价写法：`R_s ≥ audience.outerRadius + Δ_h + CLEARANCE_AUDIENCE_M`。违反后果：观众席外圈会露出到内屏球面以外，即"坐在 LED 墙外面"，属于不可能的搭建。

### C-04（硬约束）内屏不得与舞台包围盒相交

舞台是一个长方体（`VenueConfig.stage`），要求其 8 个顶点都完整落在内屏球体内部：

```
∀ 顶点 c ∈ 舞台包围盒角点: |c − O_s| ≤ R_s − CLEARANCE_STAGE_M
```

默认 `CLEARANCE_STAGE_M = 1`。

### C-05（硬约束）内屏最低点不得穿地

```
O_s.y − R_s ≥ −MAX_EMBED_M
```

默认 `MAX_EMBED_M = 0`（球体最低点不能低于地面 `y=0`）。实现时可以先用整球最低点做保守判定（简单、总是安全），更精细的版本可以只检查 Screen Mask 有效显示区域内的最低点（复用 `ScreenMask.sampleBoundaryCurve`），因为非显示区域理论上允许被地面裁掉——本文档建议先上线保守版本，精细版留作后续优化。

### C-06（硬约束）内屏半径的绝对上下限，避免退化配置

```
R_s ∈ [ max(audience.outerRadius + CLEARANCE_AUDIENCE_M, MIN_ABS_RADIUS_M), R_b − CLEARANCE_SHELL_M ]
```

默认 `MIN_ABS_RADIUS_M = 10`。防止拖出半径趋近 0 甚至负数、或者"内屏比观众席还小"这类没有意义的配置。

### C-07（交互准则，非数值约束）越界时夹紧而不是拒绝

硬约束（C-01/C-03/C-04/C-05/C-06）越界时，把当前正在拖拽的坐标分量夹紧到刚好满足约束的边界值，而不是丢弃整个拖拽手势或弹阻断式错误——保持拖拽手感连续。软约束（C-02/C-09）只变色提示，不夹紧。

### C-08（前置数据模型要求，非数值约束）外壳必须有独立于内屏的中心高度

对应第 3 节第 2 点：`BuildingConfig` 现在没有自己的中心字段，直接借用 `mediaPlane.centerHeight`。解耦内屏的前提是先把这处耦合拆掉，否则"外屏只能参数化固定"这条要求在内屏 Y 方向拖拽时会被破坏。

### C-09（软约束，可选）偏心程度的二级预警阈值

在 C-02 的硬性 10% 上限之下，建议再加一个更低的预警阈值（比如 `OFFSET_WARNING_RATIO = 0.05`，5%）：低于预警阈值不提示，介于预警和硬上限之间显示黄色提示（"配置合法但明显偏心"），触达硬上限显示红色/夹紧。纯 UX 建议，不影响是否允许该配置存在。

---

## 6. 默认阈值汇总表

| 常量 | 默认值 | 类型 | 对应约束 |
|---|---|---|---|
| `CLEARANCE_SHELL_M` | 2 m | 硬 | C-01, C-06 |
| `OFFSET_TOLERANCE_RATIO` | 0.10（10%） | 软 | C-02 |
| `OFFSET_WARNING_RATIO` | 0.05（5%） | 软（二级） | C-09 |
| `CLEARANCE_AUDIENCE_M` | 1 m | 硬 | C-03, C-06 |
| `CLEARANCE_STAGE_M` | 1 m | 硬 | C-04 |
| `MAX_EMBED_M` | 0 m | 硬 | C-05 |
| `MIN_ABS_RADIUS_M` | 10 m | 硬 | C-06 |

这些都建议做成 `ScreenPlacementValidation.ts` 里可导出的具名常量（而不是散落的魔法数字），方便后续按真实场馆数据调整——和 `VenueConfig.ts` 现有"P0 冻结参数，V2 起替换"的处理方式一致。

---

## 7. 待确认的开放问题（已按默认建议拍板并实现）

1. **中心 Y 方向是否也走新的拖拽 handle？** ✅ 已按此实现——X/Y/Z 都可拖拽：橙色球（水平面 `centerOffsetX/Z`）+ 橙色圆锥（垂直 `centerHeight`，屏幕空间纵向拖拽，按距相机距离换算成世界单位）。
2. **C-02 的基准用外壳半径 `R_b` 还是内屏半径 `R_s`？** ✅ 已按此实现——用 `R_b`（`ScreenPlacementValidation.ts` 里 `offsetRatio = horizOffsetFinal / shellR`）。
3. **越界时夹紧还是拒绝？** ✅ 已按此实现——夹紧（`clampMediaPlanePlacement` 直接返回修正后的值 + 一份 `violations` 列表，从不拒绝/丢弃拖拽手势，见 C-07）。
4. **Screen Mask 在内屏偏心后是否继续按内屏自身局部坐标系工作？** ✅ 确认是——`ERPMaskMaterial` 的 shader 完全是 object-space 计算（`vObjPos = position`，未经 `modelMatrix`），偏心只是平移了整个 mesh 的 `position`，mask/内容采样的数学完全不用改，也确实没有改。

**新增的实现细节**（设计阶段没有展开，落地时确定的）：

- 拖拽、GUI 滑杆、以及 `onVenueChange`（外壳/观众席/舞台滑杆改了、间接让当前内屏摆放失效）三条路径最终都收敛到同一个 `reconcileMediaPlanePlacement()` + `onMediaPlaneGeometryChange()`，保证约束检查/夹紧不会有路径遗漏。
- `#placement-info` 面板只在存在违规时出现，合规时完全隐藏（不像最初版本那样常驻显示"摆放合规"占着屏幕）——和 `#seat-info`/`#analysis-info` 的"空则隐藏"是同一个 CSS 规则。
- `clampMediaPlanePlacement()` 内部用 `reportedCodes` 去重：同一次调用里，即便某条约束在多轮夹紧迭代（或 C-04 的 8 个舞台顶点检查）里反复触发，也只报一次，不然面板会把同一行文字重复刷很多遍。
- **半径拖拽 handle 试过又去掉了**：最初按提案在内屏赤道上放了个可径向拖拽的 handle（用"求两条直线最近点"公式），但实测手感差、容易跟中心拖拽混淆——按反馈改成半径只用 GUI「球面半径」滑杆调整，3D 视口只保留中心（水平 + 高度）两个 handle。
- 中心/高度 handle 材质用 `depthTest:false` + 高 `renderOrder`，确保 handle 常年不被球幕/场馆几何挡住——handle 位置本来就在球心附近，正常深度测试下经常被挡到，之前"拖拽不灵敏"的报告根因就是这个，不是拖拽手势的算法问题。**只设 `depthTest:false` 还不够**：一个普通（未标 `transparent:true`）的 `MeshBasicMaterial` 会被丢进 three.js 的"不透明"渲染队列，永远先于内屏这类"透明"队列的物体绘制，所以内屏球面仍可能在之后盖住它——把 handle 材质也标成 `transparent:true`（配合更高的 `renderOrder`）才是让它保证画在最后、盖过一切的完整做法。
- **外壳（外屏）现在所有观众视角下都常驻可见**：外壳材质加上 `depthTest:false` + `renderOrder`（比内屏默认高、比拖拽 handle 低），确保从内屏内部的普通视角看，外壳线框也能"透过"内屏球面显示出来，而不是被挡住——两个球幕才能同时作为拖拽时的视觉参照。
- **上一步的"常驻可见"其实还不够**：外壳材质没显式设 `side`，默认 `THREE.FrontSide` 会做背面剔除——球体的三角形法线朝外，从球体内部（外壳比球幕/观众席都大，普通观众视角必然在外壳内部）看到的全是背面，会被整个剔除掉，实际上一片都不会画出来。补上 `side: THREE.DoubleSide`（跟 `ERPMaskMaterial` 给内屏用的是同一个理由：`materials/ERPMaskMaterial.ts` 注释里那句"the mesh is normally viewed from inside the concave sphere"）才是外壳真正开始出现的关键一步，单改 `visible` 不够。顺带把颜色/不透明度调得更亮更实（`0x7fb8ff` / 0.55），让两个球幕的轮廓都更容易一眼看出来。
- **拖拽"不灵敏"的真正原因是性能，不是命中检测或数学**：`onMediaPlaneGeometryChange()`（当时唯一的更新入口）每次都会重建球体几何 + 整个诊断图层（参考球体、yaw/pitch 网格、边界线——数百到数千个三角函数算出来的顶点）+ 相机机位 + 统计信息，而拖拽时这个函数在**每一次 `pointermove`** 都会被调用一次，帧率因此被严重拖慢，手感自然像"完全没反应"。拆成了 `rebuildMediaPlaneVisuals()`（贵，完整版，给 GUI 滑杆和拖拽结束时用）+ `applyMediaPlaneTransformOnly()`（只挪已建好的 mesh/handle 位置，拖拽中途用，半径没变的情况下完全不碰诊断图层）——半径通常不会在纯中心/高度拖拽里变化，只有约束夹紧（C-03/C-04）真的需要更大半径包住观众席/舞台时才会退回贵的那条路径。
- **"拖一下就飞到最上面、然后拽不动"是水平拖拽的一个经典数值坑**：中心拖拽用水平面与鼠标射线求交（`intersectPlane`）；当相机视角接近与该水平面平行（观众眼位本来就大多是接近水平地看向舞台，非常容易出现这个角度）时，射线和平面几乎平行但没有真正平行，`intersectPlane` 仍然返回一个"合法"交点，但这个点可能远在几千米开外——鼠标只是稍微动了一下，换算出来的世界坐标却是个天文数字，随后又被摆放约束一把拽回边界，看起来就是"飞走了、然后卡死在边界动不了"。修法是在写入 `params` 之前先做合理性检查：交点到世界原点的水平距离若超过外壳半径的 3 倍，直接丢弃这一帧的采样（视同求交失败），而不是把这个离谱的值交给约束函数去善后。垂直拖拽同样加了单帧像素位移的夹紧（±80px）作为兜底，防止任何异常的单次事件位移被放大成同类问题。
- **外壳的渲染方式改了两轮**：先从线框网格改成 Fresnel 边缘发光轮廓（自定义 shader），按最新反馈又从"发光"简化成`buildFlatTransparentMaterial()`——一个普通 `MeshBasicMaterial`，恒定透明度、纯色、不发光、不画网格，内外两个球唯一的区别就是颜色（外壳目前是中性灰蓝 `0x9aa5b8`）。`DoubleSide` + `depthTest:false` + `renderOrder` 这几条（解决背面剔除和内屏遮挡问题的部分）还留着，只是外观从"发光"改成了"平面半透明"。
- **两个球的默认半径改成一致**（`VenueConfig.ts` `building.shellRadius` 默认值从 60 改成跟 `mediaPlane.radius` 一样的 52），且去掉了页面载入时自动跑一次摆放约束校验的调用——否则默认配置里外壳只比内屏大 0m（低于约束要求的 2m 间距），一加载就会被约束夹紧改掉，达不到"初始一致"的效果。约束逻辑本身没删，GUI 滑杆和 `onVenueChange` 依然会跑检查，只是不再在什么都没动的初始状态上生效。
- **新增内屏俯仰角（仰角/旋转，`tiltDeg`）——内屏第一个真正的旋转自由度**：之前内屏（`mediaPlaneMesh`）只会平移，从不旋转（`ERPMaskMaterial.ts`/`SceneBuilder.ts` 原有注释明确写了这一点）；现在新增 `VenueConfig.mediaPlane.tiltDeg`（绕局部 X 轴的刚体旋转，度，正值抬高正前方/面向舞台一侧的仰角），三角 handle（跟圆圈放在一起，见下）拖动改这个值，右侧面板也有对应滑杆。选它绕 X 轴（而不是 Y/Z）是因为这是"标准仰角"的定义——绕左右方向的水平轴前后俯仰。
  - **为什么这个改动几乎不需要碰 shader 数学**：Mask 边界和默认（`uWarpToEye=false`）的内容采样全程只用物体空间的 `vObjPos`（网格自身局部坐标，从不转换到世界空间），所以内屏刚性旋转时，屏幕形状和贴图都会免费跟着一起转——这跟平移当初"免费生效"是同一个道理，只是这次是旋转而不是平移。
  - **唯一需要动公式的地方是"按观众参考眼位校正内容"（`uWarpToEye`）**：因为这个模式需要把世界坐标系里的观众眼位换算回内屏自己的局部坐标系，而这个换算現在要多考虑一次旋转——`world = R(tilt)·local + offset`，所以反过来要 `local = R(tilt)⁻¹·(world - offset)`。绕单轴旋转矩阵的逆等于转置，转置又等于绕同一轴转相反角度，所以直接用 `R(-tilt)` 而不用真的求矩阵逆，公式並沒有變复杂多少——具体推导和代码见 `materials/ERPMaskMaterial.ts` 顶部大注释。
  - **明确没有覆盖到的地方（V1 已知缺口，不是"假装不存在"）**：`ScreenPlacementValidation.ts` 的 C-01~C-09 完全不需要改——旋转不改变球体本身占据的空间范围，跟"是否穿出外壳/是否包住观众席"这类包含关系无关，只跟半径/中心有关。但**诊断图层**（参考球体、yaw/pitch 网格线、屏幕边界线，`DiagnosticsOverlay.ts`）和 **座位视角量化指标**（`SeatMetrics.ts` 的覆盖率计算）目前都不知道 tilt 的存在——它们各自把方向直接换算成世界坐标系下的 yaw/pitch，而不是先转换回内屏自己的（可能已经倾斜的）局部坐标系再算。默认这些诊断层大多是关闭的，倾斜角度为 0 时完全没有影响；但如果同时打开这些诊断层 **且** 内屏被倾斜了，画面会不一致（诊断线不会跟着倾斜的球转）。真要修，思路是这些计算也要先做一次跟 shader 里一样的 `R(tilt)⁻¹` 换算，但这次先没有做。

- **新增"修改模式 / 预演模式"**（按最新反馈）：外屏/观众席/舞台永远只能靠滑杆调，这点不变；内屏现在分两种模式——**修改模式**（`placementMode: "edit"`，默认）下可以拖拽 + 滑杆改中心/半径，`#placement-info` 右侧面板的两个 3D handle 可见；**预演模式**（`"preview"`）下位置彻底锁定：两个拖拽 handle 隐藏（`main.ts` `onPlacementModeChange`），对应的 4 个滑杆（半径/球心高度/水平偏移 X/Z）也被 `GUIPanel.ts` 禁用（`.disable()`），避免预演内容时手滑碰到画面。GUI 面板「球幕几何与 Mask」折叠组顶部新增下拉框「内屏模式」切换两种状态。
- **圆圈拖拽的求交方式换成了"面向相机的平面"，而不是水平面**：老实现用世界坐标系的水平面（法线 = 世界 Y 轴）求交，在相机接近水平视角（观众眼位很常见的角度）时数值上会不稳定——这也是本文档前面提到的"拖一下就飞到最上面"那个 bug 的根源（虽然当时加了一个"离谱就丢弃这一帧"的兜底，但没有从根子上解决"求交不稳定"这件事）。改成用法线＝相机视线方向、过内屏当前球心的平面求交后，这个问题从数学上就不存在了——从相机出发穿过任意一个屏幕像素的射线，基本不可能跟"法线正好是相机视线方向本身"的平面平行（除非视场角大到离谱），所以拖拽移动永远贴着当前这块"2D 屏幕"走，不会有前后失控的跳动。副作用（其实是这次明确要的效果）：命中点现在 x/y/z 三个分量都有意义，所以圆圈不再只控制水平位置，而是控制完整的球心位置（X/Y/Z）——上下拖动会改高度，左右拖动改水平偏移，`centerHeight` 现在也可以拖圆圈改了（原来只能滑杆调）。之前"离谱就丢弃"的兜底判断依然保留，但降级成防御性检查，不再是主要修复手段。
- **两个拖拽 handle 的职责换了两轮**：最初是橙色球控中心水平位置 + 橙色圆锥控高度；第二轮改成橙色圆锥控半径（沿球心向外拖动，复用"求两条直线最近点"公式，见半径拖拽段落）；**最新一轮又改了**——用户确认圆圈拖拽"看起来像在改大小"其实是透视错觉（球没变，是水平面拖拽把它移到离相机更远/更近的地方，看着显大显小），所以圆圈保持不变（还是控水平中心）；橙色圆锥现在**改成控俯仰角/仰角（`tiltDeg`）**——沿一个以球心为圆心、半径固定 3m 的小圆弧拖动（`TILT_HANDLE_ARM`，故意不跟内屏半径挂钩，好让两个 handle"放在一起"而不是一个在球心一个在赤道，这也是这轮改动明确提出的要求），角度换算用 `atan2` 从拖拽命中点相对球心的 (y,z) 分量反解，跟 `updatePlacementHandles()` 里正向"角度→位置"的公式互为逆运算。半径和球心高度现在都没有对应的拖拽 handle 了，只能用滑杆调——3D 视口里保持只有两个 handle。旋转（跟平移一样）不需要重建球体几何，只是设置 `mesh.rotation.x`，所以中心拖拽和俯仰角拖拽现在共用同一条最便宜的 `applyMediaPlaneTransformOnly()` 路径；之前给半径拖拽专门写的 `applyMediaPlaneGeometryLive()`（必须重建几何的那条稍贵路径）随着半径拖拽被去掉，也一并删掉了。
- **内屏在"修改模式"或"未载入真实素材"期间显示成纯色透明球**——用户明确的工作流是"起初两个球都是透明的，拖到合适位置后再导入素材填充图片"：`main.ts` `shouldShowMediaAsSimpleBall()` 现在是两个条件的"或"——`placementMode === "edit"`（不管有没有加载过真实素材，修改模式下一律简化成纯色球，避免拖动的时候被内容分散注意力）或者当前贴图仍是占位校准图（`placeholderTexture`）。满足其一就调用 `ERPMaskMaterial.setSolid()`（复用"Non-Screen Area"诊断层已经在用的同一个纯色机制，不是新发明的开关）把内屏画成跟外壳同色系但不同颜色（青色 `0x4fd1c5`）、同样恒定透明度（0.22）的纯色球——不过它填的是内屏真实的 Screen Mask 形状（不是完整球体，因为内屏本来就不是完整球体），外壳则是完整球体，形状上天然就能区分开。切到「预演模式」且已经加载过真实素材时，会立刻切回正常贴图采样、透明度恢复到 GUI 滑杆的值；点「恢复占位校准图」则会切回纯色球（不管当前是哪个模式）。opacity 的写入点统一收到 `applyMediaOpacity()` 一个函数里，`setSolid`/`setOpacity` 又进一步收到 `applyMediaSolidLook()` 里，避免"纯色球"状态被 Mask 相关滑杆（本来会调 `setOpacity(params.opacity)`）或模式切换不小心覆盖掉。
