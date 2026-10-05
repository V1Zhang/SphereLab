import * as THREE from "three";
import { MaskControlPoint } from "../core/VenueConfig";
import { ERPProjection } from "../content/ERPManifest";

/**
 * Shader that fuses content mapping + screen mask into a single pass on the media-plane mesh.
 * Two independent direction computations happen per fragment, deliberately kept apart (see
 * docs/ARCHITECTURE.md "内容参考原点" and src/content/ERPManifest.ts):
 *
 *  1. Physical direction — dome center → this surface point. Drives the screen mask only
 *     (ScreenMask.ts, mirrored here in GLSL) using a smoothstep feather instead of a hard cut.
 *     Never affected by content parameters, so the physical screen shape stays independent of
 *     whatever content happens to be loaded.
 *  2. Content direction — content reference origin (manifest `originOffset`, defaults to the dome
 *     center, or — with `uWarpToEye` enabled, see "屏幕位置几何校正" below — the fixed audience
 *     reference eye) → this surface point. Drives which texel of the source gets sampled, via the
 *     mapping selected by `uProjection` (see src/content/ERPManifest.ts `ERPProjection`):
 *       - equirectangular: yaw/pitch → UV linearly, scaled by hFov/vFov (the source's actual
 *         covered field of view — full 360×180 or a partial panorama).
 *       - perspective: the content direction is projected into a virtual camera's image plane
 *         (standard pinhole/tangent projection) — `originOffset` doubles as that camera's optical
 *         center, `yawOffsetDeg`/`pitchOffsetDeg` as its orientation, `hFovDeg`/`vFovDeg` as its
 *         lens field of view.
 *       - fisheyeEquidistant / fisheyeEquisolid / domemaster / cylindrical: inverse mappings for already
 *         pre-warped 2D deliverables, so different warp exports can be compared on the same dome.
 *     All mappings are compiled into the same shader program so switching projection never
 *     triggers a shader recompile.
 *     Both directions are computed per-fragment from the interpolated object-space position rather
 *     than interpolating an already-computed angle, so there's no seam artefact at yaw ±180 (angle
 *     interpolation would average across the wrap; position interpolation doesn't).
 *
 * V1 constraint: the mask boundary is driven by exactly three control points (front @ yaw 0,
 * side @ yaw ~90, rear @ yaw 180), matching the default VenueConfig and the GUI sliders. If a
 * future venue profile needs more control points, this shader's minPitchForYaw() needs a matching
 * general form (or a 1D LUT texture) — see docs/ROADMAP.md V2.
 *
 * 屏幕位置几何校正（`uWarpToEye`，见 docs/SCREEN_DECOUPLING_DESIGN.md「内屏偏心与观众视觉校正」）：
 * 内屏（Media Plane）现在可以拖离场馆几何中心（见 core/ScreenPlacementValidation.ts）。默认情况
 * 下（`uWarpToEye = false`）内容方向仍然是"内容参考原点 → 表面点"，而 `uOriginOffset` 是相对内屏
 * 自身局部坐标系的偏移——也就是说内屏挪到哪儿，这份映射就刚性地跟着挪到哪儿（如同一面真实 LED 墙，
 * 每个像素点该发什么色是焊死在墙上的，不会因为墙搬了家而改变），这会让固定座位的观众看到透视变形
 * （内屏原本假设的"理想观看点"和观众实际眼位不再重合）。
 *
 * 打开 `uWarpToEye` 后，改用"固定的观众参考眼位 → 表面点"重新计算内容方向——效果上等价于把
 * `uOriginOffset` 的参照系从"内屏自己的局部原点"换成"世界坐标系里固定不动的观众参考眼位"，其余
 * 计算完全不变。这是穹顶/球幕投影几何校正的标准做法（内屏挪动时，仍按同一个固定观看点重新反算每个
 * 物理表面点该显示的内容，而不是让内容随着屏幕一起刚性平移），使得该参考眼位看到的画面在内屏移动后
 * 依然保持未变形——但仅对这一个参考点成立：一块物理曲面在同一时刻只能为一个观看点做到完全校正，其余
 * 座位仍会有不同程度的残余畸变，这是任何单一物理曲面显示系统（包括真实穹顶投影/LED 球幕）都绕不开的
 * 物理限制。
 *
 * 数学推导（含内屏俯仰角 `uMeshTiltRad`，围绕局部 X 轴的刚体旋转，见 core/VenueConfig.ts
 * `MediaPlaneConfig.tiltDeg`）：世界坐标点 = R(tilt) · 物体坐标点 + meshWorldOffset，R 是绕 X 轴的
 * 旋转矩阵。关闭 uWarpToEye 时不需要管这个——mask 边界和内容采样全程只用物体空间的 `vObjPos`，跟着
 * 整个 mesh 刚性旋转/平移是免费得到的（本来就没有转换到世界空间）。打开 uWarpToEye 时，为了保持"物体
 * 空间统一处理两种情况"的写法，把观众眼位也反向旋转回物体空间：
 * `originObjectSpace = R(tilt)⁻¹ · (eyeWorldPos - meshWorldOffset)`，纯旋转矩阵的逆等于转置，绕单轴
 * 旋转的转置又等于绕同一轴转相反角度，所以直接用 `R(-tilt)` 而不需要真的构造矩阵求逆——见下方
 * `toObjectSpaceInverseTilt()`。`tiltDeg = 0` 时 `R(0) = I`，退化成纯平移那版公式，完全向后兼容。
 */

