import * as THREE from "three";

/**
 * Media input = the media file itself + an accompanying manifest describing how to place it on
 * the dome. The manifest is the single source of truth for projection, orientation, content
 * reference origin and color interpretation — none of these are ever inferred from the media file
 * itself (pixel dimensions, aspect ratio, codec tags). A video that happens to be 4096×2048 is not
 * assumed to be a full 360°×180° equirectangular panorama just because its aspect ratio is 2:1;
 * that assumption has to be stated, either in a loaded manifest.json or via the GUI controls.
 *
 * Projection names describe the 2D source's encoding. The shader applies the inverse mapping from
 * a dome direction back into that 2D image/video, which lets multiple pre-warped exports of the
 * same content be compared on the same 3D screen.
 *
 *  - "equirectangular" — a full-360°-capable panorama (video/image/EXR/HDR). `hFovDeg`/`vFovDeg`
 *    is the ANGULAR EXTENT the source pixels cover (360×180 for a full pano, less for a partial
 *    one); sampling maps yaw/pitch to UV linearly. No camera parameters needed — the source
 *    already carries color for every direction it covers.
 *  - "perspective" — a single ordinary flat image/video rendered by a virtual camera (e.g. a sim
 *    engine's output, sRGB PNG/JPG/MP4). `hFovDeg`/`vFovDeg` is that camera's LENS field of view
 *    (its intrinsics); `originOffset` is the camera's optical center / position (its extrinsics
 *    translation — the project brief's reference scenario puts this at the dome center, which is
 *    also this field's default); `yawOffsetDeg`/`pitchOffsetDeg` is the camera's orientation (its
 *    extrinsics rotation). Sampling projects the content direction into the camera's image plane
 *    with a standard pinhole (tangent) projection instead of the equirect's linear angle mapping;
 *    points behind the camera or outside its lens FOV show no content, same as an out-of-window
 *    equirect sample. Reusing the equirect fields as camera intrinsics/extrinsics is deliberate —
 *    "where the sampling reference point is / how it's oriented / how wide its coverage is" is the
 *    same mental model in both cases, only the LED→pixel formula differs (see ERPMaskMaterial.ts).
 *
 *  - "fisheyeEquidistant" — circular/elliptical fisheye or dome-master style output where image
 *    radius is linear in angle from the optical axis.
 *  - "fisheyeEquisolid" — circular/elliptical fisheye where image radius is linear in
 *    sin(theta / 2), common in lens models.
 *  - "domemaster" — 180° equidistant fisheye with the optical axis fixed to the dome zenith
 *    (pitch +90°). This differs from forward-facing fisheye by a 90° pitch basis.
 *  - "cylindrical" — horizontal angle maps linearly across the image, while vertical placement is
 *    projected onto a cylinder; useful for very wide non-ERP content.
 */
export type ERPProjection =
  | "equirectangular"
  | "perspective"
  | "fisheyeEquidistant"
  | "fisheyeEquisolid"
  | "domemaster"
  | "cylindrical";

export const SUPPORTED_PROJECTIONS: readonly ERPProjection[] = [
  "equirectangular",
  "perspective",
  "fisheyeEquidistant",
  "fisheyeEquisolid",
  "domemaster",
  "cylindrical",
];

export interface ERPManifest {
  /** Required — no default. Loading a manifest that omits this, or names an unsupported value,
   *  is a hard error; it is never guessed from the media's width/height ratio. */
  projection: ERPProjection;
  /** Equirectangular/cylindrical: horizontal field of view actually covered by the source pixels, degrees,
   *  range (0, 360] — 360 = a full wrap-around panorama, less means a partial pano (e.g. a
   *  narrower capture rig), and the rest of the dome's yaw range simply shows no content.
   *  Perspective/fisheye: the virtual camera/lens horizontal field of view (intrinsics), degrees. */
  hFovDeg: number;
  /** Same as `hFovDeg`, vertically. Range (0, 180]. */
  vFovDeg: number;
  /** Equirect: rotates the content horizontally so its authored "forward" lines up with yaw 0°
   *  (the stage direction, see SphericalMath.ts), degrees. Perspective: the virtual camera's yaw
   *  orientation (extrinsics rotation) in the same yaw convention. */
  yawOffsetDeg: number;
  /** Same as `yawOffsetDeg`, for pitch (equirect: content tilt; perspective: camera pitch). */
  pitchOffsetDeg: number;
  /** Mirrors the content left/right. Some capture/export paths flip it. */
  hFlip: boolean;
  /** Mirrors the content top/bottom (ceiling/floor swapped). Some decoders/exports disagree on
   *  scanline order — an EXR is a common source of this, since OpenEXR's `lineOrder` header field
   *  doesn't force a single top-to-bottom convention the way most image/video codecs do. */
  vFlip: boolean;
  /** How to interpret pixel values: "srgb" for a normal display-referred export, "linear" for
   *  scene-linear source data (e.g. an EXR/HDR-derived intermediate) that still needs the sRGB
   *  transfer function applied on the way to the screen. */
  colorSpace: "srgb" | "linear";
  /** Equirect: content reference origin — the point the content was authored/captured from — as a
   *  meters offset from the Media Plane sphere center, in the same frame. Perspective: the virtual
   *  camera's optical center / position (extrinsics translation), same frame. Either way, distinct
   *  from BOTH the sphere center and the viewer eye position: sampling direction is always
   *  (surface point − this origin), never (surface point − eye), which is what keeps the same
   *  texture correct from every seat instead of re-centering itself under whichever eye is
   *  currently looking (see docs/ARCHITECTURE.md, "内容参考原点"). Zero — i.e. the dome center —
   *  for content captured/rendered from there, which is the common case for both projections (the
   *  project brief's reference scenario puts the virtual camera's optical center at the dome
   *  center O). */
  originOffset: { x: number; y: number; z: number };
}

