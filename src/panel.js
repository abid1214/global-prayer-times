import * as adhan from "adhan";
import { getTimesForLocation, PRAYER_META } from "./prayer.js";

const panel = document.getElementById("panel");
const panelLocation = document.getElementById("panelLocation");
const panelCoords = document.getElementById("panelCoords");
const panelDate = document.getElementById("panelDate");
const panelCurrent = document.getElementById("panelCurrent");
const panelTimesBody = document.querySelector("#panelTimes tbody");
const panelQibla = document.getElementById("panelQibla");
const panelClose = document.getElementById("panelClose");

panelClose.addEventListener("click", () => { panel.hidden = true; });

// ---- timezone lookup (lazy-loaded; falls back to longitude-based estimate) ----
let tzLookupPromise = null;
function getTzLookup() {
  if (!tzLookupPromise) {
    tzLookupPromise = import("https://cdn.jsdelivr.net/npm/tz-lookup@6.1.25/+esm")
      .then((mod) => mod.default || mod)
      .catch((err) => {
        console.warn("tz-lookup failed to load — falling back to longitude estimate", err);
        return null;
      });
  }
  return tzLookupPromise;
}

function approxTzFromLon(lonDeg) {
  return { kind: "approx", offsetMin: Math.round(lonDeg * 4) };
}

async function resolveTimezone(lat, lon) {
  const lookup = await getTzLookup();
  if (!lookup) return approxTzFromLon(lon);
  try {
    const tz = lookup(lat, lon);
    if (tz) return { kind: "iana", iana: tz };
  } catch (err) {
    console.warn("tz-lookup threw", err);
  }
  return approxTzFromLon(lon);
}

function fmtTimeWithTz(date, tz) {
  if (tz.kind === "iana") {
    return new Intl.DateTimeFormat([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz.iana,
    }).format(date);
  }
  // approx — shift by longitude solar offset
  const shifted = new Date(date.getTime() + tz.offsetMin * 60_000);
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function fmtDateLabel(date, tz) {
  if (tz.kind === "iana") {
    return new Intl.DateTimeFormat([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: tz.iana,
    }).format(date);
  }
  const shifted = new Date(date.getTime() + tz.offsetMin * 60_000);
  return new Intl.DateTimeFormat([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(shifted);
}

function tzLabel(tz, date) {
  if (tz.kind === "iana") {
    // Resolve current UTC offset for the IANA zone
    const offsetStr = new Intl.DateTimeFormat([], {
      timeZone: tz.iana,
      timeZoneName: "shortOffset",
    })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value || "";
    return `${tz.iana} · ${offsetStr}`;
  }
  const h = (tz.offsetMin / 60).toFixed(1);
  return `local solar time (UTC${tz.offsetMin >= 0 ? "+" : ""}${h}h)`;
}

function fmtCoords(lat, lon) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lon).toFixed(2)}° ${ew}`;
}

function fmtBearing(deg) {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const d = ((deg % 360) + 360) % 360;
  const idx = Math.round(d / 22.5) % 16;
  return `${d.toFixed(1)}° (${dirs[idx]})`;
}

export async function showPanelForLocation({ lat, lon, name }, date = new Date()) {
  panel.hidden = false;
  panelLocation.textContent = name || "Selected location";
  panelCoords.textContent = fmtCoords(lat, lon);
  panelDate.textContent = "Loading local time…";
  panelCurrent.innerHTML = "";
  panelTimesBody.innerHTML = "";
  panelQibla.textContent = "";

  // Resolve tz, then render. If tz-lookup is slow, we render with the
  // approximation immediately, then upgrade once it loads.
  const fastTz = approxTzFromLon(lon);
  render(lat, lon, date, fastTz);

  resolveTimezone(lat, lon).then((tz) => {
    if (tz.kind === "iana") render(lat, lon, date, tz);
  });
}

function render(lat, lon, date, tz) {
  const times = getTimesForLocation(lat, lon, date);

  let dateLine = `${fmtDateLabel(date, tz)} · ${tzLabel(tz, date)}`;
  if (times.aqrab) {
    const hemi = times.aqrab.projectedFromLat >= 0 ? "N" : "S";
    dateLine += ` · projected from ${Math.abs(times.aqrab.projectedFromLat)}°${hemi} (Aqrab al-Bilād)`;
  }
  panelDate.textContent = dateLine;

  const cur = times.currentPrayer;
  const meta = PRAYER_META.find((p) => p.key === cur);
  if (cur && cur !== "none" && meta) {
    panelCurrent.innerHTML = `
      <div class="label">Now in</div>
      <div class="value"><span class="swatch" style="background:${meta.color}"></span>${meta.label}</div>
    `;
  } else {
    panelCurrent.innerHTML = `
      <div class="label">Now</div>
      <div class="value">Outside any prayer window</div>
    `;
  }

  panelTimesBody.innerHTML = "";
  for (const p of PRAYER_META) {
    const t = times[p.key];
    if (!(t instanceof Date) || isNaN(t)) continue;
    const tr = document.createElement("tr");
    if (cur === p.key) tr.classList.add("active");
    tr.innerHTML = `
      <td><span class="swatch" style="background:${p.color}"></span>${p.label}</td>
      <td>${fmtTimeWithTz(t, tz)}</td>
    `;
    panelTimesBody.appendChild(tr);
  }

  // Qibla bearing
  const coords = new adhan.Coordinates(lat, lon);
  const qiblaDeg = adhan.Qibla(coords);
  panelQibla.innerHTML = `<span class="muted">Qibla:</span> ${fmtBearing(qiblaDeg)}`;
}
