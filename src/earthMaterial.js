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
  uniform sampler2D nightMap;
  uniform vec3 sunDir;
  uniform float decl;
  uniform float prayerOpacity;
  uniform float dayBoost;
  uniform float nightBoost;
  uniform float prayerEnabled;
  uniform float dayNightEnabled;

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

    float sinAlt = clamp(dot(sd, n), -1.0, 1.0);
    float alt = asin(sinAlt);

    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), n));

    // Asr altitude threshold — smooth abs(lat-decl) to remove the V-kink
    // at the subsolar latitude where the derivative would otherwise jump.
    float lat = asin(clamp(n.y, -1.0, 1.0));
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

    // morning vs afternoon with wider smoothing at midnight meridian
    float morningness = smoothstep(-0.06, 0.06, dot(sd, east));

    // ---- morning branch ----
    vec3 morningColor = mix(cIsha, cFajr, wFajr);
    float morningCoverage = 1.0 - wHor;
    // per-prayer enable: interpolate Isha-enable → Fajr-enable by blend weight
    float morningEnable = mix(enIsha, enFajr, wFajr);
    morningCoverage *= morningEnable;

    // ---- afternoon branch ----
    vec3 nightZone = mix(cIsha, cMaghrib, wIsha);
    vec3 twilight  = mix(nightZone, cAsr, wMag);
    vec3 daytime   = mix(cAsr, cDhuhr, wAsr);
    vec3 afternoonColor = mix(twilight, daytime, wHor);
    float nightEn   = mix(enIsha, enMaghrib, wIsha);
    float twilEn    = mix(nightEn, enAsr, wMag);
    float dayEn     = mix(enAsr, enDhuhr, wAsr);
    float afternoonEnable = mix(twilEn, dayEn, wHor);
    float afternoonCoverage = afternoonEnable;

    vec3 prayerColor = mix(afternoonColor, morningColor, morningness);
    float coverage = mix(afternoonCoverage, morningCoverage, morningness);

    // ---- base earth coloring ----
    vec3 rawDay = sampleEquirect(dayMap, n).rgb;
    vec3 nightCol = pow(sampleEquirect(nightMap, n).rgb, vec3(0.75)) * nightBoost;

    // Brighten the day texture so the sunlit side reads clearly.
    // When day/night is OFF, push even harder + lift shadows for uniform look.
    vec3 dayOn  = rawDay * dayBoost + 0.05;
    vec3 dayOff = rawDay * (dayBoost * 1.5) + 0.14;
    vec3 dayCol = mix(dayOff, dayOn, dayNightEnabled);

    float realDayMix = smoothstep(-0.12, 0.06, sinAlt);
    float dayMix = mix(1.0, realDayMix, dayNightEnabled);
    vec3 baseCol = mix(nightCol, dayCol, dayMix);

    // ---- prayer overlay ----
    float realDayK = smoothstep(-0.05, 0.10, sinAlt);
    float strength = coverage * prayerOpacity * prayerEnabled;

    // When day/night is ON, vary tint strength (light on day side, heavy on night).
    // When OFF, use a uniform medium-high strength so prayer bands pop against
    // the evenly-lit base.
    float kTerminator = mix(strength * 0.65, strength * 0.45, realDayK);
    float kFlat = strength * 0.80;
    float k = mix(kFlat, kTerminator, dayNightEnabled);
    vec3 tinted = mix(baseCol, prayerColor, k);

    float glowTerminator = strength * 0.30 * (1.0 - realDayK);
    float glowFlat = strength * 0.32;
    float glow = mix(glowFlat, glowTerminator, dayNightEnabled);
    tinted += prayerColor * glow;

    float term = exp(-pow(sinAlt * 12.0, 2.0)) * dayNightEnabled;
    tinted += vec3(1.0, 0.55, 0.25) * term * 0.18;

    gl_FragColor = vec4(clamp(tinted, 0.0, 1.0), 1.0);
  }
`;

export function createEarthMaterial({ dayMap, nightMap }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: dayMap },
      nightMap: { value: nightMap },
      sunDir: { value: new THREE.Vector3(1, 0, 0) },
      decl: { value: 0 },
      prayerOpacity: { value: 0.7 },
      dayBoost: { value: 1.8 },
      nightBoost: { value: 1.6 },
      prayerEnabled: { value: 1.0 },
      dayNightEnabled: { value: 1.0 },
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
