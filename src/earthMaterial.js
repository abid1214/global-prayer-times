import * as THREE from "three";
import { VERT, FRAG } from "./earthShader.js";
import { PRAYER_COLORS } from "./constants.js";

// THREE.ShaderMaterial wrapper; GLSL from earthShader.js, colors from PRAYER_COLORS.
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
      cFajr: { value: new THREE.Color(PRAYER_COLORS.fajr) },
      cDhuhr: { value: new THREE.Color(PRAYER_COLORS.dhuhr) },
      cAsr: { value: new THREE.Color(PRAYER_COLORS.asr) },
      cMaghrib: { value: new THREE.Color(PRAYER_COLORS.maghrib) },
      cIsha: { value: new THREE.Color(PRAYER_COLORS.isha) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}