const VERTEX_SHADER = /* glsl */ `
varying vec3 vObjPos;

void main() {
  // Object-space position — NOT world space, and deliberately so: mask boundary + (non-warp)
  // content sampling are computed entirely from this in the fragment shader below, which is what
  // makes both of them rotate/translate rigidly with the mesh for free, no matter how
  // mesh.rotation/mesh.position are set (see SceneBuilder.ts, main.ts's placement drag/tilt
  // handling). Only the uWarpToEye branch needs to know the actual world transform, via separate
  // uniforms (uMeshWorldOffset, uMeshTiltRad) rather than through this varying.
  vObjPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D map;
uniform bool uHasMap;
uniform vec3 uMaskYaw;   // (front, side, rear) absolute yaw control points, ascending
uniform vec3 uMaskPitch; // matching minPitch values, degrees
uniform float uFeatherDeg;
uniform float uOpacity;
uniform bool uSolid;
uniform vec3 uSolidColor;
uniform bool uInvert; // true = render the NON-screen region instead (diagnostics "Non-Screen Area")

// Content mapping (see src/content/ERPManifest.ts) — all no-ops at their defaults (origin at the
// dome center, full 360×180 FOV, zero offsets), matching a full, centered equirect panorama.
uniform int uProjection;      // 0=equirectangular, 1=perspective, 2=fisheye equidistant, 3=fisheye equisolid, 4=cylindrical, 5=domemaster
uniform vec3 uOriginOffset;   // content reference origin / virtual camera position, object-space meters offset from dome center
uniform float uHFovDeg;       // equirect: source's horizontal FOV. perspective: camera lens horizontal FOV.
uniform float uVFovDeg;       // same, vertically.
uniform float uYawOffsetDeg;  // equirect: content yaw rotation. perspective: camera yaw orientation.
uniform float uPitchOffsetDeg;
uniform bool uHFlip;
uniform bool uVFlip;
uniform float uSurfaceRadius;         // horizontal-section radius in the X/Z plane
uniform float uSurfaceDomeRadius; // local Z' dome radius, independent from circular X'/Y' radius

// 屏幕位置几何校正（见文件顶部大注释「屏幕位置几何校正」一节）——内屏拖离场馆中心后，是否按固定的
// 观众参考眼位重新计算内容方向，而不是刚性跟着内屏一起平移。
uniform bool uWarpToEye;
uniform vec3 uMeshWorldOffset;     // 内屏 mesh.position，世界坐标平移量
uniform float uMeshTiltRad;        // 内屏 mesh.rotation.x，绕局部 X 轴的俯仰角（弧度）
uniform vec3 uReferenceEyeWorldPos; // 固定的观众参考眼位，世界坐标

// R(tilt)⁻¹ = R(-tilt)（绕单轴旋转矩阵的逆 = 转置 = 转相反角度），把一个"世界坐标系下的方向量"转回
// 内屏自己未旋转前的物体坐标系——只在 uWarpToEye 分支里用得到，见文件顶部大注释的推导。
vec3 toObjectSpaceInverseTilt(vec3 v) {
  float c = cos(uMeshTiltRad);
  float s = sin(uMeshTiltRad);
  return vec3(v.x, v.y * c + v.z * s, -v.y * s + v.z * c);
}

// LED pixelation preview (diagnostics only — see docs/ROADMAP.md, real per-LED/cabinet mapping is
// V4 scope). Snaps the CONTENT direction to the center of a (uLedCountX × uLedCountY) angular grid
// cell before sampling, so every fragment inside one LED cell reads the exact same texel — a real
// LED emits one flat color, it doesn't interpolate sub-pixel like the default smooth shader does.
// The mask boundary/feather is untouched (still driven by the true, unsnapped physical direction)
// because this diagnostic is about validating the content mapping's color-per-LED plausibility, not
// re-modeling the screen's physical edge.
uniform bool uLedPixelate;
uniform float uLedCountX; // LED columns across the full 360° yaw range
uniform float uLedCountY; // LED rows across the full 180° pitch range

varying vec3 vObjPos;

const float RAD2DEG = 57.29577951308232;
const float DEG2RAD = 0.017453292519943295;

float cosineEase(float a, float b, float t) {
  float tt = 0.5 - 0.5 * cos(clamp(t, 0.0, 1.0) * 3.14159265359);
  return mix(a, b, tt);
}

float minPitchForYaw(float yawDeg) {
  float absYaw = abs(yawDeg);
  if (absYaw <= uMaskYaw.x) return uMaskPitch.x;
  if (absYaw >= uMaskYaw.z) return uMaskPitch.z;
  if (absYaw <= uMaskYaw.y) {
    float t = (absYaw - uMaskYaw.x) / max(uMaskYaw.y - uMaskYaw.x, 1e-5);
    return cosineEase(uMaskPitch.x, uMaskPitch.y, t);
  }
  float t = (absYaw - uMaskYaw.y) / max(uMaskYaw.z - uMaskYaw.y, 1e-5);
  return cosineEase(uMaskPitch.y, uMaskPitch.z, t);
}

vec3 surfaceMappingDirection(vec3 surfacePos, vec3 originPos) {
  vec3 rel = surfacePos - originPos;
  return normalize(vec3(
    rel.x / max(uSurfaceRadius, 1e-5),
    rel.z / max(uSurfaceRadius, 1e-5),
    rel.y / max(uSurfaceDomeRadius, 1e-5)
  ));
}

// Convert a Three.js object-space displacement (Y-up) into the dome's logical Z-up ray.
// Content direction is the real ray from the content origin; inverse-axis ellipsoid scaling is
// reserved for the physical mask parameterization above.
vec3 contentRayDirection(vec3 surfacePos, vec3 originPos) {
  vec3 rel = surfacePos - originPos;
  vec3 logicalRay = vec3(rel.x, rel.z, rel.y);
  float rayLengthSq = dot(logicalRay, logicalRay);
  return rayLengthSq > 1e-12 ? logicalRay * inversesqrt(rayLengthSq) : vec3(0.0, 0.0, 1.0);
}

void cameraBasis(out vec3 forward, out vec3 right, out vec3 up) {
  float yawRad = radians(uYawOffsetDeg);
  float pitchRad = radians(uPitchOffsetDeg);
  forward = vec3(cos(pitchRad) * sin(yawRad), -cos(pitchRad) * cos(yawRad), sin(pitchRad));
  vec3 worldUpRef = abs(forward.z) > 0.98 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
  right = normalize(cross(worldUpRef, forward));
  up = normalize(cross(forward, right));
}

bool mapPerspective(vec3 dContent, out float u, out float v) {
  vec3 forward;
  vec3 right;
  vec3 up;
  cameraBasis(forward, right, up);

  float zCam = dot(dContent, forward);
  float xCam = dot(dContent, right);
  float yCam = dot(dContent, up);

  if (zCam <= 1e-4) {
    u = -1.0;
    v = -1.0;
    return false;
  }

  float halfW = tan(radians(uHFovDeg) * 0.5);
  float halfH = tan(radians(uVFovDeg) * 0.5);
  u = 0.5 + (xCam / zCam) / (2.0 * halfW);
  v = 0.5 - (yCam / zCam) / (2.0 * halfH);
  return true;
}

bool mapFisheye(vec3 dContent, bool equisolid, bool zenithAxis, out float u, out float v) {
  vec3 forward;
  vec3 right;
  vec3 up;
  if (zenithAxis) {
    forward = vec3(0.0, 0.0, 1.0);
    right = vec3(1.0, 0.0, 0.0);
    up = vec3(0.0, 1.0, 0.0);
  } else {
    cameraBasis(forward, right, up);
  }

  float zCam = dot(dContent, forward);
  float xCam = dot(dContent, right);
  float yCam = dot(dContent, up);
  float theta = acos(clamp(zCam, -1.0, 1.0));
  float xyLen = length(vec2(xCam, yCam));
  float cosPhi = xyLen > 1e-6 ? xCam / xyLen : 0.0;
  float sinPhi = xyLen > 1e-6 ? yCam / xyLen : 0.0;

  float halfW = radians(uHFovDeg) * 0.5;
  float halfH = radians(uVFovDeg) * 0.5;
  float radial = equisolid ? sin(theta * 0.5) : theta;
  float maxX = equisolid ? sin(halfW * 0.5) : halfW;
  float maxY = equisolid ? sin(halfH * 0.5) : halfH;
  u = 0.5 + 0.5 * (radial * cosPhi) / max(maxX, 1e-5);
  v = 0.5 - 0.5 * (radial * sinPhi) / max(maxY, 1e-5);
  return theta <= max(halfW, halfH) + 1e-5;
}

bool mapCylindrical(vec3 dContent, out float u, out float v) {
  vec3 forward;
  vec3 right;
  vec3 up;
  cameraBasis(forward, right, up);

  float zCam = dot(dContent, forward);
  float xCam = dot(dContent, right);
  float yCam = dot(dContent, up);
  float yaw = atan(xCam, zCam);
  float halfW = radians(uHFovDeg) * 0.5;
  float halfH = radians(uVFovDeg) * 0.5;
  float horizontalLen = length(vec2(xCam, zCam));
  if (horizontalLen <= 1e-5) {
    u = -1.0;
    v = -1.0;
    return false;
  }
  u = 0.5 + yaw / max(radians(uHFovDeg), 1e-5);
  v = 0.5 - (yCam / horizontalLen) / (2.0 * tan(max(halfH, 1e-5)));
  return abs(yaw) <= halfW + 1e-5;
}

void main() {
  vec3 nPhys = surfaceMappingDirection(vObjPos, vec3(0.0));
  float physYawDeg = atan(nPhys.x, -nPhys.y) * RAD2DEG;
  float physPitchDeg = asin(clamp(nPhys.z, -1.0, 1.0)) * RAD2DEG;

  float minPitch = minPitchForYaw(physYawDeg);
  float alpha = minPitch <= -90.0
    ? 1.0
    : smoothstep(minPitch - uFeatherDeg, minPitch + uFeatherDeg, physPitchDeg);
  if (uInvert) alpha = 1.0 - alpha;
  if (alpha < 0.003) discard;

  vec3 color = uSolidColor;
  if (!uSolid && uHasMap) {
    vec3 originObjectSpace = uWarpToEye ? toObjectSpaceInverseTilt(uReferenceEyeWorldPos - uMeshWorldOffset) : vec3(0.0);
    vec3 contentOrigin = originObjectSpace + uOriginOffset;
    vec3 dContent = contentRayDirection(vObjPos, contentOrigin);
    float contentYawDeg = atan(dContent.x, -dContent.y) * RAD2DEG;
    float contentPitchDeg = asin(clamp(dContent.z, -1.0, 1.0)) * RAD2DEG;
    if (uLedPixelate) {
      float cellYawDeg = 360.0 / max(uLedCountX, 1.0);
      float cellPitchDeg = 180.0 / max(uLedCountY, 1.0);
      float idxYaw = floor((contentYawDeg + 180.0) / cellYawDeg);
      float idxPitch = floor((contentPitchDeg + 90.0) / cellPitchDeg);
      float snapYawDeg = -180.0 + (idxYaw + 0.5) * cellYawDeg;
      float snapPitchDeg = clamp(-90.0 + (idxPitch + 0.5) * cellPitchDeg, -90.0, 90.0);
      contentYawDeg = snapYawDeg;
      contentPitchDeg = snapPitchDeg;
      float syRad = radians(contentYawDeg);
      float spRad = radians(contentPitchDeg);
      dContent = vec3(cos(spRad) * sin(syRad), -cos(spRad) * cos(syRad), sin(spRad));
    }
    // 等效原点：默认（uWarpToEye=false）是内屏自身局部原点 (0,0,0)，跟以前完全一样；打开后换成
    // "观众参考眼位在内屏局部坐标系下的位置"（世界坐标先反平移、再反旋转回物体空间，见文件顶部注释
    // 的推导——反平移和反旋转的顺序很重要：先减去平移量得到"以内屏中心为原点的世界坐标系下的相对
    // 位置"，再用 R(-tilt) 转回内屏未旋转前的物体坐标系）。
    float u, v;
    bool inBounds;

    if (uProjection == 1) {
      inBounds = mapPerspective(dContent, u, v);
    } else if (uProjection == 2) {
      inBounds = mapFisheye(dContent, false, false, u, v);
    } else if (uProjection == 3) {
      inBounds = mapFisheye(dContent, true, false, u, v);
    } else if (uProjection == 4) {
      inBounds = mapCylindrical(dContent, u, v);
    } else if (uProjection == 5) {
      inBounds = mapFisheye(dContent, false, true, u, v);
    } else {
      float cYawDeg = contentYawDeg - uYawOffsetDeg;
      float cPitchDeg = contentPitchDeg - uPitchOffsetDeg;
      cYawDeg = mod(cYawDeg + 180.0, 360.0) - 180.0; // fold into (-180, 180] after the offset
      u = 0.5 + cYawDeg / uHFovDeg;
      v = 0.5 - cPitchDeg / uVFovDeg;
      inBounds = true;
    }

    if (uHFlip) u = 1.0 - u;
    if (uVFlip) v = 1.0 - v;
    inBounds = inBounds && u >= 0.0 && u <= 1.0 && v >= 0.0 && v <= 1.0;

    // Outside the source content's covered FOV window (partial panorama, behind/outside the
    // virtual camera, or an offset pushed the window off this fragment) — leave the dome unfilled
    // here instead of smearing edge pixels.
    if (!inBounds) discard;
    color = texture2D(map, vec2(u, v)).rgb;
  }

  gl_FragColor = vec4(color, alpha * uOpacity);
}
`;

