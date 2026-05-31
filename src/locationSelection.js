import * as THREE from "three";
import { latLonToVec3 } from "./solar.js";
import { aqrabProjection } from "./prayer.js";
import { showPanelForLocation } from "./panel.js";
import { snapToNearestHighLatCity } from "./highLatCities.js";
import { POLAR_METHODS, getMethod } from "./settings.js";
import { degToRad, MECCA_LAT, MECCA_LON } from "./constants.js";
import { arcBuilder } from "./sceneObjects.js";

// "User picked a location": white pin, gold qibla arc to Mecca, and (inside a
// polar cap) the teal Aqrab al-Bilād projection pin + arc. Owns the qibla/
// projection Line2 objects; scene refs are injected, getLines() exposes them for
// the resolution-refresh sweep.
export function createLocationSelection({ earthGroup, pinMesh, projectionPin, lineResolution, markDirty, effectiveNow }) {
  let qiblaLine = null;
  let projectionLine = null;
  // Kept so refreshProjection() can re-aim the pin as the scrubber moves the date.
  let lastSelection = null;

  // Remove a Line2 overlay and free its GPU resources; returns null to reassign.
  function cleanupLine(line) {
    if (!line) return null;
    earthGroup.remove(line);
    line.geometry.dispose();
    line.material.dispose();
    return null;
  }

  function setPin(latRad, lonRad) {
    const v = latLonToVec3(latRad, lonRad);
    pinMesh.position.set(v[0] * 1.005, v[1] * 1.005, v[2] * 1.005);
    pinMesh.visible = true;
    markDirty();
  }

  function setQiblaFrom(latDeg, lonDeg) {
    qiblaLine = cleanupLine(qiblaLine);
    const A = new THREE.Vector3(...latLonToVec3(degToRad(latDeg), degToRad(lonDeg)));
    const B = new THREE.Vector3(...latLonToVec3(degToRad(MECCA_LAT), degToRad(MECCA_LON)));
    qiblaLine = arcBuilder(A, B, 96, 1.018,
      { color: 0xffe066, linewidth: 3.5, opacity: 1.0, depthTest: false },
      lineResolution());
    if (!qiblaLine) return;
    qiblaLine.renderOrder = 2;
    earthGroup.add(qiblaLine);
    markDirty();
  }

  function clearProjectionViz() {
    let changed = false;
    if (projectionPin.visible) {
      projectionPin.visible = false;
      changed = true;
    }
    if (projectionLine) {
      projectionLine = cleanupLine(projectionLine);
      changed = true;
    }
    // Render loop is dirty-flag gated, so erasing needs an explicit markDirty.
    if (changed) markDirty();
  }

  // Teal pin + arc at the projection point ("where did these times come from?").
  // Target lat/lon differ from the user's for nearest-city, so both are explicit.
  function setProjectionViz(actualLatDeg, actualLonDeg, targetLatDeg, targetLonDeg) {
    const latRadTgt = degToRad(targetLatDeg);
    const lonRadTgt = degToRad(targetLonDeg);
    const v = latLonToVec3(latRadTgt, lonRadTgt);
    projectionPin.position.set(v[0] * 1.005, v[1] * 1.005, v[2] * 1.005);
    projectionPin.visible = true;

    projectionLine = cleanupLine(projectionLine);
    const A = new THREE.Vector3(...latLonToVec3(degToRad(actualLatDeg), degToRad(actualLonDeg)));
    const B = new THREE.Vector3(...latLonToVec3(latRadTgt, lonRadTgt));
    projectionLine = arcBuilder(A, B, 32, 1.014,
      { color: 0x6cd0c4, linewidth: 2.0, opacity: 0.9, depthTest: false },
      lineResolution());
    if (projectionLine) {
      projectionLine.renderOrder = 2;
      earthGroup.add(projectionLine);
    }
    // markDirty regardless — pin position/visibility may change even with no arc.
    markDirty();
  }

  // Pin target for the current method, or null when none should be drawn (off
  // cap, or the four clock-mode methods with no spatial source). SAME_LON →
  // projection point; NEAREST_CITY → snapped city (else the projection).
  function pinSourceForMethod(latDeg, lonDeg, date) {
    const aqrab = aqrabProjection(latDeg, date);
    if (!aqrab) return null;
    const method = getMethod();
    if (method === POLAR_METHODS.AQRAB_SAME_LON) {
      return { targetLat: aqrab.projectedFromLat, targetLon: lonDeg };
    }
    if (method === POLAR_METHODS.AQRAB_NEAREST_CITY) {
      const city = snapToNearestHighLatCity(latDeg, lonDeg, aqrab.projectedFromLat);
      return city
        ? { targetLat: city.lat, targetLon: city.lon }
        : { targetLat: aqrab.projectedFromLat, targetLon: lonDeg };
    }
    return null;
  }

  function applyProjection(latDeg, lonDeg, date) {
    const src = pinSourceForMethod(latDeg, lonDeg, date);
    if (src) setProjectionViz(latDeg, lonDeg, src.targetLat, src.targetLon);
    else clearProjectionViz();
  }

  // Re-aim the pin for the current selection (method/preset change, scrubber move).
  function refreshProjection() {
    if (!lastSelection) return;
    applyProjection(lastSelection.latDeg, lastSelection.lonDeg, effectiveNow());
  }

  // Single entry point — pin, qibla, projection, panel — so click/search/URL agree.
  function selectLocation(latDeg, lonDeg, name) {
    setPin(degToRad(latDeg), degToRad(lonDeg));
    setQiblaFrom(latDeg, lonDeg);
    const date = effectiveNow();
    applyProjection(latDeg, lonDeg, date);
    lastSelection = { latDeg, lonDeg, name };
    showPanelForLocation({ lat: latDeg, lon: lonDeg, name }, date);
  }

  return {
    selectLocation,
    refreshProjection,
    getLines: () => [qiblaLine, projectionLine],
  };
}
