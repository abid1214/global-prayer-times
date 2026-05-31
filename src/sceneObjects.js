import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { latLonToVec3 } from "./solar.js";

// Pure three.js object factories for the globe scene (no module state). The
// Line2-based ones take `res` (drawing-buffer size) for LineMaterial.resolution.

export const SUN_DISTANCE = 60;
// Lift for surface rings (equator, subsolar trace) — avoids z-fighting.
export const SURFACE_RING_R = 1.014;
// ±12h sun-path trace, this many segments (declination drift over 24h is sub-degree).
export const SUN_TRACE_SEGMENTS = 96;
export const SUN_TRACE_HALF_MS = 12 * 3600 * 1000;

export function makePin() {
  const g = new THREE.SphereGeometry(0.012, 16, 12);
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const mesh = new THREE.Mesh(g, m);
  const glowGeo = new THREE.SphereGeometry(0.022, 16, 12);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x6aa8ff,
    transparent: true,
    opacity: 0.45,
  });
  mesh.add(new THREE.Mesh(glowGeo, glowMat));
  return mesh;
}

export function makeMeccaPin() {
  const g = new THREE.SphereGeometry(0.014, 18, 14);
  const m = new THREE.MeshBasicMaterial({ color: 0xffe066 });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 3;
  const glowGeo = new THREE.SphereGeometry(0.028, 18, 14);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffd84d,
    transparent: true,
    opacity: 0.55,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.renderOrder = 3;
  mesh.add(glow);
  return mesh;
}

// Teal, distinct from the white click pin so both read as related at a polar tap.
export function makeProjectionPin() {
  const g = new THREE.SphereGeometry(0.011, 16, 12);
  const m = new THREE.MeshBasicMaterial({ color: 0x6cd0c4 });
  const mesh = new THREE.Mesh(g, m);
  const glowGeo = new THREE.SphereGeometry(0.020, 16, 12);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x6cd0c4,
    transparent: true,
    opacity: 0.45,
  });
  mesh.add(new THREE.Mesh(glowGeo, glowMat));
  return mesh;
}

export function makeSun() {
  const group = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.SphereGeometry(4.5, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff5cc })
  );
  group.add(disc);
  // Additive Fresnel corona — soft glow past the disc.
  const corona = new THREE.Mesh(
    new THREE.SphereGeometry(13, 48, 32),
    new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          // Both vNormal and vViewDir in world space so the Fresnel dot
          // product doesn't drift as the camera orbits.
          vNormal = normalize(mat3(modelMatrix) * normal);
          vViewDir = normalize(cameraPosition - worldPos.xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float intensity = pow(max(dot(vNormal, vViewDir), 0.0), 1.4);
          gl_FragColor = vec4(1.0, 0.92, 0.55, 1.0) * intensity * 0.85;
        }
      `,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    })
  );
  group.add(corona);
  return group;
}

// Earth-center → sun-center. Line2 for real pixel width; endpoints rewritten by
// updateSunUniforms. frustumCulled off because setPositions leaves stale bounds.
export function makeSunLine(res) {
  const geo = new LineGeometry();
  geo.setPositions([0, 0, 0, 1, 0, 0]);
  const mat = new LineMaterial({
    color: 0xfff5cc,
    linewidth: 1.5,
    transparent: true,
    opacity: 0.55,
    resolution: res,
  });
  const line = new Line2(geo, mat);
  line.frustumCulled = false;
  return line;
}

// Closed ring at lat=0, lifted off the texture; depthTest on so Earth occludes the back half.
export function makeEquatorLine(res) {
  const N = 256;
  const positions = [];
  for (let i = 0; i <= N; i++) {
    const lon = (i / N) * 2 * Math.PI;
    const v = latLonToVec3(0, lon);
    positions.push(v[0] * SURFACE_RING_R, v[1] * SURFACE_RING_R, v[2] * SURFACE_RING_R);
  }
  const geo = new LineGeometry();
  geo.setPositions(positions);
  const mat = new LineMaterial({
    color: 0x6cd0c4,
    linewidth: 1.8,
    transparent: true,
    opacity: 0.85,
    resolution: res,
  });
  return new Line2(geo, mat);
}

// Sun's ±12h path (placeholder positions; updateSunUniforms resamples).
export function makeSunTrace(res) {
  const geo = new LineGeometry();
  geo.setPositions(new Array((SUN_TRACE_SEGMENTS + 1) * 3).fill(0));
  const mat = new LineMaterial({
    color: 0xffd966,
    linewidth: 1.6,
    transparent: true,
    opacity: 0.7,
    resolution: res,
  });
  const line = new Line2(geo, mat);
  line.frustumCulled = false;
  return line;
}

// Same path at Earth's surface (the subsolar track). Deep orange to stay legible
// over desert tones in the Blue Marble texture.
export function makeSubsolarTrace(res) {
  const geo = new LineGeometry();
  geo.setPositions(new Array((SUN_TRACE_SEGMENTS + 1) * 3).fill(0));
  const mat = new LineMaterial({
    color: 0xff5522,
    linewidth: 1.8,
    transparent: true,
    opacity: 0.95,
    resolution: res,
  });
  const line = new Line2(geo, mat);
  line.frustumCulled = false;
  return line;
}

// Great-circle arc A→B (unit vectors), `segments` samples lifted to `lift`, as a
// Line2. Shared by the qibla and projection arcs; null when the endpoints
// coincide. `matOpts` override the LineMaterial. Caller sets renderOrder + adds.
export function arcBuilder(A, B, segments, lift, matOpts, res) {
  if (A.distanceTo(B) < 0.001) return null;
  const omega = Math.acos(Math.max(-1, Math.min(1, A.dot(B))));
  const sinOmega = Math.sin(omega);
  const positions = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = Math.sin((1 - t) * omega) / sinOmega;
    const b = Math.sin(t * omega) / sinOmega;
    p.copy(A).multiplyScalar(a).addScaledVector(B, b).normalize().multiplyScalar(lift);
    positions.push(p.x, p.y, p.z);
  }
  const geom = new LineGeometry();
  geom.setPositions(positions);
  const mat = new LineMaterial({ transparent: true, resolution: res, ...matOpts });
  const line = new Line2(geom, mat);
  line.computeLineDistances();
  return line;
}
