import { HIGH_LAT_CITIES } from "./data/highLatCities.js";

const DEG = Math.PI / 180;
const LON_WINDOW_DEG = 5;

// Angular great-circle distance in degrees, used as the snap metric.
// Cheap enough to scan the full table on each request — at ~80 entries
// the cost is negligible and there's no need for a spatial index yet.
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

// Find the populated city nearest to (projectedFromLat, userLonDeg) that
// lies within ±LON_WINDOW_DEG longitude of the user and on the valid
// side of the polar-cap threshold for the user's hemisphere.
//
// Returns { name, country, lat, lon, pop } or null if nothing in window.
export function snapToNearestHighLatCity(userLatDeg, userLonDeg, projectedFromLat) {
  const isNorthCap = projectedFromLat > 0;
  let best = null;
  let bestDist = Infinity;
  for (const c of HIGH_LAT_CITIES) {
    if (Math.abs(wrapLonDelta(c.lon - userLonDeg)) > LON_WINDOW_DEG) continue;
    // City must be on the valid side of the cap (closer to the equator
    // than the threshold latitude). Without this, snapping in summer
    // could pick a city that's itself inside the cap and would have no
    // valid times.
    if (isNorthCap ? !(c.lat >= 0 && c.lat <= projectedFromLat)
                   : !(c.lat <= 0 && c.lat >= projectedFromLat)) continue;
    const d = greatCircleDeg(projectedFromLat, userLonDeg, c.lat, c.lon);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}
