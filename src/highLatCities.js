import { HIGH_LAT_CITIES } from "./data/highLatCities.js";

const DEG = Math.PI / 180;
const LON_WINDOW_DEG = 5;
const KM_PER_DEGREE_GC = 111.32;  // mean great-circle km per degree of arc

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

// Great-circle distance in km from (latDeg, lonDeg) to the nearest entry
// in HIGH_LAT_CITIES. Returns Infinity if the table is empty. Used by
// prayer.js to warn when the same-longitude projection falls deep in
// open ocean or uninhabited terrain — the fuqaha generally mean *balad*
// (populated locality), so a same-longitude projection landing nowhere
// near a settled place is jurisprudentially weak.
//
// NOTE: the curated city table is currently ~80 well-known cities. The
// 200 km warning threshold is calibrated for the eventual full
// Natural Earth populated_places dataset; with the curated subset,
// sparsely-tabled regions (central Siberia, interior Canada, southern
// hemisphere) will trigger false positives. Doesn't matter for a
// developer-facing console.warn but worth knowing when reading logs.
export function distanceToNearestCityKm(latDeg, lonDeg) {
  let best = Infinity;
  for (const c of HIGH_LAT_CITIES) {
    const d = greatCircleDeg(latDeg, lonDeg, c.lat, c.lon);
    if (d < best) best = d;
  }
  return best * KM_PER_DEGREE_GC;
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
