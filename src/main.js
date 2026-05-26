import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";

import { sunPosition, latLonToVec3 } from "./solar.js";
import { createEarthMaterial } from "./earthMaterial.js";
import { showPanelForLocation } from "./panel.js";
import { aqrabProjection } from "./prayer.js";
import { initSearch } from "./search.js";
import { GlobeControls } from "./globeControls.js";
import { POLAR_METHODS, getMethod, subscribe as subscribeMethod } from "./settings.js";
import { snapToNearestHighLatCity } from "./highLatCities.js";

// Uniformly-lit NASA Blue Marble composite (no baked-in sunlight shading).
const DAY_TEXTURE = "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";

const MECCA_LAT = 21.4225;
const MECCA_LON = 39.8262;

const canvas = document.getElementById("globe");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const HI_DPR = Math.min(window.devicePixelRatio, 2);
const LO_DPR = Math.min(window.devicePixelRatio, 1);
let currentDPR = HI_DPR;
function setDPR(dpr) {
  if (dpr === currentDPR) return;
  currentDPR = dpr;
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  // LineMaterial.resolution must track the drawing-buffer size, not
  // CSS pixels — pixel-width strokes drift when DPR flips between
  // HI/LO during motion otherwise.
  refreshLineResolutions();
}
renderer.setPixelRatio(HI_DPR);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;

// Vector2 reused by lineResolution()/refreshLineResolutions().
const _drawSize = new THREE.Vector2();
function lineResolution() {
  // Drawing-buffer size = CSS pixels × DPR. LineMaterial expects this
  // (NOT window.innerWidth/Height) — without it, strokes render at
  // wrong pixel widths on high-DPI screens.
  return renderer.getDrawingBufferSize(new THREE.Vector2());
}
function refreshLineResolutions() {
  renderer.getDrawingBufferSize(_drawSize);
  const lines = [qiblaLine, projectionLine, sunLine, equatorLine, sunTrace, subsolarTrace];
  for (const l of lines) {
    if (l) l.material.resolution.copy(_drawSize);
  }
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.01,
  1000
);

// Default camera placement: sit on the current sun-Earth line, looking
// back at Earth. The sun's daily rotational plane is at constant
// declination (a circle parallel to the equator, offset by sin δ along
// the polar axis), NOT the equatorial plane — at solstice δ ≈ ±23.5°,
// so dropping the polar-axis component would lift the camera ~23°
// out of the sun's plane and send the sun above/below the Earth on a
// +12h scrub. Aligning camera with sunDir directly puts both camera
// and sun on the same diurnal circle, so a +12h scrub places the sun
// directly behind Earth.
//
// If a ?lat=&lon= link was shared, point at that location instead.
const INITIAL_DISTANCE = 5.5;
const _initialView = parseUrlLocation();
{
  let dir;
  if (_initialView) {
    dir = latLonToVec3(_initialView.latRad, _initialView.lonRad);
  } else {
    const { sunDir } = sunPosition(new Date());
    dir = sunDir;
  }
  camera.position.set(dir[0] * INITIAL_DISTANCE, dir[1] * INITIAL_DISTANCE, dir[2] * INITIAL_DISTANCE);
  camera.lookAt(0, 0, 0);
}

function parseUrlLocation() {
  const p = new URLSearchParams(window.location.search);
  const lat = parseFloat(p.get("lat"));
  const lon = parseFloat(p.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return {
    latDeg: lat,
    lonDeg: lon,
    latRad: (lat * Math.PI) / 180,
    lonRad: (lon * Math.PI) / 180,
    name: p.get("name") || null,
  };
}

const controls = new GlobeControls(camera, canvas);
controls.dampingFactor = 0.02;
controls.rotateSpeed = 1.5;
controls.minDistance = 1.25;
controls.maxDistance = 8;
controls.zoomSpeed = 0.6;

// Starfield
{
  const starCount = 2500;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 60 + Math.random() * 40;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.6,
    sizeAttenuation: true,
    color: 0xffffff,
    transparent: true,
    opacity: 0.7,
  });
  scene.add(new THREE.Points(geo, mat));
}

// Earth
const loader = new THREE.TextureLoader();
loader.crossOrigin = "anonymous";

function loadTex(url) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        // Disable mipmaps to avoid a seam at the dateline (atan2 jumps from
        // -π to +π so derivatives spike across the seam, picking a low mip).
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 8;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      reject
    );
  });
}

