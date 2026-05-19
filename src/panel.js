import * as adhan from "adhan";
import { getTimesForLocation, PRAYER_META } from "./prayer.js";
import { subscribe as subscribeMethod } from "./settings.js";

const panel = document.getElementById("panel");
const panelLocation = document.getElementById("panelLocation");
const panelCoords = document.getElementById("panelCoords");
const panelDate = document.getElementById("panelDate");
const panelMethodNote = document.getElementById("panelMethodNote");
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
// Last (lat, lon, date, tz) tuple used for render. Re-render on
// method change reuses this rather than re-resolving timezone (which
// is async and would flicker). Cleared on dismiss.
let lastRender = null;
// Active settings subscription. Established on the first
// showPanelForLocation and kept alive across dismiss → peek (mobile)
// and across desktop close, so a method change via the gear refreshes
// whichever surface is currently visible (panel, peek, or nothing).
// The single subscriber is replaced on the next showPanelForLocation
// when the user picks a new location, so the count stays bounded.
// settings.js's subscribe() returns an unsubscribe handle.
let methodUnsub = null;
// Monotonically increasing token bumped on every showPanelForLocation
// call. The async timezone resolve compares against this before
// committing its render — a stale resolution from a previous selection
// gets dropped instead of overwriting the newer panel's times/tz.
let selectionToken = 0;

const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

panelClose.addEventListener("click", () => dismissPanel());

// ---- shareable link ----
// Encode the selected location as ?lat=&lon=(&name=) so the browser
// address bar always shows a link the user can copy from. URL is kept
// in sync on every showPanelForLocation via history.replaceState (no
// page reload).
function syncUrlFromLocation(loc) {
  if (!loc) return;
  if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) {
    console.warn("syncUrlFromLocation: non-finite lat/lon, skipping URL update", loc);
    return;
  }
  try {
    const u = new URL(window.location.href);
    u.searchParams.set("lat", loc.lat.toFixed(4));
    u.searchParams.set("lon", loc.lon.toFixed(4));
    if (loc.name) u.searchParams.set("name", loc.name);
    else u.searchParams.delete("name");
    history.replaceState(null, "", u.toString());
  } catch (err) {
    // history.replaceState can throw on file:// or sandboxed origins.
    // Surface it instead of swallowing silently so dev failures stay
    // visible, but don't let it break panel rendering.
    console.warn("syncUrlFromLocation: history.replaceState failed", err);
  }
}

let pendingDismissEnd = null;
function cancelPendingDismiss() {
  if (!pendingDismissEnd) return;
  panel.removeEventListener("transitionend", pendingDismissEnd);
  pendingDismissEnd = null;
}

function dismissPanel() {
  if (panel.hidden) return;
  // Intentionally do NOT unsubscribe from method changes here: when
  // the user dismisses to peek on mobile, a method change via the
  // gear should still refresh the peek's "Now:" label. The
  // subscriber callback (see showPanelForLocation) handles both the
  // full-panel and peek states. Next showPanelForLocation replaces
  // the subscription cleanly on a new location.
  lastRender = null;
  if (!isMobile()) {
    panel.hidden = true;
    return;
  }
  panel.classList.remove("dragging");
  cancelPendingDismiss();
  panel.style.transform = "translateY(100%)";
  pendingDismissEnd = (e) => {
    if (e.propertyName !== "transform") return;
    cancelPendingDismiss();
    panel.hidden = true;
    panel.style.transform = "";
  };
  panel.addEventListener("transitionend", pendingDismissEnd);
  if (lastLocation) {
    dismissed = true;
    showPeek(lastLocation);
  }
}

function restorePanel() {
  cancelPendingDismiss();
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
// Pointer events handle mouse/touch; this covers keyboard activation
// (Enter/Space) on the peek <button> for screen-reader / switch users.
panelPeek.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    restorePanel();
  }
});

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

