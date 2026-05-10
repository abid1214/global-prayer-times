import * as THREE from "three";

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
    this.rotateSpeed = 0.005;
    this.zoomSpeed = 0.6;
    this.dampingFactor = 0.04;
    this.enabled = true;

    this._distance = camera.position.distanceTo(this.target);
    this._quat = new THREE.Quaternion();
    // Initial quaternion: rotate the default offset (0,0,d) onto the current
    // camera direction. Subsequent input rotations are layered on top.
    const dir = new THREE.Vector3().subVectors(camera.position, this.target).normalize();
    this._quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);

    this._pointers = new Map();
    this._twoFingerLast = null;
    this._inertia = { pitch: 0, yaw: 0, roll: 0, zoom: 1 };
    this._dragging = false;

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
    domElement.style.touchAction = "none";

    this._writeCameraTransform();
  }

  // ---- input handlers ----

  _onPointerDown(e) {
    if (!this.enabled) return;
    this.dom.setPointerCapture(e.pointerId);
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this._pointers.size === 2) this._twoFingerLast = this._twoFingerSnapshot();
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
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._pointers.size === 1) {
      const dYaw = -dx * this.rotateSpeed;
      const dPitch = -dy * this.rotateSpeed;
      this._applyEuler(dPitch, dYaw, 0);
      this._inertia.pitch = dPitch;
      this._inertia.yaw = dYaw;
      this._inertia.roll = 0;
    } else if (this._pointers.size === 2) {
      const cur = this._twoFingerSnapshot();
      if (this._twoFingerLast) {
        // Pinch.
        const ratio = this._twoFingerLast.distance / cur.distance;
        const scale = Math.pow(ratio, this.zoomSpeed);
        this._applyZoom(scale);
        this._inertia.zoom = scale;
        // Twist. atan2 in screen-space (y-down) increases clockwise, which
        // matches what users expect: twist your fingers CW → scene CW.
        let dAngle = cur.angle - this._twoFingerLast.angle;
        if (dAngle > Math.PI) dAngle -= 2 * Math.PI;
        if (dAngle < -Math.PI) dAngle += 2 * Math.PI;
        const dRoll = dAngle;
        this._applyEuler(0, 0, dRoll);
        this._inertia.roll = dRoll;
      }
      this._twoFingerLast = cur;
    }
    this._writeCameraTransform();
    this.dispatchEvent({ type: "change" });
  }

  _onPointerUp(e) {
    if (!this._pointers.has(e.pointerId)) return;
    this._pointers.delete(e.pointerId);
    try { this.dom.releasePointerCapture(e.pointerId); } catch (_) {}
    if (this._pointers.size === 0) {
      this._dragging = false;
      this.dispatchEvent({ type: "end" });
    } else if (this._pointers.size === 1) {
      this._twoFingerLast = null;
    } else if (this._pointers.size === 2) {
      this._twoFingerLast = this._twoFingerSnapshot();
    }
  }

  _onWheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const scale = Math.exp(e.deltaY * 0.001 * this.zoomSpeed);
    this._applyZoom(scale);
    this._writeCameraTransform();
    this.dispatchEvent({ type: "change" });
  }

  _twoFingerSnapshot() {
    const [a, b] = [...this._pointers.values()];
    return {
      distance: Math.hypot(b.x - a.x, b.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }

  // ---- math ----

  _applyEuler(dPitch, dYaw, dRoll) {
    // All rotations are camera-local: pitch around local X, yaw around
    // local Y, roll around local Z. Right-multiplying composes in local
    // frame, which keeps drag direction intuitive even when the camera is
    // upside-down after a pole crossing.
    const dq = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(dPitch, dYaw, dRoll, "XYZ")
    );
    this._quat.multiply(dq);
    this._quat.normalize();
  }

  _applyZoom(scale) {
    this._distance = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, this._distance * scale)
    );
  }

  _writeCameraTransform() {
    const offset = new THREE.Vector3(0, 0, this._distance).applyQuaternion(this._quat);
    this.camera.position.copy(this.target).add(offset);
    this.camera.up.set(0, 1, 0).applyQuaternion(this._quat);
    this.camera.lookAt(this.target);
  }

  // ---- frame tick ----

  update() {
    if (!this.enabled) return false;

    if (this._dragging) {
      // While dragging, motion is applied immediately on input. Return true
      // so the render loop keeps painting the latest camera.
      return true;
    }

    const eps = 1e-5;
    const decay = 1 - this.dampingFactor;
    let moved = false;

    const i = this._inertia;
    if (Math.abs(i.pitch) > eps || Math.abs(i.yaw) > eps || Math.abs(i.roll) > eps) {
      this._applyEuler(i.pitch, i.yaw, i.roll);
      i.pitch *= decay;
      i.yaw   *= decay;
      i.roll  *= decay;
      moved = true;
    } else {
      i.pitch = i.yaw = i.roll = 0;
    }
    if (Math.abs(i.zoom - 1) > eps) {
      this._applyZoom(i.zoom);
      i.zoom = 1 + (i.zoom - 1) * decay;
      moved = true;
    } else {
      i.zoom = 1;
    }

    if (moved) {
      this._writeCameraTransform();
      this.dispatchEvent({ type: "change" });
    }
    return moved;
  }

  dispose() {
    this.dom.removeEventListener("pointerdown", this._onPointerDown);
    this.dom.removeEventListener("pointermove", this._onPointerMove);
    this.dom.removeEventListener("pointerup", this._onPointerUp);
    this.dom.removeEventListener("pointercancel", this._onPointerUp);
    this.dom.removeEventListener("wheel", this._onWheel);
  }
}
