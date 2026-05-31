import { HIGH_LAT_CITIES } from "./data/highLatCities.js";
import { DEG, KM_PER_DEGREE_GC } from "./constants.js";

const LON_WINDOW_DEG = 5;

// Great-circle distance in degrees (the snap metric). The ~80-entry table is
// scanned linearly per request — negligible, no spatial index needed.
function greatCircleDeg(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * DEG, φ2 = lat2 * DEG;
  const dλ = (lon2 - lon1) * DEG;
  const cosD = Math.sin(φ1) * Math.sin(φ2)
             + Math.cos(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return Math.acos(Math.max(-1, Math.min(1, cosD))) / DEG;
}

function wrapLonDelta(d) {
  return ((d + 540) % 360) - 180;
}

// Km to the nearest tabled city (Infinity if empty). Drives prayer.js's warn
// when a same-longitude projection lands far from any *balad*. With the curated
// ~80-city subset, sparsely-tabled regions over-fire the warn — log noise only.
export function distanceToNearestCityKm(latDeg, lonDeg) {
  let best = Infinity;
  for (const c of HIGH_LAT_CITIES) {
    const d = greatCircleDeg(latDeg, lonDeg, c.lat, c.lon);
    if (d < best) best = d;
  }
  return best * KM_PER_DEGREE_GC;
}

// Nearest city to (projectedFromLat, userLonDeg) within ±LON_WINDOW_DEG and on
// the valid side of the cap → { name, country, lat, lon, pop }, or null.
export function snapToNearestHighLatCity(userLatDeg, userLonDeg, projectedFromLat) {
  const isNorthCap = projectedFromLat > 0;
  let best = null;
  let bestDist = Infinity;
  for (const c of HIGH_LAT_CITIES) {
    if (Math.abs(wrapLonDelta(c.lon - userLonDeg)) > LON_WINDOW_DEG) continue;
    // Must be equatorward of the cap edge, else the city itself has no valid times.
    if (isNorthCap ? !(c.lat >= 0 && c.lat <= projectedFromLat)
                   : !(c.lat <= 0 && c.lat >= projectedFromLat)) continue;
    const d = greatCircleDeg(projectedFromLat, userLonDeg, c.lat, c.lon);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}
