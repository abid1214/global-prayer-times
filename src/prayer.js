import * as adhan from "adhan";
import { classifyPrayer } from "./solar.js";

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

export function getTimesForLocation(latDeg, lonDeg, date = new Date()) {
  const coords = new adhan.Coordinates(latDeg, lonDeg);
  const params = jafariParams();
  const times = new adhan.PrayerTimes(coords, date, params);

  // Use solar-geometry classification rather than adhan.currentPrayer.
  // At high latitudes adhan can return e.g. Isha when today's Fajr has
  // just passed because its time-ordered comparison breaks when
  // Isha and the next day's Fajr are only minutes apart. Computing from
  // current sun altitude keeps the panel and the globe coloring in sync.
  const latRad = (latDeg * Math.PI) / 180;
  const lonRad = (lonDeg * Math.PI) / 180;

  return {
    fajr: times.fajr,
    sunrise: times.sunrise,
    dhuhr: times.dhuhr,
    asr: times.asr,
    maghrib: times.maghrib,
    isha: times.isha,
    currentPrayer: classifyPrayer(latRad, lonRad, date),
    raw: times,
  };
}

export { PRAYER_META };
