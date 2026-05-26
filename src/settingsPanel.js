// Settings slide-over: open/close + radio reflects current method
// choice. The radios call setMethod() (which persists to localStorage
// and fans out to subscribers); src/panel.js and src/main.js subscribe
// for live re-render of the side panel and the projection pin/arc.

import { POLAR_METHODS, getMethod, setMethod, PRESET_ORDER, getPreset, setPreset } from "./settings.js";

const overlay = document.getElementById("settingsOverlay");
const panel   = document.getElementById("settingsPanel");
const openBtn = document.getElementById("settingsBtn");
const closeBtn = document.getElementById("settingsClose");
const backdrop = document.getElementById("settingsBackdrop");
const handle  = document.getElementById("settingsHandle");
const radios  = document.querySelectorAll('input[name="polarMethod"]');
const presetRadios = document.querySelectorAll('input[name="preset"]');

// Pending state so rapid open/close cycles don't leak listeners or
// race each other:
//   • pendingHide  — transitionend listener + safety-timeout cleanup
//     that flips overlay.hidden=true after the slide-out finishes.
//     Cancelled on re-open so the overlay doesn't get yanked out of
//     layout under an open panel.
//   • openRaf      — RAF that adds .open after the layout commits
//     hidden=false. Cancelled on close so a quick close can't be
//     undone by a queued RAF.
//   • isOpen       — guards open()/close() against duplicate work.
//   • previousFocus — the element focused when the dialog opened, so
//     close() can restore it (aria-modal expectation).
let pendingHide = null;
let openRaf = null;
let isOpen = false;
let previousFocus = null;
// Drag state for the mobile bottom-sheet's swipe-down handle.
// Declared up here so close() can cancel it if the panel is dismissed
// mid-drag — otherwise the inline transform set during pointermove
// would override the CSS slide-out transform.
let drag = null;

function open() {
  if (isOpen) return;
  isOpen = true;
  if (pendingHide) { pendingHide.cancel(); pendingHide = null; }
  previousFocus = document.activeElement;
  overlay.hidden = false;
  openBtn.setAttribute("aria-expanded", "true");
  // Allow the layout to commit hidden=false before adding .open so
  // the slide-in transition fires on first open.
  openRaf = requestAnimationFrame(() => {
    openRaf = null;
    overlay.classList.add("open");
    // Focus the close button so keyboard users have an obvious
    // dismiss target and the tab-trap has somewhere to anchor.
    closeBtn.focus();
  });
  document.addEventListener("keydown", onKey);
  document.addEventListener("focusin", trapFocus);
}

function close() {
  if (!isOpen) return;
  isOpen = false;
  // If we never got to add .open (close fires faster than RAF), there's
  // no slide-out transition to wait for. Without this branch we'd
  // schedule the hide on transitionend, the event would never fire,
  // and the transparent backdrop (opacity: 0, pointer-events: auto)
  // would briefly block clicks to the globe until the safety timeout.
  const wasVisuallyOpen = overlay.classList.contains("open");
  if (openRaf !== null) { cancelAnimationFrame(openRaf); openRaf = null; }
  // If close() fires mid-drag (Escape, backdrop tap, or close button
  // before pointerup), cancel the drag and clear the inline transform
  // so the CSS slide-out transition can actually run.
  if (drag) {
    releasePointerCaptureSafe(drag.pointerId);
    panel.classList.remove("dragging");
    drag = null;
  }
  panel.style.transform = "";
  overlay.classList.remove("open");
  openBtn.setAttribute("aria-expanded", "false");
  document.removeEventListener("keydown", onKey);
  document.removeEventListener("focusin", trapFocus);
  // Wait for the slide-out transition to finish before yanking the
  // overlay out of layout. transitionend is robust to CSS timing
  // changes (e.g., a future prefers-reduced-motion override); a
  // safety setTimeout catches the no-transition case where
  // transitionend never fires.
  if (pendingHide) pendingHide.cancel();
  if (wasVisuallyOpen) {
    pendingHide = scheduleHide();
  } else {
    // No transition expected — hide immediately so the backdrop
    // doesn't briefly block clicks.
    overlay.hidden = true;
    pendingHide = null;
  }
  // Restore focus to whoever had it before the dialog opened (usually
  // the gear button).
  if (previousFocus && typeof previousFocus.focus === "function") {
    previousFocus.focus();
  }
  previousFocus = null;
}

function scheduleHide() {
  const safetyMs = 400;  // > CSS 220ms + slack
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    panel.removeEventListener("transitionend", onEnd);
    clearTimeout(safety);
    overlay.hidden = true;
    pendingHide = null;
  };
  const onEnd = (e) => {
    // Multiple transitionend events fire per element; only the
    // transform one signals the slide-out completed.
    if (e.target === panel && e.propertyName === "transform") finish();
  };
  panel.addEventListener("transitionend", onEnd);
  const safety = setTimeout(finish, safetyMs);
  return { cancel: () => {
    if (done) return;
    done = true;
    panel.removeEventListener("transitionend", onEnd);
    clearTimeout(safety);
  } };
}

