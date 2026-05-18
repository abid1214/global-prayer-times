// Single source of truth for user-configurable options. Persists to
// localStorage and notifies subscribers on change so the side panel and
// the projection viz stay in lockstep.

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

const DEFAULT_METHOD = POLAR_METHODS.AQRAB_SAME_LON;
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
