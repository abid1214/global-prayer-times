# Global Prayer Times

A real-time, interactive 3D globe showing the five Shia (Ja'fari) prayer windows around the world. Drop a finger anywhere on Earth to see today's prayer schedule, a great-circle qibla line to Mecca, and which prayer is currently in effect.

Live: <https://abid1214.github.io/global-prayer-times/> *(once GitHub Pages is enabled on `master`)*

## What it does

- **Continuous shading** — each pixel of the globe is colored by computing the sun's altitude angle at that location and classifying which Ja'fari prayer window applies (Fajr, Dhuhr, Asr, Maghrib, Isha). The bands sweep across Earth in real time as the planet rotates.
- **Tap-anywhere prayer panel** — pick any point and get sunrise, all five prayer times in local timezone, the current prayer, and the qibla bearing. On mobile this is a swipe-down bottom sheet with a peek bar that remembers dismissal.
- **Time scrubber** — drag back or forward up to ±12 hours to see how the bands evolve.
- **Qibla great-circle line** — every selected location draws a line on the surface to Mecca, with a permanent gold marker at the Kaaba.
- **City search** — geocoded autocomplete for fast lookups.
- **Aqrab al-Bilād high-latitude handling** — above 60° N/S the per-pixel overlay fades out, and the side panel projects the schedule onto the nearest valid latitude (the dominant Shia ruling for polar regions per Sistani / Khamenei).
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

- **[Three.js](https://threejs.org/)** for the 3D globe (sphere geometry, OrbitControls, Line2 for the thick qibla arc).
- **GLSL fragment shader** (in `src/earthMaterial.js`) that classifies the prayer window per pixel — that's why the bands are smooth and continuous instead of a discretized grid.
- **[Adhan.js](https://github.com/batoulapps/adhan-js)** for prayer time calculations in the side panel.
- **[tz-lookup](https://github.com/darkskyapp/tz-lookup-oss)** to resolve IANA time zones from coordinates.
- A simplified NOAA solar algorithm (`src/solar.js`) for declination and subsolar longitude — accurate to ~0.01°.
- NASA Blue Marble texture (uniformly-lit composite) for the base earth.

## Methodology

The Ja'fari parameters used throughout:

| Prayer  | Threshold                                               |
| ------- | ------------------------------------------------------- |
| Fajr    | Sun 16° below the horizon (rising)                      |
| Dhuhr   | Solar noon (zawāl)                                      |
| Asr     | Shadow factor = 1 (Shāfi'ī convention)                  |
| Maghrib | Sun 4° below the horizon (setting) — eastern redness    |
| Isha    | Sun 14° below the horizon (setting)                     |

The **eastern-redness Maghrib** (4° below horizon, ~13 minutes after sunset) is the explicit Ja'fari distinction from Sunni Maghrib at sunset. The dedicated Asr time begins at shadow-factor 1; Dhuhr and Asr share their time after zawāl per the *al-Kāfī* tradition.

Above 60° N/S the standard altitude-based calculation can fail (no astronomical Fajr at summer solstice, no sunrise at all above the Arctic Circle), so the side-panel times are projected to 60° on the same longitude — the **Aqrab al-Bilād** ("nearest locality") ruling. The globe overlay fades out in that zone since per-pixel projection produces a meaningless kaleidoscope. See the in-app info modal for primary-source citations.

## Repository layout

```
index.html              — single-page entry, CDN importmap, info modal
styles.css              — desktop + responsive (≤768, ≤480, pointer:coarse)
src/
  main.js               — three.js scene, OrbitControls, render loop, click + search
  earthMaterial.js      — GLSL shader for prayer-window classification
  solar.js              — NOAA solar position math + per-pixel classifier
  prayer.js             — Adhan.js wrapper + Aqrab al-Bilād clamp
  panel.js              — bottom-sheet panel, peek bar, drag-to-dismiss
  search.js             — geocoded city autocomplete
```

## Performance notes

The render loop uses **dirty-flag rendering** — `renderer.render()` only fires when something actually changed (orbit input, scrubber, sun tick, animations). When the globe sits idle, GPU work drops to ~2 fps.

While the camera is moving (drag or damping settle), the renderer drops to 1× pixel ratio for a 4× pixel reduction on high-DPI phones; it bumps back to 2× the moment motion stops, so the resting frame is sharp. On touch devices, `backdrop-filter` is also disabled on overlay panels because re-blurring a constantly-redrawing canvas was the dominant compositor cost during a fling on iOS Safari.

## Credits

- NASA Blue Marble texture via the [`three-globe`](https://github.com/vasturiano/three-globe) example assets.
- Qur'ānic citations from the Hafs *muṣḥaf*; hadith citations from *al-Kāfī* (al-Kulaynī) and *Tahdhīb al-Aḥkām* (al-Ṭūsī).