function onKey(e) {
  if (e.key === "Escape") { close(); return; }
  if (e.key === "Tab") trapTab(e);
}

// Defensive release — pointer capture may already be implicitly
// released (e.g., browser ended the gesture on pointercancel), in
// which case releasePointerCapture throws. Swallow that case rather
// than letting it propagate out of close()/endDrag.
function releasePointerCaptureSafe(pointerId) {
  if (pointerId == null) return;
  try { handle.releasePointerCapture(pointerId); } catch (_) {}
}

// Focus trap. Primary mechanism is a Tab keydown handler that cycles
// first ↔ last so both forward (Tab) and reverse (Shift+Tab) wrap
// correctly within the dialog. focusin is a safety net for the
// uncommon case where something else moves focus outside the panel
// (programmatic focus call, non-Tab key); it pulls focus back to the
// dialog but doesn't try to guess direction.
function focusableEls() {
  return Array.from(panel.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter((el) => !el.hidden && el.offsetParent !== null);
}

function trapTab(e) {
  if (!isOpen || e.key !== "Tab") return;
  const els = focusableEls();
  if (els.length === 0) return;
  const first = els[0];
  const last = els[els.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !panel.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

function trapFocus(e) {
  if (!isOpen) return;
  if (panel.contains(e.target)) return;
  // Safety net only — Tab cycling is handled by trapTab.
  const els = focusableEls();
  if (els.length) els[0].focus();
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
  // pointerId stored so close() / endDrag can release capture later.
  // Without this, an Escape mid-drag leaves the handle holding pointer
  // capture until the next pointerup/cancel — subsequent pointer
  // events get routed to it even though it's no longer in drag mode.
  drag = { startY: e.clientY, dy: 0, pointerId: e.pointerId };
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
  releasePointerCaptureSafe(drag.pointerId);
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

// Initialize the preset radio to whatever's persisted and write back
// any user selection. setPreset() fans the change out to subscribers
// (panel.js) so the side panel re-renders with the new angles. Mirrors
// the polar-method pattern above.
const currentPreset = getPreset();
for (const r of presetRadios) {
  if (r.value === currentPreset) r.checked = true;
  r.addEventListener("change", (e) => {
    if (e.target.checked) setPreset(e.target.value);
  });
}
const knownPresets = new Set(PRESET_ORDER);
for (const r of presetRadios) {
  if (!knownPresets.has(r.value)) {
    console.error(`[settingsPanel] unknown preset value in DOM: "${r.value}"`);
  }
}

// One-time first-run intro for the new preset choice. Localstorage
// flag is independent of the persisted preset value so existing users
// (who already have polar_method set but no gpt.preset yet) see the
// intro once and then never again. Wrap in try/catch so a private-mode
// localStorage rejection doesn't crash the dialog setup.
const PRESET_INTRO_SEEN_KEY = "gpt.presetIntroSeen";
const introOverlay = document.getElementById("presetIntroOverlay");
const introClose   = document.getElementById("presetIntroClose");
const introDismiss = document.getElementById("presetIntroDismiss");
if (introOverlay && introClose && introDismiss) {
  let seen = false;
  try { seen = localStorage.getItem(PRESET_INTRO_SEEN_KEY) === "1"; } catch (_) {}
  if (!seen) {
    introOverlay.hidden = false;
    // Save the element that had focus when the modal opened so we can
    // restore it on dismiss (aria-modal expectation). On first page
    // load this is usually document.body; on programmatic show it's
    // whichever element triggered it.
    const introPreviousFocus = document.activeElement;
    // Move focus to the primary dismiss button so keyboard users have
    // an obvious target and the Tab cycle has somewhere to start.
    // RAF defers past the layout commit so focus() doesn't fight a
    // pending hidden→shown transition.
    requestAnimationFrame(() => introDismiss.focus());
    const onIntroKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); dismiss(); return; }
      if (e.key !== "Tab") return;
      // Two focusables in the modal — close (×) and Got it. Cycle
      // between them so focus can't escape into the page behind.
      const first = introClose;
      const last  = introDismiss;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const dismiss = () => {
      introOverlay.hidden = true;
      document.removeEventListener("keydown", onIntroKey);
      try { localStorage.setItem(PRESET_INTRO_SEEN_KEY, "1"); } catch (_) {}
      if (introPreviousFocus && typeof introPreviousFocus.focus === "function") {
        introPreviousFocus.focus();
      }
    };
    document.addEventListener("keydown", onIntroKey);
    introClose.addEventListener("click", dismiss);
    introDismiss.addEventListener("click", dismiss);
    // Click-outside on backdrop also dismisses.
    introOverlay.addEventListener("click", (e) => {
      if (e.target === introOverlay) dismiss();
    });
  }
}
