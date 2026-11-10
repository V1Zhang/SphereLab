import { VenueConfig } from "../core/VenueConfig";

const COMPOUND_FILE_SIGNATURE = "d0cf11e0a1b11ae1";

export type MaxVenueOverrides = {
  [K in keyof VenueConfig]?: Partial<VenueConfig[K]>;
};

export type MaxSceneImportResult = {
  venueOverrides: MaxVenueOverrides;
  cameraLocations?: MaxCameraLocation[];
  sceneInfo: MaxSceneInfo;
  warnings: string[];
  detected: string[];
};

export type MaxSceneInfo = {
  maxVersion?: string;
  build?: string;
  vertices?: number;
  objectCount?: number;
  shapeCount?: number;
  lightCount?: number;
  cameraCount?: number;
  helperCount?: number;
  spaceWarpCount?: number;
  totalNodeCount?: number;
  rendererName?: string;
  renderWidth?: number;
  renderHeight?: number;
  renderAspect?: number;
  animationStart?: number;
  animationEnd?: number;
  renderCameras: string[];
  renderOutputPath?: string;
  stateSet?: string;
  materials: string[];
};

export type MaxCameraLocation = {
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
};

function extractStrings(bytes: Uint8Array): string[] {
  const text = new TextDecoder("latin1").decode(bytes);
  const utf16 = new TextDecoder("utf-16le").decode(bytes);
  const strings = new Set<string>();
  for (const source of [text, utf16]) {
    for (const match of source.matchAll(/[\x20-\x7e\u4e00-\u9fff][\x20-\x7e\u4e00-\u9fff]{2,}/g)) {
      strings.add(match[0].trim());
    }
  }
  return [...strings];
}

function extractEmbeddedConfig(strings: string[]): { venueOverrides: MaxVenueOverrides; cameraLocations?: MaxCameraLocation[] } | null {
  const marker = strings.find((value) => value.startsWith("SPHERELAB_CONFIG="));
  if (!marker) return null;
  try {
    const value = JSON.parse(marker.slice("SPHERELAB_CONFIG=".length));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const payload = value as Record<string, unknown>;
    return {
      venueOverrides: payload.venueConfig && typeof payload.venueConfig === "object"
        ? payload.venueConfig as MaxVenueOverrides
        : value as MaxVenueOverrides,
      cameraLocations: Array.isArray(payload.cameraLocations)
        ? payload.cameraLocations as MaxCameraLocation[]
        : undefined,
    };
  } catch {
    return null;
  }
}

function readStringValue(strings: string[], key: string): string | undefined {
  const prefix = `${key}=`;
  return strings.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim();
}

function readNumberValue(strings: string[], key: string): number | undefined {
  const value = readStringValue(strings, key);
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function readCount(strings: string[], label: string): number | undefined {
  const value = strings.find((item) => item.startsWith(`${label}:`));
  if (!value) return undefined;
  const number = Number(value.slice(label.length + 1).trim());
  return Number.isFinite(number) ? number : undefined;
}

function readSceneInfo(strings: string[]): MaxSceneInfo {
  return {
    maxVersion: readStringValue(strings, "3ds Max Version"),
    build: readStringValue(strings, "Build"),
    vertices: readNumberValue(strings, "Vertices"),
    objectCount: readCount(strings, "Objects"),
    shapeCount: readCount(strings, "Shapes"),
    lightCount: readCount(strings, "Lights"),
    cameraCount: readCount(strings, "Cameras"),
    helperCount: readCount(strings, "Helpers"),
    spaceWarpCount: readCount(strings, "Space Warps"),
    totalNodeCount: readCount(strings, "Total"),
    rendererName: readStringValue(strings, "Renderer Name"),
    renderWidth: readNumberValue(strings, "Render Width"),
    renderHeight: readNumberValue(strings, "Render Height"),
    renderAspect: readNumberValue(strings, "Render Aspect"),
    animationStart: readNumberValue(strings, "Animation Start"),
    animationEnd: readNumberValue(strings, "Animation End"),
    renderCameras: strings
      .filter((value) => /^Render Camera \d+=/.test(value))
      .map((value) => value.slice(value.indexOf("=") + 1).trim()),
    renderOutputPath: strings.find((value) => value.includes("renderoutput") && value.includes("<StateName>")),
    stateSet: strings.includes("State01") ? "State01" : undefined,
    materials: strings.filter((value) => /^Material #\d+$/.test(value)),
  };
}

/**
 * Reads the small amount of scene information that can be safely consumed without 3ds Max.
 * A .max file is a proprietary binary scene, not a text interchange format, so this deliberately
 * does not pretend to recover arbitrary node geometry. SphereLab-specific exports can carry a
 * `SPHERELAB_CONFIG=<json>` marker; otherwise a diameter in the filename (for example `40m-05.max`)
 * is used as a conservative venue-radius hint.
 */
export function parseMaxScene(bytes: ArrayBuffer, filename: string): MaxSceneImportResult {
  const data = new Uint8Array(bytes);
  const signature = [...data.slice(0, 8)].map((v) => v.toString(16).padStart(2, "0")).join("");
  if (signature !== COMPOUND_FILE_SIGNATURE) {
    throw new Error("不是受支持的 3ds Max .max 二进制文件（缺少 Compound File 标识）");
  }

  const strings = extractStrings(data);
  const embedded = extractEmbeddedConfig(strings);
  const sceneInfo = readSceneInfo(strings);
  const overrides: MaxVenueOverrides = embedded ? { ...embedded.venueOverrides } : {};
  const warnings: string[] = [];
  const detected = strings.filter((value) => /^(Sphere|Rectangle|Plane|Camera|Object|Line)\d*/.test(value));

  const diameterMatch = filename.match(/(?:^|[^\d])(\d+(?:\.\d+)?)\s*m(?:[^a-z]|$)/i);
  if (diameterMatch && !overrides.mediaPlane?.radius && !overrides.building?.shellRadius) {
    const radius = Number(diameterMatch[1]) / 2;
    overrides.mediaPlane = { radius };
    overrides.building = { shellRadius: radius };
    warnings.push(`根据文件名识别到约 ${diameterMatch[1]} m 口径，已换算为半径 ${radius} m；请在面板中确认。`);
  } else if (!embedded) {
    warnings.push("该 MAX 没有 SphereLab 参数块；未从任意 3ds Max 对象尺寸反推场馆参数，其他字段保留当前值。");
  }

  if (embedded) detected.push("SphereLab 参数块");
  return { venueOverrides: overrides, cameraLocations: embedded?.cameraLocations, sceneInfo, warnings, detected };
}
