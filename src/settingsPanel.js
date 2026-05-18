// Settings slide-over: open/close + radio reflects current method
// choice. The radios call setMethod() (which persists to
// localStorage), so the next panel render picks up the new method.
// Live re-render of the existing panel/main UI on change is wired in
// a follow-up commit — at this stage the UI is interactive but
// state-flow changes only land after the next render trigger
// (location click, scrubber tick, page reload).

import { POLAR_METHODS, getMethod, setMethod } from "./settings.js";

const overlay = document.getElementById("settingsOverlay");
const panel   = document.getElementById("settingsPanel");
const openBtn = document.getElementById("settingsBtn");
const closeBtn = document.getElementById("settingsClose");
const backdrop = document.getElementById("settingsBackdrop");
const radios  = document.querySelectorAll('input[name="polarMethod"]');

function open() {
  overlay.hidden = false;
  // Allow the layout to commit hidden=false before adding .open so
  // the slide-in transition fires on first open.
  requestAnimationFrame(() => overlay.classList.add("open"));
  document.addEventListener("keydown", onKey);
}

function close() {
  overlay.classList.remove("open");
  document.removeEventListener("keydown", onKey);
  // Wait for the slide-out transition before yanking the overlay
  // out of the layout, otherwise it just snaps away.
  setTimeout(() => { overlay.hidden = true; }, 220);
}

function onKey(e) {
  if (e.key === "Escape") close();
}

openBtn.addEventListener("click", open);
closeBtn.addEventListener("click", close);
backdrop.addEventListener("click", close);

// Initialize the radio to whatever's persisted, then write back any
// user selection so the next prayer.js getMethod() reads the new
// choice. Wiring the live re-render is the next step.
const current = getMethod();
for (const r of radios) {
  if (r.value === current) r.checked = true;
  r.addEventListener("change", (e) => {
    if (e.target.checked) setMethod(e.target.value);
  });
}

// Sanity check: validate that every radio in the DOM has a matching
// POLAR_METHODS entry. If a typo crept into the markup, fail loudly
// at boot rather than silently never-matching.
const known = new Set(Object.values(POLAR_METHODS));
for (const r of radios) {
  if (!known.has(r.value)) {
    console.error(`[settingsPanel] unknown polar method value in DOM: "${r.value}"`);
  }
}
