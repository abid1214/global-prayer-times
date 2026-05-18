// Settings slide-over: open/close + radio reflects current method
// choice. The radios call setMethod() (which persists to localStorage
// and fans out to subscribers); src/panel.js and src/main.js subscribe
// for live re-render of the side panel and the projection pin/arc.

import { POLAR_METHODS, getMethod, setMethod } from "./settings.js";

const overlay = document.getElementById("settingsOverlay");
const panel   = document.getElementById("settingsPanel");
const openBtn = document.getElementById("settingsBtn");
const closeBtn = document.getElementById("settingsClose");
const backdrop = document.getElementById("settingsBackdrop");
const handle  = document.getElementById("settingsHandle");
const radios  = document.querySelectorAll('input[name="polarMethod"]');

// Pending state tracked so rapid open/close cycles don't leak listeners
// or race each other:
//   • hideTimeout — close's post-transition overlay.hidden=true; cleared
//     on open() so a quick re-open doesn't get yanked out of layout
//   • openRaf    — the requestAnimationFrame that adds .open after the
//     layout commits hidden=false; cleared on close() so a quick close
//     can't be undone by a queued RAF
//   • isOpen     — guards open() and close() against duplicate work
//     (re-clicking the gear would otherwise re-register the keydown
//     listener every time)
let hideTimeout = null;
let openRaf = null;
let isOpen = false;
// Drag state for the mobile bottom-sheet's swipe-down handle.
// Declared up here so close() can cancel it if the panel is dismissed
// mid-drag (e.g., Escape key fires while the user's finger is still
// down) — otherwise the inline transform set during pointermove would
// override the CSS slide-out transform.
let drag = null;

function open() {
  if (isOpen) return;
  isOpen = true;
  if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
  overlay.hidden = false;
  // Allow the layout to commit hidden=false before adding .open so
  // the slide-in transition fires on first open.
  openRaf = requestAnimationFrame(() => {
    openRaf = null;
    overlay.classList.add("open");
  });
  document.addEventListener("keydown", onKey);
}

function close() {
  if (!isOpen) return;
  isOpen = false;
  if (openRaf !== null) { cancelAnimationFrame(openRaf); openRaf = null; }
  // If close() fires mid-drag (Escape or backdrop tap before pointerup),
  // cancel the drag and clear the inline transform so the CSS slide-out
  // transition can actually run. Without this, the inline
  // transform: translateY(...) set during pointermove would override
  // the closed-state CSS transform and the sheet would snap away when
  // hideTimeout fires instead of animating out.
  if (drag) {
    panel.classList.remove("dragging");
    drag = null;
  }
  panel.style.transform = "";
  overlay.classList.remove("open");
  document.removeEventListener("keydown", onKey);
  // Wait for the slide-out transition before yanking the overlay
  // out of the layout, otherwise it just snaps away. open() cancels
  // this if the user re-opens before it fires.
  if (hideTimeout) clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => {
    overlay.hidden = true;
    hideTimeout = null;
  }, 220);
}

function onKey(e) {
  if (e.key === "Escape") close();
}

openBtn.addEventListener("click", open);
closeBtn.addEventListener("click", close);
backdrop.addEventListener("click", close);

// Swipe-down to dismiss on the mobile bottom-sheet variant. Mirrors
// the prayer-times panel handle in src/panel.js so the two surfaces
// share the same gesture. Handle is display:none on desktop, so the
// listeners are inert there. `drag` itself is declared above close()
// so close() can clean it up if dismissed mid-drag.
handle.addEventListener("pointerdown", (e) => {
  drag = { startY: e.clientY, dy: 0 };
  panel.classList.add("dragging");
  handle.setPointerCapture(e.pointerId);
});
handle.addEventListener("pointermove", (e) => {
  if (!drag) return;
  drag.dy = Math.max(0, e.clientY - drag.startY);
  panel.style.transform = `translateY(${drag.dy}px)`;
});
function endDrag(commit) {
  if (!drag) return;
  panel.classList.remove("dragging");
  if (commit && drag.dy > 80) {
    // Clear the inline transform BEFORE close() so the CSS slide-out
    // transition (translateY(0) → translateY(100%) via removing .open)
    // can actually run. Leaving the inline transform set would
    // override the CSS and the sheet would snap away when hideTimeout
    // fires instead of animating out.
    panel.style.transform = "";
    close();
  } else {
    panel.style.transform = "";
  }
  drag = null;
}
handle.addEventListener("pointerup",     () => endDrag(true));
handle.addEventListener("pointercancel", () => endDrag(false));

// Initialize the radio to whatever's persisted, then write back any
// user selection. setMethod() fans the change out to subscribers
// (panel.js, main.js) for live re-render.
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
