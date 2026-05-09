import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";

import { sunPosition, latLonToVec3 } from "./solar.js";
import { createEarthMaterial } from "./earthMaterial.js";
import { showPanelForLocation } from "./panel.js";
import { initSearch } from "./search.js";

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
}
renderer.setPixelRatio(HI_DPR);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.01,
  1000
);
camera.position.set(3.6, 0, 0);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.02;
controls.rotateSpeed = 0.5;
controls.enablePan = false;
controls.minDistance = 1.25;
controls.maxDistance = 8;
controls.zoomSpeed = 0.6;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

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
        vNormal = normalize(normalMatrix * normal);
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

  const meccaPin = makeMeccaPin();
  const m = latLonToVec3((MECCA_LAT * Math.PI) / 180, (MECCA_LON * Math.PI) / 180);
  meccaPin.position.set(m[0] * 1.006, m[1] * 1.006, m[2] * 1.006);
  earthGroup.add(meccaPin);

  initToggles();
  initScrubber();
  start();
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
    resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
  });
  qiblaLine = new Line2(geom, mat);
  qiblaLine.renderOrder = 2;
  qiblaLine.computeLineDistances();
  earthGroup.add(qiblaLine);
  markDirty();
}

// ---- ticking ----
function updateSunUniforms(date) {
  if (!earthMaterial) return;
  const { sunDir, declination } = sunPosition(date);
  earthMaterial.uniforms.sunDir.value.set(sunDir[0], sunDir[1], sunDir[2]);
  earthMaterial.uniforms.decl.value = declination;
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

function initScrubber() {
  const slider = document.getElementById("scrub");
  const live = document.getElementById("liveBtn");
  const label = document.getElementById("scrubLabel");

  function fmtOffset(ms) {
    if (Math.abs(ms) < 30 * 1000) return "now";
    const sign = ms >= 0 ? "+" : "−";
    const abs = Math.abs(ms);
    const h = Math.floor(abs / 3600000);
    const m = Math.round((abs - h * 3600000) / 60000);
    if (h === 0) return `${sign}${m}m`;
    return `${sign}${h}h ${String(m).padStart(2, "0")}m`;
  }

  slider.addEventListener("input", () => {
    const minutes = parseInt(slider.value, 10);
    scrubOffsetMs = minutes * 60 * 1000;
    scrubLive = scrubOffsetMs === 0;
    label.textContent = fmtOffset(scrubOffsetMs);
    live.classList.toggle("active", scrubLive);
    const now = effectiveNow();
    updateSunUniforms(now);
    updateClock(now, scrubLive);
    markDirty();
  });

  live.addEventListener("click", () => {
    slider.value = "0";
    scrubOffsetMs = 0;
    scrubLive = true;
    label.textContent = "now";
    live.classList.add("active");
    const now = effectiveNow();
    updateSunUniforms(now);
    updateClock(now, scrubLive);
    markDirty();
  });

  label.textContent = "now";
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
  });

  // per-prayer color toggles
  document.querySelectorAll(".prayer-toggle input").forEach((cb) => {
    const key = cb.closest("[data-prayer]").dataset.prayer;
    const uniName = PRAYER_UNIFORM_MAP[key];
    if (!uniName) return;
    cb.addEventListener("change", () => {
      earthMaterial.uniforms[uniName].value = cb.checked ? 1.0 : 0.0;
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
  if (qiblaLine) {
    qiblaLine.material.resolution.set(window.innerWidth, window.innerHeight);
  }
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
  setPin(lat, lon);
  setQiblaFrom(latDeg, lonDeg);
  showPanelForLocation({ lat: latDeg, lon: lonDeg, name: null }, effectiveNow());
});

// ---- search ----
initSearch(({ lat, lon, name }) => {
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  setPin(latRad, lonRad);
  setQiblaFrom(lat, lon);
  showPanelForLocation({ lat, lon, name }, effectiveNow());
  flyTo(latRad, lonRad);
});

function flyTo(latRad, lonRad) {
  const v = latLonToVec3(latRad, lonRad);
  const target = new THREE.Vector3(v[0], v[1], v[2]);
  const dist = camera.position.length();
  const endPos = target.clone().multiplyScalar(dist);
  const startPos = camera.position.clone();
  const startTime = performance.now();
  const dur = 800;
  function step(t) {
    const k = Math.min(1, (t - startTime) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    camera.position.lerpVectors(startPos, endPos, eased);
    camera.lookAt(0, 0, 0);
    markDirty();
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
