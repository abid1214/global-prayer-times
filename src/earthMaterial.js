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

  vec4 sampleEquirect(sampler2D tex, vec3 dir) {
    float lat = asin(clamp(dir.y, -1.0, 1.0));
    float lon = atan(-dir.z, dir.x);
    vec2 uv = vec2(lon / TWO_PI + 0.5, lat / PI + 0.5);
    return texture2D(tex, uv);
  }

  void main() {
    vec3 n = normalize(vNormalLocal);
    vec3 sd = normalize(sunDir);

    float lat = asin(clamp(n.y, -1.0, 1.0));

    float sinAlt = clamp(dot(sd, n), -1.0, 1.0);
    float alt = asin(sinAlt);

    float diff = lat - decl;
    float zenithDiff = clamp(sqrt(diff * diff + 0.0005), 0.0, 1.4);
    float altAsr = atan(1.0 / (1.0 + tan(zenithDiff)));

    // Wide smoothing band (~5° arc) on each threshold
    const float B = 0.09;

    float wFajr = smoothstep(FAJR_ANGLE - B, FAJR_ANGLE + B, alt);
    float wIsha = smoothstep(ISHA_ANGLE - B, ISHA_ANGLE + B, alt);
    float wMag  = smoothstep(MAGHRIB_ANGLE - B, MAGHRIB_ANGLE + B, alt);
    float wHor  = smoothstep(-B, B, alt);
    float wAsr  = smoothstep(altAsr - B, altAsr + B, alt);

    // Shar'ī midnight = midpoint of the night (sunset → next-day Fajr).
    // Solved in closed form from each pixel's hour angle so the cutoff is
    // exact, not the antisolar-meridian approximation. Equation of time is
    // baked into sunDir already (see sunPosition() in solar.js), so the
    // subsolar longitude derived here carries the correction implicitly.
    //   H_set  = sunset hour-angle (alt = 0° going down)
    //   H_fajr = Fajr hour-angle  (alt = -16° going up next morning)
    //   H_mid  = π + (H_set - H_fajr) / 2  — earlier than solar midnight
    //            because the night is asymmetric (sunset at 0°, dawn at -16°).
    float lonP   = atan(-n.z, n.x);
    float lonS   = atan(-sd.z, sd.x);
    float Hp     = mod(lonP - lonS, TWO_PI);
    float cosLat = cos(lat);
    float cosDec = cos(decl);
    float Hset   = acos(clamp(-tan(lat) * tan(decl), -1.0, 1.0));
    float Hfajr  = acos(clamp((sin(FAJR_ANGLE) - sin(lat) * sin(decl)) / max(cosLat * cosDec, 1e-4), -1.0, 1.0));
    float Hmid   = PI + (Hset - Hfajr) * 0.5;
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

    // Uniformly-lit base earth (no day/night terminator).
    vec3 baseCol = sampleEquirect(dayMap, n).rgb * dayBoost + 0.14;

    // Above ~60° N/S the altitude-based Ja'fari definitions become unreliable
    // and Aqrab al-Bilad (the dominant Shia high-latitude ruling) projects
    // the schedule onto a single nearest-locality point — which doesn't have
    // a clean spatial coloring. We fade the prayer overlay out so the
    // polar caps just show geography. The side panel still shows projected
    // times for any polar click.
    const float LAT_THRESH = 1.047; // 60° in radians
    float poleFade = 1.0 - smoothstep(LAT_THRESH - 0.04, LAT_THRESH + 0.04, abs(lat));

    float strength = coverage * prayerOpacity * prayerEnabled * poleFade;
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
