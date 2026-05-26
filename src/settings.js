// Single source of truth for user-configurable options. Persists to
// localStorage and notifies subscribers on change so the side panel and
// the projection viz stay in lockstep.

// ---- Marja' / calculation-method preset ----

export const PRESETS = Object.freeze({
  JAFARI: "jafari",
  TEHRAN: "tehran",
});

export const PRESET_ORDER = [PRESETS.JAFARI, PRESETS.TEHRAN];

// Display metadata. Angles are advisory (the actual parameters come from
// adhan.CalculationMethod.Jafari() / Tehran() in prayer.js); list them
// here so the UI can show them without importing adhan.
export const PRESET_META = Object.freeze({
  [PRESETS.JAFARI]: Object.freeze({
    id: PRESETS.JAFARI,
    name: "Shia Ithna-Ashari, Leva Institute, Qum",
    shortName: "Leva Qom",
    angles: Object.freeze({ fajr: 16, maghrib: 4, isha: 14 }),
    note: "Sistani-aligned. Used by most English-language Shia calendars.",
  }),
  [PRESETS.TEHRAN]: Object.freeze({
    id: PRESETS.TEHRAN,
    name: "Institute of Geophysics, University of Tehran",
    shortName: "Tehran",
    angles: Object.freeze({ fajr: 17.7, maghrib: 4.5, isha: 14 }),
    note: "Khamenei-aligned. Official Iranian government calendar default.",
  }),
});

const PRESET_STORAGE_KEY = "gpt.preset";
const DEFAULT_PRESET = PRESETS.JAFARI;  // preserve existing behavior for current users

const presetSubscribers = new Set();
let presetCached = null;

function loadPreset() {
  // URL ?preset= takes precedence at load only — read once, never
  // written back. Matches the ?m= pattern used by polar-method so a
  // "share this view with preset X" link works without polluting the
  // recipient's persisted preference.
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("preset");
    if (fromUrl && PRESET_ORDER.includes(fromUrl)) return fromUrl;
  } catch (_) {}
  try {
    const stored = localStorage.getItem(PRESET_STORAGE_KEY);
    if (stored && PRESET_ORDER.includes(stored)) return stored;
  } catch (_) {}
  return DEFAULT_PRESET;
}

export function getPreset() {
  if (presetCached === null) presetCached = loadPreset();
  return presetCached;
}

export function setPreset(preset) {
  if (!PRESET_ORDER.includes(preset) || preset === presetCached) return;
  presetCached = preset;
  try { localStorage.setItem(PRESET_STORAGE_KEY, preset); } catch (_) {}
  for (const fn of presetSubscribers) fn(preset);
}

export function subscribePreset(fn) {
  presetSubscribers.add(fn);
  return () => presetSubscribers.delete(fn);
}

// ---- High-latitude polar method ----

export const POLAR_METHODS = Object.freeze({
  AQRAB_SAME_LON:     "aqrab_same_lon",
  AQRAB_NEAREST_CITY: "aqrab_nearest_city",
  AQRAB_AL_AWQAT:     "aqrab_al_awqat",
  MIDNIGHT:           "midnight",
  SEVENTH:            "seventh",
  ANGLE_REDUCED:      "angle_reduced",
});

// Canonical method order — used to validate persisted values and the
// URL ?m= parameter. The shader is intentionally NOT method-aware (cap
// always uses same-longitude projection regardless of choice, see the
// docblock in src/earthMaterial.js), so this order is not bound to any
// uniform; it only needs to be stable for storage round-tripping.
const METHOD_ORDER = [
  POLAR_METHODS.AQRAB_SAME_LON,
  POLAR_METHODS.AQRAB_NEAREST_CITY,
  POLAR_METHODS.AQRAB_AL_AWQAT,
  POLAR_METHODS.MIDNIGHT,
  POLAR_METHODS.SEVENTH,
  POLAR_METHODS.ANGLE_REDUCED,
];

// Method 2 (nearest city) matches Sistani §2032 verbatim: "Muslims
// should rely on the timings of the closest city that has night and
// day in a twenty-four hour period." sistani.org/english/book/46/2032
// Existing users with a stored polar_method preference retain their
// choice; only fresh visitors see this default.
const DEFAULT_METHOD = POLAR_METHODS.AQRAB_NEAREST_CITY;
const STORAGE_KEY = "polar_method";

const subscribers = new Set();
let cached = null;

function load() {
  // URL ?m= takes precedence at load only — read once, never written
  // back. Lets someone share a "see this view with method X" link
  // without polluting the recipient's persisted preference; their
  // next change via the gear writes to localStorage and is sticky on
  // subsequent visits without ?m=.
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("m");
    if (fromUrl && METHOD_ORDER.includes(fromUrl)) return fromUrl;
  } catch (_) {}
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && METHOD_ORDER.includes(stored)) return stored;
  } catch (_) {}
  return DEFAULT_METHOD;
}

export function getMethod() {
  if (cached === null) cached = load();
  return cached;
}

export function setMethod(method) {
  if (!METHOD_ORDER.includes(method) || method === cached) return;
  cached = method;
  try { localStorage.setItem(STORAGE_KEY, method); } catch (_) {}
  for (const fn of subscribers) fn(method);
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
