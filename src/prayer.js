import * as adhan from "adhan";
import { classifyPrayer, sunPosition } from "./solar.js";
import { POLAR_METHODS, getMethod, PRESETS, getPreset, PRESET_META } from "./settings.js";
import { snapToNearestHighLatCity, distanceToNearestCityKm } from "./highLatCities.js";
import { DEG, DAY_LIMIT_DEG, SAFE_MARGIN_DEG, APPARENT_HORIZON_DEG, PRAYER_COLORS, hexColor } from "./constants.js";

// Preset-aware adhan params. jafari: 16°/4°/14° (built via Other(), since adhan
// 4.4.3 has no Jafari() factory). tehran: 17.7°/4.5°/14°. madhab=Shafi forces
// Asr shadow factor T=1 for both.
function paramsForPreset(presetId) {
  const p = presetId ?? getPreset();
  let params;
  if (p === PRESETS.TEHRAN) {
    params = adhan.CalculationMethod.Tehran();
  } else {
    params = adhan.CalculationMethod.Other();
    params.fajrAngle = 16;
    params.ishaAngle = 14;
    params.maghribAngle = 4;
  }
  params.madhab = adhan.Madhab.Shafi;
  return params;
}

// Panel rows, colors from the shared palette so swatches match the globe.
const PRAYER_META = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"].map((key) => ({
  key,
  label: key[0].toUpperCase() + key.slice(1),
  color: hexColor(PRAYER_COLORS[key]),
}));

// Active Fajr depression angle for the selected preset (16° Leva Qom / 17.7° Tehran).
function activeFajrAngleDeg() {
  return PRESET_META[getPreset()]?.angles?.fajr ?? 16;
}

// Aqrab al-Bilad threshold (sun-relative). Two failure modes for the standard
// calc: Fajr-cap when |φ+δ| > 90−fajrAngle (sun never reaches the Fajr angle),
// polar-night when |φ−δ| > DAY_LIMIT_DEG (sun never crosses the apparent
// horizon). Project to the closer threshold per hemisphere; cap membership uses
// the TRUE threshold while SAFE_MARGIN_DEG pulls only the projection target back
// from adhan's cosH=±1 singularity. The preset-aware Fajr limit here can diverge
// from the shader's fixed 74° (see earthShader.js) by up to ~1.7° under Tehran.
export function aqrabProjection(latDeg, date = new Date(), opts = {}) {
  const { declination } = sunPosition(date);
  const declDeg = (declination * 180) / Math.PI;
  const fajrAngleDeg = Number.isFinite(opts.fajrAngleDeg)
    ? opts.fajrAngleDeg
    : activeFajrAngleDeg();
  const fajrLimitDeg = 90 - fajrAngleDeg;
  const northTrue = Math.min(fajrLimitDeg - declDeg, DAY_LIMIT_DEG + declDeg);
  const southTrue = Math.max(-fajrLimitDeg - declDeg, -DAY_LIMIT_DEG + declDeg);
  if (latDeg > northTrue) return { projectedFromLat: northTrue - SAFE_MARGIN_DEG };
  if (latDeg < southTrue) return { projectedFromLat: southTrue + SAFE_MARGIN_DEG };
  return null;
}

// ---------- internal helpers ----------

// Normalized to UTC noon so the date is unambiguous for adhan (which keys on
// calendar date) across timezones in -11..+11.
function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

