// Solar position math — simplified NOAA-style algorithm.
// Accurate to within ~0.01° for declination and ~30s for the equation of time,
// which is far more than enough to color a globe.
//
// ECEF axis convention used throughout:
//   +x  -> (lat=0, lon=0)        Greenwich, equator
//   +y  -> north pole
//   +z  -> (lat=0, lon=-90°)     90° West (i.e. east is the -z direction)
//
// This convention mirrors the more common "+z = 90°E" so that, when three.js
// places the camera at +x looking at the origin with up=+y, eastern longitudes
// appear on the right of the screen — matching how a globe is normally drawn.

const DEG = Math.PI / 180;

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
    subsolarLat: delta,
    subsolarLon,
    equationOfTime: eqTime,
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

// Unit vector → (lat, lon) in radians.
export function vec3ToLatLon(v) {
  const lat = Math.asin(Math.max(-1, Math.min(1, v[1])));
  const lon = Math.atan2(-v[2], v[0]);
  return { lat, lon };
}

// Classify which Shia (Ja'fari) prayer window applies at (lat, lon) at `date`.
// This mirrors the shader logic exactly so the side panel's "Now in"
// indicator and the globe's coloring always agree, even at high latitudes
// where Adhan's PrayerTimes can produce a counter-intuitive currentPrayer.
const FAJR = -16 * DEG;
const MAGHRIB = -4 * DEG;
const ISHA = -14 * DEG;

export function classifyPrayer(latRad, lonRad, date) {
  const { sunDir, declination, subsolarLon } = sunPosition(date);
  const n = latLonToVec3(latRad, lonRad);
  const sinAlt = sunDir[0] * n[0] + sunDir[1] * n[1] + sunDir[2] * n[2];
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  // Closed-form shar'ī midnight check — mirrors the shader so the panel's
  // "Now in" indicator stays in lockstep with the globe coloring.
  // Hp = pixel hour angle in [0, 2π); Hmid = midpoint of the night between
  // sunset (alt = 0°) and next dawn (alt = FAJR = -16°).
  const TWO_PI = 2 * Math.PI;
  const Hp = ((lonRad - subsolarLon) % TWO_PI + TWO_PI) % TWO_PI;
  const cosLat = Math.cos(latRad);
  const cosDec = Math.cos(declination);
  const cosHset = -Math.tan(latRad) * Math.tan(declination);
  const Hset = Math.acos(Math.max(-1, Math.min(1, cosHset)));
  const cosHfajr = (Math.sin(FAJR) - Math.sin(latRad) * Math.sin(declination)) /
                   Math.max(cosLat * cosDec, 1e-4);
  const Hfajr = Math.acos(Math.max(-1, Math.min(1, cosHfajr)));
  const Hmid = Math.PI + (Hset - Hfajr) / 2;
  const pastMidnight = Hp > Hmid;

  const zenithDiff = Math.min(Math.abs(latRad - declination), 1.4);
  const altAsr = Math.atan(1 / (1 + Math.tan(zenithDiff)));

  if (alt > 0) {
    if (pastMidnight) return "none"; // post-sunrise, pre-Dhuhr
    return alt >= altAsr ? "dhuhr" : "asr";
  }
  if (pastMidnight) {
    // After shar'ī midnight Isha's waqt has ended. Until the sun reaches
    // the Fajr angle there is no prayer in its dedicated time.
    return alt > FAJR ? "fajr" : "none";
  }
  if (alt > MAGHRIB) return "asr";        // sunset → -4°, Asr's time still extending
  if (alt > ISHA) return "maghrib";
  return "isha";
}