function fmtLat(lat) {
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}`;
}

// UTC-only short-date formatter, used for derivedFromDate (aqrab
// al-awqāt's "schedule from {date}"). That's a date-only concept
// stored as a Date-at-UTC-noon — formatting it in an IANA timezone
// (especially +12 or higher) can roll into the next/previous local
// calendar day. Forcing UTC keeps the label as the canonical
// historical calendar date the schedule was computed for.
function fmtUtcShortDate(d) {
  return new Intl.DateTimeFormat([], {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(d);
}

// Human description of how the polar-cap schedule was derived.
// Returns { primary, secondary? } or null. `primary` is appended to
// the date line; `secondary`, when present, renders as an italic
// sub-line below — used only for caveats that don't belong in the
// always-visible row.
const CITY_VISUAL_DELTA_DEG = 1;
function describePolarMethod(polarMethod, tz, _date) {
  if (!polarMethod) return null;
  switch (polarMethod.kind) {
    case "aqrab":
      return { primary: `Method: aqrab al-bilād · projected from ${fmtLat(polarMethod.projectedFromLat)}` };
    case "aqrab_city": {
      if (!polarMethod.city) {
        return { primary: `Method: aqrab al-bilād (nearest city) · no city in window, fell back to ${fmtLat(polarMethod.projectedFromLat)}` };
      }
      const c = polarMethod.city;
      const out = { primary: `Method: aqrab al-bilād · times from ${c.name}` };
      // Shader can't carry a city table — visual cap always uses the
      // same-longitude projection. Only flag it when the discrepancy
      // is visually meaningful (>1° lat difference between the city
      // and the projection target).
      if (Math.abs(c.lat - polarMethod.projectedFromLat) > CITY_VISUAL_DELTA_DEG) {
        out.secondary = `(cap visualization uses ${fmtLat(polarMethod.projectedFromLat)} projection)`;
      }
      return out;
    }
    case "aqrab_awqat":
      return { primary: `Method: aqrab al-awqāt · schedule from ${fmtUtcShortDate(polarMethod.derivedFromDate)}` };
    case "midnight":
      return { primary: `Method: niṣf al-layl (middle of night)` };
    case "seventh":
      return { primary: `Method: sub'iyya (one-seventh)` };
    case "angle_reduced":
      return { primary: `Method: angle-based with seasonal reduction · Fajr ${polarMethod.fajrAngle.toFixed(1)}°, Isha ${polarMethod.ishaAngle.toFixed(1)}°` };
    default:
      return null;
  }
}

export async function showPanelForLocation({ lat, lon, name }, date = new Date()) {
  // Bump the token first so any in-flight tz-resolve from a previous
  // call drops its render (see resolveTimezone().then below).
  const token = ++selectionToken;
  const times = getTimesForLocation(lat, lon, date);
  lastLocation = { lat, lon, name, date, currentPrayer: times.currentPrayer };
  syncUrlFromLocation(lastLocation);

  if (dismissed && isMobile()) {
    showPeek(lastLocation);
    return;
  }

  cancelPendingDismiss();
  panelPeek.hidden = true;
  panel.hidden = false;
  panel.style.transform = "";
  panelLocation.textContent = name || "Selected location";
  panelCoords.textContent = fmtCoords(lat, lon);
  panelDate.textContent = "Loading local time…";
  panelMethodNote.hidden = true;
  panelMethodNote.textContent = "";
  panelCurrent.innerHTML = "";
  panelTimesBody.innerHTML = "";
  panelQibla.textContent = "";

  // Subscribe to method changes for live re-render. Replace any
  // existing subscription (in case the user picks a new location
  // without dismissing). Kept alive across dismiss → peek so a
  // method change while peeking refreshes the peek label too;
  // replaced on the next showPanelForLocation when the user picks
  // a different location.
  if (methodUnsub) methodUnsub();
  methodUnsub = subscribeMethod(() => {
    if (!panel.hidden && lastRender) {
      // Full panel open — re-render in place.
      render(lastRender.lat, lastRender.lon, lastRender.date, lastRender.tz);
    } else if (!panelPeek.hidden && lastLocation) {
      // Peek visible — recompute currentPrayer for the new method
      // and refresh the peek's "Now:" label.
      const times = getTimesForLocation(lastLocation.lat, lastLocation.lon, lastLocation.date);
      lastLocation.currentPrayer = times.currentPrayer;
      showPeek(lastLocation);
    }
  });

  // Resolve tz, then render. If tz-lookup is slow, we render with the
  // approximation immediately, then upgrade once it loads.
  const fastTz = approxTzFromLon(lon);
  render(lat, lon, date, fastTz);

  resolveTimezone(lat, lon).then((tz) => {
    // Guard against races: if the user has selected a different
    // location while tz-lookup was in flight, drop this stale
    // resolution rather than overwriting the newer panel with
    // mismatched header / tz.
    if (token !== selectionToken) return;
    if (tz.kind === "iana") render(lat, lon, date, tz);
  });
}

function render(lat, lon, date, tz) {
  lastRender = { lat, lon, date, tz };
  const times = getTimesForLocation(lat, lon, date);
  // Keep lastLocation.currentPrayer in lockstep with the just-rendered
  // band so the peek bar's "Now:" label stays accurate after a method
  // change or tz refinement. Without this, dismissing the panel after
  // switching method would show the band from panel-open time.
  if (lastLocation) lastLocation.currentPrayer = times.currentPrayer;

  let dateLine = `${fmtDateLabel(date, tz)} · ${tzLabel(tz, date)}`;
  const method = describePolarMethod(times.polarMethod, tz, date);
  if (method?.primary) dateLine += ` · ${method.primary}`;
  panelDate.textContent = dateLine;
  if (method?.secondary) {
    panelMethodNote.textContent = method.secondary;
    panelMethodNote.hidden = false;
  } else {
    panelMethodNote.textContent = "";
    panelMethodNote.hidden = true;
  }

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
