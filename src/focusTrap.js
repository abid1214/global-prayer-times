// Reusable focus trap for modal/dialog containers. Returns keydown/focusin
// handlers the caller wires to `document` while the dialog is open (and removes
// on close). Tab / Shift+Tab wrap between the first and last focusable; focusin
// is a safety net that pulls stray focus back inside. Escape handling stays with
// the caller (each dialog decides what Escape does).
//
// `getFocusables` defaults to a live query of the container; pass a fixed list
// for dialogs whose controls are known and stable (e.g. a two-button modal).
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function createFocusTrap(container, getFocusables) {
  const focusables = getFocusables || (() =>
    Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter((el) => !el.hidden && el.offsetParent !== null));

  function onKeydown(e) {
    if (e.key !== "Tab") return;
    const els = focusables();
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    const active = document.activeElement;
    const inside = container.contains(active);
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  }

  function onFocusIn(e) {
    if (container.contains(e.target)) return;
    const els = focusables();
    if (els.length) els[0].focus();
  }

  return { onKeydown, onFocusIn };
}
