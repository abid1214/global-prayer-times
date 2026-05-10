import * as THREE from "three";

// Module-scope constant reused as input to THREE.Quaternion.setFromUnitVectors
// (reads it but doesn't mutate). Avoids allocating a (0,0,1) Vec3 per call.
const _FORWARD = new THREE.Vector3(0, 0, 1);

// Quaternion-based orbit controls. Replaces three.js OrbitControls so that
// (a) a vertical drag can flick past the poles (no spherical clamp on the
// camera) and (b) a two-finger twist rotates the view as a true roll. The
// public surface mirrors what main.js was using from OrbitControls so the
// rest of the app doesn't have to change much:
//
//   .update()              — call each rAF tick; returns true if camera moved
//   .addEventListener('change'|'start'|'end', fn)
//   .target  / .minDistance / .maxDistance / .dampingFactor / .rotateSpeed
//   .zoomSpeed / .enabled
//   .dispose()
//
// Notes:
// - Rotations are applied in the camera-local frame, so dragging-right always
//   spins the world right regardless of the camera's current orientation,
//   even after a pole crossing.
// - The camera's `up` vector follows the quaternion, so a flick past the
//   north pole naturally leaves the south side at the top of the screen —
//   the "globe in your hand" feel.
// - Inertia uses the most recent pointer delta and decays each frame by
//   (1 − dampingFactor), matching how OrbitControls' damping feels.
export class GlobeControls extends THREE.EventDispatcher {
  constructor(camera, domElement) {
    super();
    this.camera = camera;
    this.dom = domElement;
    this.target = new THREE.Vector3(0, 0, 0);
    this.minDistance = 1.25;
    this.maxDistance = 8;
    // rotateSpeed is now a multiplier on a zoom-aware angle-per-pixel
    // (computed in _anglePerPx), not raw rad/px. 1.5 makes a full-screen
    // vertical drag at default zoom rotate ~one FOV, and gracefully slows
    // down as the camera approaches the globe surface.
    this.rotateSpeed = 1.5;
    this.zoomSpeed = 0.6;
    this.dampingFactor = 0.04;
    this.globeRadius = 1; // used to scale rotation against camera distance
    this.enabled = true;

    this._distance = camera.position.distanceTo(this.target);
    this._quat = new THREE.Quaternion();
    // Initial quaternion: rotate the default offset (0,0,d) onto the current
    // camera direction. Subsequent input rotations are layered on top.
    {
      const dir = new THREE.Vector3().subVectors(camera.position, this.target).normalize();
      this._quat.setFromUnitVectors(_FORWARD, dir);
    }

    // Scratch instances reused on every input / frame to avoid GC churn in
    // the hot drag/inertia path. Never escape this class.
    this._tmpQuat = new THREE.Quaternion();
    this._tmpEuler = new THREE.Euler(0, 0, 0, "XYZ");
    this._tmpVec3 = new THREE.Vector3();

    this._pointers = new Map();
    // Two-finger gesture snapshots are reused in-place instead of being
    // reallocated each pointermove (was: `return {distance, angle};` plus a
    // `[...this._pointers.values()]` array spread). Keeps the hot pinch /
    // twist path allocation-free.
    this._twoFingerCur = { distance: 0, angle: 0 };
    this._twoFingerLast = { distance: 0, angle: 0 };
    this._twoFingerLastValid = false;
    this._inertia = { pitch: 0, yaw: 0, roll: 0, zoom: 1 };
    this._dragging = false;
    // Most recent input time — used on release to decide if the user was
    // still actively moving (fling) or had paused / slowed (no inertia).
    // Without this, careful slow drags + release would keep coasting for
    // ~1 s and the globe would visibly slip past the user's intended pose.
    this._lastMoveTime = 0;
    // True when input or inertia has updated _quat/_distance since the last
    // update() tick — drives both the 'change' dispatch and the return value
    // (which is what main.js uses to gate adaptive pixel-ratio).
    this._changed = false;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);

