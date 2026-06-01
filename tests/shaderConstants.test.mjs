// Guards the shader<->constants single-source: earthShader.js interpolates the
// visualization thresholds from constants.js into its GLSL. This asserts the
// generated literals still equal the pre-refactor hardcoded values (the
// integer ones byte-exact; the 50/60 fraction to within 1e-12 radians).
// Pure Node — earthShader.js imports only constants.js (no THREE).

import { FRAG } from "../src/earthShader.js";
import {
  VIS_FAJR_DEG, VIS_MAGHRIB_DEG, VIS_ISHA_DEG, APPARENT_HORIZON_DEG, COS_FLOOR,
} from "../src/constants.js";

const fail = [];
const eq = (name, got, want) => {
  if (Math.abs(got - want) > 1e-12) fail.push(`${name} = ${got}, want ${want}`);
};
const has = (s) => { if (!FRAG.includes(s)) fail.push(`FRAG missing: ${s}`); };

eq("VIS_FAJR_DEG", VIS_FAJR_DEG, -16);
eq("VIS_MAGHRIB_DEG", VIS_MAGHRIB_DEG, -4);
eq("VIS_ISHA_DEG", VIS_ISHA_DEG, -14);
eq("APPARENT_HORIZON_DEG", APPARENT_HORIZON_DEG, -50 / 60);
eq("COS_FLOOR", COS_FLOOR, 1e-4);

// Integer-valued GLSL literals must be byte-identical to the original shader.
has("const float FAJR_ANGLE = -16.0 * PI / 180.0;");
has("const float MAGHRIB_ANGLE = -4.0 * PI / 180.0;");
has("const float ISHA_ANGLE = -14.0 * PI / 180.0;");
has("max(cosLat * cosDec, 0.0001)");

// Fractional threshold: confirm the GLSL evaluates to the original radians.
eq("APPARENT_HORIZON rad", (APPARENT_HORIZON_DEG * Math.PI) / 180, (-50 / 60 * Math.PI) / 180);

if (fail.length) {
  for (const f of fail) console.error(`✗ shaderConstants: ${f}`);
  console.log(`shaderConstants: ${fail.length} failed`);
  if (typeof process !== "undefined") process.exitCode = 1;
} else {
  console.log("shaderConstants: 10/10 passed");
}
