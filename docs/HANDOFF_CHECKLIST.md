# 对接清单 — D-01 ~ D-10 场馆数据需求

场馆设计方、LED 供应商、内容制作方三边在拿到真实工程资料前需要先对齐的最小参数集。**编号（D-01 ~ D-10）是固定引用编号，任何地方引用这份清单里的某一项时都用编号，不要用编号之外的描述代替**，方便跨文档（`ARCHITECTURE.md` / `ROADMAP.md` / 代码注释）互相对照。

| 编号 | 需求项 | 优先级 | 确认的内容 | 单位/格式 | 用于开发的目的 | 是否提供 | 备注 |
|---|---|---|---|---|---|---|---|
| D-01 | 室内场馆三维模型 | P1 建议 | 室内空间、地面、舞台、座席、通道、入口/控制区 | — | 建立可预演的场馆空间 | — | — |
| D-02 | 屏幕有效显示区域边界 | P0 必须 | Media Plane 的前/侧/后/顶部边界及下边界曲线 | 模型/剖面图/坐标表 | 生成屏幕 Mask，避免内容显示到非屏幕区 | — | — |
| D-03 | 非显示区域清单 | P0 必须 | 舞台、地面、座席、出入口、控制区等明确范围 | Mask/模型/平面图 | 确定哪些区域不应显示内容 | — | — |
| D-04 | 舞台位置与尺寸 | P0 必须 | 中心点、朝向、宽度、深度、高度 | m + 坐标 | 确定屏幕与舞台的空间关系 | — | — |
| D-05 | 观众区范围 | P0 必须 | 前/后/左/右范围、座席碗高程、中央通道 | m + 模型/平面图 | 建立简化观众区和镜头位置 | — | — |
| D-06 | 代表性观众视点 | P0 必须 | 中央、前排、后排、左右侧、后方仰视等坐标和朝向 | 坐标表 | 用于预设镜头和评审截图 | — | 建议至少 5 个视点 |
| D-07 | 完整座位/眼位数据 | P1 建议 | 每个座位或每排中心线、眼高、朝向 | CSV/JSON/模型 | 评估不同位置的观看效果 | — | 概念阶段可暂不提供 |
| D-08 | 建筑外壳模型 | P1 建议 | 外部球壳、入口、结构外形 | — | 支持外部剖面视角 | — | — |
| D-09 | 永久遮挡物模型 | P1 建议 | 梁柱、灯具、音响、机械设备及其高度 | 模型/设备布置图 | 识别实际视线遮挡 | — | — |
| D-10 | 设计坐标系说明 | P0 必须 | 单位、原点、轴向、模型版本及转换规则 | 坐标说明 | 保证所有资料在系统中对齐 | — | — |

> D-01 ~ D-10 里凡是"是否提供"留空的，代表尚未拿到，SphereLab 当前用 `src/core/VenueConfig.ts` 里的近似参数代替（对应关系见下表），等场馆/LED 供应商真实数据到位后按编号逐项替换。

## D-编号 ↔ 当前代码近似值对照

| 编号 | 对应 VenueConfig 字段 | V1 当前近似值 |
|---|---|---|
| D-02 屏幕有效显示区域边界 | `mediaPlane.radius`, `mediaPlane.maskControlPoints` | 半径 52m 球面 + 3 控制点 cosine 插值 mask（Front -25° / Side +5° / Rear +22°），不是真实屏幕边界曲面 |
| D-03 非显示区域清单 | `ScreenMask.ts` 的 mask 反向区域 | 由同一套 mask 隐含定义（非屏幕 = mask 之外），没有单独的非显示区域清单 |
| D-04 舞台位置与尺寸 | `stage.width/depth/height/frontOffset` | 中心点 (0, 0.6, -18)，宽 32m × 深 12m × 高 1.2m |
| D-05 观众区范围 | `audience.innerRadius/outerRadius/riseHeight` | 扇形 raked bowl，内径 5m ~ 外径 28m，另加简化中央通道 |
| D-06 代表性观众视点 | `src/scene/CameraPresets.ts` | 已有 7 个近似机位：Central Audience / Front Row / Rear Row / Left Side / Right Side / Rear Look-Up / Exterior Cutaway，满足"至少 5 个视点"的建议；坐标仍是参数化近似，非真实座位表 |
| D-07 完整座位/眼位数据 | `src/core/VenueGeometry.ts` `seatMeta` / `audienceSeatPosition()` | 观众席点击拾取（`main.ts` `selectSeat`）+ 座位视角量化指标（`src/core/SeatMetrics.ts`：视锥球幕覆盖率、与中央参考位的视线偏移）已实现，但座位坐标仍是 `VenueConfig` 参数化的代表性方位角/半径网格，不是真实座位表；也不建模遮挡物（对应 D-09）。真实数据到位后只需替换喂给这套拾取/量化逻辑的坐标来源，公式本身不用改 |
| D-08 建筑外壳模型 | `building.shellRadius` | 半径 60m 的同心参考球壳（比 Media Plane 大 8m，仅用于表现结构间距，非真实外壳形状） |
| D-09 永久遮挡物模型 | `src/core/VenueGeometry.ts` `occluderMeshes` | 梁柱/灯具/音响/机械设备仍未建模；但视线示意图（`main.ts` `checkOcclusion`）已经对已有的场馆几何——舞台平台、座椅方块、后方控制区盒子——做真实遮挡判定，不是"永久遮挡物"，是"顺带能查的现有几何" |
| D-10 设计坐标系说明 | `src/utils/SphericalMath.ts` | 已冻结（+Y 向上、米制、右手系，yaw 0°=舞台方向 -Z，pitch 0°=球心水平面），细节见 `ARCHITECTURE.md` |

## 分工：谁提供什么（映射到 D-编号）

### 场馆 / 屏幕设计方（Venue & Screen Design）
D-02（Media Plane 边界）、D-03（非显示区域）、D-04（舞台坐标）、D-05（观众区范围）、D-06（代表性视点）、D-10（设计坐标系，需能转换进本项目冻结坐标系）

### LED 供应商（LED Vendor）
D-02（LED 显示面 3D 模型、显示面曲率）、D-03（Screen Mask，可能是遮罩纹理而非简单角度函数）

### 双方需要共同冻结
D-10（统一坐标系）、D-02+D-04（屏幕与建筑/舞台关系、屏幕下边界）、ERP / Canvas 定位（ERP 图像 yaw=0/pitch=0 对应场馆哪个物理方向 — 本项目约定 yaw=0 面向舞台）、D-06（代表性视点，双方对"典型观众能看到什么"的理解要一致）

## P1 / P2 — 暂不需要，留给 V2 / V3 / V4

以下内容明确**不在 V1 范围内**，不要因为等待这些资料而阻塞 V1 的预演验证：

- Pixel pitch（像素间距）、实际像素矩阵、LED 分区、箱体排列
- Pixel / Cabinet Mapping
- Brightness / Color Calibration、Calibration LUT
- Genlock、Processor Topology

这些属于 [`ROADMAP.md`](./ROADMAP.md) 中的 **V4 — Engineering Integration** 阶段，是 LED 播控/像素映射系统的范畴，SphereLab 的定位是「球幕适配 → 数字预演 → 视觉校正」，不承担这部分职责。