export interface ContentMapping {
  projection: ERPProjection;
  hFovDeg: number;
  vFovDeg: number;
  yawOffsetDeg: number;
  pitchOffsetDeg: number;
  hFlip: boolean;
  vFlip: boolean;
  originOffset: { x: number; y: number; z: number };
}

export interface ERPMaskMaterialOptions {
  map?: THREE.Texture | null;
  maskControlPoints: MaskControlPoint[];
  featherDeg: number;
  opacity?: number;
  solid?: boolean;
  solidColor?: THREE.ColorRepresentation;
  invert?: boolean;
  content?: ContentMapping;
  ledPixelate?: { enabled: boolean; countX: number; countY: number };
  surfaceRadius?: number;
  surfaceDomeRadius?: number;
}

const DEFAULT_CONTENT_MAPPING: ContentMapping = {
  projection: "equirectangular",
  hFovDeg: 360,
  vFovDeg: 180,
  yawOffsetDeg: 0,
  pitchOffsetDeg: 0,
  hFlip: false,
  vFlip: false,
  originOffset: { x: 0, y: 0, z: 0 },
};

function projectionToId(projection: ERPProjection): number {
  switch (projection) {
    case "perspective":
      return 1;
    case "fisheyeEquidistant":
      return 2;
    case "fisheyeEquisolid":
      return 3;
    case "cylindrical":
      return 4;
    case "domemaster":
      return 5;
    case "equirectangular":
    default:
      return 0;
  }
}

