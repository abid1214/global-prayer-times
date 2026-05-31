// Settings slide-over: open/close + the method/preset radios. The radios call
// setMethod/setPreset, which fan out to panel.js + main.js for live re-render.

import { POLAR_METHODS, getMethod, setMethod, PRESET_ORDER, getPreset, setPreset } from "./settings.js";
import { createFocusTrap } from "./focusTrap.js";

const overlay = document.getElementById("settingsOverlay");
const panel   = document.getElementById("settingsPanel");
const openBtn = document.getElementById("settingsBtn");
const closeBtn = document.getElementById("settingsClose");
const backdrop = document.getElementById("settingsBackdrop");
const handle  = document.getElementById("settingsHandle");
const radios  = document.querySelectorAll('input[name="polarMethod"]');
const presetRadios = document.querySelectorAll('input[name="preset"]');

// Tab cycling + focusin safety net live in focusTrap.js; Escape via onKey below.
const settingsTrap = createFocusTrap(panel);

// State guarding rapid open/close cycles against leaks/races:
//   pendingHide   — transitionend + safety-timeout that hides the overlay after slide-out
//   openRaf       — RAF that adds .open after layout commits
//   isOpen        — guards open()/close() against duplicate work
//   previousFocus — element to restore focus to on close (aria-modal)
let pendingHide = null;
let openRaf = null;
let isOpen = false;
let previousFocus = null;
// Bottom-sheet drag state, up here so close() can cancel a mid-drag dismissal
// (else the inline transform would override the CSS slide-out).
let drag = null;

function open() {
  if (isOpen) return;
  isOpen = true;
  if (pendingHide) { pendingHide.cancel(); pendingHide = null; }
  previousFocus = document.activeElement;
  overlay.hidden = false;
  openBtn.setAttribute("aria-expanded", "true");
  // Let layout commit hidden=false before adding .open so the transition fires.
  openRaf = requestAnimationFrame(() => {
    openRaf = null;
    overlay.classList.add("open");
    closeBtn.focus();
  });
  document.addEventListener("keydown", onKey);
  document.addEventListener("focusin", settingsTrap.onFocusIn);
}

function close() {
  if (!isOpen) return;
  isOpen = false;
  // If .open was never added (close beats the RAF) there's no slide-out to await,
  // so hide immediately below — else the backdrop briefly blocks globe clicks.
  const wasVisuallyOpen = overlay.classList.contains("open");
  if (openRaf !== null) { cancelAnimationFrame(openRaf); openRaf = null; }
  // close() mid-drag: cancel it and clear the inline transform so CSS can run.
  if (drag) {
    releasePointerCaptureSafe(drag.pointerId);
    panel.classList.remove("dragging");
    drag = null;
  }
  panel.style.transform = "";
  overlay.classList.remove("open");
  openBtn.setAttribute("aria-expanded", "false");
  document.removeEventListener("keydown", onKey);
  document.removeEventListener("focusin", settingsTrap.onFocusIn);
  // Hide after the slide-out (transitionend, + safety timeout for the
  // no-transition case); hide immediately if there was no transition to await.
  if (pendingHide) pendingHide.cancel();
  if (wasVisuallyOpen) {
    pendingHide = scheduleHide();
  } else {
    overlay.hidden = true;
    pendingHide = null;
  }
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
    // Only the transform transitionend signals the slide-out completed.
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
  settingsTrap.onKeydown(e);
}

// Capture may already be released (e.g. pointercancel), where the call throws — swallow it.
function releasePointerCaptureSafe(pointerId) {
  if (pointerId == null) return;
  try { handle.releasePointerCapture(pointerId); } catch (_) {}
}

openBtn.addEventListener("click", open);
closeBtn.addEventListener("click", close);
backdrop.addEventListener("click", close);

// Swipe-down to dismiss on mobile (handle is display:none on desktop, so inert
// there). Mirrors the prayer panel's gesture. pointerId is stored so close()/
// endDrag can release capture after an Escape mid-drag.
handle.addEventListener("pointerdown", (e) => {
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
    // Clear the inline transform before close() so the CSS slide-out can run.
    panel.style.transform = "";
    close();
  } else {
    panel.style.transform = "";
  }
  drag = null;
}
handle.addEventListener("pointerup",     () => endDrag(true));
handle.addEventListener("pointercancel", () => endDrag(false));

// Check the persisted value, persist user changes via setValue() (fans out to
// panel.js/main.js), and fail loudly if a DOM radio value is outside `known`.
function initRadioGroup(group, current, setValue, known, label) {
  for (const r of group) {
    if (r.value === current) r.checked = true;
    r.addEventListener("change", (e) => {
      if (e.target.checked) setValue(e.target.value);
    });
    if (!known.has(r.value)) {
      console.error(`[settingsPanel] unknown ${label} value in DOM: "${r.value}"`);
    }
  }
}

initRadioGroup(radios, getMethod(), setMethod, new Set(Object.values(POLAR_METHODS)), "polar method");
initRadioGroup(presetRadios, getPreset(), setPreset, new Set(PRESET_ORDER), "preset");

// One-time first-run intro for the preset choice; its localStorage flag is
// independent of the preset value so existing users see it once. try/catch
// guards private-mode localStorage rejection.
const PRESET_INTRO_SEEN_KEY = "gpt.presetIntroSeen";
const introOverlay = document.getElementById("presetIntroOverlay");
const introClose   = document.getElementById("presetIntroClose");
const introDismiss = document.getElementById("presetIntroDismiss");
if (introOverlay && introClose && introDismiss) {
  let seen = false;
  try { seen = localStorage.getItem(PRESET_INTRO_SEEN_KEY) === "1"; } catch (_) {}
  if (!seen) {
    introOverlay.hidden = false;
    const introPreviousFocus = document.activeElement; // restore on dismiss
    // Focus the dismiss button after layout commits; cancellable so a fast
    // close doesn't pull focus back into a now-hidden modal.
    let introFocusRaf = requestAnimationFrame(() => {
      introFocusRaf = null;
      if (!introOverlay.hidden) introDismiss.focus();
    });
    // Two-button modal (× and Got it): reuse the shared focus trap with a fixed
    // focusable list. Escape (handled here) dismisses; Tab cycling + the focusin
    // safety net come from focusTrap.js.
    const introTrap = createFocusTrap(introOverlay, () => [introClose, introDismiss]);
    const onIntroKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); dismiss(); return; }
      introTrap.onKeydown(e);
    };
    const dismiss = () => {
      // Cancel the pending focus RAF so it can't focus into the hidden modal.
      if (introFocusRaf !== null) {
        cancelAnimationFrame(introFocusRaf);
        introFocusRaf = null;
      }
      introOverlay.hidden = true;
      document.removeEventListener("keydown", onIntroKey);
      document.removeEventListener("focusin", introTrap.onFocusIn);
      try { localStorage.setItem(PRESET_INTRO_SEEN_KEY, "1"); } catch (_) {}
      if (introPreviousFocus && typeof introPreviousFocus.focus === "function") {
        introPreviousFocus.focus();
      }
    };
    document.addEventListener("keydown", onIntroKey);
    document.addEventListener("focusin", introTrap.onFocusIn);
    introClose.addEventListener("click", dismiss);
    introDismiss.addEventListener("click", dismiss);
    introOverlay.addEventListener("click", (e) => {
      if (e.target === introOverlay) dismiss();
    });
  }
}
