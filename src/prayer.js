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

// Aqrab al-Bilad threshold. Above this latitude the Ja'fari altitude-based
// definitions can fail (sun never reaches -16° at summer solstice above ~51°,
// never sets above the Arctic Circle). The dominant Shia ruling is to adopt
// the schedule of the nearest latitude where the calculation works; we
// approximate that by clamping the effective latitude. The same threshold is
// hard-coded in the shader.
const LAT_THRESH_DEG = 60;

export function getTimesForLocation(latDeg, lonDeg, date = new Date()) {
  const projected = Math.abs(latDeg) > LAT_THRESH_DEG;
  const effLatDeg = projected ? Math.sign(latDeg) * LAT_THRESH_DEG : latDeg;
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
    aqrab: projected ? { projectedFromLat: effLatDeg } : null,
    raw: times,
  };
}

export { PRAYER_META };