export class ERPMaskMaterial extends THREE.ShaderMaterial {
  constructor(opts: ERPMaskMaterialOptions) {
    const [front, side, rear] = opts.maskControlPoints;
    const content = opts.content ?? DEFAULT_CONTENT_MAPPING;
    super({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      // DoubleSide: the mesh is normally viewed from inside the concave sphere, but Exterior
      // Cutaway looks at it from outside, and getting winding direction wrong would silently
      // render an invisible sphere — DoubleSide trades a small fill-rate cost for guaranteed
      // visibility (and correct raycasting) from either side.
      side: THREE.DoubleSide,
      depthWrite: false,
      uniforms: {
        map: { value: opts.map ?? null },
        uHasMap: { value: !!opts.map },
        uMaskYaw: { value: new THREE.Vector3(front.yawDeg, side.yawDeg, rear.yawDeg) },
        uMaskPitch: { value: new THREE.Vector3(front.minPitchDeg, side.minPitchDeg, rear.minPitchDeg) },
        uFeatherDeg: { value: opts.featherDeg },
        uOpacity: { value: opts.opacity ?? 1 },
        uSolid: { value: !!opts.solid },
        uSolidColor: { value: new THREE.Color(opts.solidColor ?? 0x4fd1c5) },
        uInvert: { value: !!opts.invert },
        uProjection: { value: projectionToId(content.projection) },
        uOriginOffset: { value: new THREE.Vector3(content.originOffset.x, content.originOffset.y, content.originOffset.z) },
        uHFovDeg: { value: content.hFovDeg },
        uVFovDeg: { value: content.vFovDeg },
        uYawOffsetDeg: { value: content.yawOffsetDeg },
        uPitchOffsetDeg: { value: content.pitchOffsetDeg },
        uHFlip: { value: content.hFlip },
        uVFlip: { value: content.vFlip },
        uSurfaceRadius: { value: opts.surfaceRadius ?? 1 },
        uSurfaceDomeRadius: { value: opts.surfaceDomeRadius ?? opts.surfaceRadius ?? 1 },
        uLedPixelate: { value: !!opts.ledPixelate?.enabled },
        uLedCountX: { value: opts.ledPixelate?.countX ?? 240 },
        uLedCountY: { value: opts.ledPixelate?.countY ?? 120 },
        uWarpToEye: { value: false },
        uMeshWorldOffset: { value: new THREE.Vector3() },
        uMeshTiltRad: { value: 0 },
        uReferenceEyeWorldPos: { value: new THREE.Vector3() },
      },
    });
  }

