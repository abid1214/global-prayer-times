import * as adhan from "adhan";
import { classifyPrayer, sunPosition } from "./solar.js";

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

// Compute the Aqrab al-Bilād projection for (latDeg, date) without
// running the full Adhan PrayerTimes calculation. Longitude is
// irrelevant — the projection only clamps latitude — so it's not a
// parameter. Returns `{ projectedFromLat }` if the location falls inside
// the polar fade cap at this date, or null if no projection is needed.
// Cheap enough to call from render-frequency code paths.
export function aqrabProjection(latDeg, date = new Date()) {
  const { declination } = sunPosition(date);
  const declDeg = (declination * 180) / Math.PI;
  const northThresh = Math.min(FAJR_LIMIT_DEG - declDeg, DAY_LIMIT_DEG + declDeg);
  const southThresh = Math.max(-FAJR_LIMIT_DEG - declDeg, -DAY_LIMIT_DEG + declDeg);
  if (latDeg > northThresh) return { projectedFromLat: northThresh };
  if (latDeg < southThresh) return { projectedFromLat: southThresh };
  return null;
}

export function getTimesForLocation(latDeg, lonDeg, date = new Date()) {
  const aqrab = aqrabProjection(latDeg, date);
  const effLatDeg = aqrab ? aqrab.projectedFromLat : latDeg;

  const coords = new adhan.Coordinates(effLatDeg, lonDeg);
  const params = jafariParams();
  const times = new adhan.PrayerTimes(coords, date, params);

  // Use solar-geometry classification rather than adhan.currentPrayer.
  // At high latitudes adhan can return e.g. Isha when today's Fajr has
  // just passed because its time-ordered comparison breaks when
  // Isha and the next day's Fajr are only minutes apart. Computing from
  // current sun altitude keeps the panel and the globe coloring in sync.
  const latRad = (effLatDeg * Math.PI) / 180;
  const lonRad = (lonDeg * Math.PI) / 180;

  return {
    fajr: times.fajr,
    sunrise: times.sunrise,
    dhuhr: times.dhuhr,
    asr: times.asr,
    maghrib: times.maghrib,
    isha: times.isha,
    currentPrayer: classifyPrayer(latRad, lonRad, date),
    aqrab: aqrab ? { projectedFromLat: aqrab.projectedFromLat } : null,
    raw: times,
  };
}

export { PRAYER_META };
