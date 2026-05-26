# Global Prayer Times

A real-time, interactive 3D globe showing the five Shia (Ja'fari) prayer windows around the world. Drop a finger anywhere on Earth to see today's prayer schedule, a great-circle qibla line to Mecca, and which prayer is currently in effect.

Live: <https://abid1214.github.io/global-prayer-times/> *(once GitHub Pages is enabled in repo settings)*

## What it does

- **Continuous shading** — each pixel of the globe is colored by computing the sun's altitude angle at that location and classifying which Ja'fari prayer window applies (Fajr, Dhuhr, Asr, Maghrib, Isha). The bands sweep across Earth in real time as the planet rotates.
- **Tap-anywhere prayer panel** — pick any point and get sunrise, all five prayer times in local timezone, the current prayer, and the qibla bearing. On mobile this is a swipe-down bottom sheet with a peek bar that remembers dismissal.
- **Time scrubber** — drag back or forward up to ±12 hours to see how the bands evolve.
- **Qibla great-circle line** — every selected location draws a line on the surface to Mecca, with a permanent gold marker at the Kaaba.
- **City search** — geocoded autocomplete for fast lookups.
- **Selectable high-latitude method** — inside the polar caps (where the standard altitude-based calculation can't compute one or more prayer times) the app projects, snaps, or substitutes per the user's choice from six methods (aqrab al-bilād — same longitude / nearest city; aqrab al-awqāt; niṣf al-layl; sub'iyya; angle-based with seasonal reduction). Settings gear in the top-right; choice persists in localStorage. See [High-latitude methods](#high-latitude-methods) below.
- **Citation-grounded info modal** — every prayer's astronomical definition is paired with its primary Qur'ānic verse and a hadith from *al-Kāfī* or *Tahdhīb al-Aḥkām*.

## Run locally

It's a static site with no build step. From the repo root:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

(Or `npx serve .`, or any other static server.)

The dependencies (`three`, `three/addons`, `adhan`, `tz-lookup`) are loaded from CDNs via an `<script type="importmap">` block in `index.html`. No `npm install` needed.

To install on a phone as a fullscreen app, open the page in Safari → Share → "Add to Home Screen". The PWA meta tags will launch it without the URL bar.

## Tech stack

- **[Three.js](https://threejs.org/)** for the 3D globe (sphere geometry, custom quaternion-based GlobeControls in `src/globeControls.js`, Line2 for the thick qibla arc).
- **GLSL fragment shader** (in `src/earthMaterial.js`) that classifies the prayer window per pixel — that's why the bands are smooth and continuous instead of a discretized grid.
- **[Adhan.js](https://github.com/batoulapps/adhan-js)** for prayer time calculations in the side panel.
- **[tz-lookup](https://github.com/darkskyapp/tz-lookup-oss)** to resolve IANA time zones from coordinates.
- A simplified NOAA solar algorithm (`src/solar.js`) for declination and subsolar longitude — accurate to ~0.01°.
- NASA Blue Marble texture (uniformly-lit composite) for the base earth.

## Methodology

The Ja'fari parameters used throughout. Two presets are selectable from the settings gear (the **Marjaʿ / Calculation method** section); the table below shows the default (Leva Qom / Sistani-aligned):

| Prayer  | Threshold (Leva Qom default)                            | Tehran preset alternative |
| ------- | ------------------------------------------------------- | ------------------------- |
| Fajr    | Sun 16° below the horizon (rising)                      | 17.7°                     |
| Dhuhr   | Solar noon (zawāl)                                      | (same)                    |
| Asr     | Shadow factor = 1 (Shāfi'ī convention)                  | (same)                    |
| Maghrib | Sun 4° below the horizon (setting) — eastern redness    | 4.5°                      |
| Isha    | Sun 14° below the horizon (setting)                     | (same)                    |

The **eastern-redness Maghrib** (4° below horizon, ~13 minutes after sunset under Leva Qom) is the explicit Ja'fari distinction from Sunni Maghrib at sunset.

**Sunrise/sunset use the apparent horizon (−0.833°)** — atmospheric refraction (~34′) + solar semi-diameter (~16′) — matching adhan.js. The other four thresholds (Fajr at −16°, Maghrib at −4°, Isha at −14°, Asr at shadow-factor 1) are taken geometrically, again matching adhan.js: refraction is negligible at those depths. See the commit message on `bf85d01` for the per-threshold audit.

**Shar'ī midnight** (the moment Isha's *waqt* ends) is computed as the midpoint of (Maghrib at −4°, next Fajr at −16°), the canonical Ja'fari definition per Sistani / Khamenei tawḍīḥ. This determines when `classifyPrayer` switches from the afternoon branch (Asr → Maghrib → Isha) to the morning branch (Fajr → Sunrise). The same anchoring is used by the high-latitude methods 4 (niṣf al-layl), 5 (sub'iyya), and 6 (angle-based with seasonal reduction) — with a documented sunrise fallback when Fajr is physically unreachable at the user's latitude/date; see [High-latitude methods](#high-latitude-methods).

### Bands vs panel times: faḍīla vs waqt

The colored bands on the globe and the times in the side panel both use the same five thresholds (−16°, *zawāl*, shadow-factor 1, −4°, −14°). For **Fajr, Dhuhr, and Maghrib** these coincide with *waqt* (validity) entry. For **Asr and Isha** they are the **preferred (*faḍīla*) start times** — *waqt* itself enters earlier:

- Asr's *waqt* enters shortly after *zawāl*, as soon as Dhuhr's brief exclusive interval ends.
- Isha's *waqt* enters shortly after Maghrib, as soon as Maghrib's brief exclusive interval ends.

The colored bands therefore depict *faḍīla* windows; an Asr or Isha prayer offered slightly earlier than its colored band is still valid. The in-app info modal cites primary sources (Qur'ān, *al-Kāfī*, *Tahdhīb al-Aḥkām*) for both the *waqt* and *faḍīla* readings.

## High-latitude methods

Above a sun-relative latitude threshold, the standard altitude-based calculation can't compute one or more prayer times. Two failure modes:

| Failure mode | Condition | Why it fails |
| --- | --- | --- |
| **Fajr-cap** | <code>\|φ + δ\| > 74°</code> | Sun never reaches Fajr's −16° threshold (90° − 16°). |
| **Polar-night cap** | <code>\|φ − δ\| > 90.833°</code> | Sun never crosses the apparent horizon (−50′, matches adhan.js). |

Whichever boundary trips first per hemisphere defines the cap edge for that date. The projection target is pulled inward by a 0.05° safety margin to keep adhan.js's `correctedHourAngle` clear of its `cosH = ±1` singularity (see `SAFE_MARGIN_DEG` in `src/prayer.js`).

Inside the cap, six methods are selectable via the settings gear. The choice persists in localStorage; a `?m=<method>` URL parameter takes precedence at load (read once, never written back) so a "share this view with method X" link works without overwriting the recipient's persisted preference.

| # | Method | What it does | When it's a good fit |
| --- | --- | --- | --- |
| 1 | **Aqrab al-bilād — same longitude** | Compute the schedule at the nearest valid latitude on the user's same longitude. Preserves local solar time exactly. | The most common implementation in Shia-focused apps. May project into ocean or uninhabited terrain (e.g., Svalbard winter → Norwegian interior); a console.warn fires when the projection is > 200 km from any city in our table. |
| 2 | **Aqrab al-bilād — nearest city** *(default)* | Snap to the nearest populated city within ±5° longitude that has valid times; fall back to same-longitude if none in window. | Closer to the *fuqahā'*'s likely intent (*balad* = populated locality) — and the verbatim Sistani §2032 ruling for high latitudes ("the closest city that has night and day in a twenty-four hour period"). The pin moves to the city — that's where the schedule actually came from. |
| 3 | **Aqrab al-awqāt** | Walk backward day-by-day from today (up to 90 days) until a date is found when the sun reached all five prayer thresholds at your actual location. Falls back to method 4 (niṣf al-layl) if no valid day in 90 days. | The most location-faithful option in summer regimes where only Fajr/Isha are missing. Side panel notes which historical date is in use. |
| 4 | **Niṣf al-layl — middle of night** | Define night as (Maghrib → next Fajr); Isha and Fajr fold to the midpoint. When the next Fajr isn't physically reachable (sun never reaches −16° at this latitude/date), falls back to next sunrise — the panel marks the substitution. | The Ja'farī rendering of the classic high-latitude rule. Matches the canonical shar'ī midnight (½(Maghrib + next Fajr)) used elsewhere in the app. In deep polar summer Isha and Fajr collapse to the same instant — the panel displays them as such. |
| 5 | **Sub'iyya — one-seventh** | Night = (Maghrib → next Fajr). Isha at first 1/7 past Maghrib; Fajr at last 1/7 before end-of-night. Sunrise fallback when Fajr is unresolvable, surfaced in the panel. | Symmetric, predictable, used by several Sunni and Shia conventions. Diverges from adhan.js's `HighLatitudeRule.SeventhOfTheNight` (sunrise-anchored) to match the Ja'farī shar'ī-midnight definition. |
| 6 | **Angle-based with seasonal reduction** | Use the standard −16° / −14° when the sun reaches them; otherwise reduce to whatever the sun actually achieves at solar midnight, so Fajr and Isha are always defined. | Converges to the standard rule when conditions allow; converges to niṣf al-layl (next-Fajr anchored) in deep polar summer. |

### Why methods 2–6 don't update the shader

The colored bands inside the cap **always render via same-longitude projection (method 1's geometry) regardless of the user's choice**. This is deliberate. Per-pixel shader implementations of the other methods would either need data the shader can't carry (a city table in GLSL for method 2), be per-location (method 3's historical date), or require running adhan-equivalent date math per pixel (methods 4–6). Rather than render a method-specific approximation that lies, the shader sticks with same-longitude and the panel's descriptor line surfaces the actual schedule source.

For methods 2–6 the visualization and the panel times therefore *disagree by design*. The panel's descriptor line (e.g., `Method: aqrab al-bilād · times from Murmansk`) is the canonical reading of what the side panel reflects; the cap visualization is informational geometry only. The docblock in `src/earthMaterial.js` and the `classifyByClock` comment in `src/prayer.js` carry the same explanation at the source-code level — a `tests/classifierAgreement.html` fixture asserts the two classifiers agree for methods 1 and 2 (where the shader and panel share semantics) and exercises methods 3–6 without asserting agreement.

## Repository layout

```
index.html              — single-page entry, CDN importmap, info modal, settings slide-over
styles.css              — desktop + responsive (≤768, ≤480, pointer:coarse)
src/
  main.js               — three.js scene, render loop, click + search
  globeControls.js      — quaternion-based drag/zoom/pinch controls (replaces OrbitControls)
  earthMaterial.js      — GLSL shader for prayer-window classification + cap derivation
  solar.js              — NOAA solar position math + per-pixel classifier
  prayer.js             — adhan.js wrapper, six high-latitude methods, clock classifier
  panel.js              — bottom-sheet panel, peek bar, drag-to-dismiss, method descriptor
  search.js             — geocoded city autocomplete
  settings.js           — persisted method choice (localStorage + ?m= URL)
  settingsPanel.js      — gear slide-over / bottom-sheet, swipe-down dismiss
  highLatCities.js      — populated-place lookup for nearest-city snap + remote-projection warn
  data/
    highLatCities.js    — curated city table (|lat| ≥ 50°); TODO: swap in Natural Earth
tests/
  classifierAgreement.html  — open in browser; asserts classifier agreement for methods 1 and 2 (aqrab same-longitude + nearest-city)
  classifierAgreement.test.js
```

## Known limitations

Three deliberate trade-offs worth surfacing so future contributors don't unwittingly "fix" them and rediscover why they were deferred.

### Curated city table (~80 entries)

`src/data/highLatCities.js` is a hand-picked subset of well-known cities at \|lat\| ≥ 50°, not a complete dataset. The TODO at the top of the file points at swapping in Natural Earth `ne_10m_populated_places` filtered/capped at build time. Until that happens:

- The **"aqrab al-bilād — nearest city"** method (method 2) may snap to a less-prominent city or fall back to same-longitude when no listed city is in the ±5° longitude window.
- The **>200 km remote-projection `console.warn`** over-fires in sparsely-tabled regions (central Siberia, interior Canada, parts of Scandinavia north of the curated belt). Annoying in console logs but informative — it's accurate to "200 km from the nearest tabled city," not "200 km from the nearest real settlement."

### Pin tooltip deferred

The teal projection pin doesn't have a hover/tap label. The pin's *position* already carries the spatial information (where the schedule was computed), and the **panel descriptor line** carries the nominal information (`Method: aqrab al-bilād · times from Murmansk`). A tooltip would duplicate one or the other. If added later, do it as a general pin-tooltip feature so methods 1 and 2 both benefit, not a method-specific patch.

### Panel times don't re-render with the scrubber

The side panel's prayer times are computed once at panel-open time and stay frozen — moving the scrubber updates the globe coloring and the projection pin, but not the panel. The TODO marker at the scrubber callback in `src/main.js` documents this. Re-rendering on every scrubber tick would require either (a) a debounced tz-aware re-resolve or (b) caching tz per location; both have their own complications. Left for a future revisit when there's actual demand.

## Performance notes

The render loop uses **dirty-flag rendering** — `renderer.render()` only fires when something actually changed (orbit input, scrubber, sun tick, animations). When the globe sits idle, GPU work drops to ~2 fps.

While the camera is moving (drag or damping settle), the renderer drops to 1× pixel ratio for a 4× pixel reduction on high-DPI phones; it bumps back to 2× the moment motion stops, so the resting frame is sharp. On touch devices, `backdrop-filter` is also disabled on overlay panels because re-blurring a constantly-redrawing canvas was the dominant compositor cost during a fling on iOS Safari.

## Recent changes

- **Default high-latitude method changed from Method 1 (same-longitude) to Method 2 (nearest city)** per Sistani §2032 verbatim ("Muslims should rely on the timings of the closest city that has night and day in a twenty-four hour period"). Existing users with `polar_method` set in localStorage retain their preference; only fresh visitors see the new default.
- **Methods 4 / 5 / 6 now anchor "end of night" on next Fajr** (the canonical Ja'farī shar'ī midnight, ½(Maghrib + next Fajr)) instead of next sunrise. When Fajr is physically unreachable at the user's latitude/date the sunrise fallback still applies and the panel discloses it ("end of night derived from next sunrise"). Existing share-links (`?m=4|5|6`) continue to work; only the anchor changed.
- **Marjaʿ / Calculation Method selector** — Leva Qom (Sistani-aligned, default, 16° / 4° / 14°) and Tehran (Khamenei-aligned, 17.7° / 4.5° / 14°) are both selectable via the settings gear. Persists in `localStorage` under `gpt.preset`; URL `?preset=jafari|tehran` is read once for share-links.

## Credits

- NASA Blue Marble texture via the [`three-globe`](https://github.com/vasturiano/three-globe) example assets.
- Qur'ānic citations from the Hafs *muṣḥaf*; hadith citations from *al-Kāfī* (al-Kulaynī) and *Tahdhīb al-Aḥkām* (al-Ṭūsī).