  setMap(tex: THREE.Texture | null) {
    this.uniforms.map.value = tex;
    this.uniforms.uHasMap.value = !!tex;
  }

  setMaskControlPoints(points: MaskControlPoint[]) {
    const [front, side, rear] = points;
    this.uniforms.uMaskYaw.value.set(front.yawDeg, side.yawDeg, rear.yawDeg);
    this.uniforms.uMaskPitch.value.set(front.minPitchDeg, side.minPitchDeg, rear.minPitchDeg);
  }

  setFeatherDeg(deg: number) {
    this.uniforms.uFeatherDeg.value = deg;
  }

  setOpacity(o: number) {
    this.uniforms.uOpacity.value = o;
  }

  setSolid(solid: boolean, color?: THREE.ColorRepresentation) {
    this.uniforms.uSolid.value = solid;
    if (color !== undefined) this.uniforms.uSolidColor.value.set(color);
  }

  /** True to render the NON-screen region instead (used by the "Non-Screen Area" diagnostics layer). */
  setInvert(invert: boolean) {
    this.uniforms.uInvert.value = invert;
  }

  /** LED pixelation preview (diagnostics only, see fragment shader comment above). `countX`/`countY`
   *  are LED counts across the full 360°/180° angular range — a visualization density knob, not a
   *  claim about the venue's real pixel pitch. */
  setLedPixelate(enabled: boolean, countX: number, countY: number) {
    this.uniforms.uLedPixelate.value = enabled;
    this.uniforms.uLedCountX.value = countX;
    this.uniforms.uLedCountY.value = countY;
  }

