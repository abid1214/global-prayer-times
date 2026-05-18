import * as adhan from "adhan";
import { classifyPrayer, sunPosition } from "./solar.js";
import { POLAR_METHODS, getMethod } from "./settings.js";
import { snapToNearestHighLatCity } from "./highLatCities.js";

const DEG = Math.PI / 180;

// Shia Ja'fari (Leva Institute Qum) parameters: Fajr 16°, Isha 14°, Maghrib 4°.
// Asr uses shadow factor 1 (Madhab.Shafi in adhan-js).
function jafariParams() {
  const params = adhan.CalculationMethod.Other();
  params.fajrAngle = 16;
  params.ishaAngle = 14;
  params.maghribAngle = 4;
  params.madhab = adhan.Madhab.Shafi;
  return params;
}

const PRAYER_META = [
  { key: "fajr",    label: "Fajr",    color: "#5B3A93" },
  { key: "sunrise", label: "Sunrise", color: "#aab3c5", muted: true },
  { key: "dhuhr",   label: "Dhuhr",   color: "#F2B33D" },
  { key: "asr",     label: "Asr",     color: "#E07A3E" },
  { key: "maghrib", label: "Maghrib", color: "#C44569" },
  { key: "isha",    label: "Isha",    color: "#283F6E" },
];

// Aqrab al-Bilad threshold is sun-relative. Two failure modes for the
// standard Ja'fari calculation, both depending on the current solar
// declination δ:
//   • Fajr fails (sun never reaches -16° below horizon) when |φ + δ| > 74°.
//   • Polar night (sun never rises above 0°) when |φ - δ| > 90° — Adhan
//     can also miss Maghrib / sunrise in this regime.
// Project to the closer of the two thresholds per hemisphere so we cover
// both. Same threshold math is mirrored in the fragment shader, where
// every cap pixel is rendered with its projection point's schedule via
// an effective-latitude clamp (see earthMaterial.js).
const FAJR_LIMIT_DEG = 74;
const DAY_LIMIT_DEG = 90;

export function aqrabProjection(latDeg, date = new Date()) {
  const { declination } = sunPosition(date);
  const declDeg = (declination * 180) / Math.PI;
  const northThresh = Math.min(FAJR_LIMIT_DEG - declDeg, DAY_LIMIT_DEG + declDeg);
  const southThresh = Math.max(-FAJR_LIMIT_DEG - declDeg, -DAY_LIMIT_DEG + declDeg);
  if (latDeg > northThresh) return { projectedFromLat: northThresh };
  if (latDeg < southThresh) return { projectedFromLat: southThresh };
  return null;
}

// ---------- internal helpers ----------

