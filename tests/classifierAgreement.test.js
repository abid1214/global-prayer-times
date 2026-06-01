// Locks in schedule-internal consistency by way of a classifier-vs-
// classifier invariant at the schedule's reference point.
//
// AQRAB_SAME_LON and AQRAB_NEAREST_CITY are the two methods that
// synthesize their schedule from a projected / snapped reference
// point. classifyPrayer (sun altitude) at that point must agree
// with classifyByClock walked over the times computed there — i.e.
// the synthesized clock schedule matches the sun-altitude reality
// at the latitude it was built for. If anyone changes how either
// classifier computes a band, this asserts they still match where
// they're supposed to. (This is a classifier-vs-classifier check at
// the reference point. It is NOT a panel-vs-globe check: the globe
// shades by true sun altitude at each actual pixel — see
// earthShader.js — so above the cap the borrowed panel times can
// diverge from the globe color; that's documented and expected.)
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
import {
  POLAR_METHODS, getMethod, setMethod,
  PRESETS, getPreset, setPreset,
} from "../src/settings.js";

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
const PRESET_STORAGE_KEY = "gpt.preset";
let savedLocalStorage = null;
let savedPresetStorage = null;
try { savedLocalStorage = localStorage.getItem(STORAGE_KEY); } catch (_) {}
try { savedPresetStorage = localStorage.getItem(PRESET_STORAGE_KEY); } catch (_) {}
const originalMethod = getMethod();
const originalPreset = getPreset();
try {
  // Force JAFARI for the main FIXTURES loop: classifyPrayer() in
  // solar.js (the shader mirror) hard-codes 16°/4°/14° thresholds,
  // so the clock-vs-sun agreement assertions only hold when the
  // schedule was computed with those same Leva Qom angles. A
  // contributor running the test page with `gpt.preset=tehran`
  // persisted (or `?preset=tehran` in the URL) would otherwise see
  // spurious failures from the angle mismatch. The finally block
  // restores the user's actual preset. Stage 1 acceptance tests
  // (further below) override preset explicitly per case.
  setPreset(PRESETS.JAFARI);
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

  // ============================================================
  // ----  Stage 1 acceptance block  ----
  // ============================================================
  // Locks in the four Stage 1 commits: preset selector (1.1),
  // Method 4/5/6 Fajr-anchoring (1.2), default-method change (1.3),
  // and this test/README pass (1.4). Numeric windows use sign +
  // rough-magnitude bounds rather than tight intervals — latitude
  // × season variation produces large noise in absolute deltas.

  // Throws on invalid input rather than silently returning NaN. NaN
  // propagating through a comparison like `(d < 15 || d > 22)` makes
  // BOTH sides false, so an assertion that should fail (because the
  // input was missing) instead silently passes. Surface the bad input
  // loudly so missing-time regressions don't ride along.
  const dmin = (a, b) => {
    if (!(a instanceof Date) || !Number.isFinite(a.getTime())) throw new Error(`dmin: invalid first arg ${a}`);
    if (!(b instanceof Date) || !Number.isFinite(b.getTime())) throw new Error(`dmin: invalid second arg ${b}`);
    return (a.getTime() - b.getTime()) / 60000;
  };
  const isFiniteDate = (d) => d instanceof Date && Number.isFinite(d.getTime());

  // ---- 1.1: Tehran preset, Tehran coords, 2026-06-21 ----
  // Tehran preset = 17.7° Fajr / 4.5° Maghrib / 14° Isha.
  setPreset(PRESETS.TEHRAN);
  setMethod(POLAR_METHODS.AQRAB_NEAREST_CITY);
  const tehranDate = new Date("2026-06-21T12:00:00Z");
  const tehranT = getTimesForLocation(35.6892, 51.3890, tehranDate);
  test("[Stage1.1] Tehran preset · Tehran 2026-06-21 · maghrib − sunset ∈ [15, 22] min", () => {
    if (!isFiniteDate(tehranT.raw?.sunset)) throw new Error("sunset NaN");
    const d = dmin(tehranT.maghrib, tehranT.raw.sunset);
    if (d < 15 || d > 22) throw new Error(`got ${d.toFixed(2)} min`);
  });
  test("[Stage1.1] Tehran preset · Tehran 2026-06-21 · sunrise − fajr ∈ [80, 115] min", () => {
    // Tehran solstice Fajr−sunrise window is wider than the spec's
    // initial 70–90 estimate because the sun's path is shallow in
    // summer mid-latitudes: 17.7° depression takes longer to climb
    // to 0.833° than at equinox. Real value at Tehran solstice: 107 min.
    const d = dmin(tehranT.sunrise, tehranT.fajr);
    if (d < 80 || d > 115) throw new Error(`got ${d.toFixed(2)} min`);
  });

  // ---- 1.1: Jafari preset, same coords/date ----
  setPreset(PRESETS.JAFARI);
  const tehranJ = getTimesForLocation(35.6892, 51.3890, tehranDate);
  test("[Stage1.1] Jafari preset · Tehran 2026-06-21 · maghrib − sunset ∈ [12, 19] min", () => {
    if (!isFiniteDate(tehranJ.raw?.sunset)) throw new Error("sunset NaN");
    const d = dmin(tehranJ.maghrib, tehranJ.raw.sunset);
    if (d < 12 || d > 19) throw new Error(`got ${d.toFixed(2)} min`);
  });

  // ---- 1.1: Preset switch parity at Karbala ----
  setPreset(PRESETS.JAFARI);
  const karbalaJ = getTimesForLocation(32.61, 44.02, tehranDate);
  setPreset(PRESETS.TEHRAN);
  const karbalaT = getTimesForLocation(32.61, 44.02, tehranDate);
  test("[Stage1.1] Karbala 2026-06-21 · ΔFajr (tehran − jafari) ∈ [−15, −8] min", () => {
    const d = dmin(karbalaT.fajr, karbalaJ.fajr);
    if (d < -15 || d > -8) throw new Error(`got ${d.toFixed(2)} min`);
  });
  test("[Stage1.1] Karbala 2026-06-21 · ΔMaghrib (tehran − jafari) ∈ [+2, +5] min", () => {
    const d = dmin(karbalaT.maghrib, karbalaJ.maghrib);
    if (d < 2 || d > 5) throw new Error(`got ${d.toFixed(2)} min`);
  });
  test("[Stage1.1] Karbala 2026-06-21 · |ΔIsha (tehran − jafari)| < 30 sec", () => {
    const ds = Math.abs(karbalaT.isha.getTime() - karbalaJ.isha.getTime()) / 1000;
    if (ds >= 30) throw new Error(`got ${ds.toFixed(1)} sec`);
  });

  // ---- 1.2: Method 4 Fajr-anchor materializes (in-cap edge geometry).
  // Spec asked for φ=50°N λ=0° 2026-06-21, but at that lat/date
  // |φ+δ| = 73.44° < 74° → BELOW the cap, so getTimesForLocation
  // takes the off-cap branch and Method 4 logic never runs (M4 only
  // fires inside the cap). The Fajr-anchor change is observable in
  // the narrow cap-edge regime where today.fajr is unreachable but
  // tomorrow.fajr is reachable. At φ=51°N λ=0°, 2026-07-02 hits
  // this: today min-alt ≈ -15.99° (just above −16°, unreachable),
  // tomorrow min-alt ≈ -16.07° (just below −16°, reachable). Isha
  // shifts by ~109 min between sunrise-anchored (old) and Fajr-
  // anchored (new) — easily ≥ 1 min.
  setPreset(PRESETS.JAFARI);
  setMethod(POLAR_METHODS.MIDNIGHT);
  const m4Edge = getTimesForLocation(51, 0, new Date("2026-07-02T12:00:00Z"));
  test("[Stage1.2] Method 4 cap-edge (51°N 0° 2026-07-02) · polarMethod.kind = 'midnight'", () => {
    assertEq(m4Edge.polarMethod?.kind, "midnight", "kind");
  });
  test("[Stage1.2] Method 4 cap-edge · Isha − Maghrib < 180 min (Fajr-anchored, was ~213 with sunrise)", () => {
    // Under the OLD sunrise anchor at this lat/date the (isha −
    // maghrib) interval was ~3h33m (213 min). Under the new Fajr
    // anchor (when tomorrow's Fajr is reachable) the interval
    // collapses to ~1h44m (104 min). 180 min is comfortably between
    // the two — a sign-and-magnitude check rather than a tight
    // interval.
    const d = dmin(m4Edge.isha, m4Edge.maghrib);
    if (d >= 180) throw new Error(`isha − maghrib = ${d.toFixed(2)} min (expected < 180 under Fajr anchor)`);
  });

  // ---- 1.2: Method 4 sunrise-fallback inside the cap ----
  setPreset(PRESETS.JAFARI);
  setMethod(POLAR_METHODS.MIDNIGHT);
  const m4InCap = getTimesForLocation(60, 30, new Date("2026-06-21T12:00:00Z"));
  test("[Stage1.2] Method 4 inside cap (60°N 30°E 2026-06-21) · endOfNightSource = 'sunrise-fallback'", () => {
    assertEq(m4InCap.polarMethod?.kind, "midnight", "kind");
    assertEq(m4InCap.polarMethod?.endOfNightSource, "sunrise-fallback", "endOfNightSource");
  });
  // The session-deduped console.warn is non-deterministic across test
  // re-runs (the boolean is reset by reload but not by re-running
  // the test block). Not asserted here.

  // ---- 1.2: 60°N source label across seasons ----
  // Spec described a "flip from sunrise-fallback to fajr across the
  // equinox at 60°N". The actual behavior: at 60°N solstice we're
  // in cap (covered above); at 60°N equinox |φ+δ|=60°<74° so we're
  // BELOW the cap and Method 4 doesn't run at all — polarMethod
  // is null. The observable spec is the cap-membership flip, not
  // the source-label flip.
  setPreset(PRESETS.JAFARI);
  setMethod(POLAR_METHODS.MIDNIGHT);
  const m4Equinox = getTimesForLocation(60, 30, new Date("2026-03-20T12:00:00Z"));
  test("[Stage1.2] Method 4 at 60°N vernal equinox · below cap; polarMethod = null", () => {
    if (m4Equinox.polarMethod !== null) {
      throw new Error(`expected null polarMethod below cap, got ${JSON.stringify(m4Equinox.polarMethod)}`);
    }
  });

  // ---- 1.3: Tromsø Method 2 structural assertion ----
  setPreset(PRESETS.JAFARI);
  setMethod(POLAR_METHODS.AQRAB_NEAREST_CITY);
  const tromso = getTimesForLocation(69.65, 18.95, new Date("2026-06-21T12:00:00Z"));
  test("[Stage1.3] Tromsø 2026-06-21 Method 2 · polarMethod.kind = 'aqrab_city'", () => {
    assertEq(tromso.polarMethod?.kind, "aqrab_city", "kind");
  });
  test("[Stage1.3] Tromsø Method 2 · city.name is non-empty string", () => {
    const c = tromso.polarMethod?.city;
    if (!c || typeof c.name !== "string" || c.name.length === 0) {
      throw new Error(`city not resolved: ${JSON.stringify(c)}`);
    }
  });
  test("[Stage1.3] Tromsø Method 2 · city.lat < 65° (temperate substitute)", () => {
    const c = tromso.polarMethod?.city;
    if (!c || c.lat >= 65) throw new Error(`city.lat = ${c?.lat}, expected < 65`);
  });
  test("[Stage1.3] Tromsø Method 2 · city.lat ≤ projectedFromLat", () => {
    const c = tromso.polarMethod?.city;
    const proj = tromso.polarMethod?.projectedFromLat;
    if (!c || !Number.isFinite(proj) || c.lat > proj) {
      throw new Error(`city.lat = ${c?.lat}, projectedFromLat = ${proj}`);
    }
  });
  test("[Stage1.3] Tromsø Method 2 · all panel times finite", () => {
    for (const key of ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"]) {
      if (!isFiniteDate(tromso[key])) throw new Error(`${key} not finite: ${tromso[key]}`);
    }
  });

  // ---- 1.4: Classifier agreement at the spec's explicit cell ----
  // φ = 30°N, λ = 0°, 2026-06-21, hourly through the day, Method 1.
  // The fixture loop above covers this kind of test at NYC equinox;
  // this adds the spec's exact coords for completeness.
  setPreset(PRESETS.JAFARI);
  setMethod(POLAR_METHODS.AQRAB_SAME_LON);
  {
    const base = new Date("2026-06-21T12:00:00Z");
    const times = getTimesForLocation(30, 0, base);
    const ref = referenceCoords(times, 30, 0);
    for (const dh of HOUR_OFFSETS) {
      const now = new Date(base.getTime() + dh * 3600 * 1000);
      const sunBand   = classifyPrayer(ref.lat * DEG, ref.lon * DEG, now);
      const clockBand = classifyByClock(times, now);
      test(`[Stage1.4] 30°N 0° 2026-06-21 @ ${dh.toFixed(1)}h · Method 1 · clock === sun`, () => {
        assertEq(clockBand, sunBand, "classifier disagreement");
      });
    }
  }
} finally {
  // setMethod() / setPreset() restore settings.js's in-memory caches
  // (so any post-test getMethod() / getPreset() returns the original
  // choice). Then overwrite localStorage with the raw saved values so
  // a ?m= or ?preset= URL override at load time doesn't leak into
  // persistent storage.
  setMethod(originalMethod);
  setPreset(originalPreset);
  try {
    if (savedLocalStorage === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, savedLocalStorage);
  } catch (_) {}
  try {
    if (savedPresetStorage === null) localStorage.removeItem(PRESET_STORAGE_KEY);
    else localStorage.setItem(PRESET_STORAGE_KEY, savedPresetStorage);
  } catch (_) {}
}

// ---- report results (browser DOM, or Node stdout) ----
const nFail = results.filter((r) => !r.ok).length;
const summaryText = `${results.length - nFail}/${results.length} passed`
                  + (nFail ? `  (${nFail} failed)` : "");

if (typeof document !== "undefined" && document.getElementById("results")) {
  const el = document.getElementById("results");
  el.textContent = "";
  for (const r of results) {
    const line = document.createElement("span");
    line.className = r.ok ? "pass" : "fail";
    line.textContent = `${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : `  →  ${r.error}`}\n`;
    el.appendChild(line);
  }
  // #results is a <pre> (phrasing-content container), so the summary must be
  // a <span> not a <div> — a block-level child inside <pre> is invalid HTML.
  const summary = document.createElement("span");
  summary.className = "summary " + (nFail === 0 ? "pass" : "fail");
  summary.textContent = `\n${summaryText}`;
  el.appendChild(summary);
} else {
  for (const r of results) {
    if (!r.ok) console.error(`✗ ${r.name}  →  ${r.error}`);
  }
  console.log(summaryText);
  if (typeof process !== "undefined" && nFail) process.exitCode = 1;
}
