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

    vec3 prayerColor = mix(afternoonColor, morningColor, morningness);
    float coverage = mix(afternoonEnable, morningCoverage, morningness);

    // Uniformly-lit base earth (no day/night terminator).
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
      prayerOpacity: { value: 1.0 },
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
