import * as THREE from "three";
import { zUpDirectionToYawPitch } from "../utils/SphericalMath";

const CURVATURE_DISPLAY_SCALE = 1000;

export function mediaPlaneCurvatureForDomeRadius(domeRadius: number): number {
  return CURVATURE_DISPLAY_SCALE / Math.max(0.001, domeRadius);
}

export function mediaPlaneCurvatureForSphere(radius: number): number {
  return mediaPlaneCurvatureForDomeRadius(radius);
}

export function mediaPlaneDomeRadius(curvature: number): number {
  return CURVATURE_DISPLAY_SCALE / Math.max(0.001, curvature);
}

export function mediaPlaneShapeLabel(radius: number, curvature: number): "球体" | "椭球体" {
  const domeRadius = mediaPlaneDomeRadius(curvature);
  return Math.abs(domeRadius - radius) < 0.05 ? "球体" : "椭球体";
}

/**
 * Builds the media-plane surface as a complete ellipsoid (a sphere when both radii match).
 * In the venue frame, XY is the horizontal plane and Z is up. `radius` is the radius of the local
 * X'/Y' center cross-section. That cross-section is always a circle. `curvature` is converted to
 * the independent local Z' radius. The mesh tilt rotates this local frame rigidly, so X'/Y'
 * remains a circular equatorial cross-section and both +Z' and -Z' halves are present.
 *
 * The `uv` attribute is still derived from the vertex direction using the Z-up spherical helper. The shader
 * recomputes content-sampling UV per fragment from position, so it remains correct for the
 * ellipsoid and for a tilted local frame.
 */
export function buildERPSphereGeometry(radius: number, curvature: number, yawSegments: number, pitchSegments: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const dir = new THREE.Vector3();
  const domeRadius = mediaPlaneDomeRadius(curvature);

  for (let j = 0; j <= pitchSegments; j++) {
    const pitch = Math.PI * 0.5 - (j / pitchSegments) * Math.PI;
    const sectionRadius = Math.cos(pitch);
    const domeDepth = Math.sin(pitch);
    for (let i = 0; i <= yawSegments; i++) {
      const u = i / yawSegments; // seam duplicated around the circular X'/Y' opening
      const sectionAngle = u * Math.PI * 2;
      dir.set(
        sectionRadius * Math.sin(sectionAngle),
        sectionRadius * Math.cos(sectionAngle),
        domeDepth,
      );
      // Three.js remains Y-up internally: logical X'/Y'/Z' maps to world X/Z/Y respectively.
      const x = dir.x * radius;
      const y = dir.z * domeRadius;
      const z = dir.y * radius;
      positions.push(x, y, z);
      const nx = x / (radius * radius);
      const ny = y / (domeRadius * domeRadius);
      const nz = z / (radius * radius);
      const normalLen = Math.hypot(nx, ny, nz) || 1;
      normals.push(nx / normalLen, ny / normalLen, nz / normalLen);
      const { yawDeg, pitchDeg } = zUpDirectionToYawPitch(dir);
      uvs.push((yawDeg + 180) / 360, (90 - pitchDeg) / 180);
    }
  }

  const rowSize = yawSegments + 1;
  for (let j = 0; j < pitchSegments; j++) {
    for (let i = 0; i < yawSegments; i++) {
      const a = j * rowSize + i;
      const b = a + 1;
      const c = a + rowSize;
      const d = c + 1;
      // Sphere is normally viewed from the inside (concave LED wall), but Exterior Cutaway looks
      // at it from outside — ERPMaskMaterial renders DoubleSide so either direction works
      // regardless of this winding choice.
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}