  setSurfaceAxes(radius: number, domeRadius: number) {
    this.uniforms.uSurfaceRadius.value = radius;
    this.uniforms.uSurfaceDomeRadius.value = domeRadius;
  }

  /** Turns the "屏幕位置几何校正" on/off (see fragment shader comment above) and keeps the world-space
   *  uniforms it needs in sync. `meshWorldOffset`/`meshTiltRad` should be the media-plane mesh's
   *  current `.position`/`.rotation.x` (call this again whenever either changes — drag, slider, or
   *  venue rebuild); `referenceEyeWorldPos` is the fixed audience point the correction targets
   *  (main.ts computes it the same way CameraPresets.ts derives `centralEye`, so this always matches
   *  that seat). */
  setWarpToReferenceEye(enabled: boolean, meshWorldOffset: THREE.Vector3, meshTiltRad: number, referenceEyeWorldPos: THREE.Vector3) {
    this.uniforms.uWarpToEye.value = enabled;
    this.uniforms.uMeshWorldOffset.value.copy(meshWorldOffset);
    this.uniforms.uMeshTiltRad.value = meshTiltRad;
    this.uniforms.uReferenceEyeWorldPos.value.copy(referenceEyeWorldPos);
  }

  /** Applies the manifest's geometric mapping parameters (everything except colorSpace, which is
   *  a texture property — see main.ts). Cheap uniform writes; safe to call on every GUI tweak.
   *  `projection` just changes an integer uniform — all mappings are compiled into the same shader
   *  program, so switching it never triggers a shader recompile. */
  setContentMapping(m: ContentMapping) {
    this.uniforms.uProjection.value = projectionToId(m.projection);
    this.uniforms.uOriginOffset.value.set(m.originOffset.x, m.originOffset.y, m.originOffset.z);
    this.uniforms.uHFovDeg.value = m.hFovDeg;
    this.uniforms.uVFovDeg.value = m.vFovDeg;
    this.uniforms.uYawOffsetDeg.value = m.yawOffsetDeg;
    this.uniforms.uPitchOffsetDeg.value = m.pitchOffsetDeg;
    this.uniforms.uHFlip.value = m.hFlip;
    this.uniforms.uVFlip.value = m.vFlip;
  }
}