function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function dayKey(d) {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function isValidDate(t) {
  return t instanceof Date && Number.isFinite(t.getTime());
}

function computeAdhanAt(latDeg, lonDeg, date, params = jafariParams()) {
  const coords = new adhan.Coordinates(latDeg, lonDeg);
  return new adhan.PrayerTimes(coords, date, params);
}

// Sun's minimum altitude (radians) at latitude φ for the day with
// declination δ. Occurs at solar antimeridian:
//   sin(α_min) = sin(φ)sin(δ) - cos(φ)cos(δ) = -cos(φ+δ)
//   α_min = |φ+δ| - π/2
// Used by ANGLE_REDUCED to derive an attainable Fajr/Isha threshold.
function sunMinAltitudeRad(latDeg, date) {
  const { declination } = sunPosition(date);
  return Math.abs(latDeg * DEG + declination) - Math.PI / 2;
}

// Best-available Maghrib anchor: the Ja'fari -4° boundary if Adhan
// returned one for this day, falling back to sunset (0°) if the -4°
// boundary doesn't exist. The high-lat fallback methods all need a
// "night start" anchor and degrade more gracefully with sunset than
// with NaN.
function anchorMaghrib(times) {
  return isValidDate(times.maghrib) ? times.maghrib : times.sunset;
}

// ---------- clock-based "Now in" classifier ----------
// Used for the side-panel "Now in" indicator under methods 2-5
// (AQRAB_AL_AWQAT / MIDNIGHT / SEVENTH / ANGLE_REDUCED). For these
// methods the band timing no longer matches "sun is at angle X below
// horizon" — bands come from either a different day (aqrab al-awqāt)
// or from a synthesized midnight/seventh split that doesn't
// correspond to any sun altitude at this location. The sun-altitude
// classifier in solar.js would produce e.g. "Dhuhr" during polar
// night under aqrab al-awqāt, which is the kind of bug that erodes
// user trust.
//
// NOTE: this is intentionally NOT mirrored in the fragment shader.
// The visual cap always renders via same-longitude projection
// regardless of method (see the docblock in earthMaterial.js). For
// methods 2-5 the bands inside the cap will therefore disagree with
// the side panel — the panel's descriptor line in panel.js surfaces
// the divergence.
export function classifyByClock(times, now) {
  const t = now.getTime();
  const fajr    = times.fajr   ? times.fajr.getTime()    : NaN;
  const sunrise = times.sunrise ? times.sunrise.getTime(): NaN;
  const dhuhr   = times.dhuhr  ? times.dhuhr.getTime()   : NaN;
  const asr     = times.asr    ? times.asr.getTime()     : NaN;
  const maghrib = times.maghrib ? times.maghrib.getTime(): NaN;
  const isha    = times.isha   ? times.isha.getTime()    : NaN;

  // Walk the day forward in band order. Each band starts at its threshold
  // and continues until the next valid threshold. NaN markers (degenerate
  // method outputs at extreme latitudes) are skipped so the prior band
  // extends through the gap.
  if (Number.isFinite(fajr)    && t < fajr)    return "none";  // pre-dawn
  if (Number.isFinite(sunrise) && t < sunrise) return "fajr";
  if (Number.isFinite(dhuhr)   && t < dhuhr)   return "none";  // morning
  if (Number.isFinite(asr)     && t < asr)     return "dhuhr";
  if (Number.isFinite(maghrib) && t < maghrib) return "asr";
  if (Number.isFinite(isha)    && t < isha)    return "maghrib";
  return "isha";  // isha until next-day rollover (panel re-fetches daily)
}

// ---------- buildResult ----------

function buildResult({ latDeg, lonDeg, date, times, polarMethod, classifyMode }) {
  // classifyMode: "sun" for AQRAB_SAME_LON / AQRAB_NEAREST_CITY (sun at
  // projected lat/lon is the intended reference); "clock" for everything
  // else.
  let currentPrayer;
  if (classifyMode === "clock") {
    currentPrayer = classifyByClock(times, new Date());
  } else {
    // Sun-relative: use the projected location's coords with the actual
    // current date.
    const refLat = polarMethod?.kind === "aqrab" ? polarMethod.projectedFromLat
                 : polarMethod?.kind === "aqrab_city" ? (polarMethod.city?.lat ?? polarMethod.projectedFromLat)
                 : latDeg;
    const refLon = polarMethod?.kind === "aqrab_city" ? (polarMethod.city?.lon ?? lonDeg) : lonDeg;
    currentPrayer = classifyPrayer(refLat * DEG, refLon * DEG, date);
  }

  return {
    fajr:    times.fajr,
    sunrise: times.sunrise,
    dhuhr:   times.dhuhr,
    asr:     times.asr,
    maghrib: times.maghrib,
    isha:    times.isha,
    currentPrayer,
    // Back-compat: panel still reads `aqrab.projectedFromLat` for the
    // existing teal projection-pin/arc. Populate only when the method
    // actually projects to a same-longitude latitude.
    aqrab: polarMethod?.kind === "aqrab" ? { projectedFromLat: polarMethod.projectedFromLat } : null,
    polarMethod,
    raw: times.raw || null,
  };
}

// ---------- method 3: aqrab al-awqāt date walk ----------

// (lat→0.1°, lon→0.1°, todayKey) → Date | null. Cache because the walk
// can iterate up to 90 days; without caching the panel would re-walk on
// every scrubber tick.
const _awqatCache = new Map();
const AWQAT_MAX_BACK_DAYS = 90;

function walkBackForValidDay(latDeg, lonDeg, date) {
  const params = jafariParams();
  for (let i = 1; i <= AWQAT_MAX_BACK_DAYS; i++) {
    const trial = addDays(date, -i);
    const t = computeAdhanAt(latDeg, lonDeg, trial, params);
    if (isValidDate(t.fajr) && isValidDate(t.sunrise) && isValidDate(t.dhuhr)
        && isValidDate(t.asr) && isValidDate(t.maghrib) && isValidDate(t.isha)) {
      return trial;
    }
  }
  return null;
}

function findRecentValidDate(latDeg, lonDeg, date) {
  const key = `${latDeg.toFixed(1)}:${lonDeg.toFixed(1)}:${dayKey(date)}`;
  if (_awqatCache.has(key)) return _awqatCache.get(key);
  const result = walkBackForValidDay(latDeg, lonDeg, date);
  _awqatCache.set(key, result);
  return result;
}

// ---------- method 4: niṣf al-layl (middle of night) ----------
//
// Spec: Isha at midpoint between Maghrib and Fajr; Fajr from that
// midpoint. We anchor "Maghrib" at the -4° boundary (or sunset if -4°
// doesn't occur) and "Fajr" at the next-day sunrise (no Fajr to anchor
// to at high lat, by construction). Midpoint M = (Maghrib + next
// sunrise) / 2. Isha-faḍīla starts at M; Fajr starts at M.
function midnightTimes(latDeg, lonDeg, date, params) {
  const today    = computeAdhanAt(latDeg, lonDeg, date, params);
  const tomorrow = computeAdhanAt(latDeg, lonDeg, addDays(date, 1), params);
  const maghrib  = anchorMaghrib(today);
  const nextRise = tomorrow.sunrise;

  let fajr, isha;
  if (isValidDate(maghrib) && isValidDate(nextRise)) {
    const mid = new Date((maghrib.getTime() + nextRise.getTime()) / 2);
    fajr = mid;
    isha = mid;
  } else {
    fajr = today.fajr;
    isha = today.isha;
  }

  return buildResult({
    latDeg, lonDeg, date,
    times: {
      fajr,
      sunrise: today.sunrise,
      dhuhr:   today.dhuhr,
      asr:     today.asr,
      maghrib,
      isha,
      raw: today,
    },
    polarMethod: { kind: "midnight" },
    classifyMode: "clock",
  });
}

// ---------- method 5: sub'iyya (one-seventh) ----------
//
// Spec: Isha at 1/7 of the night past Maghrib; Fajr at 1/7 before
// sunrise. "The night" for today's Fajr is last night (yesterday's
// Maghrib → today's sunrise); for today's Isha it's tonight (today's
// Maghrib → tomorrow's sunrise). Symmetric with the standard
// HighLatitudeRule.SeventhOfTheNight in adhan.js.
function seventhTimes(latDeg, lonDeg, date, params) {
  const yesterday = computeAdhanAt(latDeg, lonDeg, addDays(date, -1), params);
  const today     = computeAdhanAt(latDeg, lonDeg, date, params);
  const tomorrow  = computeAdhanAt(latDeg, lonDeg, addDays(date, 1), params);

  const yMaghrib = anchorMaghrib(yesterday);
  const tMaghrib = anchorMaghrib(today);
  const tSunrise = today.sunrise;
  const nextRise = tomorrow.sunrise;

  let fajr = today.fajr;
  let isha = today.isha;
  if (isValidDate(yMaghrib) && isValidDate(tSunrise)) {
    const lastNightLen = tSunrise.getTime() - yMaghrib.getTime();
    fajr = new Date(tSunrise.getTime() - lastNightLen / 7);
  }
  if (isValidDate(tMaghrib) && isValidDate(nextRise)) {
    const thisNightLen = nextRise.getTime() - tMaghrib.getTime();
    isha = new Date(tMaghrib.getTime() + thisNightLen / 7);
  }

  return buildResult({
    latDeg, lonDeg, date,
    times: {
      fajr,
      sunrise: tSunrise,
      dhuhr:   today.dhuhr,
      asr:     today.asr,
      maghrib: tMaghrib,
      isha,
      raw: today,
    },
    polarMethod: { kind: "seventh" },
    classifyMode: "clock",
  });
}

// ---------- method 6: angle-based with seasonal reduction ----------
//
// Spec: keep -16°/-14° but reduce toward the horizon proportionally
// when the sun doesn't reach the threshold. Reduce to whichever is
// closer to the horizon: the standard angle, or the sun's minimum
// altitude on this date (so the reduced threshold is always
// physically attainable, and converges to the standard whenever it's
// reachable).
function angleReducedTimes(latDeg, lonDeg, date, params) {
  const sunMinRad = sunMinAltitudeRad(latDeg, date);
  const sunMinDeg = sunMinRad / DEG;                       // negative
  const fajrAngleDeg = Math.min(16, Math.max(0, -sunMinDeg));
  const ishaAngleDeg = Math.min(14, Math.max(0, -sunMinDeg));

  const reduced = jafariParams();
  reduced.fajrAngle = fajrAngleDeg;
  reduced.ishaAngle = ishaAngleDeg;
  const t = computeAdhanAt(latDeg, lonDeg, date, reduced);

  return buildResult({
    latDeg, lonDeg, date,
    times: {
      fajr:    t.fajr,
      sunrise: t.sunrise,
      dhuhr:   t.dhuhr,
      asr:     t.asr,
      maghrib: anchorMaghrib(t),
      isha:    t.isha,
      raw: t,
    },
    polarMethod: {
      kind: "angle_reduced",
      fajrAngle: fajrAngleDeg,
      ishaAngle: ishaAngleDeg,
    },
    classifyMode: "clock",
  });
}

// ---------- main entry point ----------

export function getTimesForLocation(latDeg, lonDeg, date = new Date()) {
  const method = getMethod();
  const params = jafariParams();
  const projection = aqrabProjection(latDeg, date);

  // Outside the cap every method collapses to the standard computation.
  if (!projection) {
    const t = computeAdhanAt(latDeg, lonDeg, date, params);
    return buildResult({
      latDeg, lonDeg, date,
      times: {
        fajr: t.fajr, sunrise: t.sunrise, dhuhr: t.dhuhr,
        asr: t.asr, maghrib: t.maghrib, isha: t.isha, raw: t,
      },
      polarMethod: null,
      classifyMode: "sun",
    });
  }

  switch (method) {
    case POLAR_METHODS.AQRAB_SAME_LON: {
      const t = computeAdhanAt(projection.projectedFromLat, lonDeg, date, params);
      return buildResult({
        latDeg, lonDeg, date,
        times: {
          fajr: t.fajr, sunrise: t.sunrise, dhuhr: t.dhuhr,
          asr: t.asr, maghrib: t.maghrib, isha: t.isha, raw: t,
        },
        polarMethod: { kind: "aqrab", projectedFromLat: projection.projectedFromLat },
        classifyMode: "sun",
      });
    }

    case POLAR_METHODS.AQRAB_NEAREST_CITY: {
      const city = snapToNearestHighLatCity(latDeg, lonDeg, projection.projectedFromLat);
      const finalLat = city ? city.lat : projection.projectedFromLat;
      const finalLon = city ? city.lon : lonDeg;
      const t = computeAdhanAt(finalLat, finalLon, date, params);
      return buildResult({
        latDeg, lonDeg, date,
        times: {
          fajr: t.fajr, sunrise: t.sunrise, dhuhr: t.dhuhr,
          asr: t.asr, maghrib: t.maghrib, isha: t.isha, raw: t,
        },
        // Shader can't carry a city table, so it renders identically to
        // AQRAB_SAME_LON (same-longitude projection). The panel surfaces
        // the discrepancy via the "Visual cap shows…" message in
        // panel.js when shaderFallback is false.
        polarMethod: {
          kind: "aqrab_city",
          projectedFromLat: projection.projectedFromLat,
          city: city || null,
          shaderFallback: !city,
        },
        classifyMode: "sun",
      });
    }

    case POLAR_METHODS.AQRAB_AL_AWQAT: {
      const validDate = findRecentValidDate(latDeg, lonDeg, date);
      if (!validDate) {
        // Per spec: cap walk at 90 days; fall through to midnight.
        return midnightTimes(latDeg, lonDeg, date, params);
      }
      const t = computeAdhanAt(latDeg, lonDeg, validDate, params);
      return buildResult({
        latDeg, lonDeg, date,
        times: {
          fajr: t.fajr, sunrise: t.sunrise, dhuhr: t.dhuhr,
          asr: t.asr, maghrib: t.maghrib, isha: t.isha, raw: t,
        },
        polarMethod: { kind: "aqrab_awqat", derivedFromDate: validDate },
        classifyMode: "clock",
      });
    }

    case POLAR_METHODS.MIDNIGHT:
      return midnightTimes(latDeg, lonDeg, date, params);

    case POLAR_METHODS.SEVENTH:
      return seventhTimes(latDeg, lonDeg, date, params);

    case POLAR_METHODS.ANGLE_REDUCED:
      return angleReducedTimes(latDeg, lonDeg, date, params);

    default:
      // settings.js validates on load, but a runtime change could in
      // principle land here. Warn loudly and fall back to the default
      // behavior rather than returning undefined.
      console.warn(`[prayer] unknown polar method "${method}", falling back to ${POLAR_METHODS.AQRAB_SAME_LON}`);
      const t = computeAdhanAt(projection.projectedFromLat, lonDeg, date, params);
      return buildResult({
        latDeg, lonDeg, date,
        times: {
          fajr: t.fajr, sunrise: t.sunrise, dhuhr: t.dhuhr,
          asr: t.asr, maghrib: t.maghrib, isha: t.isha, raw: t,
        },
        polarMethod: { kind: "aqrab", projectedFromLat: projection.projectedFromLat },
        classifyMode: "sun",
      });
  }
}

export { PRAYER_META };
