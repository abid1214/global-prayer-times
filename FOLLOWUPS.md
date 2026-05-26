# Follow-ups

Carried-forward design questions and known imperfections that are
deliberately deferred. Sorted newest first. Each entry should name
the stage that surfaced it and the proposed disposition.

## Stage 2.x / future

- **Reconsider `snapToNearestHighLatCity` constraint.** Sistani §2032
  may admit a less aggressive projection (target = user lat minus
  epsilon, find nearest city where Fajr/Isha resolve on this date)
  instead of always projecting to the cap edge and snapping
  equator-ward. The current strict `c.lat ≤ projectedFromLat`
  constraint sends users farther south than necessary in shoulder
  seasons — e.g., Tromsø in June resolves to Prague rather than
  Bergen/Oslo (both excluded: Bergen by the ±5° longitude window,
  Oslo by being north of the cap-edge target). Surfaced in Stage 1.3
  review.

- **Per-prayer `endOfNightSource` in methods 4/5.** `combineSources()`
  collapses last-night and this-night anchors into a single
  conservative label. Inside the cap, today's Fajr is unreachable
  by definition, so the combined label is always `sunrise-fallback`
  even when this-night's Isha is genuinely Fajr-anchored (cap-edge
  exit days). Consider exposing `endOfNightSourceFajr` and
  `endOfNightSourceIsha` so the panel can show the per-prayer truth.
  Surfaced in Stage 1.4 acceptance writing (the spec's case 6 was
  unverifiable through the public API for this reason).

- **Remove or downgrade the `[prayer] endOfNight` session warn.**
  Diagnostic canary added in Stage 1.2 for catching cap-edge
  surprises. Once Natural Earth expansion (Stage 3.1) lands and the
  cap-related geometry stabilises, consider removing this — or
  promoting it to a structured diagnostic on the result object
  rather than a console emission.
