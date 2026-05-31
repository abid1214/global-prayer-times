// Minimal browser-global stubs so the src/ modules and the classifier test
// can load under Node (the suite is otherwise browser-only). Imported FIRST
// by run-node.mjs, before the test module pulls in settings.js — which reads
// window.location.search and localStorage. A Map-backed localStorage is used
// so the test's save/restore of the user's persisted preset/method actually
// round-trips.

const store = new Map();

// Only define globals the runtime is missing — recent Node ships a read-only
// `navigator`, which the test's dependency graph (prayer -> solar/settings/
// highLatCities) doesn't touch, so leave it alone.
if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
}

if (typeof globalThis.window === "undefined") {
  globalThis.window = { location: { search: "", href: "http://localhost/" } };
}
