import * as adhan from "adhan";
import { classifyPrayer, sunPosition } from "./solar.js";
import { POLAR_METHODS, getMethod, PRESETS, getPreset, PRESET_META } from "./settings.js";
import { snapToNearestHighLatCity, distanceToNearestCityKm } from "./highLatCities.js";

const DEG = Math.PI / 180;

// Preset-aware adhan params factory.
//   jafari (Leva Institute, Qum)        : Fajr 16°,   Maghrib 4°,   Isha 14°
//   tehran (Inst. of Geophysics, Tehran): Fajr 17.7°, Maghrib 4.5°, Isha 14°
//
// adhan 4.4.3 ships Tehran() as a built-in but does NOT ship a Jafari()
// factory (see METHODS.md — only 13 methods, none called Jafari). The
// Leva Qom angles are therefore built manually via Other(), which is
// what the previous jafariParams() did.
//
// Asr shadow factor T = 1 (Ja'farī/Shāfi'ī consensus, NOT Hanafi T = 2)
// is enforced by setting madhab = Shafi for both presets. (Tehran()
// already defaults to madhab=Shafi but we set it explicitly so the
// intent is local to this function and survives any future adhan
// default change.)
//
// Note: adhan 4.4.3 has no `midnightMethod` field — shar'ī midnight is
// computed independently by classifyPrayer/classifyByClock per the
// Ja'farī rule (½(Maghrib + nextFajr)), so switching presets does not
// risk a midnight-semantics flip downstream.
function paramsForPreset(presetId) {
  const p = presetId ?? getPreset();
  let params;
  if (p === PRESETS.TEHRAN) {
    params = adhan.CalculationMethod.Tehran();
  } else {
    // Leva Qom — build from Other() with the canonical Ja'farī angles.
    params = adhan.CalculationMethod.Other();
    params.fajrAngle = 16;
    params.ishaAngle = 14;
    params.maghribAngle = 4;
  }
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
// declination δ. See earthMaterial.js for the full derivation; in
// short:
//   • Fajr fails (sun never reaches -16°) when |φ + δ| > 74° = 90° - 16°.
//     Adhan uses -16° geometric (no refraction), so 74° matches exactly.
//   • Polar night (sun never crosses apparent horizon) when |φ - δ| >
//     90.833° = 90° + 50'. The 50' offset matches Adhan's sunrise/
//     sunset convention (refraction + solar semi-diameter). Without
//     it, the cap kicks in ~14 days/year earlier at φ ≈ 68°N than
//     Adhan actually returns NaN.
// Project to the closer of the two thresholds per hemisphere. The
// fragment shader still uses FAJR_LIMIT_DEG = 74 (the Leva Qom default)
// regardless of preset — see earthMaterial.js's docblock; Stage 3.2
// will make the shader preset-aware. The computational path here, by
// contrast, derives the Fajr limit from the active preset's fajrAngle
// (16° for Leva Qom → 74° limit; 17.7° for Tehran → 72.3° limit), so
// the panel's "in cap" decision tracks the user's selected angle even
// while the shader stays at the Leva Qom cap. The two diverge by up
// to ~1.7° of latitude near the seasonal cap edge under Tehran.
const DAY_LIMIT_DEG = 90 + 50 / 60;  // 90.8333…

// Active Fajr angle, in degrees, for the selected preset. PRESET_META
// is a frozen lookup table in settings.js; falling back to 16° on a
// non-preset code path keeps existing behavior intact.
function activeFajrAngleDeg() {
  return PRESET_META[getPreset()]?.angles?.fajr ?? 16;
}
// Adhan's correctedHourAngle computes
//   H = acos((sin(α) - sin(φ)·sin(δ)) / (cos(φ)·cos(δ)))
// which approaches acos(±1) at the cap edge and goes NaN under
// double-precision rounding within ~0.01° of that singularity. A
// 0.05° pullback gives ~5× safety while shifting the projected
// schedule by only ~5.5 km of arc — visually indistinguishable on
// the globe and well below the precision of the underlying
// adhan/NOAA sun position. Symmetric form rescues both polar-night
// (cosHsunrise → 1) and Fajr-cap (cosHfajr → -1) sides — exactly
// the regression bf85d01's refraction shift exposed: the previous
// 0.4° buffer was masking the singularity, and adding +0.83° for
// the apparent-horizon correction consumed it.
const SAFE_MARGIN_DEG = 0.05;

export function aqrabProjection(latDeg, date = new Date(), opts = {}) {
  const { declination } = sunPosition(date);
  const declDeg = (declination * 180) / Math.PI;
  // Preset-aware Fajr limit. Tehran (17.7°) → 72.3°; Leva Qom (16°)
  // → 74°. Callers that want to force a specific limit can pass
  // opts.fajrAngleDeg; otherwise the active preset is used. main.js's
  // pinSourceForMethod calls without opts so the pin tracks the
  // user's currently-selected preset.
  const fajrAngleDeg = Number.isFinite(opts.fajrAngleDeg)
    ? opts.fajrAngleDeg
    : activeFajrAngleDeg();
  const fajrLimitDeg = 90 - fajrAngleDeg;
  // Cap membership uses the TRUE threshold — a user at the boundary
  // latitude has computable times and should not be forced into the
  // projection. SAFE_MARGIN_DEG applies only to the projection target
  // so Adhan's correctedHourAngle has numerical headroom from the
  // cosH = ±1 singularity when we DO project.
  const northTrue = Math.min(fajrLimitDeg - declDeg, DAY_LIMIT_DEG + declDeg);
  const southTrue = Math.max(-fajrLimitDeg - declDeg, -DAY_LIMIT_DEG + declDeg);
  if (latDeg > northTrue) return { projectedFromLat: northTrue - SAFE_MARGIN_DEG };
  if (latDeg < southTrue) return { projectedFromLat: southTrue + SAFE_MARGIN_DEG };
  return null;
}

// ---------- internal helpers ----------

function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  // Normalize to UTC noon as a defensive measure against day-boundary
  // surprises when this Date is passed to adhan (which keys on
  // calendar date) and when derivedFromDate is displayed. UTC noon is
  // unambiguous for timezones in -11..+11; offsets beyond that
  // (Kiritimati at UTC+14, Baker Island at UTC-12) can still roll
  // into adjacent local days. Panel display defends separately by
  // formatting derivedFromDate in UTC explicitly (see panel.js's
  // fmtUtcShortDate) so the historical-date label is the canonical
  // calendar day regardless of viewer locale.
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

function dayKey(d) {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function isValidDate(t) {
  return t instanceof Date && Number.isFinite(t.getTime());
}

function computeAdhanAt(latDeg, lonDeg, date, params = paramsForPreset()) {
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

// One console.warn per browser session when endOfNight() falls back
// from Fajr to sunrise. Diagnostic canary for catching the fallback
// firing more often than expected near the 74° Fajr-cap; can be
// removed before Stage 3 if noisy.
let _sunriseFallbackWarned = false;

// Fajr at the preset's depression angle (16° Leva Qom / 17.7° Tehran)
// is physically reachable at (latDeg, date) iff the sun's minimum
// altitude that day is at or below that angle (i.e., |φ + δ| ≤ 90° −
// fajrAngleDeg).
//
// ADHAN'S DEFAULTS WILL LIE TO YOU: adhan's CalculationParameters
// default highLatitudeRule = middleofthenight, which synthesizes a
// "Fajr" value (actually a midnight-rule fallback) at latitudes where
// the fajr angle is never astronomically reached. So isValidDate(t.
// fajr) alone is not a usable signal for "did the sun reach this
// depression today" — it conflates real Fajr with synthesized
// midnight. Using the synthesized value as the anchor for endOfNight()
// would silently double-apply the midnight rule.
//
// This is the canonical pattern anywhere in this codebase that needs
// "did the sun actually reach depression θ on date D at latitude φ":
// check sunMinAltitudeRad(φ, D) ≤ θ directly. Do NOT trust adhan's
// non-NaN return value.
//
// fajrAngleDeg must be passed by callers (paramsForPreset's
// CalculationParameters object exposes .fajrAngle). Defaulting here
// would couple this helper to the global preset state; callers
// already have params in hand.
function reachableFajr(latDeg, date, adhanFajr, fajrAngleDeg) {
  if (!isValidDate(adhanFajr)) return null;
  const thresholdRad = -fajrAngleDeg * DEG;
  if (sunMinAltitudeRad(latDeg, date) > thresholdRad) return null;
  return adhanFajr;
}

// Resolve the end of the Shia night for split-night methods (4, 5, 6).
// Canonical Ja'farī: end of night = next Fajr (the midpoint of
// Maghrib → next Fajr is shar'ī midnight; per Sistani's Dialogue on
// Prayer and leader.ir/en/content/24743). Fallback: next sunrise,
// used only when nextFajr is unresolvable — typically when the user
// is inside the Fajr cap (|φ+δ| > 74°). Callers should pre-filter
// the Fajr anchor via reachableFajr() so adhan's middleofthenight
// synthesis is not silently treated as a real Fajr.
//
// Returns { time, source } where source ∈ {'fajr', 'sunrise-fallback'}.
// time may itself be NaN in the deepest-polar regime (neither anchor
// available) — callers test isValidDate(time) and emit NaN times.
//
// `context` carries lat/lon/date/method for the session-deduped warn.
function endOfNight({ nextFajr, nextSunrise }, context) {
  if (isValidDate(nextFajr)) {
    return { time: nextFajr, source: "fajr" };
  }
  // Skip the warn if sunrise is also missing — there's no "fallback"
  // happening in any meaningful sense, just a NaN propagating
  // downstream. The source label stays 'sunrise-fallback' to make the
  // algorithmic intent clear.
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

// Merge two endOfNight source values into a single diagnostic for the
// polarMethod field. midnightTimes/seventhTimes resolve two endpoints
// (last night and this night); we want a single source label for the
// panel's note. If either fell back to sunrise, the surface label is
// 'sunrise-fallback' — that's the more conservative reading.
function combineSources(...sources) {
  return sources.some((s) => s === "sunrise-fallback")
    ? "sunrise-fallback"
    : "fajr";
}

// ---------- clock-based "Now in" classifier ----------
// Used for the side-panel "Now in" indicator under the four
// clock-mode methods: AQRAB_AL_AWQAT, MIDNIGHT, SEVENTH, and
// ANGLE_REDUCED. For these the band timing no longer matches
// "sun is at angle X below horizon" — bands come from either a
// different day (aqrab al-awqāt) or from a synthesized
// midnight/seventh/angle-reduced split that doesn't correspond
// to any sun altitude at this location. The sun-altitude
// classifier in solar.js would produce e.g. "Dhuhr" during polar
// night under aqrab al-awqāt, which is the kind of bug that
// erodes user trust. AQRAB_SAME_LON and AQRAB_NEAREST_CITY
// continue to use the sun-altitude classifier at the projected /
// snapped reference point.
//
// NOTE: this is intentionally NOT mirrored in the fragment shader.
// The visual cap always renders via same-longitude projection
// regardless of method (see the docblock in earthMaterial.js). For
// the four clock-mode methods the bands inside the cap will
// therefore disagree with the side panel — the panel's descriptor
// line in panel.js surfaces the divergence.
export function classifyByClock(times, now, opts = {}) {
  const t = now.getTime();
  // opts.crossDay = true: project each prayer time onto the same UTC
  // calendar day as `now` before comparing. Required for aqrab
  // al-awqāt, where the schedule is from a historical date and direct
  // absolute-instant comparison always falls through to "isha".
  // opts.crossDay = false (default): compare absolute instants. This
  // is correct for same-day schedules (methods 1, 2, 4, 5, 6) and
  // critically must NOT be reprojected — Adhan can place a prayer
  // time on the previous UTC calendar day (e.g., Tromsø summer fajr
  // ≈ 22:46 UTC the day before the panel date, due to longitude
  // offset placing solar antimeridian before UTC midnight). Day-
  // projecting that would produce a phantom-late fajr.
  // crossDay projection: don't setUTCFullYear per-time. Adhan can
  // legitimately place fajr on the day BEFORE the schedule's
  // calendar date (longitude offset puts solar antimeridian before
  // UTC midnight at high lat). Per-time projection collapses that
  // structure: fajr@22:00 prev-UTC-day projects to today 22:00,
  // sunrise@02:00 same-UTC-day projects to today 02:00 — now
  // fajr > sunrise after projection, and the band walker treats
  // every daylight hour as pre-dawn.
  //
  // Instead, anchor on dhuhr (solar transit; near-always-valid and
  // safely mid-day) and propagate the offset to every other time.
  // The schedule's internal structure is preserved exactly,
  // independent of which UTC day each threshold originally landed
  // on. Falls back to fajr as anchor if dhuhr is missing; falls
  // back to raw absolute compare if neither is finite.
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

  // Walk the day forward. Each entry is the threshold at which a band
  // starts; the previous band extends until t reaches that threshold.
  // NaN thresholds are skipped — the previous band absorbs the gap.
  // E.g., if fajr is NaN, "none" extends until sunrise (no "fajr"
  // band today); if sunrise is NaN, "fajr" extends until dhuhr (no
  // "none" morning gap). This matches the behavior the comment used
  // to claim but the old hard-coded comparisons didn't actually
  // implement — at extreme latitudes adhan can return NaN for
  // sunrise or maghrib and the previous form mislabeled the band.
  const BANDS = [
    [fajr,    "fajr"],
    [sunrise, "none"],    // post-sunrise, pre-Dhuhr morning gap
    [dhuhr,   "dhuhr"],
    [asr,     "asr"],
    [maghrib, "maghrib"],
    [isha,    "isha"],
  ];
  let band = "none";  // default before any threshold has fired
  for (const [threshold, label] of BANDS) {
    if (!Number.isFinite(threshold)) continue;
    if (t < threshold) return band;
    band = label;
  }

  // Past Isha's listed time. Walk to shar'ī midnight (canonical
  // Ja'fari: midpoint of Maghrib → next-day Fajr). The times object
  // only carries today's data, so we approximate next-day Fajr as
  // today's Fajr + 24h. The true value drifts by ≤1 min/day from
  // equation-of-time and declination changes — well below the
  // 5-minute resolution at which any band edge matters here.
  if (band === "isha" && Number.isFinite(maghrib) && Number.isFinite(fajr)) {
    const midnight = maghrib + ((fajr + 86400000) - maghrib) / 2;
    if (t >= midnight) return "none";  // Isha's waqt has ended, pre-next-Fajr
  }
  return band;
}

// ---------- buildResult ----------

function buildResult({ latDeg, lonDeg, date, times, polarMethod, classifyMode }) {
  // classifyMode: "sun" for AQRAB_SAME_LON / AQRAB_NEAREST_CITY (sun at
  // projected lat/lon is the intended reference); "clock" for everything
  // else.
  let currentPrayer;
  if (classifyMode === "clock") {
    // For aqrab al-awqāt the times are from a historical date, so
    // compare time-of-day rather than absolute instant. All other
    // clock-mode methods (midnight, seventh, angle-reduced) compute
    // for today and use direct comparison. Use the passed-in `date`
    // (not new Date()) so this matches sun-mode's reference instant
    // and stays consistent with the scrubber's notion of "now".
    const crossDay = polarMethod?.kind === "aqrab_awqat";
    currentPrayer = classifyByClock(times, date, { crossDay });
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
//
// Bounded LRU via Map's insertion-order property: at cap, evict the
// oldest entry on every new insert. ~2 KB at cap (key strings + Date
// references), bounded across long sessions that span many days and
// many locations.
const _awqatCache = new Map();
const AWQAT_CACHE_CAP = 256;
const AWQAT_MAX_BACK_DAYS = 90;

function walkBackForValidDay(latDeg, lonDeg, date) {
  // FALLBACK INVARIANT (see midnightTimes; enforced by
  // assertChronological in tests/classifierAgreement.test.js). Here
  // it means "non-NaN isn't enough" — adhan can return six valid
  // Dates that are internally out of order at marginal polar dates,
  // and accepting those as success silently corrupts the panel's
  // "Now in" indicator.
  const params = paramsForPreset();
  for (let i = 1; i <= AWQAT_MAX_BACK_DAYS; i++) {
    const trial = addDays(date, -i);
    const t = computeAdhanAt(latDeg, lonDeg, trial, params);
    if (!(isValidDate(t.fajr) && isValidDate(t.sunrise) && isValidDate(t.dhuhr)
        && isValidDate(t.asr) && isValidDate(t.maghrib) && isValidDate(t.isha))) {
      continue;
    }
    // Non-NaN isn't enough: at marginal polar dates (e.g., Oct 26 at
    // 78°N, where the sun barely crosses the apparent horizon) adhan
    // can return six "valid" Dates that are internally out of order
    // (asr before dhuhr, or isha before asr) due to its
    // HighLatitudeRule defaults firing for some thresholds and not
    // others. Require strict chronological ordering so the historical
    // schedule we hand to the panel walker is actually coherent.
    const a = t.fajr.getTime(), b = t.sunrise.getTime(), c = t.dhuhr.getTime();
    const d = t.asr.getTime(),  e = t.maghrib.getTime(), f = t.isha.getTime();
    if (a < b && b < c && c < d && d < e && e < f) return trial;
  }
  return null;
}

function findRecentValidDate(latDeg, lonDeg, date) {
  // Preset is part of the cache key because walkBackForValidDay's
  // schedule depends on the Fajr/Maghrib/Isha angles (16°/4°/14° vs
  // 17.7°/4.5°/14°): a date that yields a chronologically-valid
  // schedule under Leva Qom can fail under Tehran (or vice versa)
  // because the deeper Fajr angle takes longer to clear inside the
  // Fajr cap. Keying only on lat/lon/day would return stale results
  // after a preset switch and silently ignore the user's choice in
  // high-latitude aqrab_al_awqat mode.
  const key = `${getPreset()}:${latDeg.toFixed(1)}:${lonDeg.toFixed(1)}:${dayKey(date)}`;
  if (_awqatCache.has(key)) {
    // Refresh insertion order for LRU semantics.
    const v = _awqatCache.get(key);
    _awqatCache.delete(key);
    _awqatCache.set(key, v);
    return v;
  }
  const result = walkBackForValidDay(latDeg, lonDeg, date);
  if (_awqatCache.size >= AWQAT_CACHE_CAP) {
    // Map iterates in insertion order; first key is the oldest.
    const oldest = _awqatCache.keys().next().value;
    _awqatCache.delete(oldest);
  }
  _awqatCache.set(key, result);
  return result;
}

// One console.warn per rounded (lat, lon) per session, when same-
// longitude projection lands deep in an uninhabited region. The
// fuqaha generally mean *balad* (populated locality), so a projection
// into open ocean or interior Antarctica is jurisprudentially weak —
// "nearest city" mode is closer to the intended ruling there.
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

// ---------- method 4: niṣf al-layl (middle of night) ----------
//
// We anchor "night start" at Maghrib's -4° boundary (or sunset if -4°
// doesn't occur) and "night end" at the canonical Ja'farī endpoint:
// the next Fajr at -16°. This matches the shar'ī midnight definition
// used throughout the rest of this codebase (½(Maghrib + nextFajr))
// — Sistani's Dialogue on Prayer; leader.ir /en/content/24743.
//
// When Fajr is unresolvable at the user's location/date (deep inside
// the Fajr cap), endOfNight() falls back to the next sunrise — this
// is the int'l-convention HighLatitudeRule.MiddleOfTheNight behavior
// and preserves predictability where Fajr doesn't enter at all. The
// polarMethod's endOfNightSource field surfaces the fallback to the
// panel so the user can see when the sunrise anchor is in play.
//
// Today's Fajr is the midpoint of the PRECEDING night (yesterday's
// Maghrib → today's end-of-night) — so it lands in the early hours
// and stays in chronological order with sunrise/dhuhr/asr that
// follow. Today's Isha is the midpoint of the UPCOMING night
// (today's Maghrib → tomorrow's end-of-night) — late evening, after
// maghrib. Mirrors seventhTimes's split-night layout; without this,
// both fajr and isha would land in the same UPCOMING-night midpoint
// and classifyByClock's forward walk (fajr → sunrise → … → isha)
// would mislabel the entire day.
function midnightTimes(latDeg, lonDeg, date, params) {
  const yesterday = computeAdhanAt(latDeg, lonDeg, addDays(date, -1), params);
  const today     = computeAdhanAt(latDeg, lonDeg, date, params);
  const tomorrow  = computeAdhanAt(latDeg, lonDeg, addDays(date, 1), params);
  const yMaghrib  = anchorMaghrib(yesterday);
  const tMaghrib  = anchorMaghrib(today);
  const tSunrise  = today.sunrise;
  const nextRise  = tomorrow.sunrise;

  // Last night ends at today's Fajr (canonical); this night ends at
  // tomorrow's Fajr. endOfNight() falls back to sunrise when Fajr is
  // unresolvable and warns once per session. reachableFajr() filters
  // out adhan's middleofthenight synthesis so we anchor only on
  // physically attainable Fajr times — otherwise the midnight rule
  // would silently nest inside itself when the user is past the cap.
  //
  // Two separate contexts: each endOfNight() call is about a
  // different Fajr-date (today's for last-night's end, tomorrow's
  // for this-night's end). The diagnostic warn includes the date,
  // so passing a single shared ctx would misreport which day's
  // Fajr was unresolvable when the warn fires on the tomorrow anchor.
  //
  // Normalize "today" the same way addDays() normalizes "tomorrow"
  // (UTC noon) before calling reachableFajr() — sunMinAltitudeRad
  // is instant-dependent through the declination, and the scrubber
  // passes arbitrary times-of-day to getTimesForLocation. Without
  // this, the reachability decision for today could flip across UTC
  // day boundaries while tomorrow's stays put.
  // params.fajrAngle drives reachableFajr(), so Tehran (17.7°) and
  // Leva Qom (16°) each check against their own depression. Without
  // this Tehran would still use a 16° reachability threshold and
  // could treat a synthesized middle-of-night Fajr as "reachable"
  // in the 72.3°-74° band.
  const fajrAngleDeg = params.fajrAngle ?? 16;
  const todayDate    = addDays(date, 0);
  const tomorrowDate = addDays(date, 1);
  const todayFajr    = reachableFajr(latDeg, todayDate,    today.fajr,    fajrAngleDeg);
  const tomorrowFajr = reachableFajr(latDeg, tomorrowDate, tomorrow.fajr, fajrAngleDeg);
  const ctxLast = { latDeg, lonDeg, date: todayDate,    method: 4 };
  const ctxThis = { latDeg, lonDeg, date: tomorrowDate, method: 4 };
  const lastEnd = endOfNight({ nextFajr: todayFajr,    nextSunrise: tSunrise }, ctxLast);
  const thisEnd = endOfNight({ nextFajr: tomorrowFajr, nextSunrise: nextRise }, ctxThis);

  // FALLBACK INVARIANT: any path that synthesizes prayer times must
  // return strictly-chronological values (fajr < sunrise < dhuhr <
  // asr < maghrib < isha) or NaN for missing markers. Never inherit
  // upstream defaults that may violate this — adhan.js's internal
  // MiddleOfTheNight default fires for some thresholds and not
  // others at deep polar latitudes, producing six "valid" times in
  // wrong order. Enforced by assertChronological in
  // tests/classifierAgreement.test.js, which runs against every
  // (method, fixture) cell.
  //
  // When the night anchors are missing (deep polar night/day where
  // neither Maghrib nor Fajr/sunrise occur), return NaN rather than
  // falling back to today.fajr/today.isha — those values come from
  // adhan's default and don't share semantics with this method.
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
      sunrise: tSunrise,
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
//
// Spec: Isha at 1/7 of the night past Maghrib; Fajr at 1/7 before
// end-of-night. "The night" for today's Fajr is last night
// (yesterday's Maghrib → today's end-of-night); for today's Isha it
// is tonight (today's Maghrib → tomorrow's end-of-night).
//
// "End of night" follows the canonical Ja'farī rule (next Fajr at
// -16°), with sunrise fallback only when Fajr is unresolvable —
// same endOfNight() helper as midnightTimes. The adhan.js
// HighLatitudeRule.SeventhOfTheNight reference uses sunrise; we
// diverge to Fajr to match the Ja'farī shar'ī-midnight definition
// used elsewhere in this app.
function seventhTimes(latDeg, lonDeg, date, params) {
  const yesterday = computeAdhanAt(latDeg, lonDeg, addDays(date, -1), params);
  const today     = computeAdhanAt(latDeg, lonDeg, date, params);
  const tomorrow  = computeAdhanAt(latDeg, lonDeg, addDays(date, 1), params);

  const yMaghrib = anchorMaghrib(yesterday);
  const tMaghrib = anchorMaghrib(today);
  const tSunrise = today.sunrise;
  const nextRise = tomorrow.sunrise;

  // Separate contexts so the diagnostic warn reports the correct
  // Fajr-date per endOfNight call AND normalize today's date to UTC
  // noon to match tomorrow's normalization (see midnightTimes for the
  // same rationale).
  // Preset-aware reachability check (see midnightTimes for the
  // rationale).
  const fajrAngleDeg = params.fajrAngle ?? 16;
  const todayDate    = addDays(date, 0);
  const tomorrowDate = addDays(date, 1);
  const todayFajr    = reachableFajr(latDeg, todayDate,    today.fajr,    fajrAngleDeg);
  const tomorrowFajr = reachableFajr(latDeg, tomorrowDate, tomorrow.fajr, fajrAngleDeg);
  const ctxLast = { latDeg, lonDeg, date: todayDate,    method: 5 };
  const ctxThis = { latDeg, lonDeg, date: tomorrowDate, method: 5 };
  const lastEnd = endOfNight({ nextFajr: todayFajr,    nextSunrise: tSunrise }, ctxLast);
  const thisEnd = endOfNight({ nextFajr: tomorrowFajr, nextSunrise: nextRise }, ctxThis);

  // FALLBACK INVARIANT (see midnightTimes; enforced by
  // assertChronological in tests/classifierAgreement.test.js).
  // Missing anchors → NaN, never adhan's internal MiddleOfTheNight
  // default. Avoids out-of-order times at deep polar latitudes.
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
      sunrise: tSunrise,
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
  // Polar-day fallback: when the sun never crosses the apparent
  // horizon (sun's minimum altitude is above −0.833°), there's no
  // physically attainable Fajr/Isha threshold. Clamping the angle
  // to 0° would tell adhan to find sun-at-horizon, which never
  // happens here either, so it'd return NaN. Fall back to the
  // midnight rule, which has its own polar-summer handling.
  const APPARENT_HORIZON_DEG = -50 / 60;
  if (sunMinDeg > APPARENT_HORIZON_DEG) {
    // CROSS-METHOD DEPENDENCY: a bug in midnightTimes silently
    // corrupts this method's polar-day output. The ordering
    // invariant in tests/classifierAgreement.test.js covers
    // midnightTimes directly, which catches both sites.
    return midnightTimes(latDeg, lonDeg, date, params);
  }
  // Cap the reduction at the preset's configured angles (16°/14° Leva
  // Qom, 17.7°/14° Tehran), not hard-coded constants. Otherwise Tehran
  // would silently degrade its Fajr threshold to 16° whenever
  // conditions allow deeper twilight — producing a schedule that
  // doesn't match the user's selected preset.
  const presetFajrMax = params.fajrAngle ?? 16;
  const presetIshaMax = params.ishaAngle ?? 14;
  const fajrAngleDeg = Math.min(presetFajrMax, Math.max(0, -sunMinDeg));
  const ishaAngleDeg = Math.min(presetIshaMax, Math.max(0, -sunMinDeg));

  // Derive from the passed params (not a fresh paramsForPreset()) so any
  // upstream customization — e.g., a future caller tweaking madhab or
  // adjustments — survives the reduction. Sibling helpers
  // (midnightTimes, seventhTimes) already use `params` directly;
  // matching the pattern here.
  const reduced = adhan.CalculationMethod.Other();
  Object.assign(reduced, params);
  reduced.fajrAngle = fajrAngleDeg;
  reduced.ishaAngle = ishaAngleDeg;
  const t = computeAdhanAt(latDeg, lonDeg, date, reduced);

  // FALLBACK INVARIANT (see midnightTimes; enforced by
  // assertChronological in tests/classifierAgreement.test.js). At
  // deep polar night the sun's max altitude can be more negative
  // than the asr threshold (~0°), so adhan still returns a clamped
  // value for asr — but the resulting isha (at the reduced angle)
  // can land BEFORE asr, violating chronological order. Detect that
  // and fall back to midnight, which returns NaN for fajr/isha when
  // anchors are missing and stays cleanly ordered.
  const mTime = anchorMaghrib(t);
  const ordered = isValidDate(t.fajr) && isValidDate(t.sunrise) && isValidDate(t.dhuhr)
    && isValidDate(t.asr) && isValidDate(mTime) && isValidDate(t.isha)
    && t.fajr < t.sunrise && t.sunrise < t.dhuhr && t.dhuhr < t.asr
    && t.asr < mTime && mTime < t.isha;
  if (!ordered) {
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
        // Shader can't carry a city table, so it renders identically
        // to AQRAB_SAME_LON (same-longitude projection). The panel
        // descriptor in panel.js surfaces the discrepancy via a
        // secondary line when the city's lat differs from the
        // projection target by > 1°.
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
        // Per spec: cap walk at 90 days; fall through to midnight.
        // CROSS-METHOD DEPENDENCY: a bug in midnightTimes silently
        // corrupts this method's deep-polar fallback output.
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
