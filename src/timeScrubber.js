// Time scrubber: owns scrub state + slider/live/mode controls. Scene-agnostic —
// fires onChange(); the caller reads effectiveNow()/isLive()/getDateOffsetMs().
// "h" scrubs the intra-day time (±12h), "d" scrubs the date (±183d); both
// offsets persist across mode toggles. The date axis counts whole calendar days
// (not fixed 24h) so the local time readout holds steady across DST changes.
// Range is ±183d — declination repeats annually, so every day stays reachable
// while the narrow slider keeps ~1 day/pixel instead of snapping between days.
const SCRUB_MODES = {
  h: { min: -720, max: 720, step: 5 }, // slider units = minutes
  d: { min: -183, max: 183, step: 1 }, // slider units = whole calendar days
};
const MS_PER_MIN = 60_000;

function shiftCalendarDays(ms, days) {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function createTimeScrubber({ onChange }) {
  let dayOffset = 0;    // whole calendar days, driven by "d" mode
  let timeOffsetMs = 0; // intra-day ms offset, driven by "h" mode
  let scrubMode = "h";
  // Set by init(); the render tick calls it so the live label tracks the wall clock.
  let refreshScrubLabel = () => {};

  const isLive = () => dayOffset === 0 && timeOffsetMs === 0;
  const effectiveNow = () => new Date(shiftCalendarDays(Date.now(), dayOffset) + timeOffsetMs);
  // Date-axis delta only (no intra-day offset); anchors the sun-path ring to the scrubbed date.
  function dateOffsetMs() {
    const now = Date.now();
    return shiftCalendarDays(now, dayOffset) - now;
  }

  function init() {
    const slider = document.getElementById("scrub");
    const live = document.getElementById("liveBtn");
    const label = document.getElementById("scrubLabel");
    const modeBtn = document.getElementById("scrubMode");

    // Two child spans (time over date); textContent only — no innerHTML.
    const timeEl = document.createElement("span");
    timeEl.className = "scrubTime";
    const dateEl = document.createElement("span");
    dateEl.className = "scrubDate";
    label.replaceChildren(timeEl, dateEl);

    const timeFmt = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", hour12: false });
    const dateFmt = new Intl.DateTimeFormat([], { weekday: "short", month: "short", day: "numeric" });
    function refreshLabel() {
      const at = effectiveNow();
      timeEl.textContent = timeFmt.format(at);
      dateEl.textContent = dateFmt.format(at);
    }
    refreshScrubLabel = refreshLabel;

    // Point the slider at the active mode's offset without disturbing either one.
    function syncSliderToMode() {
      const cfg = SCRUB_MODES[scrubMode];
      slider.min = String(cfg.min);
      slider.max = String(cfg.max);
      slider.step = String(cfg.step);
      slider.value = String(scrubMode === "h" ? Math.round(timeOffsetMs / MS_PER_MIN) : dayOffset);
    }

    modeBtn.addEventListener("click", () => {
      scrubMode = scrubMode === "h" ? "d" : "h";
      modeBtn.textContent = scrubMode;
      modeBtn.classList.toggle("date-mode", scrubMode === "d");
      modeBtn.title = scrubMode === "h" ? "Switch to date scrubbing" : "Switch to time scrubbing";
      modeBtn.setAttribute("aria-pressed", scrubMode === "d" ? "true" : "false");
      // Toggle only re-points the slider; both offsets are preserved, so no onChange.
      syncSliderToMode();
    });

    slider.addEventListener("input", () => {
      const units = parseInt(slider.value, 10);
      if (scrubMode === "h") timeOffsetMs = units * MS_PER_MIN;
      else dayOffset = units;
      refreshLabel();
      live.classList.toggle("active", isLive());
      onChange();
    });

    live.addEventListener("click", () => {
      dayOffset = 0;
      timeOffsetMs = 0;
      syncSliderToMode();
      refreshLabel();
      live.classList.add("active");
      onChange();
    });

    // Initial paint.
    modeBtn.textContent = scrubMode;
    modeBtn.title = "Switch to date scrubbing";
    modeBtn.setAttribute("aria-pressed", "false");
    syncSliderToMode();
    refreshLabel();
    live.classList.toggle("active", isLive());
  }

  return {
    init,
    effectiveNow,
    isLive,
    getDateOffsetMs: dateOffsetMs,
    refreshLabel: () => refreshScrubLabel(),
  };
}
