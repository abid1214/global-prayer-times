// Time scrubber: owns scrub state + slider/live/mode controls. Scene-agnostic —
// fires onChange(); the caller reads effectiveNow()/isLive()/getMode()/
// getOffsetMs(). Modes: "h" = ±12h step 5min; "d" = ±366d step 1day.
const SCRUB_MODES = {
  h: { min: -720, max: 720, step: 5, msPerUnit: 60_000 },
  d: { min: -366, max: 366, step: 1, msPerUnit: 86_400_000 },
};

export function createTimeScrubber({ onChange }) {
  let scrubOffsetMs = 0;
  let scrubLive = true;
  let scrubMode = "h";
  // Set by init(); the render tick calls it so the date label tracks the wall clock.
  let refreshScrubLabel = () => {};

  const effectiveNow = () => new Date(Date.now() + scrubOffsetMs);

  function init() {
    const slider = document.getElementById("scrub");
    const live = document.getElementById("liveBtn");
    const label = document.getElementById("scrubLabel");
    const modeBtn = document.getElementById("scrubMode");

    function fmtTimeOffset(ms) {
      if (Math.abs(ms) < 30 * 1000) return "now";
      const sign = ms >= 0 ? "+" : "−";
      const abs = Math.abs(ms);
      const h = Math.floor(abs / 3600000);
      const m = Math.round((abs - h * 3600000) / 60000);
      if (h === 0) return `${sign}${m}m`;
      return `${sign}${h}h ${String(m).padStart(2, "0")}m`;
    }

    const dateFmt = new Intl.DateTimeFormat([], { month: "short", day: "numeric" });
    function fmtDateOffset(ms) {
      if (Math.abs(ms) < 86_400_000 / 2) return "today";
      return dateFmt.format(new Date(Date.now() + ms));
    }

    function refreshLabel() {
      label.textContent = scrubMode === "h" ? fmtTimeOffset(scrubOffsetMs) : fmtDateOffset(scrubOffsetMs);
    }
    refreshScrubLabel = refreshLabel;

    function applyMode() {
      const cfg = SCRUB_MODES[scrubMode];
      slider.min = String(cfg.min);
      slider.max = String(cfg.max);
      slider.step = String(cfg.step);
      slider.value = "0";
      scrubOffsetMs = 0;
      scrubLive = true;
      live.classList.add("active");
      modeBtn.textContent = scrubMode;
      modeBtn.classList.toggle("date-mode", scrubMode === "d");
      modeBtn.title = scrubMode === "h" ? "Switch to date scrubbing" : "Switch to time scrubbing";
      modeBtn.setAttribute("aria-pressed", scrubMode === "d" ? "true" : "false");
      refreshLabel();
      onChange();
    }

    modeBtn.addEventListener("click", () => {
      scrubMode = scrubMode === "h" ? "d" : "h";
      applyMode();
    });

    slider.addEventListener("input", () => {
      const units = parseInt(slider.value, 10);
      scrubOffsetMs = units * SCRUB_MODES[scrubMode].msPerUnit;
      scrubLive = scrubOffsetMs === 0;
      refreshLabel();
      live.classList.toggle("active", scrubLive);
      onChange();
    });

    live.addEventListener("click", () => {
      slider.value = "0";
      scrubOffsetMs = 0;
      scrubLive = true;
      refreshLabel();
      live.classList.add("active");
      onChange();
    });

    // Initial state — mirrors applyMode without resetting scrub state.
    modeBtn.textContent = scrubMode;
    modeBtn.title = "Switch to date scrubbing";
    modeBtn.setAttribute("aria-pressed", "false");
    refreshLabel();
    live.classList.add("active");
  }

  return {
    init,
    effectiveNow,
    isLive: () => scrubLive,
    getMode: () => scrubMode,
    getOffsetMs: () => scrubOffsetMs,
    refreshLabel: () => refreshScrubLabel(),
  };
}