const earthGroup = new THREE.Group();
scene.add(earthGroup);

const earthGeo = new THREE.SphereGeometry(1, 96, 64);
let earthMaterial;
let earthMesh;
let pinMesh = null;
let qiblaLine = null;
let projectionPin = null;
let projectionLine = null;
let sunGroup = null;
let sunLine = null;
let equatorLine = null;
let sunTrace = null;
let subsolarTrace = null;
const SUN_DISTANCE = 60;
// Radius at which surface reference rings (equator, subsolar trace)
// sit above the textured sphere — 1.4% lift avoids z-fighting and
// matches the projection-arc convention.
const SURFACE_RING_R = 1.014;
// 24-hour window for the sun-path trace (matches the hour-scrubber
// range of ±12h). Sampled at this many segments — declination drift
// over 24h is sub-degree so coarse sampling reads as a smooth arc.
const SUN_TRACE_SEGMENTS = 96;
const SUN_TRACE_HALF_MS = 12 * 3600 * 1000;
// Preallocated buffers + Date so the trace re-sample on every
// scrubber input doesn't churn the GC (avoids per-segment
// `new Date()` and per-call `new Array()` allocations).
const FAR_TRACE_BUF = new Float32Array((SUN_TRACE_SEGMENTS + 1) * 3);
const SURF_TRACE_BUF = new Float32Array((SUN_TRACE_SEGMENTS + 1) * 3);
const _traceDate = new Date();

