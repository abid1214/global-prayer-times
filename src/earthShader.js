// GLSL for the prayer-window shader. THREE-free (imports only constants.js) so
// the text can be built and verified in Node (tests/shaderConstants); wrapped by
// earthMaterial.js. Visualization thresholds are interpolated from constants.js
// to stay in lockstep with solar.js's classifier and prayer.js's cap math.

import {
  VIS_FAJR_DEG, VIS_MAGHRIB_DEG, VIS_ISHA_DEG, APPARENT_HORIZON_DEG,
  COS_FLOOR, FAJR_LIMIT_DEG, DAY_LIMIT_DEG, SAFE_MARGIN_DEG,
} from "./constants.js";

// JS number → GLSL float literal (force a decimal point so it parses as float).
function glslFloat(n) {
  if (!Number.isFinite(n)) throw new Error(`glslFloat: non-finite ${n}`);
  const s = n.toString();
  return /[.eE]/.test(s) ? s : s + ".0";
}

export const VERT = /* glsl */ `
  varying vec3 vNormalLocal;

  void main() {
    vNormalLocal = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const FRAG = /* glsl */ `
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
  const float FAJR_ANGLE = ${glslFloat(VIS_FAJR_DEG)} * PI / 180.0;
  const float MAGHRIB_ANGLE = ${glslFloat(VIS_MAGHRIB_DEG)} * PI / 180.0;
  const float ISHA_ANGLE = ${glslFloat(VIS_ISHA_DEG)} * PI / 180.0;
  // Apparent horizon = -50' (refraction + solar semi-diameter), applied only to
  // sunrise/sunset per Adhan.js; the depression angles are face-value.
  const float APPARENT_HORIZON = ${glslFloat(APPARENT_HORIZON_DEG)} * PI / 180.0;

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

    // Aqrab al-Bilād: above the latitude where the standard calc breaks down,
    // each pixel uses its same-longitude projection point's schedule. Two
    // failure modes (full derivation: README / git history):
    //   Fajr-cap:        |φ+δ| > 74°     (sun never reaches -16°)
    //   Polar-night cap: |φ-δ| > 90.833° (sun never crosses the apparent horizon)
    // Cap = whichever trips first per hemisphere; it tilts seasonally with ±δ.
    // The shader is intentionally method-agnostic — always same-longitude — since
    // the other five methods have no clean per-pixel form; the panel descriptor
    // surfaces the divergence (see describePolarMethod in panel.js). The Fajr cap
    // is the fixed Leva Qom 74°; the panel derives a preset-aware one (prayer.js).
    const float FAJR_LIMIT = ${glslFloat(FAJR_LIMIT_DEG)} * PI / 180.0;
    const float DAY_LIMIT  = ${glslFloat(DAY_LIMIT_DEG)} * PI / 180.0;
    // Cap membership uses the TRUE threshold (matches aqrabProjection). SAFE_MARGIN
    // pulls only the projection target back from adhan's cosH=±1 singularity.
    const float SAFE_MARGIN = ${glslFloat(SAFE_MARGIN_DEG)} * PI / 180.0;
    float northTrue = min(FAJR_LIMIT - decl, DAY_LIMIT + decl);
    float southTrue = max(-FAJR_LIMIT - decl, -DAY_LIMIT + decl);
    // effLat jumps by SAFE_MARGIN at the threshold (sub-pixel); the ~5° band
    // smoothing below absorbs the step.
    float effLat = lat;
    if (lat > northTrue) effLat = northTrue - SAFE_MARGIN;
    else if (lat < southTrue) effLat = southTrue + SAFE_MARGIN;
    // Effective normal at (effLat, lonP): equals n below the cap, the projection
    // point's normal inside it, so all sun-relative math reflects the schedule.
    float cosEff = cos(effLat);
    float sinEff = sin(effLat);
    vec3 effN = vec3(cosEff * cos(lonP), sinEff, -cosEff * sin(lonP));

    float sinAlt = clamp(dot(sd, effN), -1.0, 1.0);
    float alt = asin(sinAlt);

    float diff = effLat - decl;
    // 0.0005 floor smooths the derivative at diff=0 (solar.js omits it — see there).
    float zenithDiff = clamp(sqrt(diff * diff + 0.0005), 0.0, 1.4);
    float altAsr = atan(1.0 / (1.0 + tan(zenithDiff)));

    // Wide smoothing band (~5° arc) on each threshold.
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
    // COS_FLOOR (see src/constants.js) on cos(φ)·cos(δ): protects acos at
    // the geographic poles and the high-lat regime where both terms
    // approach zero. Mirrored in solar.js; do not shrink without testing
    // |φ|,|δ| → π/2.
    float denom  = max(cosEff * cosDec, ${glslFloat(COS_FLOOR)});
    float Hmag   = acos(clamp((sin(MAGHRIB_ANGLE) - sinEff * sinDec) / denom, -1.0, 1.0));
    float Hfajr  = acos(clamp((sin(FAJR_ANGLE)    - sinEff * sinDec) / denom, -1.0, 1.0));
    float Hmid   = PI + (Hmag - Hfajr) * 0.5;
    // Smoothing band ~2.3° in hour angle (~9 min of solar time).
    float pastMidnight = smoothstep(Hmid - 0.04, Hmid + 0.04, Hp);

    // ---- morning branch ----
    // After shar'ī midnight only Fajr has a dedicated waqt. morningColor stays
    // cIsha→cFajr so the seam with the afternoon side (cIsha at deep night) has
    // no spurious tint; morningCoverage is 0 outside the Fajr window.
    vec3 morningColor = mix(cIsha, cFajr, wFajr);
    float morningCoverage = wFajr * (1.0 - wHor) * enFajr;

    // ---- afternoon branch ----
    // Ja'fari "shared time" regions: Dhuhr+Asr (to sunset) and Maghrib+Isha (to
    // midnight). One color per pixel shows the later prayer (Asr/Isha) by default,
    // but when that's toggled off the earlier prayer's color (and full waqt) shows.
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

    // Uniformly-lit base earth, sampled on the actual normal (geography
    // unchanged inside the cap).
    vec3 baseCol = sampleEquirect(dayMap, n).rgb * dayBoost + 0.14;

    float strength = coverage * prayerOpacity * prayerEnabled;
    vec3 tinted = mix(baseCol, prayerColor, strength * 0.92);
    tinted += prayerColor * strength * 0.40;

    gl_FragColor = vec4(clamp(tinted, 0.0, 1.0), 1.0);
  }
`;
