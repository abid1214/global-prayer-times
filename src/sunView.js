import { sunPosition } from "./solar.js";
import { SUN_DISTANCE, SURFACE_RING_R, SUN_TRACE_SEGMENTS, SUN_TRACE_HALF_MS } from "./sceneObjects.js";

// Sun-driven scene updates: shader sunDir/decl uniforms, the distant sun group
// + axis line, and the 24h traces. Resampling is coalesced — updateSunUniforms
// only sets a dirty flag, drained once per frame via resampleIfDirty (a fast
// scrubber drag would otherwise run 97 sunPosition() calls per input event).
export function createSunView({ earthMaterial, sunGroup, sunLine, sunTrace, subsolarTrace, getScrub, markDirty }) {
  // Preallocated buffers + Date so the per-tick resample doesn't churn the GC.
  const FAR_TRACE_BUF = new Float32Array((SUN_TRACE_SEGMENTS + 1) * 3);
  const SURF_TRACE_BUF = new Float32Array((SUN_TRACE_SEGMENTS + 1) * 3);
  const _traceDate = new Date();
  let _tracesDirty = true;

  function updateSunUniforms(date) {
    const { sunDir, declination } = sunPosition(date);
    earthMaterial.uniforms.sunDir.value.set(sunDir[0], sunDir[1], sunDir[2]);
    earthMaterial.uniforms.decl.value = declination;
    sunGroup.position.set(sunDir[0] * SUN_DISTANCE, sunDir[1] * SUN_DISTANCE, sunDir[2] * SUN_DISTANCE);
    sunLine.geometry.setPositions([
      0, 0, 0,
      sunDir[0] * SUN_DISTANCE, sunDir[1] * SUN_DISTANCE, sunDir[2] * SUN_DISTANCE,
    ]);
    _tracesDirty = true;
  }

  function resampleTraces() {
    // Hour mode anchors the 24h window to now (so the marker slides along a fixed
    // trace); day mode anchors to the scrubbed date (so the ring migrates between
    // the tropics with declination).
    const { mode, offsetMs } = getScrub();
    const center = mode === "h" ? Date.now() : (Date.now() + offsetMs);
    const t0 = center - SUN_TRACE_HALF_MS;
    const step = (2 * SUN_TRACE_HALF_MS) / SUN_TRACE_SEGMENTS;
    for (let i = 0; i <= SUN_TRACE_SEGMENTS; i++) {
      _traceDate.setTime(t0 + i * step);
      const { sunDir: d } = sunPosition(_traceDate);
      const idx = i * 3;
      FAR_TRACE_BUF[idx + 0] = d[0] * SUN_DISTANCE;
      FAR_TRACE_BUF[idx + 1] = d[1] * SUN_DISTANCE;
      FAR_TRACE_BUF[idx + 2] = d[2] * SUN_DISTANCE;
      SURF_TRACE_BUF[idx + 0] = d[0] * SURFACE_RING_R;
      SURF_TRACE_BUF[idx + 1] = d[1] * SURFACE_RING_R;
      SURF_TRACE_BUF[idx + 2] = d[2] * SURFACE_RING_R;
    }
    // Write the interleaved buffer in place (setPositions would reallocate).
    updateTraceInPlace(sunTrace.geometry, FAR_TRACE_BUF);
    updateTraceInPlace(subsolarTrace.geometry, SURF_TRACE_BUF);
  }

  // Resample at most once per frame; returns true if it did (caller marks dirty).
  function resampleIfDirty() {
    if (!_tracesDirty) return false;
    resampleTraces();
    _tracesDirty = false;
    return true;
  }

  // Seed before the first paint so a cache-warm load doesn't flash placeholders.
  function seed(date) {
    updateSunUniforms(date);
    resampleTraces();
    _tracesDirty = false;
  }

  return { updateSunUniforms, resampleIfDirty, seed };
}

// Write a flat [x,y,z,...] array into a LineGeometry's interleaved
// instanceStart/instanceEnd buffer without allocating. Depends on three.js's
// internal layout (one shared buffer, stride 6); falls back to setPositions if
// that contract doesn't hold (layout change, or geometry not sized yet).
function updateTraceInPlace(geometry, vertices) {
  const segments = vertices.length / 3 - 1;
  const startAttr = geometry.attributes.instanceStart;
  const endAttr = geometry.attributes.instanceEnd;
  const ib = startAttr && startAttr.data;
  if (
    !ib ||
    !endAttr ||
    endAttr.data !== ib ||
    ib.stride !== 6 ||
    !ib.array ||
    ib.array.length < segments * 6
  ) {
    geometry.setPositions(vertices);
    return;
  }
  const arr = ib.array;
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
