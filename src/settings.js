// Single source of truth for user-configurable options. Persists to
// localStorage and notifies subscribers on change so the shader uniform,
// the side panel, and the projection viz stay in lockstep.

export const POLAR_METHODS = Object.freeze({
  AQRAB_SAME_LON:     "aqrab_same_lon",
  AQRAB_NEAREST_CITY: "aqrab_nearest_city",
  AQRAB_AL_AWQAT:     "aqrab_al_awqat",
  MIDNIGHT:           "midnight",
  SEVENTH:            "seventh",
  ANGLE_REDUCED:      "angle_reduced",
});

// Index doubles as the shader uniform value (u_polarMethod, int 0..5).
// Order is load-bearing — do not reorder without updating earthMaterial.js.
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

export function methodKind(method = getMethod()) {
  return METHOD_ORDER.indexOf(method);
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
