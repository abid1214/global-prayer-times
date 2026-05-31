// Shared constants and tiny math helpers. Single home for values that had
// drifted across modules (DEG, the prayer palette, the visualization angles
// mirrored between solar.js and the shader).

export const DEG = Math.PI / 180;
export const degToRad = (deg) => deg * DEG;
export const radToDeg = (rad) => rad / DEG;

// Kaaba — qibla target + permanent globe marker.
export const MECCA_LAT = 21.4225;
export const MECCA_LON = 39.8262;

// Mean great-circle km per degree of arc (remote-projection warn metric).
export const KM_PER_DEGREE_GC = 111.32;

// Prayer-window palette (single source of truth): globe shader uniforms,
// panel swatches (PRAYER_META), and legend swatches (CSS --c-*, set by main.js).
export const PRAYER_COLORS = Object.freeze({
  fajr:    0x7a52c4,
  sunrise: 0xaab3c5,
  dhuhr:   0xf2b33d,
  asr:     0xe07a3e,
  maghrib: 0xc44569,
  isha:    0x3b5998,
});

export const hexColor = (n) => "#" + n.toString(16).padStart(6, "0");

// Visualization thresholds (Leva Qom angles, degrees). Drive BOTH the shader
// (earthShader.js interpolates them into GLSL) and the JS classifier
// (solar.js), which MUST stay in lockstep — hence one home. The side-panel
// SCHEDULE uses preset-aware angles instead; these are the fixed viz thresholds.
export const VIS_FAJR_DEG = -16;
export const VIS_MAGHRIB_DEG = -4;
export const VIS_ISHA_DEG = -14;
// Apparent horizon = -50' (refraction + solar semi-diameter), matching adhan.js.
export const APPARENT_HORIZON_DEG = -50 / 60;
// Floor on cos(φ)·cos(δ): protects acos at the poles / high-lat.
export const COS_FLOOR = 1e-4;

// Aqrab al-Bilād cap thresholds (degrees, sun-relative): Fajr-cap at
// |φ+δ| > 74 (sun never reaches -16°); polar night at |φ-δ| > 90.8333 (sun
// never rises). Polar-night limit is preset-independent; the Fajr limit is the
// fixed Leva Qom viz value (prayer.js derives a preset-aware one for the panel).
export const FAJR_LIMIT_DEG = 90 + VIS_FAJR_DEG;
export const DAY_LIMIT_DEG = 90 - APPARENT_HORIZON_DEG;

// Pull-back on the projection target (not cap membership) so adhan's
// correctedHourAngle keeps headroom from its cosH = ±1 singularity.
export const SAFE_MARGIN_DEG = 0.05;
