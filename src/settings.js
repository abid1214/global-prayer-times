// Single source of truth for user-configurable options. Each setting persists
// to localStorage and notifies subscribers on change so the side panel and the
// projection viz stay in lockstep.

// Generic persisted-choice state machine. Both user settings below (calculation
// preset, high-latitude method) follow the same shape: a URL parameter takes
// precedence at load (read once, never written back — so a "share this view"
// link works without polluting the recipient's saved preference), falling back
// to localStorage, then a default. Validated against an `order` allow-list.
function createSetting({ storageKey, urlParam, order, defaultValue }) {
  const subscribers = new Set();
  let cached = null;

  function load() {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get(urlParam);
      if (fromUrl && order.includes(fromUrl)) return fromUrl;
    } catch (_) {}
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored && order.includes(stored)) return stored;
    } catch (_) {}
    return defaultValue;
  }

  return {
    get() {
      if (cached === null) cached = load();
      return cached;
    },
    set(value) {
      if (!order.includes(value) || value === cached) return;
      cached = value;
      try { localStorage.setItem(storageKey, value); } catch (_) {}
      for (const fn of subscribers) fn(value);
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}

// ---- Marja' / calculation-method preset ----

export const PRESETS = Object.freeze({
  JAFARI: "jafari",
  TEHRAN: "tehran",
});

export const PRESET_ORDER = [PRESETS.JAFARI, PRESETS.TEHRAN];

// Preset metadata. adhan params are built by paramsForPreset() in prayer.js.
// IMPORTANT: the angles here are also read by activeFajrAngleDeg() (prayer.js)
// to derive the cap edge — keep them in lockstep with paramsForPreset() or the
// panel's "in cap" decision diverges from the computed schedule.
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

const preset = createSetting({
  storageKey: "gpt.preset",
  urlParam: "preset",
  order: PRESET_ORDER,
  defaultValue: PRESETS.JAFARI,  // preserve existing behavior for current users
});
export const getPreset = preset.get;
export const setPreset = preset.set;
export const subscribePreset = preset.subscribe;

// ---- High-latitude polar method ----

export const POLAR_METHODS = Object.freeze({
  AQRAB_SAME_LON:     "aqrab_same_lon",
  AQRAB_NEAREST_CITY: "aqrab_nearest_city",
  AQRAB_AL_AWQAT:     "aqrab_al_awqat",
  MIDNIGHT:           "midnight",
  SEVENTH:            "seventh",
  ANGLE_REDUCED:      "angle_reduced",
});

// Validates persisted values and the URL ?m= parameter.
const METHOD_ORDER = [
  POLAR_METHODS.AQRAB_SAME_LON,
  POLAR_METHODS.AQRAB_NEAREST_CITY,
  POLAR_METHODS.AQRAB_AL_AWQAT,
  POLAR_METHODS.MIDNIGHT,
  POLAR_METHODS.SEVENTH,
  POLAR_METHODS.ANGLE_REDUCED,
];

// Default: method 2 (nearest city), per Sistani §2032. Existing users keep
// their stored choice; only fresh visitors get this default.
const method = createSetting({
  storageKey: "polar_method",
  urlParam: "m",
  order: METHOD_ORDER,
  defaultValue: POLAR_METHODS.AQRAB_NEAREST_CITY,
});
export const getMethod = method.get;
export const setMethod = method.set;
export const subscribe = method.subscribe;
