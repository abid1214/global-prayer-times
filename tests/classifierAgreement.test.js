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

// Strict chronological-ordering invariant. classifyByClock walks the
// six prayer thresholds in the order fajr → sunrise → dhuhr → asr →
// maghrib → isha, so the returned times MUST satisfy that ordering as
// Date instants. NaN markers (legitimately produced at extreme
// latitudes for some methods) are skipped — the prior band absorbs
// the gap — but any finite pair out of order is a real bug that
// silently corrupts the "Now in" indicator.
//
// This invariant was added after a midnightTimes regression placed
// today's "fajr" at the upcoming-night midpoint (an EVENING value,
// after sunrise/dhuhr/asr on the same day). The bug propagated to
// AQRAB_AL_AWQAT and ANGLE_REDUCED via their midnight fallback paths
// and the 150-fixture tripwire missed it because diverging-method
// tests only smoke-check no-throw. This assertion would have failed
// loudly. Pattern: every real bug that escapes the suite turns into
// a permanent invariant here.
function assertChronological(times) {
  const ORDER = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
  let prev = null;
  let prevName = null;
  for (const name of ORDER) {
    const t = times[name];
    if (!t || !Number.isFinite(t.getTime())) continue;  // legitimate NaN gap
    if (prev !== null && t.getTime() <= prev) {
      throw new Error(
        `out of order: ${name}=${t.toISOString()} ≤ ${prevName}=${new Date(prev).toISOString()}`
      );
    }
    prev = t.getTime();
    prevName = name;
  }
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

// Save the raw localStorage value rather than getMethod()'s result.
// If the test page was opened with ?m=foo (which settings.js honors
// at load), getMethod() returns "foo" but localStorage still holds
// the recipient's true preference. Restoring via setMethod() would
// write "foo" into localStorage and overwrite the saved value;
// restoring the raw localStorage entry directly keeps the test
// side-effect free.
const STORAGE_KEY = "polar_method";
let savedLocalStorage = null;
try { savedLocalStorage = localStorage.getItem(STORAGE_KEY); } catch (_) {}
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

    // Ordering invariant — one test per (method, fixture) cell.
    // Asserts the six returned times are strictly chronological as
    // Dates. NaN markers are skipped (see assertChronological). This
    // is the test that would have caught the midnightTimes regression
    // where today's "fajr" landed in the evening.
    for (const method of [...AGREEING_METHODS, ...DIVERGING_METHODS]) {
      setMethod(method);
      const times = getTimesForLocation(fx.lat, fx.lon, base);
      test(`[${method}] ${fx.name} — chronological ordering`, () => {
        assertChronological(times);
      });
    }
  }

  // ---- crossDay projection invariant ----
  // Direct test of classifyByClock's crossDay path. Adhan can return
  // a prayer time on the previous UTC calendar day at high latitudes
  // (longitude puts solar antimeridian before UTC midnight). The
  // dhuhr-anchored projection in classifyByClock must preserve the
  // schedule's internal ordering across that boundary, otherwise the
  // band walker labels every daylight hour as pre-dawn. The
  // chronological-ordering fixture above doesn't catch this — it
  // checks the times object that getTimesForLocation returns, not
  // classifyByClock's internal projected sequence.
  const xdayTimes = {
    fajr:    new Date("2025-10-25T22:00:00Z"),  // ← prev UTC day
    sunrise: new Date("2025-10-26T02:00:00Z"),
    dhuhr:   new Date("2025-10-26T10:00:00Z"),
    asr:     new Date("2025-10-26T14:00:00Z"),
    maghrib: new Date("2025-10-26T19:00:00Z"),
    isha:    new Date("2025-10-26T22:00:00Z"),
  };
  // After dhuhr-anchored projection the schedule should map to:
  //   fajr    → today−1 22:00   (was prev-UTC-day in source)
  //   sunrise → today    02:00
  //   dhuhr   → today    10:00
  //   asr     → today    14:00
  //   maghrib → today    19:00
  //   isha    → today    22:00
  // Pre-fix per-time setUTCFullYear projection would have placed
  // fajr at today 22:00 (after sunrise's 02:00), breaking the
  // walker. The 12:00 case is the critical regression catcher:
  // pre-fix it returned "none" because t<fajr@22:00; post-fix it
  // returns "dhuhr".
  const expectations = [
    // now (UTC)              → expected band
    ["2026-05-19T00:00:00Z",     "fajr"],     // between fajr (yest 22:00) and sunrise (02:00)
    ["2026-05-19T08:00:00Z",     "none"],     // post-sunrise, pre-dhuhr morning gap
    ["2026-05-19T12:00:00Z",     "dhuhr"],    // ← the bug-catcher
    ["2026-05-19T15:00:00Z",     "asr"],
    ["2026-05-19T20:00:00Z",     "maghrib"],
  ];
  for (const [nowIso, expected] of expectations) {
    test(`[crossDay] fajr-on-prev-UTC-day @ ${nowIso.slice(11, 16)}Z — band = ${expected}`, () => {
      const band = classifyByClock(xdayTimes, new Date(nowIso), { crossDay: true });
      assertEq(band, expected, "crossDay band");
    });
  }
} finally {
  // setMethod() restores settings.js's in-memory cache (so any
  // post-test getMethod() returns the original choice). Then
  // overwrite localStorage with the raw saved value so a ?m= URL
  // override at load time doesn't leak into persistent storage.
  setMethod(originalMethod);
  try {
    if (savedLocalStorage === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, savedLocalStorage);
  } catch (_) {}
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
// #results is a <pre> (phrasing-content container), so the summary
// must be a <span> not a <div> — a block-level child inside <pre> is
// invalid HTML and can render inconsistently across browsers.
const summary = document.createElement("span");
summary.className = "summary " + (nFail === 0 ? "pass" : "fail");
summary.textContent = `\n${results.length - nFail}/${results.length} passed`
                    + (nFail ? `  (${nFail} failed)` : "");
el.appendChild(summary);
