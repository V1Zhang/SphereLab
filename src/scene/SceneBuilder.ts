import * as THREE from "three";
import { VenueConfig } from "../core/VenueConfig";
import { buildERPSphereGeometry, mediaPlaneDomeRadius } from "../core/MediaPlaneGeometry";
import { ERPMaskMaterial } from "../materials/ERPMaskMaterial";
import { buildVenueGroup, VenueGroup } from "../core/VenueGeometry";
import { buildDiagnosticsLayers, DiagnosticsLayers } from "../diagnostics/DiagnosticsOverlay";

/**
 * Assembles the full scene graph from a VenueConfig: media plane (actual screen), non-screen
 * area (inverted-mask diagnostic), venue (stage/audience/shell) and diagnostics overlay. Owns
 * disposal/rebuild so GUI-driven parameter changes (radius, mask control points, venue sizing)
 * can swap geometry live without leaking GPU resources.
 */

export interface SceneBundle {
  scene: THREE.Scene;
  mediaPlaneMesh: THREE.Mesh;
  mediaMaterial: ERPMaskMaterial;
  nonScreenMesh: THREE.Mesh;
  nonScreenMaterial: ERPMaskMaterial;
  venue: VenueGroup;
  diagnostics: DiagnosticsLayers;
  cutawayPlane: THREE.Plane;
  dispose: () => void;
}

export function buildScene(cfg: VenueConfig, initialMap: THREE.Texture | null): SceneBundle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070a);

  const hemi = new THREE.HemisphereLight(0x8fa8c0, 0x14161c, 0.9);
  const key = new THREE.DirectionalLight(0xffffff, 0.6);
  key.position.set(20, 40, 10);
  scene.add(hemi, key);

  const center = new THREE.Vector3(cfg.mediaPlane.centerOffsetX, cfg.mediaPlane.centerHeight, cfg.mediaPlane.centerOffsetZ);
  const tiltRad = THREE.MathUtils.degToRad(cfg.mediaPlane.tiltDeg);
  const domeRadius = mediaPlaneDomeRadius(cfg.mediaPlane.curvature);

  const mediaGeo = buildERPSphereGeometry(cfg.mediaPlane.radius, cfg.mediaPlane.curvature, cfg.mediaPlane.yawSegments, cfg.mediaPlane.pitchSegments);
  const mediaMaterial = new ERPMaskMaterial({
    map: initialMap,
    maskControlPoints: cfg.mediaPlane.maskControlPoints,
    featherDeg: cfg.mediaPlane.maskFeatherDeg,
    surfaceRadius: cfg.mediaPlane.radius,
    surfaceDomeRadius: domeRadius,
  });
  const mediaPlaneMesh = new THREE.Mesh(mediaGeo, mediaMaterial);
  mediaPlaneMesh.position.copy(center);
  // Rigid-body tilt around the local X axis — see VenueConfig.ts `MediaPlaneConfig.tiltDeg` for the
  // sign convention and why this is the media plane's first-ever rotation (previously translation
  // only). Mask boundary + content mapping both ride along for free (see ERPMaskMaterial.ts).
  mediaPlaneMesh.rotation.x = tiltRad;
  mediaPlaneMesh.name = "mediaPlane";

  const nonScreenGeo = buildERPSphereGeometry(cfg.mediaPlane.radius, cfg.mediaPlane.curvature, 96, 48);
  const nonScreenMaterial = new ERPMaskMaterial({
    maskControlPoints: cfg.mediaPlane.maskControlPoints,
    featherDeg: cfg.mediaPlane.maskFeatherDeg,
    surfaceRadius: cfg.mediaPlane.radius,
    surfaceDomeRadius: domeRadius,
    solid: true,
    solidColor: 0xff5f5f,
    opacity: 0.28,
    invert: true,
  });
  const nonScreenMesh = new THREE.Mesh(nonScreenGeo, nonScreenMaterial);
  nonScreenMesh.position.copy(center);
  nonScreenMesh.rotation.x = tiltRad;
  nonScreenMesh.visible = false;
  nonScreenMesh.name = "nonScreenArea";

  const venue = buildVenueGroup(cfg);
  const diagnostics = buildDiagnosticsLayers(cfg);
  diagnostics.group.visible = true;

  scene.add(mediaPlaneMesh, nonScreenMesh, venue.group, diagnostics.group);

  const cutawayPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);

  const dispose = () => {
    mediaGeo.dispose();
    mediaMaterial.dispose();
    nonScreenGeo.dispose();
    nonScreenMaterial.dispose();
    venue.dispose();
    diagnostics.dispose();
  };

  return { scene, mediaPlaneMesh, mediaMaterial, nonScreenMesh, nonScreenMaterial, venue, diagnostics, cutawayPlane, dispose };
}
