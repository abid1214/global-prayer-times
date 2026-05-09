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
const panelHandle = document.getElementById("panelHandle");
const panelPeek = document.getElementById("panelPeek");
const peekName = panelPeek.querySelector(".peekName");
const peekCur = panelPeek.querySelector(".peekCur");

let dismissed = false;
let lastLocation = null;

const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

panelClose.addEventListener("click", () => dismissPanel());

function dismissPanel() {
  if (panel.hidden) return;
  if (!isMobile()) {
    panel.hidden = true;
    return;
  }
  panel.classList.remove("dragging");
  panel.style.transform = "translateY(100%)";
  const onEnd = (e) => {
    if (e.propertyName !== "transform") return;
    panel.removeEventListener("transitionend", onEnd);
    panel.hidden = true;
    panel.style.transform = "";
  };
  panel.addEventListener("transitionend", onEnd);
  if (lastLocation) {
    dismissed = true;
    showPeek(lastLocation);
  }
}

function restorePanel() {
  dismissed = false;
  panelPeek.style.transform = "";
  panelPeek.classList.remove("dragging");
  panelPeek.hidden = true;
  if (lastLocation) showPanelForLocation(lastLocation, lastLocation.date);
}

function showPeek(loc) {
  peekName.textContent = loc.name || "Selected location";
  const meta = loc.currentPrayer && PRAYER_META.find((p) => p.key === loc.currentPrayer);
  peekCur.textContent = meta ? `Now: ${meta.label}` : "";
  panelPeek.hidden = false;
}

// ---- drag the handle to dismiss ----
let panelDrag = null;
panelHandle.addEventListener("pointerdown", (e) => {
  panelDrag = { startY: e.clientY, dy: 0 };
  panel.classList.add("dragging");
  panelHandle.setPointerCapture(e.pointerId);
});
panelHandle.addEventListener("pointermove", (e) => {
  if (!panelDrag) return;
  panelDrag.dy = Math.max(0, e.clientY - panelDrag.startY);
  panel.style.transform = `translateY(${panelDrag.dy}px)`;
});
function endPanelDrag(commit) {
  if (!panelDrag) return;
  panel.classList.remove("dragging");
  if (commit && panelDrag.dy > 80) {
    dismissPanel();
  } else {
    panel.style.transform = "";
  }
  panelDrag = null;
}
panelHandle.addEventListener("pointerup", () => endPanelDrag(true));
panelHandle.addEventListener("pointercancel", () => endPanelDrag(false));

// ---- tap or drag-up on the peek to restore ----
let peekDrag = null;
panelPeek.addEventListener("pointerdown", (e) => {
  peekDrag = { startY: e.clientY, dy: 0, moved: false };
  panelPeek.classList.add("dragging");
  panelPeek.setPointerCapture(e.pointerId);
});
panelPeek.addEventListener("pointermove", (e) => {
  if (!peekDrag) return;
  const dy = e.clientY - peekDrag.startY;
  if (Math.abs(dy) > 4) peekDrag.moved = true;
  peekDrag.dy = Math.min(0, dy);
  panelPeek.style.transform = `translateY(${peekDrag.dy}px)`;
});
function endPeekDrag(commit) {
  if (!peekDrag) return;
  panelPeek.classList.remove("dragging");
  const tap = !peekDrag.moved;
  const swipedUp = peekDrag.dy < -40;
  if (commit && (tap || swipedUp)) {
    restorePanel();
  } else {
    panelPeek.style.transform = "";
  }
  peekDrag = null;
}
panelPeek.addEventListener("pointerup", () => endPeekDrag(true));
panelPeek.addEventListener("pointercancel", () => endPeekDrag(false));

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
  const times = getTimesForLocation(lat, lon, date);
  lastLocation = { lat, lon, name, date, currentPrayer: times.currentPrayer };

  if (dismissed) {
    showPeek(lastLocation);
    return;
  }

  panelPeek.hidden = true;
  panel.hidden = false;
  panel.style.transform = "";
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
