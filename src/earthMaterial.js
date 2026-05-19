import * as THREE from "three";

const VERT = /* glsl */ `
  varying vec3 vNormalLocal;

  void main() {
    vNormalLocal = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D dayMap;
  uniform vec3 sunDir;
  uniform float decl;
  uniform float prayerOpacity;
  uniform float dayBoost;
  uniform float prayerEnabled;

  // per-prayer visibility toggles (0 or 1)
  uniform float enFajr;
  uniform float enDhuhr;
  uniform float enAsr;
  uniform float enMaghrib;
  uniform float enIsha;

  uniform vec3 cFajr;
  uniform vec3 cDhuhr;
  uniform vec3 cAsr;
  uniform vec3 cMaghrib;
  uniform vec3 cIsha;

  varying vec3 vNormalLocal;

  const float PI = 3.14159265359;
  const float TWO_PI = 6.28318530718;
  const float FAJR_ANGLE = -16.0 * PI / 180.0;
  const float MAGHRIB_ANGLE = -4.0 * PI / 180.0;
  const float ISHA_ANGLE = -14.0 * PI / 180.0;
  // Apparent horizon = -50' = -0.833°, matching Adhan.js's sunrise/sunset
  // convention (atmospheric refraction ~34' + solar semi-diameter ~16').
  // Adhan applies this offset ONLY to sunrise/sunset; Fajr (-16°),
  // Maghrib (-4°), and Isha (-14°) are taken at face value (refraction
  // is negligible at those depths). Mirrored in src/solar.js's
  // APPARENT_HORIZON constant.
  const float APPARENT_HORIZON = -50.0 / 60.0 * PI / 180.0;

  vec4 sampleEquirect(sampler2D tex, vec3 dir) {
    float lat = asin(clamp(dir.y, -1.0, 1.0));
    float lon = atan(-dir.z, dir.x);
    vec2 uv = vec2(lon / TWO_PI + 0.5, lat / PI + 0.5);
    return texture2D(tex, uv);
  }

  void main() {
    vec3 n = normalize(vNormalLocal);
    vec3 sd = normalize(sunDir);

    float lat  = asin(clamp(n.y, -1.0, 1.0));
    float lonP = atan(-n.z, n.x);

    // Aqrab al-Bilād: above the latitude where the altitude-based Ja'fari
    // calculation breaks down, this pixel uses the prayer schedule of its
    // projection point — the nearest valid latitude on the same longitude.
    //
    // ---- Derivation of the two failure modes ----
    //
    // Sun altitude at hour angle H, latitude φ, declination δ:
    //   sin(α) = sin(φ)·sin(δ) + cos(φ)·cos(δ)·cos(H)
    //
    // (a) Fajr-cap: sun never reaches the Fajr threshold (-16°).
    //   α_min occurs at H = π (solar antimeridian):
    //     sin(α_min) = sin(φ)·sin(δ) - cos(φ)·cos(δ) = -cos(φ + δ)
    //     α_min     = -(π/2 - |φ + δ|)  = |φ + δ| - π/2
    //   Sun reaches -16° iff α_min ≤ -16°, i.e. |φ + δ| ≤ 90° - 16° = 74°.
    //   So Fajr fails when |φ + δ| > 74°. Adhan.js uses -16° geometric
    //   (no refraction), so 74° matches Adhan exactly.
    //
    // (b) Polar-night cap: sun never crosses the (apparent) horizon.
    //   α_max occurs at H = 0 (transit):
    //     sin(α_max) = cos(φ - δ)
    //     α_max     = π/2 - |φ - δ|
    //   Adhan.js defines sunrise/sunset at α = -0.833° = -50' (atmospheric
    //   refraction ~34' + solar semi-diameter ~16'), so the sun crosses
    //   the horizon iff α_max ≥ -0.833°, i.e. |φ - δ| ≤ 90° + 50' =
    //   90.833°. So polar night kicks in when |φ - δ| > 90.833°.
    //
    //   Using the geometric horizon (0°) instead — as we used to —
    //   triggers the cap ~50 arcminutes too early in latitude, which at
    //   φ ≈ 68°N means ~7 days too early in autumn and ~7 days too late
    //   in spring (≈ 14 days/year disagreement with what Adhan actually
    //   returns). See refraction audit in commit message.
    //
    // The cap is whichever kicks in first per hemisphere. Seasonal tilt
    // of the cap visualization follows from the ±δ terms: as decl
    // swings ±23.4° over the year, the north cap threshold sweeps
    // between min(74-23.4, 90.833-23.4) = 50.6°N (summer, Fajr-cap
    // dominates) and min(74+23.4, 90.833+23.4) = 97.4° clipped to the
    // polar-night-dominated regime → effective 67.4°N (winter), with
    // the dominant mode switching around |δ| ≈ 8°.
    //
    // Intentionally NOT branching on the user's polar-method setting (see
    // POLAR_METHODS in src/settings.js): the visual cap always uses
    // same-longitude projection regardless of which method drives the
    // side-panel times. The other methods (nearest-city, aqrab al-awqāt,
    // midnight, seventh, angle-reduced) don't have a clean per-pixel
    // shader equivalent — nearest-city would need a city table in GLSL,
    // aqrab al-awqāt's historical date is per-location, midnight/seventh
    // depend on the pixel's own night length. Rather than render a
    // method-specific approximation that lies, the shader sticks with
    // same-longitude projection and the panel's descriptor line surfaces
    // the divergence (see describePolarMethod in src/panel.js).
    const float FAJR_LIMIT = 74.0 * PI / 180.0;                 // Fajr fails beyond this
    const float DAY_LIMIT  = (90.0 + 50.0 / 60.0) * PI / 180.0; // polar night beyond this (apparent horizon)
    // Cap membership uses the TRUE threshold (matches aqrabProjection
    // in src/prayer.js exactly). SAFE_MARGIN — see SAFE_MARGIN_DEG
    // comment in src/prayer.js — applies ONLY to the projection target
    // when we ARE in the cap, giving Adhan numerical room from the
    // cosH=±1 singularity without expanding the cap into latitudes
    // where the standard calc still works.
    const float SAFE_MARGIN = 0.05 * PI / 180.0;
    float northTrue = min(FAJR_LIMIT - decl, DAY_LIMIT + decl);
    float southTrue = max(-FAJR_LIMIT - decl, -DAY_LIMIT + decl);
    // effLat C⁰-jumps by SAFE_MARGIN at the threshold (~5.5 km / sub-
    // pixel at any reasonable zoom); the ~5° smoothstep bands on each
    // prayer window below absorb that step in the rendered band shapes.
    float effLat = lat;
    if (lat > northTrue) effLat = northTrue - SAFE_MARGIN;
    else if (lat < southTrue) effLat = southTrue + SAFE_MARGIN;
    // Effective normal at (effLat, lonP). Below the cap this equals n; inside
    // the cap it's the normal of the projection point, so all sun-relative
    // math below (altitude, asr, midnight) reflects the projected schedule.
    float cosEff = cos(effLat);
    float sinEff = sin(effLat);
    vec3 effN = vec3(cosEff * cos(lonP), sinEff, -cosEff * sin(lonP));

    float sinAlt = clamp(dot(sd, effN), -1.0, 1.0);
    float alt = asin(sinAlt);

    float diff = effLat - decl;
    float zenithDiff = clamp(sqrt(diff * diff + 0.0005), 0.0, 1.4);
    float altAsr = atan(1.0 / (1.0 + tan(zenithDiff)));

    // Wide smoothing band (~5° arc) on each threshold
    const float B = 0.09;

    float wFajr = smoothstep(FAJR_ANGLE - B, FAJR_ANGLE + B, alt);
    float wIsha = smoothstep(ISHA_ANGLE - B, ISHA_ANGLE + B, alt);
    float wMag  = smoothstep(MAGHRIB_ANGLE - B, MAGHRIB_ANGLE + B, alt);
    float wHor  = smoothstep(APPARENT_HORIZON - B, APPARENT_HORIZON + B, alt);
    float wAsr  = smoothstep(altAsr - B, altAsr + B, alt);

    // Shar'ī midnight = midpoint of the night (Maghrib → next-day Fajr),
    // per the canonical Ja'fari definition. Anchored on Maghrib (-4°,
    // disappearance of the eastern redness) rather than geometric
    // sunset (0°): the rest of the app already takes the Ja'fari -4°
    // reading for Maghrib, so anchoring midnight to it removes the
    // single place this classifier previously used Sunni-convention
    // (sunset-anchored) midnight. Solved in closed form from each
    // pixel's hour angle so the cutoff is exact, not the antisolar-
    // meridian approximation. Equation of time is baked into sunDir
    // already (see sunPosition() in solar.js), so the subsolar
    // longitude derived here carries the correction implicitly.
    //   H_mag  = Maghrib hour-angle (alt = -4° going down)
    //   H_fajr = Fajr hour-angle    (alt = -16° going up next morning)
    //   H_mid  = π + (H_mag - H_fajr) / 2  — earlier than solar midnight
    //            because the night is asymmetric (Maghrib at -4°, dawn
    //            at -16°).
    float lonS   = atan(-sd.z, sd.x);
    float Hp     = mod(lonP - lonS, TWO_PI);
    float cosDec = cos(decl);
    float sinDec = sin(decl);
    // 1e-4 floor on cos(φ)·cos(δ): protects acos at the geographic
    // poles and the high-lat regime where both terms approach zero.
    // Mirrored in solar.js; do not shrink without testing |φ|,|δ| → π/2.
    float denom  = max(cosEff * cosDec, 1e-4);
    float Hmag   = acos(clamp((sin(MAGHRIB_ANGLE) - sinEff * sinDec) / denom, -1.0, 1.0));
    float Hfajr  = acos(clamp((sin(FAJR_ANGLE)    - sinEff * sinDec) / denom, -1.0, 1.0));
    float Hmid   = PI + (Hmag - Hfajr) * 0.5;
    // Smoothing band ~2.3° in hour angle (~9 min of solar time).
    float pastMidnight = smoothstep(Hmid - 0.04, Hmid + 0.04, Hp);

    // ---- morning branch ----
    // After shar'ī midnight (pastMidnight ≈ 1) Isha's waqt has ended; only
    // Fajr is in its dedicated waqt here.
    //
    // morningColor stays as mix(cIsha → cFajr) by altitude so that, right
    // at the seam where pastMidnight ∈ (0,1), the blend with the afternoon
    // side stays consistent (the afternoon side at deep night is cIsha, so
    // the seam interpolates cIsha→cIsha without a spurious Fajr tint).
    // morningCoverage drops to 0 outside the Fajr
    // altitude window, so we never actually paint Isha on the morning
    // side — only Fajr inside its window.
    vec3 morningColor = mix(cIsha, cFajr, wFajr);
    float morningCoverage = wFajr * (1.0 - wHor) * enFajr;

    // ---- afternoon branch ----
    // The Ja'fari "shared time" regions: Dhuhr+Asr after shadow=1 (both
    // valid until sunset) and Maghrib+Isha after shafaq (both valid until
    // shar'ī midnight). The shader paints one color per pixel, so by
    // default it shows the later-entered prayer (Asr / Isha) as the
    // "current" one. But when that later prayer is filtered off via the
    // legend toggles, fall back to the earlier prayer's color so the
    // earlier prayer's full waqt remains visible — otherwise turning Isha
    // off makes Maghrib appear to end at -14° instead of at midnight.
    vec3 asrOrDhuhr     = mix(cDhuhr, cAsr, enAsr);
    float asrOrDhuhrEn  = max(enAsr, enDhuhr);
    vec3 ishaOrMaghrib  = mix(cMaghrib, cIsha, enIsha);
    float ishaOrMaghribEn = max(enIsha, enMaghrib);

    vec3 nightZone = mix(ishaOrMaghrib, cMaghrib, wIsha);
    vec3 twilight  = mix(nightZone, cAsr, wMag);
    vec3 daytime   = mix(asrOrDhuhr, cDhuhr, wAsr);
    vec3 afternoonColor = mix(twilight, daytime, wHor);
    float nightEn   = mix(ishaOrMaghribEn, enMaghrib, wIsha);
    float twilEn    = mix(nightEn, enAsr, wMag);
    float dayEn     = mix(asrOrDhuhrEn, enDhuhr, wAsr);
    float afternoonEnable = mix(twilEn, dayEn, wHor);

    vec3 prayerColor = mix(afternoonColor, morningColor, pastMidnight);
    float coverage = mix(afternoonEnable, morningCoverage, pastMidnight);

    // Uniformly-lit base earth (no day/night terminator). Sampled on the
    // actual normal so geography is unchanged inside the Aqrab cap.
    vec3 baseCol = sampleEquirect(dayMap, n).rgb * dayBoost + 0.14;

    float strength = coverage * prayerOpacity * prayerEnabled;
    vec3 tinted = mix(baseCol, prayerColor, strength * 0.92);
    tinted += prayerColor * strength * 0.40;

    gl_FragColor = vec4(clamp(tinted, 0.0, 1.0), 1.0);
  }
`;

export function createEarthMaterial({ dayMap }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: dayMap },
      sunDir: { value: new THREE.Vector3(1, 0, 0) },
      decl: { value: 0 },
      prayerOpacity: { value: 0.85 },
      dayBoost: { value: 2.7 },
      prayerEnabled: { value: 1.0 },
      enFajr: { value: 1.0 },
      enDhuhr: { value: 1.0 },
      enAsr: { value: 1.0 },
      enMaghrib: { value: 1.0 },
      enIsha: { value: 1.0 },
      cFajr: { value: new THREE.Color(0x7a52c4) },
      cDhuhr: { value: new THREE.Color(0xf2b33d) },
      cAsr: { value: new THREE.Color(0xe07a3e) },
      cMaghrib: { value: new THREE.Color(0xc44569) },
      cIsha: { value: new THREE.Color(0x3b5998) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}
