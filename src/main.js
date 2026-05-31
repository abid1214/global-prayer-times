import * as THREE from "three";

import { sunPosition, latLonToVec3 } from "./solar.js";
import { createEarthMaterial } from "./earthMaterial.js";
import { initSearch } from "./search.js";
import { GlobeControls } from "./globeControls.js";
import { subscribe as subscribeMethod, subscribePreset } from "./settings.js";
import { degToRad, MECCA_LAT, MECCA_LON, PRAYER_COLORS, hexColor } from "./constants.js";
import {
  makePin, makeMeccaPin, makeProjectionPin, makeSun, makeSunLine,
  makeEquatorLine, makeSunTrace, makeSubsolarTrace,
} from "./sceneObjects.js";
import { createTimeScrubber } from "./timeScrubber.js";
import { createSunView } from "./sunView.js";
import { createLocationSelection } from "./locationSelection.js";

// Apply the shared prayer palette to CSS custom properties so the legend
// swatches (CSS) and panel swatches (JS, via PRAYER_META) share one source.
for (const [key, val] of Object.entries(PRAYER_COLORS)) {
  document.documentElement.style.setProperty(`--c-${key}`, hexColor(val));
}

// Uniformly-lit NASA Blue Marble composite (no baked-in sunlight shading).
const DAY_TEXTURE = "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";

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
  // LineMaterial.resolution tracks the drawing-buffer size (not CSS px), else
  // stroke widths drift when DPR flips during motion.
  refreshLineResolutions();
}
renderer.setPixelRatio(HI_DPR);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const _drawSize = new THREE.Vector2();
// Fresh Vector2 per call by design — each LineMaterial owns its resolution
// vector, which refreshLineResolutions() mutates via .copy(), so no aliasing.
function lineResolution() {
  return renderer.getDrawingBufferSize(new THREE.Vector2());
}
function refreshLineResolutions() {
  renderer.getDrawingBufferSize(_drawSize);
  // qibla + projection lines live in the selection module (null until a pick).
  const lines = [sunLine, equatorLine, sunTrace, subsolarTrace];
  if (selection) lines.push(...selection.getLines());
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

// Place the camera on the current sun-Earth line (aligned with sunDir, so both
// sit on the same diurnal circle and a +12h scrub puts the sun behind Earth),
// or at a shared ?lat=&lon= location.
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
    latRad: degToRad(lat),
    lonRad: degToRad(lon),
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
let projectionPin = null;
let sunGroup = null;
let sunLine = null;
let equatorLine = null;
let sunTrace = null;
let subsolarTrace = null;

// Constructed in init() once their scene objects exist; declared here so the
// render loop, handlers, and subscriptions (module scope) can reach them.
let sunView = null;
let selection = null;

const scrubber = createTimeScrubber({ onChange: handleTimeChange });
const effectiveNow = () => scrubber.effectiveNow();

function handleTimeChange() {
  const now = scrubber.effectiveNow();
  sunView.updateSunUniforms(now);
  updateClock(now, scrubber.isLive());
  // Re-aim the pin (cap latitude tracks declination). The panel's times stay
  // fixed to the selection date — intentionally not re-rendered on scrub.
  selection.refreshProjection();
  markDirty();
}

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
  const m = latLonToVec3(degToRad(MECCA_LAT), degToRad(MECCA_LON));
  meccaPin.position.set(m[0] * 1.006, m[1] * 1.006, m[2] * 1.006);
  earthGroup.add(meccaPin);

  // Distant sun in the world frame (doesn't rotate with earthGroup).
  sunGroup = makeSun();
  scene.add(sunGroup);

  // Sun-to-Earth axis line; endpoints rewritten by sunView.
  sunLine = makeSunLine(lineResolution());
  scene.add(sunLine);

  equatorLine = makeEquatorLine(lineResolution());
  earthGroup.add(equatorLine);

  // 24h sun-path arc (world space) + its subsolar surface track; sunView resamples both.
  sunTrace = makeSunTrace(lineResolution());
  scene.add(sunTrace);
  subsolarTrace = makeSubsolarTrace(lineResolution());
  earthGroup.add(subsolarTrace);

  sunView = createSunView({
    earthMaterial, sunGroup, sunLine, sunTrace, subsolarTrace,
    getDateOffsetMs: () => scrubber.getDateOffsetMs(),
    markDirty,
  });
  selection = createLocationSelection({
    earthGroup, pinMesh, projectionPin, lineResolution, markDirty, effectiveNow,
  });

  // Method/preset change moves the cap edge, so re-aim the pin. (Panel re-renders
  // via its own subscription in panel.js.) Never unsubscribed — page-lifetime.
  subscribeMethod(() => selection.refreshProjection());
  subscribePreset(() => selection.refreshProjection());

  // Seed before the first paint so a cache-warm load doesn't flash placeholders.
  sunView.seed(effectiveNow());

  initToggles();
  scrubber.init();
  start();

  // Shared ?lat=&lon= link: open its panel (camera was already aimed above).
  if (_initialView) {
    selection.selectLocation(_initialView.latDeg, _initialView.lonDeg, _initialView.name);
  }
})();

const clockEl = document.getElementById("clock");
function updateClock(date, isLive) {
  const utc = date.toISOString().slice(11, 19);
  const local = date.toLocaleTimeString([], { hour12: false });
  const tag = isLive ? "Live" : "Scrubbed";
  clockEl.textContent = `${tag} · ${local} · ${utc} UTC`;
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
      sunView.updateSunUniforms(now);
      updateClock(now, scrubber.isLive());
      scrubber.refreshLabel();
      lastUniformUpdate = t;
      dirty = true;
    }
    // Coalesce rapid updateSunUniforms() calls (scrubber drags fire input
    // events at 60+ Hz) to one trace resample per frame.
    if (sunView.resampleIfDirty()) dirty = true;
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
  // LineMaterial.resolution must track the drawing-buffer size for correct
  // pixel-width strokes. refreshLineResolutions covers every active Line2
  // overlay (sun line, equator, both 24h traces, plus the selection module's
  // qibla + projection lines).
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
  if (!earthMesh || !selection) return;

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
  selection.selectLocation(latDeg, lonDeg, null);
});

// ---- search ----
initSearch(({ lat, lon, name }) => {
  if (!selection) return;
  selection.selectLocation(lat, lon, name);
  flyTo(degToRad(lat), degToRad(lon));
});

function flyTo(latRad, lonRad) {
  // Slerp the direction (constant radius). A linear lerp would chord through the
  // origin for near-antipodal moves, tripping the minDistance clamp mid-flight.
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
    // No lookAt here — syncFromCamera rewrites the transform (incl. its own lookAt).
    controls.syncFromCamera();
    markDirty();
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
