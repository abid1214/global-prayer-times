import * as THREE from "three";

// Reused input to setFromUnitVectors (read-only) — avoids allocating per call.
const _FORWARD = new THREE.Vector3(0, 0, 1);

// Quaternion-based orbit controls, replacing OrbitControls so a vertical drag
// can flick past the poles (no spherical clamp) and a two-finger twist rolls the
// view. Rotations are camera-local (drag-right always spins the world right,
// even upside-down after a pole crossing); camera.up follows the quaternion.
// Public surface mirrors the OrbitControls bits main.js used: update(),
// addEventListener('change'|'start'|'end'), target/min·maxDistance/
// dampingFactor/rotateSpeed/zoomSpeed/enabled, dispose().
export class GlobeControls extends THREE.EventDispatcher {
  constructor(camera, domElement) {
    super();
    this.camera = camera;
    this.dom = domElement;
    this.target = new THREE.Vector3(0, 0, 0);
    this.minDistance = 1.25;
    this.maxDistance = 8;
    // Multiplier on a zoom-aware angle-per-pixel (see _anglePerPx), not rad/px.
    this.rotateSpeed = 1.5;
    this.zoomSpeed = 0.6;
    this.dampingFactor = 0.04;
    this.globeRadius = 1; // scales rotation against camera distance
    this.enabled = true;

    this._distance = camera.position.distanceTo(this.target);
    this._quat = new THREE.Quaternion();
    // Rotate the default offset (0,0,d) onto the current camera direction.
    {
      const dir = new THREE.Vector3().subVectors(camera.position, this.target).normalize();
      this._quat.setFromUnitVectors(_FORWARD, dir);
    }

    // Scratch instances reused per input/frame to avoid GC churn; never escape.
    this._tmpQuat = new THREE.Quaternion();
    this._tmpEuler = new THREE.Euler(0, 0, 0, "XYZ");
    this._tmpVec3 = new THREE.Vector3();

    this._pointers = new Map();
    // Two-finger snapshots reused in place (no per-move allocation).
    this._twoFingerCur = { distance: 0, angle: 0 };
    this._twoFingerLast = { distance: 0, angle: 0 };
    this._twoFingerLastValid = false;
    this._inertia = { pitch: 0, yaw: 0, roll: 0, zoom: 1 };
    this._dragging = false;
    // Last input time — on release, decides fling vs. snap (a slow/paused drag
    // shouldn't keep coasting past the user's intended pose).
    this._lastMoveTime = 0;
    // Set when input/inertia changed _quat/_distance this tick; drives the
    // 'change' dispatch and update()'s return (main.js gates adaptive DPR on it).
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
    // Suppress the browser's own scroll/pinch while we capture touches; restore on dispose.
    this._priorTouchAction = domElement.style.touchAction;
    domElement.style.touchAction = "none";

    this._writeCameraTransform();
  }

  _resetInertia() {
    this._inertia.pitch = 0;
    this._inertia.yaw = 0;
    this._inertia.roll = 0;
    this._inertia.zoom = 1;
  }

  // Recompute internal state from the current camera transform — call after the
  // camera is moved outside the controls (e.g. flyTo animates camera.position),
  // else the next gesture applies deltas to stale state. Picks the shortest-arc
  // quaternion (discards prior roll, fine for go-to) and clears inertia.
  syncFromCamera() {
    this._resetInertia();
    const rawDistance = this.camera.position.distanceTo(this.target);
    // Camera on top of target → offset direction undefined; leave last-known-good
    // state so an animation grazing the origin resumes cleanly next frame.
    if (rawDistance < 1e-6) return;
    this._distance = Math.max(this.minDistance, Math.min(this.maxDistance, rawDistance));
    this._tmpVec3.subVectors(this.camera.position, this.target).normalize();
    this._quat.setFromUnitVectors(_FORWARD, this._tmpVec3);
    // Write back now so camera.up doesn't carry the old roll into the next gesture.
    this._writeCameraTransform();
    // Mark dirty so update() reports motion (keeps main.js's adaptive DPR at 1× during flight).
    this._changed = true;
  }

  // ---- input handlers ----

  _onPointerDown(e) {
    if (!this.enabled) return;
    // Ignore 3rd+ touches (usually a resting finger); the first two stay authoritative.
    if (this._pointers.size >= 2) return;
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
    this._resetInertia(); // re-grab kills any in-flight inertia
  }

  _onPointerMove(e) {
    if (!this.enabled || !this._pointers.has(e.pointerId)) return;
    const prev = this._pointers.get(e.pointerId);
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (dx === 0 && dy === 0) return; // resting finger — don't mark dirty
    // Mutate the existing record in place (no allocation).
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
      // Guard the pinch ratio against coincident pointers (distance ≈ 0 →
      // Infinity/NaN that would contaminate _distance / _inertia.zoom).
      const MIN_PINCH = 1e-3;
      if (this._twoFingerLastValid && cur.distance > MIN_PINCH && last.distance > MIN_PINCH) {
        // Pinch.
        const ratio = last.distance / cur.distance;
        const scale = Math.pow(ratio, this.zoomSpeed);
        if (Number.isFinite(scale) && scale > 0) {
          this._applyZoom(scale);
          this._inertia.zoom = scale;
        }
        // Twist (screen-space atan2 increases CW → fingers CW = scene CW).
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
    // Camera write + 'change' happen in update() — one event per frame.
  }

  _onPointerUp(e) {
    if (!this._pointers.has(e.pointerId)) return;
    this._pointers.delete(e.pointerId);
    try { this.dom.releasePointerCapture(e.pointerId); } catch (_) {}
    if (this._pointers.size === 0) {
      // Coast (fling) vs. snap: kill inertia if the user paused before lifting
      // (>~50ms) or the rotational velocity is imperceptible (~0.3°/frame).
      const since = e.timeStamp - this._lastMoveTime;
      const rotVel = Math.hypot(this._inertia.pitch, this._inertia.yaw, this._inertia.roll);
      const FLING_TIMEOUT_MS = 50;
      const FLING_MIN_VEL = 0.005; // rad/frame ≈ 0.29°
      if (since > FLING_TIMEOUT_MS || rotVel < FLING_MIN_VEL) {
        this._inertia.pitch = 0;
        this._inertia.yaw = 0;
        this._inertia.roll = 0;
      }
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

  // Distance and angle between the first two pointers, written into `out`
  // (no array allocation — see _twoFingerCur/_twoFingerLast in the ctor).
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

  // Camera-local rotation (pitch=X, yaw=Y, roll=Z); right-multiply composes in
  // local frame, keeping drag direction intuitive even when upside-down.
  _applyEuler(dPitch, dYaw, dRoll) {
    this._tmpEuler.set(dPitch, dYaw, dRoll, "XYZ");
    this._tmpQuat.setFromEuler(this._tmpEuler);
    this._quat.multiply(this._tmpQuat);
    this._quat.normalize();
  }

  // Drag px → orbit radians, scaled by (distance − globeRadius) so a surface
  // point stays under the finger across zooms; clamped to a small minimum.
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

    // Inertia only after release — during drag the handlers stamp _changed.
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