    domElement.addEventListener("pointerdown", this._onPointerDown);
    domElement.addEventListener("pointermove", this._onPointerMove);
    domElement.addEventListener("pointerup", this._onPointerUp);
    domElement.addEventListener("pointercancel", this._onPointerUp);
    domElement.addEventListener("wheel", this._onWheel, { passive: false });
    // OrbitControls used to set touch-action; mirror that so the browser
    // doesn't try to scroll/pinch-zoom the page while we capture touches.
    // Stash the prior value so dispose() can restore it.
    this._priorTouchAction = domElement.style.touchAction;
    domElement.style.touchAction = "none";

    this._writeCameraTransform();
  }

  // Recompute internal state from the current camera transform. Use this
  // whenever the camera has been moved outside the controls (e.g. main.js's
  // search-result flyTo animates camera.position directly). Without it, the
  // next gesture would apply deltas to stale _quat/_distance and snap the
  // camera back to the pre-fly orbit. Picks the shortest-arc quaternion, so
  // any prior camera roll is discarded — fine for a "go-to" operation. Also
  // clears in-flight inertia so a fling that's still decaying doesn't fight
  // the external animation.
  syncFromCamera() {
    // Always clear inertia first — the whole point of syncFromCamera is to
    // accept that the camera has moved outside our control, so any in-flight
    // fling shouldn't keep applying its decay on top of it.
    this._inertia.pitch = 0;
    this._inertia.yaw = 0;
    this._inertia.roll = 0;
    this._inertia.zoom = 1;
    const rawDistance = this.camera.position.distanceTo(this.target);
    // If the camera is sitting on top of the target, the offset direction is
    // undefined. Don't mutate _distance / _quat / camera transform at all —
    // leave the controls' last-known-good orientation so an in-flight
    // animation that briefly grazes the origin can resume cleanly on the
    // next frame instead of producing a half-derived state.
    if (rawDistance < 1e-6) return;
    this._distance = Math.max(this.minDistance, Math.min(this.maxDistance, rawDistance));
    this._tmpVec3.subVectors(this.camera.position, this.target).normalize();
    // setFromUnitVectors picks the shortest-arc rotation, which discards
    // any roll the camera previously had. That's fine for "go-to" jumps,
    // but we then need to write the unrolled transform back to the camera
    // immediately — otherwise camera.up still carries the old roll and the
    // next user gesture (which goes through _writeCameraTransform) will
    // visibly snap the camera to the unrolled state.
    this._quat.setFromUnitVectors(_FORWARD, this._tmpVec3);
    this._writeCameraTransform();
  }

  // ---- input handlers ----

  _onPointerDown(e) {
    if (!this.enabled) return;
    this.dom.setPointerCapture(e.pointerId);
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this._pointers.size === 2) {
      this._fillTwoFingerSnapshot(this._twoFingerLast);
      this._twoFingerLastValid = true;
    }
    if (!this._dragging) {
      this._dragging = true;
      this.dispatchEvent({ type: "start" });
    }
    // Grabbing again kills any in-flight inertia.
    this._inertia.pitch = 0;
    this._inertia.yaw = 0;
    this._inertia.roll = 0;
    this._inertia.zoom = 1;
  }

  _onPointerMove(e) {
    if (!this.enabled || !this._pointers.has(e.pointerId)) return;
    const prev = this._pointers.get(e.pointerId);
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (dx === 0 && dy === 0) return; // resting finger — don't mark dirty
    // Mutate the existing pointer record in place (it's the same reference
    // the Map already holds) instead of allocating a new {x,y} object.
    prev.x = e.clientX;
    prev.y = e.clientY;
    this._lastMoveTime = e.timeStamp;

    if (this._pointers.size === 1) {
      const anglePerPx = this._anglePerPx();
      const dYaw = -dx * anglePerPx * this.rotateSpeed;
      const dPitch = -dy * anglePerPx * this.rotateSpeed;
      this._applyEuler(dPitch, dYaw, 0);
      this._inertia.pitch = dPitch;
      this._inertia.yaw = dYaw;
      this._inertia.roll = 0;
      this._changed = true;
    } else if (this._pointers.size === 2) {
      this._fillTwoFingerSnapshot(this._twoFingerCur);
      const cur = this._twoFingerCur;
      const last = this._twoFingerLast;
      // Guard against pinch ratio blowups when the two pointers land on top
      // of each other (cur.distance ≈ 0) — would otherwise produce
      // Infinity/NaN that contaminates _distance and _inertia.zoom forever.
      const MIN_PINCH = 1e-3;
      if (this._twoFingerLastValid && cur.distance > MIN_PINCH && last.distance > MIN_PINCH) {
        // Pinch.
        const ratio = last.distance / cur.distance;
        const scale = Math.pow(ratio, this.zoomSpeed);
        if (Number.isFinite(scale) && scale > 0) {
          this._applyZoom(scale);
          this._inertia.zoom = scale;
        }
        // Twist. atan2 in screen-space (y-down) increases clockwise, which
        // matches what users expect: twist your fingers CW → scene CW.
        let dAngle = cur.angle - last.angle;
        if (dAngle > Math.PI) dAngle -= 2 * Math.PI;
        if (dAngle < -Math.PI) dAngle += 2 * Math.PI;
        this._applyEuler(0, 0, dAngle);
        this._inertia.roll = dAngle;
        this._changed = true;
      }
      last.distance = cur.distance;
      last.angle = cur.angle;
      this._twoFingerLastValid = true;
    }
    // Camera write + 'change' dispatch happen in update() so we only emit
    // one event per animation frame even if many pointer events fired.
  }

  _onPointerUp(e) {
    if (!this._pointers.has(e.pointerId)) return;
    this._pointers.delete(e.pointerId);
    try { this.dom.releasePointerCapture(e.pointerId); } catch (_) {}
    if (this._pointers.size === 0) {
      // Decide whether to coast (fling) or snap (deliberate placement).
      // Two cases kill inertia:
      //   • The user paused before lifting their finger (last pointermove
      //     was more than ~50 ms ago) — they were positioning, not flinging.
      //   • The most recent rotational velocity is below a perceptible
      //     threshold (~0.3°/frame). A slow steady drag should stop
      //     immediately on release rather than slipping past the user's
      //     intended pose.
      const since = e.timeStamp - this._lastMoveTime;
      const rotVel = Math.hypot(this._inertia.pitch, this._inertia.yaw, this._inertia.roll);
      const FLING_TIMEOUT_MS = 50;
      const FLING_MIN_VEL = 0.005; // rad/frame ≈ 0.29°
      if (since > FLING_TIMEOUT_MS || rotVel < FLING_MIN_VEL) {
        this._inertia.pitch = 0;
        this._inertia.yaw = 0;
        this._inertia.roll = 0;
      }
      // Pinch inertia gets the same treatment, just measured against the
      // multiplicative scale (1.0 = no zoom).
      const FLING_MIN_ZOOM = 0.005; // ~0.5%/frame
      if (since > FLING_TIMEOUT_MS || Math.abs(this._inertia.zoom - 1) < FLING_MIN_ZOOM) {
        this._inertia.zoom = 1;
      }
      this._dragging = false;
      this._twoFingerLastValid = false;
      this.dispatchEvent({ type: "end" });
    } else if (this._pointers.size === 1) {
      this._twoFingerLastValid = false;
    } else if (this._pointers.size === 2) {
      this._fillTwoFingerSnapshot(this._twoFingerLast);
      this._twoFingerLastValid = true;
    }
  }

  _onWheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const scale = Math.exp(e.deltaY * 0.001 * this.zoomSpeed);
    this._applyZoom(scale);
    this._changed = true;
  }

  // Fill `out` with the distance and angle between the first two pointers
  // in this._pointers, iterating the Map once without an array spread.
  _fillTwoFingerSnapshot(out) {
    let ax = 0, ay = 0, bx = 0, by = 0;
    let i = 0;
    for (const p of this._pointers.values()) {
      if (i === 0) { ax = p.x; ay = p.y; }
      else { bx = p.x; by = p.y; }
      if (++i === 2) break;
    }
    out.distance = Math.hypot(bx - ax, by - ay);
    out.angle = Math.atan2(by - ay, bx - ax);
  }

  // ---- math ----

  _applyEuler(dPitch, dYaw, dRoll) {
    // All rotations are camera-local: pitch around local X, yaw around
    // local Y, roll around local Z. Right-multiplying composes in local
    // frame, which keeps drag direction intuitive even when the camera is
    // upside-down after a pole crossing.
    this._tmpEuler.set(dPitch, dYaw, dRoll, "XYZ");
    this._tmpQuat.setFromEuler(this._tmpEuler);
    this._quat.multiply(this._tmpQuat);
    this._quat.normalize();
  }

  // Pixels of drag → radians of camera orbit, scaled so a point on the
  // globe surface stays roughly under the user's finger across zooms.
  //
  //   θ = (drag_px / clientHeight) · vFOV · (distance − globeRadius)
  //
  // The (distance − globeRadius) factor is what makes the drag feel
  // consistent: when the camera is close to the surface the same screen
  // gesture should produce a much smaller orbit, otherwise the globe flies
  // past your finger. Falls back to a small positive minimum so we don't
  // freeze rotation if the camera somehow gets right up against the globe.
  _anglePerPx() {
    const fov = (this.camera.fov || 45) * (Math.PI / 180);
    const h = this.dom.clientHeight || 800;
    const distFactor = Math.max(0.05, this._distance - this.globeRadius);
    return (fov / h) * distFactor;
  }

  _applyZoom(scale) {
    this._distance = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, this._distance * scale)
    );
  }

  _writeCameraTransform() {
    this._tmpVec3.set(0, 0, this._distance).applyQuaternion(this._quat);
    this.camera.position.copy(this.target).add(this._tmpVec3);
    this._tmpVec3.set(0, 1, 0).applyQuaternion(this._quat);
    this.camera.up.copy(this._tmpVec3);
    this.camera.lookAt(this.target);
  }

  // ---- frame tick ----

  update() {
    if (!this.enabled) return false;

    // Inertia (only after release — during drag, input handlers stamp
    // _changed directly).
    if (!this._dragging) {
      const eps = 1e-5;
      const decay = 1 - this.dampingFactor;
      const i = this._inertia;
      if (Math.abs(i.pitch) > eps || Math.abs(i.yaw) > eps || Math.abs(i.roll) > eps) {
        this._applyEuler(i.pitch, i.yaw, i.roll);
        i.pitch *= decay;
        i.yaw   *= decay;
        i.roll  *= decay;
        this._changed = true;
      } else {
        i.pitch = i.yaw = i.roll = 0;
      }
      if (Math.abs(i.zoom - 1) > eps) {
        this._applyZoom(i.zoom);
        i.zoom = 1 + (i.zoom - 1) * decay;
        this._changed = true;
      } else {
        i.zoom = 1;
      }
    }

    if (this._changed) {
      this._writeCameraTransform();
      this.dispatchEvent({ type: "change" });
      this._changed = false;
      return true;
    }
    return false;
  }

  dispose() {
    this.dom.removeEventListener("pointerdown", this._onPointerDown);
    this.dom.removeEventListener("pointermove", this._onPointerMove);
    this.dom.removeEventListener("pointerup", this._onPointerUp);
    this.dom.removeEventListener("pointercancel", this._onPointerUp);
    this.dom.removeEventListener("wheel", this._onWheel);
    this.dom.style.touchAction = this._priorTouchAction;
  }
}
