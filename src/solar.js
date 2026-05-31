// Solar position math — simplified NOAA-style algorithm (~0.01° declination,
// ~30s equation of time). ECEF axis convention used throughout:
//   +x → (lat 0, lon 0)      +y → north pole      +z → (lat 0, lon −90°)
// i.e. east is −z, so a camera at +x (up=+y) shows eastern longitudes on the
// right, as a globe is normally drawn.

import {
  DEG, degToRad,
  VIS_FAJR_DEG, VIS_MAGHRIB_DEG, VIS_ISHA_DEG, APPARENT_HORIZON_DEG, COS_FLOOR,
} from "./constants.js";

function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function wrap360(deg) {
  return ((deg % 360) + 360) % 360;
}

function wrap180(deg) {
  return ((deg + 540) % 360) - 180;
}

export function sunPosition(date) {
  const jd = julianDay(date);
  const n = jd - 2451545.0;

  const L = wrap360(280.460 + 0.9856474 * n);
  const g = wrap360(357.528 + 0.9856003 * n) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const epsilon = (23.439 - 0.0000004 * n) * DEG;

  const alpha = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const delta = Math.asin(Math.sin(epsilon) * Math.sin(lambda));

  let eqTime = (L * DEG - alpha) * 4 / DEG;
  while (eqTime > 720) eqTime -= 1440;
  while (eqTime < -720) eqTime += 1440;

  const utHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600 +
    date.getUTCMilliseconds() / 3600000;

  const subsolarLonDeg = wrap180(-15 * (utHours - 12 + eqTime / 60));
  const subsolarLon = subsolarLonDeg * DEG;

  return {
    declination: delta,
    subsolarLon,
    sunDir: latLonToVec3(delta, subsolarLon),
  };
}

// (lat, lon) in radians → unit vector in our ECEF frame.
export function latLonToVec3(latRad, lonRad) {
  const cosLat = Math.cos(latRad);
  return [
    cosLat * Math.cos(lonRad),
    Math.sin(latRad),
    -cosLat * Math.sin(lonRad),
  ];
}

// Which Ja'fari prayer window applies at (lat, lon) at `date`. Mirrors the
// shader (earthShader.js) so the panel's "Now in" agrees with the globe; the
// one intentional divergence is the Asr zenithDiff term (see altAsr).
const FAJR = degToRad(VIS_FAJR_DEG);
const MAGHRIB = degToRad(VIS_MAGHRIB_DEG);
const ISHA = degToRad(VIS_ISHA_DEG);
const APPARENT_HORIZON = degToRad(APPARENT_HORIZON_DEG);

export function classifyPrayer(latRad, lonRad, date) {
  const { sunDir, declination, subsolarLon } = sunPosition(date);
  const n = latLonToVec3(latRad, lonRad);
  const sinAlt = sunDir[0] * n[0] + sunDir[1] * n[1] + sunDir[2] * n[2];
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  // Shar'ī midnight (closed form, mirrors the shader): midpoint of the night
  // between MAGHRIB (-4°, the Ja'fari sunset boundary) and next dawn (-16°).
  const TWO_PI = 2 * Math.PI;
  const Hp = ((lonRad - subsolarLon) % TWO_PI + TWO_PI) % TWO_PI;
  const cosLat = Math.cos(latRad);
  const cosDec = Math.cos(declination);
  // COS_FLOOR protects acos at the poles / high-lat where both terms → 0.
  const denom = Math.max(cosLat * cosDec, COS_FLOOR);
  const cosHmag = (Math.sin(MAGHRIB) - Math.sin(latRad) * Math.sin(declination)) / denom;
  const Hmag = Math.acos(Math.max(-1, Math.min(1, cosHmag)));
  const cosHfajr = (Math.sin(FAJR) - Math.sin(latRad) * Math.sin(declination)) / denom;
  const Hfajr = Math.acos(Math.max(-1, Math.min(1, cosHfajr)));
  const Hmid = Math.PI + (Hmag - Hfajr) / 2;
  const pastMidnight = Hp > Hmid;

  // Asr: |diff| here vs the shader's sqrt(diff²+0.0005) smoothing — the ~0.6°
  // difference at lat ≈ decl is below the band-edge width the tests check.
  const zenithDiff = Math.min(Math.abs(latRad - declination), 1.4);
  const altAsr = Math.atan(1 / (1 + Math.tan(zenithDiff)));

  if (alt > APPARENT_HORIZON) {
    if (pastMidnight) return "none"; // post-sunrise, pre-Dhuhr
    return alt >= altAsr ? "dhuhr" : "asr";
  }
  if (pastMidnight) {
    return alt > FAJR ? "fajr" : "none"; // after midnight, only Fajr has a dedicated waqt
  }
  if (alt > MAGHRIB) return "asr";        // sunset → -4°, Asr's time still extending
  if (alt > ISHA) return "maghrib";
  return "isha";
}
