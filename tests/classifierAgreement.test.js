// Locks in the same-longitude-only cap visualization decision (see
// the docblock in src/earthMaterial.js) by way of a classifier-vs-
// classifier invariant at the schedule's reference point.
//
// AQRAB_SAME_LON and AQRAB_NEAREST_CITY are the two methods where
// the panel uses the sun-altitude classifier (at the projected /
// snapped reference point); the clock-based classifier walked over
// the same times must agree with it. If anyone changes how either
// classifier computes a band, this asserts they still match where
// they're supposed to. (Note: this is a classifier-vs-classifier
// check at the reference point, NOT a panel-vs-shader check —
// the shader is always same-longitude regardless of method per
// the earthMaterial.js docblock, so nearest-city's panel times
// can still diverge from the visual cap; that's documented and
// expected.)
//
// For the four clock-mode methods (AQRAB_AL_AWQAT / MIDNIGHT /
// SEVENTH / ANGLE_REDUCED) the two classifiers are designed to
// disagree — clock-mode is the whole point — so the fixture just
// exercises both paths without asserting agreement.
//
// Run by opening tests/classifierAgreement.html in a browser. No
// test runner needed; results print to the page.
//
// Test-design notes for future maintainers:
//   • Both `times` and the comparison instant `now` must reference
//     the same UTC calendar day, otherwise adhan computes the wrong
//     day's prayer times and the comparison becomes apples-to-
//     oranges. Sample offsets here are constrained to ±10 h around
//     a UTC-noon base.
//   • Offsets are deliberately jittered (irrational-looking) to
//     avoid landing exactly on a prayer threshold, where refraction
//     differences (cf. Part 3a) could cause spurious mismatches.
//   • At polar-day / polar-night fixtures, adhan returns NaN for
//     some prayer times. classifyByClock skips NaN markers (see
//     prayer.js), so polar fixtures still exercise the walker
//     without crashing.

import { getTimesForLocation, classifyByClock } from "../src/prayer.js";
import { classifyPrayer } from "../src/solar.js";
import { POLAR_METHODS, getMethod, setMethod } from "../src/settings.js";

const DEG = Math.PI / 180;

// Five fixtures spanning the cases that matter:
//   (a) temperate latitude — control case, cap inactive
//   (b) just inside the Fajr cap in summer
//   (c) deep polar night
//   (d) polar day
//   (e) seasonal cap-boundary transition (|φ + δ| crosses 74°)
const FIXTURES = [
  { name: "Temperate (NYC, equinox)",            lat: 40.71, lon: -74.01, dateISO: "2025-03-21T12:00:00Z" },
  { name: "Just inside Fajr cap (Tromsø, June)", lat: 69.65, lon:  18.96, dateISO: "2025-06-21T12:00:00Z" },
  { name: "Polar night (Longyearbyen, Dec)",     lat: 78.22, lon:  15.65, dateISO: "2025-12-21T12:00:00Z" },
  { name: "Polar day (Longyearbyen, June)",      lat: 78.22, lon:  15.65, dateISO: "2025-06-21T12:00:00Z" },
  { name: "Cap-boundary transition (~74°N)",     lat: 74.00, lon:   0.00, dateISO: "2025-05-15T12:00:00Z" },
];

// Hour offsets from the UTC-noon base. Kept inside ±10 h so `now`
// stays in the same UTC calendar day as the date used to compute
// `times`. Irrational-looking values reduce the chance of landing
// exactly on a prayer threshold.
const HOUR_OFFSETS = [-7.3, -3.1, +1.7, +5.4, +8.9];

const AGREEING_METHODS = [
  POLAR_METHODS.AQRAB_SAME_LON,
  POLAR_METHODS.AQRAB_NEAREST_CITY,
];

const DIVERGING_METHODS = [
  POLAR_METHODS.AQRAB_AL_AWQAT,
  POLAR_METHODS.MIDNIGHT,
  POLAR_METHODS.SEVENTH,
  POLAR_METHODS.ANGLE_REDUCED,
];

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, error: e.message }); }
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Pull the reference (lat, lon) used to compute the schedule. For
// SAME_LON it's the projected latitude on the user's longitude; for
// NEAREST_CITY it's the snapped city's coordinates (or the projection
// when no city was in window). Off-cap returns the user's own coords.
function referenceCoords(times, userLat, userLon) {
  const pm = times.polarMethod;
  if (!pm) return { lat: userLat, lon: userLon };
  if (pm.kind === "aqrab") return { lat: pm.projectedFromLat, lon: userLon };
  if (pm.kind === "aqrab_city") {
    return pm.city
      ? { lat: pm.city.lat, lon: pm.city.lon }
      : { lat: pm.projectedFromLat, lon: userLon };
  }
  return { lat: userLat, lon: userLon };
}

const originalMethod = getMethod();
try {
  for (const fx of FIXTURES) {
    const base = new Date(fx.dateISO);

    for (const method of AGREEING_METHODS) {
      setMethod(method);
      // Compute the schedule once at the base date — all sample
      // offsets fall within the same UTC day, so adhan's date input
      // stays constant and the times object is the right one to
      // compare against.
      const times = getTimesForLocation(fx.lat, fx.lon, base);
      const ref = referenceCoords(times, fx.lat, fx.lon);

      for (const dh of HOUR_OFFSETS) {
        const now = new Date(base.getTime() + dh * 3600 * 1000);
        const sunBand   = classifyPrayer(ref.lat * DEG, ref.lon * DEG, now);
        const clockBand = classifyByClock(times, now);
        test(`[${method}] ${fx.name} @ ${dh.toFixed(1)}h — clock === sun`, () => {
          assertEq(clockBand, sunBand, "classifier disagreement");
        });
      }
    }

    for (const method of DIVERGING_METHODS) {
      setMethod(method);
      // Smoke test only — confirm both classifiers run without
      // throwing. Disagreement is expected and intentional (see
      // earthMaterial.js docblock); do not assert equality.
      const times = getTimesForLocation(fx.lat, fx.lon, base);
      const ref = referenceCoords(times, fx.lat, fx.lon);
      for (const dh of HOUR_OFFSETS) {
        const now = new Date(base.getTime() + dh * 3600 * 1000);
        test(`[${method}] ${fx.name} @ ${dh.toFixed(1)}h — both classifiers run`, () => {
          classifyByClock(times, now);
          classifyPrayer(ref.lat * DEG, ref.lon * DEG, now);
        });
      }
    }
  }
} finally {
  setMethod(originalMethod);
}

// ---- render results to the page ----
const el = document.getElementById("results");
el.textContent = "";
let nFail = 0;
for (const r of results) {
  const mark = r.ok ? "✓" : "✗";
  const cls  = r.ok ? "pass" : "fail";
  const tail = r.ok ? "" : `  →  ${r.error}`;
  const line = document.createElement("span");
  line.className = cls;
  line.textContent = `${mark} ${r.name}${tail}\n`;
  el.appendChild(line);
  if (!r.ok) nFail++;
}
const summary = document.createElement("div");
summary.className = "summary " + (nFail === 0 ? "pass" : "fail");
summary.textContent = `\n${results.length - nFail}/${results.length} passed`
                    + (nFail ? `  (${nFail} failed)` : "");
el.appendChild(summary);