(async function init() {
  const dayTex = await loadTex(DAY_TEXTURE);
  earthMaterial = createEarthMaterial({ dayMap: dayTex });
  earthMesh = new THREE.Mesh(earthGeo, earthMaterial);
  earthGroup.add(earthMesh);

  // Atmosphere halo
  const haloGeo = new THREE.SphereGeometry(1.025, 96, 64);
  const haloMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        // Keep vNormal and vViewDir in the same (world) space.
        vNormal = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float intensity = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.5);
        gl_FragColor = vec4(0.30, 0.55, 1.0, 1.0) * intensity * 0.55;
      }
    `,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
  earthGroup.add(new THREE.Mesh(haloGeo, haloMat));

  pinMesh = makePin();
  pinMesh.visible = false;
  earthGroup.add(pinMesh);

  projectionPin = makeProjectionPin();
  projectionPin.visible = false;
  earthGroup.add(projectionPin);

  const meccaPin = makeMeccaPin();
  const m = latLonToVec3((MECCA_LAT * Math.PI) / 180, (MECCA_LON * Math.PI) / 180);
  meccaPin.position.set(m[0] * 1.006, m[1] * 1.006, m[2] * 1.006);
  earthGroup.add(meccaPin);

  // Distant sun, lives in the world frame so it doesn't rotate with the
  // earth group; position is updated each tick from sunDir.
  sunGroup = makeSun();
  scene.add(sunGroup);

  // Faint sun-to-Earth axis line. Endpoints are rewritten alongside
  // sunGroup.position whenever updateSunUniforms runs so the line
  // tracks the scrubbed sun.
  sunLine = makeSunLine();
  scene.add(sunLine);

  // Reference ring at lat=0 on Earth's surface. Static — added to
  // earthGroup so it travels with the planet (currently earthGroup
  // doesn't rotate, but keeping it grouped is correct in principle).
  equatorLine = makeEquatorLine();
  earthGroup.add(equatorLine);

  // 24-hour sun-path arc — the trace the sun-line endpoint sweeps as
  // the user scrubs ±12h. Lives in world space (sun does too) and is
  // re-sampled in updateSunUniforms so it stays centred on the
  // effective time.
  sunTrace = makeSunTrace();
  scene.add(sunTrace);

  // Same 24h path but projected onto Earth's surface — traces the
  // subsolar point (where the sun is directly overhead) as the
  // scrubber moves. Sits just above the texture like the equator.
  subsolarTrace = makeSubsolarTrace();
  earthGroup.add(subsolarTrace);

  // Seed sun-driven objects (shader sunDir uniform, sunGroup position,
  // sunLine endpoints, sun-trace positions) once before the first
  // paint. Without this, updateSunUniforms only fires on the
  // throttled 500ms tick — on a cache-warm load the first frame can
  // render with placeholder geometry and a flash of the wrong
  // lighting.
  updateSunUniforms(effectiveNow());

  initToggles();
  initScrubber();
  start();

  // If a shared link landed us with ?lat=&lon=, open the panel for that
  // location now that earthMesh + controls are ready. Camera was already
  // pointed at it by the setup above, so no flyTo is needed.
  if (_initialView) {
    selectLocation(_initialView.latDeg, _initialView.lonDeg, _initialView.name);
  }
})();

function makePin() {
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

function makeMeccaPin() {
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

function makeSun() {
  const group = new THREE.Group();
  // Solid disc — bright pale yellow
  const disc = new THREE.Mesh(
    new THREE.SphereGeometry(4.5, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff5cc })
  );
  group.add(disc);
  // Additive Fresnel corona — extends past the disc as a soft glow
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

function makeSunLine() {
  // Two-point line, Earth-center → sun-center, using Line2 so the
  // stroke has real pixel width (THREE.Line / LineBasicMaterial caps
  // at 1px on WebGL, effectively invisible against the starfield).
  // Endpoints are rewritten by updateSunUniforms — once at init,
  // again on every scrubber input, and on the 500ms throttled live
  // tick. The placeholder positions here are overwritten by that
  // init-time call before the first paint. depthTest stays on so
  // Earth occludes the half of the segment that passes through its
  // body.
  const geo = new LineGeometry();
  geo.setPositions([0, 0, 0, 1, 0, 0]);
  const mat = new LineMaterial({
    color: 0xfff5cc,
    linewidth: 1.5,
    transparent: true,
    opacity: 0.55,
    resolution: lineResolution(),
  });
  const line = new Line2(geo, mat);
  // setPositions only rewrites the instance buffer, not the bounding
  // sphere — without disabling culling the line vanishes whenever its
  // computed bounds (stale from the placeholder) fall outside the
  // frustum.
  line.frustumCulled = false;
  return line;
}

function makeEquatorLine() {
  // Closed ring at lat=0 on Earth's surface, lifted by SURFACE_RING_R
  // above the texture so it sits proud without z-fighting. depthTest
  // stays on so Earth occludes the back half of the ring — otherwise
  // the globe reads as see-through.
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
    resolution: lineResolution(),
  });
  return new Line2(geo, mat);
}

function makeSunTrace() {
  // Polyline tracing the sun's position across the ±12h window
  // centred on the effective time. Positions are placeholders here
  // — updateSunUniforms re-samples them on every tick.
  const geo = new LineGeometry();
  geo.setPositions(new Array((SUN_TRACE_SEGMENTS + 1) * 3).fill(0));
  const mat = new LineMaterial({
    color: 0xffd966,
    linewidth: 1.6,
    transparent: true,
    opacity: 0.7,
    resolution: lineResolution(),
  });
  const line = new Line2(geo, mat);
  line.frustumCulled = false;
  return line;
}

function makeSubsolarTrace() {
  // Same 24h path the sun-trace draws, but at Earth's surface — the
  // subsolar point's track. Lifted to SURFACE_RING_R to match the
  // equator. depthTest on so Earth occludes the back half (no
  // see-through). Deep orange instead of the far-trace yellow so
  // the line stays legible against desert tones in the Blue Marble
  // texture.
  const geo = new LineGeometry();
  geo.setPositions(new Array((SUN_TRACE_SEGMENTS + 1) * 3).fill(0));
  const mat = new LineMaterial({
    color: 0xff5522,
    linewidth: 1.8,
    transparent: true,
    opacity: 0.95,
    resolution: lineResolution(),
  });
  const line = new Line2(geo, mat);
  line.frustumCulled = false;
  return line;
}

function makeProjectionPin() {
  // Teal — same shape as the click pin but a distinct hue, so when the
  // user taps a polar location both pins are visible and clearly related.
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

function setPin(latRad, lonRad) {
  if (!pinMesh) return;
  const v = latLonToVec3(latRad, lonRad);
  pinMesh.position.set(v[0] * 1.005, v[1] * 1.005, v[2] * 1.005);
  pinMesh.visible = true;
  markDirty();
}

function setQiblaFrom(latDeg, lonDeg) {
  if (!earthGroup) return;
  if (qiblaLine) {
    earthGroup.remove(qiblaLine);
    qiblaLine.geometry.dispose();
    qiblaLine.material.dispose();
    qiblaLine = null;
  }
  const aRad = [(latDeg * Math.PI) / 180, (lonDeg * Math.PI) / 180];
  const bRad = [(MECCA_LAT * Math.PI) / 180, (MECCA_LON * Math.PI) / 180];
  const A = new THREE.Vector3(...latLonToVec3(aRad[0], aRad[1]));
  const B = new THREE.Vector3(...latLonToVec3(bRad[0], bRad[1]));

  if (A.distanceTo(B) < 0.001) return;

  const omega = Math.acos(Math.max(-1, Math.min(1, A.dot(B))));
  const sinOmega = Math.sin(omega);
  const N = 96;
  const positions = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = Math.sin((1 - t) * omega) / sinOmega;
    const b = Math.sin(t * omega) / sinOmega;
    const v = new THREE.Vector3()
      .copy(A).multiplyScalar(a)
      .addScaledVector(B, b)
      .normalize()
      .multiplyScalar(1.018);
    positions.push(v.x, v.y, v.z);
  }
  const geom = new LineGeometry();
  geom.setPositions(positions);
  const mat = new LineMaterial({
    color: 0xffe066,
    linewidth: 3.5,
    transparent: true,
    opacity: 1.0,
    depthTest: false,
    resolution: lineResolution(),
  });
  qiblaLine = new Line2(geom, mat);
  qiblaLine.renderOrder = 2;
  qiblaLine.computeLineDistances();
  earthGroup.add(qiblaLine);
  markDirty();
}

// Show a teal pin + great-circle arc at the Aqrab al-Bilād projection
// point when the user taps a high-latitude location. The projection
// preserves longitude and clamps the latitude to the threshold where the
// standard calculation works (see prayer.js), so the arc lies along the
// meridian. The pin shares its glow with the panel's "projected from N°"
// note — a visual cue that the times shown aren't computed at the actual
// tapped latitude.
function clearProjectionViz() {
  let changed = false;
  if (projectionPin && projectionPin.visible) {
    projectionPin.visible = false;
    changed = true;
  }
  if (projectionLine) {
    earthGroup.remove(projectionLine);
    projectionLine.geometry.dispose();
    projectionLine.material.dispose();
    projectionLine = null;
    changed = true;
  }
  // The render loop is dirty-flag gated, so removing the pin / arc
  // doesn't visually erase them until something else dirties the
  // scene. setProjectionViz() markDirty's at the end; mirror here.
  if (changed) markDirty();
}

// Target lat/lon may differ from the user's lon for the nearest-city
// method, so both must be passed explicitly rather than inferring from
// the user's lon.
function setProjectionViz(actualLatDeg, actualLonDeg, targetLatDeg, targetLonDeg) {
  if (!earthGroup || !projectionPin) return;
  const latRadTgt = (targetLatDeg * Math.PI) / 180;
  const lonRadTgt = (targetLonDeg * Math.PI) / 180;
  const v = latLonToVec3(latRadTgt, lonRadTgt);
  projectionPin.position.set(v[0] * 1.005, v[1] * 1.005, v[2] * 1.005);
  projectionPin.visible = true;

  if (projectionLine) {
    earthGroup.remove(projectionLine);
    projectionLine.geometry.dispose();
    projectionLine.material.dispose();
    projectionLine = null;
  }
  const A = new THREE.Vector3(...latLonToVec3((actualLatDeg * Math.PI) / 180, (actualLonDeg * Math.PI) / 180));
  const B = new THREE.Vector3(...latLonToVec3(latRadTgt, lonRadTgt));
  if (A.distanceTo(B) < 0.001) {
    // No arc to draw, but the pin's position/visibility above may
    // have changed (e.g., method switch landed the pin essentially
    // on the user's actual lat). Dirty the scene so the change
    // shows up under the dirty-flag render loop.
    markDirty();
    return;
  }
  const omega = Math.acos(Math.max(-1, Math.min(1, A.dot(B))));
  const sinOmega = Math.sin(omega);
  const N = 32;
  const positions = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = Math.sin((1 - t) * omega) / sinOmega;
    const b = Math.sin(t * omega) / sinOmega;
    const p = new THREE.Vector3()
      .copy(A).multiplyScalar(a)
      .addScaledVector(B, b)
      .normalize()
      .multiplyScalar(1.014);
    positions.push(p.x, p.y, p.z);
  }
  const geom = new LineGeometry();
  geom.setPositions(positions);
  const mat = new LineMaterial({
    color: 0x6cd0c4,
    linewidth: 2.0,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    resolution: lineResolution(),
  });
  projectionLine = new Line2(geom, mat);
  projectionLine.renderOrder = 2;
  projectionLine.computeLineDistances();
  earthGroup.add(projectionLine);
  markDirty();
}

// Single entry point for "user picked a location": pin, qibla, panel,
// and any Aqrab al-Bilād projection viz. Centralises so click and search
// stay in lockstep.
// Last location the user picked (click / search / URL load), kept so the
// projection viz can be re-evaluated when the scrubber changes the
// effective date. Without this, the teal pin/arc would stay at the
// threshold latitude for the moment the location was first selected and
// drift out of sync with the panel's "projected from N°" note as
// declination moves.
let _lastSelection = null;

// Where the projection pin/arc should sit for the current method.
// Returns null when no pin should be drawn (location outside the cap,
// or any of the four methods with no spatial schedule source).
//   • SAME_LON     → pin at same-longitude projection
//   • NEAREST_CITY → pin at the snapped city (falls back to SAME_LON
//                    when no city is in window)
//   • AQRAB_AL_AWQAT / MIDNIGHT / SEVENTH / ANGLE_REDUCED → null
// The pin's purpose is "where did these times come from?" — so it
// tracks the actual times source, not the visualization projection.
function pinSourceForMethod(latDeg, lonDeg, date) {
  const aqrab = aqrabProjection(latDeg, date);
  if (!aqrab) return null;
  const method = getMethod();
  if (method === POLAR_METHODS.AQRAB_SAME_LON) {
    return { targetLat: aqrab.projectedFromLat, targetLon: lonDeg };
  }
  if (method === POLAR_METHODS.AQRAB_NEAREST_CITY) {
    const city = snapToNearestHighLatCity(latDeg, lonDeg, aqrab.projectedFromLat);
    return city
      ? { targetLat: city.lat, targetLon: city.lon }
      : { targetLat: aqrab.projectedFromLat, targetLon: lonDeg };
  }
  // AQRAB_AL_AWQAT, MIDNIGHT, SEVENTH, ANGLE_REDUCED — no spatial
  // schedule source to point at.
  return null;
}

function refreshProjectionForCurrentSelection() {
  if (!_lastSelection) return;
  const { latDeg, lonDeg } = _lastSelection;
  const src = pinSourceForMethod(latDeg, lonDeg, effectiveNow());
  if (src) setProjectionViz(latDeg, lonDeg, src.targetLat, src.targetLon);
  else clearProjectionViz();
}

function selectLocation(latDeg, lonDeg, name) {
  const latRad = (latDeg * Math.PI) / 180;
  const lonRad = (lonDeg * Math.PI) / 180;
  setPin(latRad, lonRad);
  setQiblaFrom(latDeg, lonDeg);
  const date = effectiveNow();
  const src = pinSourceForMethod(latDeg, lonDeg, date);
  if (src) setProjectionViz(latDeg, lonDeg, src.targetLat, src.targetLon);
  else clearProjectionViz();
  _lastSelection = { latDeg, lonDeg, name };
  showPanelForLocation({ lat: latDeg, lon: lonDeg, name }, date);
}

// Method change repaints the pin/arc for the current selection. The
// panel re-renders itself independently via its own subscription in
// src/panel.js. Subscriber is global and never unsubscribed — main.js
// runs for the lifetime of the page.
subscribeMethod(() => refreshProjectionForCurrentSelection());

// ---- ticking ----
function updateSunUniforms(date) {
  if (!earthMaterial) return;
  const { sunDir, declination } = sunPosition(date);
  earthMaterial.uniforms.sunDir.value.set(sunDir[0], sunDir[1], sunDir[2]);
  earthMaterial.uniforms.decl.value = declination;
  if (sunGroup) {
    sunGroup.position.set(
      sunDir[0] * SUN_DISTANCE,
      sunDir[1] * SUN_DISTANCE,
      sunDir[2] * SUN_DISTANCE
    );
  }
  if (sunLine) {
    sunLine.geometry.setPositions([
      0, 0, 0,
      sunDir[0] * SUN_DISTANCE,
      sunDir[1] * SUN_DISTANCE,
      sunDir[2] * SUN_DISTANCE,
    ]);
  }
  if (sunTrace || subsolarTrace) {
    // Anchor the 24h window to a stable reference rather than the
    // scrubbed date, so the user sees the sun marker SLIDE along a
    // fixed trace as they drag the hour scrubber instead of the
    // trace shifting with the marker. In day mode the user is
    // moving through the year by full days — anchor to the scrubbed
    // date so the orange ring migrates between the tropics as
    // declination changes.
    const center = scrubMode === "h" ? Date.now() : date.getTime();
    const t0 = center - SUN_TRACE_HALF_MS;
    const step = (2 * SUN_TRACE_HALF_MS) / SUN_TRACE_SEGMENTS;
    // Reuse FAR_TRACE_BUF / SURF_TRACE_BUF / _traceDate to avoid
    // per-tick allocations during scrubber drags.
    for (let i = 0; i <= SUN_TRACE_SEGMENTS; i++) {
      _traceDate.setTime(t0 + i * step);
      const { sunDir: d } = sunPosition(_traceDate);
      const idx = i * 3;
      if (sunTrace) {
        FAR_TRACE_BUF[idx + 0] = d[0] * SUN_DISTANCE;
        FAR_TRACE_BUF[idx + 1] = d[1] * SUN_DISTANCE;
        FAR_TRACE_BUF[idx + 2] = d[2] * SUN_DISTANCE;
      }
      if (subsolarTrace) {
        SURF_TRACE_BUF[idx + 0] = d[0] * SURFACE_RING_R;
        SURF_TRACE_BUF[idx + 1] = d[1] * SURFACE_RING_R;
        SURF_TRACE_BUF[idx + 2] = d[2] * SURFACE_RING_R;
      }
    }
    // LineGeometry.setPositions allocates a fresh Float32Array per
    // call (size 2 * vertex_count) plus an InstancedInterleavedBuffer
    // — at scrubber-drag rates that's measurable GC churn. Write the
    // interleaved start/end buffer in place instead.
    if (sunTrace) updateTraceInPlace(sunTrace.geometry, FAR_TRACE_BUF);
    if (subsolarTrace) updateTraceInPlace(subsolarTrace.geometry, SURF_TRACE_BUF);
  }
}

// Update a LineGeometry's instanceStart/instanceEnd interleaved
// buffer in place from a flat [x,y,z, x,y,z, ...] vertex array. Lets
// us replace LineGeometry.setPositions for the per-tick trace
// updates without allocating. Assumes the geometry was sized by a
// prior setPositions call with the same vertex count (so the buffer
// already has the right length).
function updateTraceInPlace(geometry, vertices) {
  const ib = geometry.attributes.instanceStart.data;
  const arr = ib.array;
  const segments = vertices.length / 3 - 1;
  for (let i = 0; i < segments; i++) {
    const o = i * 6;
    const p = i * 3;
    arr[o + 0] = vertices[p + 0];
    arr[o + 1] = vertices[p + 1];
    arr[o + 2] = vertices[p + 2];
    arr[o + 3] = vertices[p + 3];
    arr[o + 4] = vertices[p + 4];
    arr[o + 5] = vertices[p + 5];
  }
  ib.needsUpdate = true;
}

const clockEl = document.getElementById("clock");
function updateClock(date, isLive) {
  const utc = date.toISOString().slice(11, 19);
  const local = date.toLocaleTimeString([], { hour12: false });
  const tag = isLive ? "Live" : "Scrubbed";
  clockEl.textContent = `${tag} · ${local} · ${utc} UTC`;
}

// ---- time scrubber ----
let scrubOffsetMs = 0;
let scrubLive = true;

function effectiveNow() {
  return new Date(Date.now() + scrubOffsetMs);
}

// Two scrubber modes — same slider, different scale.
//   "h": ±12 hours, step 5 min — for watching prayer windows sweep around
//   "d": ±366 days, step 1 day — for watching seasonal cap asymmetry
const SCRUB_MODES = {
  h: { min: -720, max: 720, step: 5,    msPerUnit: 60_000 },
  d: { min: -366, max: 366, step: 1,    msPerUnit: 86_400_000 },
};
let scrubMode = "h";
// Reassigned inside initScrubber once the DOM is wired up. Called from
// the throttled tick so the date-mode label keeps tracking the wall clock
// (e.g. crossing midnight) without requiring user interaction.
let refreshScrubLabel = () => {};

function initScrubber() {
  const slider = document.getElementById("scrub");
  const live = document.getElementById("liveBtn");
  const label = document.getElementById("scrubLabel");
  const modeBtn = document.getElementById("scrubMode");

  function fmtTimeOffset(ms) {
    if (Math.abs(ms) < 30 * 1000) return "now";
    const sign = ms >= 0 ? "+" : "−";
    const abs = Math.abs(ms);
    const h = Math.floor(abs / 3600000);
    const m = Math.round((abs - h * 3600000) / 60000);
    if (h === 0) return `${sign}${m}m`;
    return `${sign}${h}h ${String(m).padStart(2, "0")}m`;
  }

  const dateFmt = new Intl.DateTimeFormat([], { month: "short", day: "numeric" });
  function fmtDateOffset(ms) {
    if (Math.abs(ms) < 86_400_000 / 2) return "today";
    return dateFmt.format(new Date(Date.now() + ms));
  }

  function refreshLabel() {
    label.textContent = scrubMode === "h" ? fmtTimeOffset(scrubOffsetMs) : fmtDateOffset(scrubOffsetMs);
  }
  refreshScrubLabel = refreshLabel;

  function applyMode() {
    const cfg = SCRUB_MODES[scrubMode];
    slider.min = String(cfg.min);
    slider.max = String(cfg.max);
    slider.step = String(cfg.step);
    slider.value = "0";
    scrubOffsetMs = 0;
    scrubLive = true;
    live.classList.add("active");
    modeBtn.textContent = scrubMode;
    modeBtn.classList.toggle("date-mode", scrubMode === "d");
    modeBtn.title = scrubMode === "h" ? "Switch to date scrubbing" : "Switch to time scrubbing";
    modeBtn.setAttribute("aria-pressed", scrubMode === "d" ? "true" : "false");
    refreshLabel();
    const now = effectiveNow();
    updateSunUniforms(now);
    updateClock(now, scrubLive);
    refreshProjectionForCurrentSelection();
    markDirty();
  }

  modeBtn.addEventListener("click", () => {
    scrubMode = scrubMode === "h" ? "d" : "h";
    applyMode();
  });

  slider.addEventListener("input", () => {
    const units = parseInt(slider.value, 10);
    scrubOffsetMs = units * SCRUB_MODES[scrubMode].msPerUnit;
    scrubLive = scrubOffsetMs === 0;
    refreshLabel();
    live.classList.toggle("active", scrubLive);
    const now = effectiveNow();
    updateSunUniforms(now);
    updateClock(now, scrubLive);
    // Threshold latitude depends on declination, which moves as the
    // user scrubs the date. Re-aim the teal pin/arc against the new
    // date so they stay in sync with the panel's "projected from N°".
    refreshProjectionForCurrentSelection();
    // TODO: side panel doesn't re-render with the scrubber — its prayer
    // times stay frozen to the date the panel was opened with.
    markDirty();
  });

  live.addEventListener("click", () => {
    slider.value = "0";
    scrubOffsetMs = 0;
    scrubLive = true;
    refreshLabel();
    live.classList.add("active");
    const now = effectiveNow();
    updateSunUniforms(now);
    updateClock(now, scrubLive);
    refreshProjectionForCurrentSelection();
    markDirty();
  });

  // Initial state — mirrors applyMode without clobbering scrub state.
  modeBtn.textContent = scrubMode;
  modeBtn.title = "Switch to date scrubbing";
  modeBtn.setAttribute("aria-pressed", "false");
  refreshLabel();
  live.classList.add("active");
}

// ---- toggles ----
const PRAYER_UNIFORM_MAP = {
  fajr: "enFajr",
  dhuhr: "enDhuhr",
  asr: "enAsr",
  maghrib: "enMaghrib",
  isha: "enIsha",
};

function initToggles() {
  const togglePrayer = document.getElementById("togglePrayer");
  togglePrayer.addEventListener("change", () => {
    earthMaterial.uniforms.prayerEnabled.value = togglePrayer.checked ? 1.0 : 0.0;
    markDirty();
  });

  // per-prayer color toggles
  document.querySelectorAll(".prayer-toggle input").forEach((cb) => {
    const key = cb.closest("[data-prayer]").dataset.prayer;
    const uniName = PRAYER_UNIFORM_MAP[key];
    if (!uniName) return;
    cb.addEventListener("change", () => {
      earthMaterial.uniforms[uniName].value = cb.checked ? 1.0 : 0.0;
      markDirty();
    });
  });

  // collapsible legend (mobile)
  const legend = document.getElementById("legend");
  const legendToggle = document.getElementById("legendToggle");
  legendToggle?.addEventListener("click", () => {
    const expanded = legend.classList.toggle("expanded");
    legendToggle.setAttribute("aria-expanded", String(expanded));
  });

  // info modal
  const overlay = document.getElementById("infoOverlay");
  document.getElementById("infoBtn").addEventListener("click", () => {
    overlay.hidden = !overlay.hidden;
  });
  document.getElementById("infoClose").addEventListener("click", () => {
    overlay.hidden = true;
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });
}

let dirty = true;
function markDirty() { dirty = true; }
controls.addEventListener("change", markDirty);

function start() {
  let lastUniformUpdate = 0;
  let lastMotion = -Infinity;
  function tick(t) {
    if (t - lastUniformUpdate > 500) {
      const now = effectiveNow();
      updateSunUniforms(now);
      updateClock(now, scrubLive);
      refreshScrubLabel();
      lastUniformUpdate = t;
      dirty = true;
    }
    const moving = controls.update();
    if (moving) {
      lastMotion = t;
      if (currentDPR !== LO_DPR) setDPR(LO_DPR);
      dirty = true;
    } else if (currentDPR !== HI_DPR && t - lastMotion > 80) {
      setDPR(HI_DPR);
      dirty = true;
    }
    if (dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  // Line2's pixel width depends on the resolution uniform — without these
  // updates, both arcs would render with stale widths until the user
  // selected a new location and the lines were rebuilt.
  refreshLineResolutions();
  markDirty();
});

// ---- click → lat/lon ----
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let mouseDownAt = null;

canvas.addEventListener("pointerdown", (e) => {
  mouseDownAt = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("pointerup", (e) => {
  if (!mouseDownAt) return;
  const dx = e.clientX - mouseDownAt.x;
  const dy = e.clientY - mouseDownAt.y;
  mouseDownAt = null;
  if (dx * dx + dy * dy > 25) return;
  if (!earthMesh) return;

  const rect = canvas.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(earthMesh, false);
  if (!hits.length) return;
  const local = earthMesh.worldToLocal(hits[0].point.clone()).normalize();
  const lat = Math.asin(Math.max(-1, Math.min(1, local.y)));
  const lon = Math.atan2(-local.z, local.x);
  const latDeg = (lat * 180) / Math.PI;
  const lonDeg = (lon * 180) / Math.PI;
  selectLocation(latDeg, lonDeg, null);
});

// ---- search ----
initSearch(({ lat, lon, name }) => {
  selectLocation(lat, lon, name);
  flyTo((lat * Math.PI) / 180, (lon * Math.PI) / 180);
});

function flyTo(latRad, lonRad) {
  // Slerp the direction so the camera stays at a constant radius
  // throughout the flight. A linear lerp between two same-distance
  // positions passes through the chord between them — for near-antipodal
  // moves the chord grazes the origin, briefly violating
  // controls.minDistance and triggering jumpy syncFromCamera clamps
  // mid-flight.
  const v = latLonToVec3(latRad, lonRad);
  const target = controls.target; // single source of truth for orbit center
  const offset = new THREE.Vector3().subVectors(camera.position, target);
  const dist = offset.length();
  const startDir = offset.clone().normalize();
  const endDir = new THREE.Vector3(v[0], v[1], v[2]);
  const totalRot = new THREE.Quaternion().setFromUnitVectors(startDir, endDir);
  const startTime = performance.now();
  const dur = 800;
  const partial = new THREE.Quaternion();
  const identity = new THREE.Quaternion();
  const dirAtT = new THREE.Vector3();
  function step(t) {
    const k = Math.min(1, (t - startTime) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    partial.copy(identity).slerp(totalRot, eased);
    dirAtT.copy(startDir).applyQuaternion(partial);
    camera.position.copy(target).addScaledVector(dirAtT, dist);
    // syncFromCamera() rewrites the camera transform (including its own
    // camera.lookAt(target)) so any lookAt here would be immediately
    // overwritten. Skip it.
    controls.syncFromCamera();
    markDirty();
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