function dayKey(d) {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function isValidDate(t) {
  return t instanceof Date && Number.isFinite(t.getTime());
}

// All six markers valid and strictly increasing. Rejects the out-of-order
// "valid" schedules adhan can emit at marginal polar dates (FALLBACK INVARIANT).
function isChronological(fajr, sunrise, dhuhr, asr, maghrib, isha) {
  const ts = [fajr, sunrise, dhuhr, asr, maghrib, isha];
  for (const t of ts) if (!isValidDate(t)) return false;
  for (let i = 1; i < ts.length; i++) if (!(ts[i - 1] < ts[i])) return false;
  return true;
}

function computeAdhanAt(latDeg, lonDeg, date, params = paramsForPreset()) {
  const coords = new adhan.Coordinates(latDeg, lonDeg);
  return new adhan.PrayerTimes(coords, date, params);
}

// adhan times in the shape buildResult expects (pass-through branches).
function buildTimesFromAdhan(t) {
  return {
    fajr: t.fajr, sunrise: t.sunrise, dhuhr: t.dhuhr,
    asr: t.asr, maghrib: t.maghrib, isha: t.isha, raw: t,
  };
}

// Sun's minimum altitude (rad) at φ on the day with declination δ: |φ+δ| − π/2.
function sunMinAltitudeRad(latDeg, date) {
  const { declination } = sunPosition(date);
  return Math.abs(latDeg * DEG + declination) - Math.PI / 2;
}

// Night-start anchor: Ja'fari -4° Maghrib, falling back to sunset if absent.
function anchorMaghrib(times) {
  return isValidDate(times.maghrib) ? times.maghrib : times.sunset;
}

// One-per-session diagnostic when endOfNight falls back from Fajr to sunrise.
let _sunriseFallbackWarned = false;

// Real Fajr or null. adhan's default highLatitudeRule synthesizes a non-NaN
// "Fajr" (a midnight fallback) where the angle is never reached, so isValidDate
// alone can't be trusted — check sunMinAltitudeRad against the angle directly.
function reachableFajr(latDeg, date, adhanFajr, fajrAngleDeg) {
  if (!isValidDate(adhanFajr)) return null;
  const thresholdRad = -fajrAngleDeg * DEG;
  if (sunMinAltitudeRad(latDeg, date) > thresholdRad) return null;
  return adhanFajr;
}

// End of the Shia night for split-night methods: next Fajr (canonical), else
// next sunrise. Returns { time, source }; time may be NaN in deep polar regimes.
// Callers must pre-filter the Fajr anchor via reachableFajr().
function endOfNight({ nextFajr, nextSunrise }, context) {
  if (isValidDate(nextFajr)) {
    return { time: nextFajr, source: "fajr" };
  }
  if (isValidDate(nextSunrise) && !_sunriseFallbackWarned) {
    _sunriseFallbackWarned = true;
    const c = context || {};
    const dateStr = (c.date instanceof Date && !isNaN(c.date))
      ? c.date.toISOString().slice(0, 10) : "n/a";
    const latStr = Number.isFinite(c.latDeg) ? c.latDeg.toFixed(2) : "n/a";
    const lonStr = Number.isFinite(c.lonDeg) ? c.lonDeg.toFixed(2) : "n/a";
    console.warn(
      `[prayer] endOfNight: Fajr unresolvable, using sunrise fallback ` +
      `(lat=${latStr}, lon=${lonStr}, date=${dateStr}, method=${c.method ?? "?"})`
    );
  }
  return { time: nextSunrise, source: "sunrise-fallback" };
}

// Collapse the two night-end sources to one label; sunrise-fallback wins.
function combineSources(...sources) {
  return sources.some((s) => s === "sunrise-fallback")
    ? "sunrise-fallback"
    : "fajr";
}

// ---------- clock-based "Now in" classifier ----------
// Used by the four clock-mode methods (AQRAB_AL_AWQAT, MIDNIGHT, SEVENTH,
// ANGLE_REDUCED), whose band timing no longer matches a sun altitude. Not
// mirrored in the shader (which is always same-longitude), so inside the cap
// these bands disagree with the panel by design — see panel.js's descriptor.
export function classifyByClock(times, now, opts = {}) {
  const t = now.getTime();
  // crossDay (aqrab al-awqāt only): the schedule is from a historical date, so
  // shift it onto today's UTC date. Anchored on dhuhr (not per-time, which would
  // break the structure when adhan placed fajr on the previous UTC day) and the
  // offset propagated to every marker. Default path compares absolute instants.
  const anchorSrc =
    (times.dhuhr && Number.isFinite(times.dhuhr.getTime())) ? times.dhuhr :
    (times.fajr  && Number.isFinite(times.fajr.getTime()))  ? times.fajr  :
    null;
  let project;
  if (opts.crossDay && anchorSrc) {
    const anchorProj = new Date(anchorSrc);
    anchorProj.setUTCFullYear(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const delta = anchorProj.getTime() - anchorSrc.getTime();
    project = (d) => (d && Number.isFinite(d.getTime()) ? d.getTime() + delta : NaN);
  } else {
    project = (d) => (d && Number.isFinite(d.getTime()) ? d.getTime() : NaN);
  }
  const fajr    = project(times.fajr);
  const sunrise = project(times.sunrise);
  const dhuhr   = project(times.dhuhr);
  const asr     = project(times.asr);
  const maghrib = project(times.maghrib);
  const isha    = project(times.isha);

  // Walk forward; each entry's threshold starts that band. NaN thresholds are
  // skipped so the previous band absorbs the gap (extreme-lat NaN markers).
  const BANDS = [
    [fajr,    "fajr"],
    [sunrise, "none"],    // post-sunrise, pre-Dhuhr morning gap
    [dhuhr,   "dhuhr"],
    [asr,     "asr"],
    [maghrib, "maghrib"],
    [isha,    "isha"],
  ];
  let band = "none";
  for (const [threshold, label] of BANDS) {
    if (!Number.isFinite(threshold)) continue;
    if (t < threshold) return band;
    band = label;
  }

  // Past Isha: end its waqt at shar'ī midnight (½ of Maghrib → next Fajr,
  // approximated as today's Fajr + 24h; drift ≤1 min/day is immaterial).
  if (band === "isha" && Number.isFinite(maghrib) && Number.isFinite(fajr)) {
    const midnight = maghrib + ((fajr + 86400000) - maghrib) / 2;
    if (t >= midnight) return "none";
  }
  return band;
}

// ---------- buildResult ----------

// classifyMode: "sun" classifies via sun altitude at the projected/snapped
// reference point (aqrab variants); "clock" walks the synthesized schedule.
function buildResult({ latDeg, lonDeg, date, times, polarMethod, classifyMode }) {
  let currentPrayer;
  if (classifyMode === "clock") {
    const crossDay = polarMethod?.kind === "aqrab_awqat";
    currentPrayer = classifyByClock(times, date, { crossDay });
  } else {
    // The globe shades by the sun's true altitude at the actual point, so "Now
    // in" classifies there too and the two always agree. The nearest-city method
    // is the lone exception: it deliberately reports the chosen city's sky (its
    // whole purpose), which the panel descriptor flags as a divergence.
    const refLat = polarMethod?.kind === "aqrab_city" ? (polarMethod.city?.lat ?? latDeg) : latDeg;
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
    // Back-compat: panel reads aqrab.projectedFromLat for the teal pin/arc.
    aqrab: polarMethod?.kind === "aqrab" ? { projectedFromLat: polarMethod.projectedFromLat } : null,
    polarMethod,
    raw: times.raw || null,
  };
}

// ---------- method 3: aqrab al-awqāt date walk ----------

// Bounded LRU (Map insertion order): the walk iterates up to 90 days, so cache
// to avoid re-walking on every scrubber tick.
const _awqatCache = new Map();
const AWQAT_CACHE_CAP = 256;
const AWQAT_MAX_BACK_DAYS = 90;

// Most recent past date whose schedule is chronologically valid at this
// location (non-NaN isn't enough — see isChronological).
function walkBackForValidDay(latDeg, lonDeg, date) {
  const params = paramsForPreset();
  for (let i = 1; i <= AWQAT_MAX_BACK_DAYS; i++) {
    const trial = addDays(date, -i);
    const t = computeAdhanAt(latDeg, lonDeg, trial, params);
    if (isChronological(t.fajr, t.sunrise, t.dhuhr, t.asr, t.maghrib, t.isha)) return trial;
  }
  return null;
}

// Preset is in the cache key: the same date can be valid under one preset and
// not the other (deeper Fajr angle takes longer to clear inside the cap).
function findRecentValidDate(latDeg, lonDeg, date) {
  const key = `${getPreset()}:${latDeg.toFixed(1)}:${lonDeg.toFixed(1)}:${dayKey(date)}`;
  if (_awqatCache.has(key)) {
    const v = _awqatCache.get(key);
    _awqatCache.delete(key);
    _awqatCache.set(key, v);
    return v;
  }
  const result = walkBackForValidDay(latDeg, lonDeg, date);
  if (_awqatCache.size >= AWQAT_CACHE_CAP) {
    const oldest = _awqatCache.keys().next().value;
    _awqatCache.delete(oldest);
  }
  _awqatCache.set(key, result);
  return result;
}

// One-per-(rounded lat,lon)-per-session warn when same-longitude projection
// lands far from any tabled city — nearest-city mode is closer to the ruling.
const REMOTE_PROJECTION_WARN_KM = 200;
const _remoteWarned = new Set();
function warnIfRemoteProjection(latDeg, lonDeg) {
  const key = `${latDeg.toFixed(0)}:${lonDeg.toFixed(0)}`;
  if (_remoteWarned.has(key)) return;
  _remoteWarned.add(key);
  const km = distanceToNearestCityKm(latDeg, lonDeg);
  if (km > REMOTE_PROJECTION_WARN_KM) {
    console.warn(
      `[aqrab] same-longitude projection to (${latDeg.toFixed(1)}°, ${lonDeg.toFixed(1)}°) is ~${Math.round(km)} km from the nearest populated place in our table. Consider the "aqrab al-bilād — nearest city" method (Settings → high-latitude method).`
    );
  }
}

// Shared setup for the split-night methods: yesterday/today/tomorrow adhan runs
// plus both resolved night-end anchors. Separate endOfNight contexts (distinct
// Fajr-dates) so the diagnostic warn reports the right day; reachableFajr keeps
// adhan's synthesized Fajr out of the anchor. The two methods differ only in how
// they place Fajr/Isha within the night.
function computeNightBoundaries(latDeg, lonDeg, date, params, methodNum) {
  const yesterday = computeAdhanAt(latDeg, lonDeg, addDays(date, -1), params);
  const today     = computeAdhanAt(latDeg, lonDeg, date, params);
  const tomorrow  = computeAdhanAt(latDeg, lonDeg, addDays(date, 1), params);
  const yMaghrib  = anchorMaghrib(yesterday);
  const tMaghrib  = anchorMaghrib(today);
  const fajrAngleDeg = params.fajrAngle ?? 16;
  const todayDate    = addDays(date, 0);
  const tomorrowDate = addDays(date, 1);
  const todayFajr    = reachableFajr(latDeg, todayDate,    today.fajr,    fajrAngleDeg);
  const tomorrowFajr = reachableFajr(latDeg, tomorrowDate, tomorrow.fajr, fajrAngleDeg);
  const lastEnd = endOfNight({ nextFajr: todayFajr,    nextSunrise: today.sunrise },
                             { latDeg, lonDeg, date: todayDate,    method: methodNum });
  const thisEnd = endOfNight({ nextFajr: tomorrowFajr, nextSunrise: tomorrow.sunrise },
                             { latDeg, lonDeg, date: tomorrowDate, method: methodNum });
  return { today, yMaghrib, tMaghrib, lastEnd, thisEnd };
}

// ---------- method 4: niṣf al-layl (middle of night) ----------
// Today's Fajr = midpoint of the preceding night (so it lands pre-dawn, in
// order); today's Isha = midpoint of the upcoming night. Missing anchors → NaN
// (never adhan's defaults), preserving the chronological FALLBACK INVARIANT.
function midnightTimes(latDeg, lonDeg, date, params) {
  const { today, yMaghrib, tMaghrib, lastEnd, thisEnd } =
    computeNightBoundaries(latDeg, lonDeg, date, params, 4);

  const fajr = (isValidDate(yMaghrib) && isValidDate(lastEnd.time))
    ? new Date((yMaghrib.getTime() + lastEnd.time.getTime()) / 2)
    : new Date(NaN);
  const isha = (isValidDate(tMaghrib) && isValidDate(thisEnd.time))
    ? new Date((tMaghrib.getTime() + thisEnd.time.getTime()) / 2)
    : new Date(NaN);

  return buildResult({
    latDeg, lonDeg, date,
    times: {
      fajr,
      sunrise: today.sunrise,
      dhuhr:   today.dhuhr,
      asr:     today.asr,
      maghrib: tMaghrib,
      isha,
      raw: today,
    },
    polarMethod: {
      kind: "midnight",
      endOfNightSource: combineSources(lastEnd.source, thisEnd.source),
    },
    classifyMode: "clock",
  });
}

// ---------- method 5: sub'iyya (one-seventh) ----------
// Isha at 1/7 of the night past Maghrib; Fajr at 1/7 before end-of-night. Same
// night anchors and FALLBACK INVARIANT as midnightTimes; diverges from adhan's
// sunrise-anchored SeventhOfTheNight to match the Ja'farī shar'ī-midnight.
function seventhTimes(latDeg, lonDeg, date, params) {
  const { today, yMaghrib, tMaghrib, lastEnd, thisEnd } =
    computeNightBoundaries(latDeg, lonDeg, date, params, 5);

  let fajr = new Date(NaN);
  let isha = new Date(NaN);
  if (isValidDate(yMaghrib) && isValidDate(lastEnd.time)) {
    const lastNightLen = lastEnd.time.getTime() - yMaghrib.getTime();
    fajr = new Date(lastEnd.time.getTime() - lastNightLen / 7);
  }
  if (isValidDate(tMaghrib) && isValidDate(thisEnd.time)) {
    const thisNightLen = thisEnd.time.getTime() - tMaghrib.getTime();
    isha = new Date(tMaghrib.getTime() + thisNightLen / 7);
  }

  return buildResult({
    latDeg, lonDeg, date,
    times: {
      fajr,
      sunrise: today.sunrise,
      dhuhr:   today.dhuhr,
      asr:     today.asr,
      maghrib: tMaghrib,
      isha,
      raw: today,
    },
    polarMethod: {
      kind: "seventh",
      endOfNightSource: combineSources(lastEnd.source, thisEnd.source),
    },
    classifyMode: "clock",
  });
}

// ---------- method 6: angle-based with seasonal reduction ----------
// Reduce Fajr/Isha toward the horizon (capped at the preset's angles) to
// whatever the sun actually reaches. Falls back to midnightTimes in polar day
// and when the reduced schedule comes out non-chronological.
function angleReducedTimes(latDeg, lonDeg, date, params) {
  const sunMinRad = sunMinAltitudeRad(latDeg, date);
  const sunMinDeg = sunMinRad / DEG;                       // negative
  // Polar day (sun never crosses the apparent horizon): no attainable
  // Fajr/Isha angle, so defer to the midnight rule's polar handling.
  if (sunMinDeg > APPARENT_HORIZON_DEG) {
    return midnightTimes(latDeg, lonDeg, date, params);
  }
  const presetFajrMax = params.fajrAngle ?? 16;
  const presetIshaMax = params.ishaAngle ?? 14;
  const fajrAngleDeg = Math.min(presetFajrMax, Math.max(0, -sunMinDeg));
  const ishaAngleDeg = Math.min(presetIshaMax, Math.max(0, -sunMinDeg));

  // Clone the passed params so any upstream customization survives the reduction.
  const reduced = adhan.CalculationMethod.Other();
  Object.assign(reduced, params);
  reduced.fajrAngle = fajrAngleDeg;
  reduced.ishaAngle = ishaAngleDeg;
  const t = computeAdhanAt(latDeg, lonDeg, date, reduced);

  // Reduced isha can land before asr at deep polar night — fall back to midnight.
  const mTime = anchorMaghrib(t);
  if (!isChronological(t.fajr, t.sunrise, t.dhuhr, t.asr, mTime, t.isha)) {
    return midnightTimes(latDeg, lonDeg, date, params);
  }

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
  const params = paramsForPreset();
  const projection = aqrabProjection(latDeg, date);

  // Outside the cap every method collapses to the standard computation.
  if (!projection) {
    const t = computeAdhanAt(latDeg, lonDeg, date, params);
    return buildResult({
      latDeg, lonDeg, date,
      times: buildTimesFromAdhan(t),
      polarMethod: null,
      classifyMode: "sun",
    });
  }

  switch (method) {
    case POLAR_METHODS.AQRAB_SAME_LON: {
      const t = computeAdhanAt(projection.projectedFromLat, lonDeg, date, params);
      warnIfRemoteProjection(projection.projectedFromLat, lonDeg);
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
        // Shader renders same-longitude (no city table); panel.js flags the
        // discrepancy when the city's lat differs from the projection by >1°.
        polarMethod: {
          kind: "aqrab_city",
          projectedFromLat: projection.projectedFromLat,
          city: city || null,
        },
        classifyMode: "sun",
      });
    }

    case POLAR_METHODS.AQRAB_AL_AWQAT: {
      const validDate = findRecentValidDate(latDeg, lonDeg, date);
      if (!validDate) {
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
      // settings.js validates on load; warn and fall back if a bad value lands here.
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