export const DEFAULT_ERP_MANIFEST: ERPManifest = {
  projection: "equirectangular",
  hFovDeg: 360,
  vFovDeg: 180,
  yawOffsetDeg: 0,
  pitchOffsetDeg: 0,
  hFlip: false,
  vFlip: false,
  colorSpace: "srgb",
  originOffset: { x: 0, y: 0, z: 0 },
};

export type ManifestParseResult = { ok: true; manifest: ERPManifest } | { ok: false; error: string };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Parses + validates a manifest JSON object. `projection` is the one field this function refuses
 * to default — it must be present in `raw` and be a supported value, or parsing fails with an
 * explanatory error. Every other field falls back to DEFAULT_ERP_MANIFEST when omitted, so a
 * minimal manifest can just declare `{ "projection": "equirectangular" }` and rely on defaults for
 * the rest (full 360×180, no offsets, sRGB, zero origin).
 */
export function parseManifest(raw: unknown): ManifestParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "清单不是一个 JSON 对象" };
  }
  const obj = raw as Record<string, unknown>;

  const projection = obj.projection;
  if (typeof projection !== "string" || !SUPPORTED_PROJECTIONS.includes(projection as ERPProjection)) {
    return {
      ok: false,
      error:
        `清单缺少有效的 "projection" 字段（当前只支持 ${SUPPORTED_PROJECTIONS.join(" / ")}）。` +
        `不会根据素材宽高比自动猜测投影类型，请在清单里显式声明。`,
    };
  }

  const manifest: ERPManifest = { ...DEFAULT_ERP_MANIFEST, projection: projection as ERPProjection };

  if (obj.hFovDeg !== undefined) {
    if (!isFiniteNumber(obj.hFovDeg) || obj.hFovDeg <= 0 || obj.hFovDeg > 360) {
      return { ok: false, error: "hFovDeg 必须是 (0, 360] 之间的数字" };
    }
    manifest.hFovDeg = obj.hFovDeg;
  }
  if (obj.vFovDeg !== undefined) {
    if (!isFiniteNumber(obj.vFovDeg) || obj.vFovDeg <= 0 || obj.vFovDeg > 180) {
      return { ok: false, error: "vFovDeg 必须是 (0, 180] 之间的数字" };
    }
    manifest.vFovDeg = obj.vFovDeg;
  }
  if (obj.yawOffsetDeg !== undefined) {
    if (!isFiniteNumber(obj.yawOffsetDeg)) return { ok: false, error: "yawOffsetDeg 必须是数字" };
    manifest.yawOffsetDeg = obj.yawOffsetDeg;
  }
  if (obj.pitchOffsetDeg !== undefined) {
    if (!isFiniteNumber(obj.pitchOffsetDeg)) return { ok: false, error: "pitchOffsetDeg 必须是数字" };
    manifest.pitchOffsetDeg = obj.pitchOffsetDeg;
  }
  if (obj.hFlip !== undefined) {
    if (typeof obj.hFlip !== "boolean") return { ok: false, error: "hFlip 必须是 true / false" };
    manifest.hFlip = obj.hFlip;
  }
  if (obj.vFlip !== undefined) {
    if (typeof obj.vFlip !== "boolean") return { ok: false, error: "vFlip 必须是 true / false" };
    manifest.vFlip = obj.vFlip;
  }
  if (obj.colorSpace !== undefined) {
    if (obj.colorSpace !== "srgb" && obj.colorSpace !== "linear") {
      return { ok: false, error: 'colorSpace 必须是 "srgb" 或 "linear"' };
    }
    manifest.colorSpace = obj.colorSpace;
  }
  if (obj.originOffset !== undefined) {
    const o = obj.originOffset;
    if (typeof o !== "object" || o === null) return { ok: false, error: "originOffset 必须是 {x, y, z} 对象" };
    const oo = o as Record<string, unknown>;
    const x = oo.x ?? 0;
    const y = oo.y ?? 0;
    const z = oo.z ?? 0;
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
      return { ok: false, error: "originOffset.x / y / z 必须是数字" };
    }
    manifest.originOffset = { x, y, z };
  }

  return { ok: true, manifest };
}

export function manifestColorSpaceToThree(cs: ERPManifest["colorSpace"]): THREE.ColorSpace {
  return cs === "linear" ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
}
