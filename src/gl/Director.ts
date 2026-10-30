import { MathUtils, type PerspectiveCamera, Vector2, Vector3 } from 'three'
import { damp } from './tween'

export interface Pose {
  position: Vector3
  look: Vector3
}

/**
 * Owns the camera outside of the detail view: a base pose (set by tweens)
 * plus a damped cursor parallax, and the view offset that shifts the scene
 * aside to make room for text columns.
 */
export class Director {
  readonly position = new Vector3()
  readonly look = new Vector3()
  /** Fraction of the viewport the scene is shifted by (+x right, +y up). */
  readonly shift = new Vector2()
  active = true
  parallaxEnabled = false

  private readonly pointer = new Vector2()
  private readonly parallax = new Vector2()
  private width = 1
  private height = 1

  constructor(private readonly camera: PerspectiveCamera) {}

  resize(width: number, height: number) {
    this.width = width
    this.height = height
    this.applyShift()
  }

  applyShift() {
    const { width: w, height: h } = this
    this.camera.setViewOffset(w, h, -this.shift.x * w, this.shift.y * h, w, h)
  }

  /** Distance at which a box of `width`×`height` fills `fill` of the view. */
  fit(width: number, height: number, fill: number) {
    const tan = Math.tan(MathUtils.degToRad(this.camera.fov / 2))
    const byHeight = height / 2 / (tan * fill)
    const byWidth = width / 2 / (tan * this.camera.aspect * fill)
    return Math.max(byHeight, byWidth)
  }

  setPointer(x: number, y: number) {
    this.pointer.set(x, y)
  }

  lerpPose(from: Pose, to: Pose, t: number) {
    this.position.lerpVectors(from.position, to.position, t)
    this.look.lerpVectors(from.look, to.look, t)
  }

  current(): Pose {
    return { position: this.position.clone(), look: this.look.clone() }
  }

  tick = (dt: number) => {
    if (!this.active) return false
    const tx = this.parallaxEnabled ? this.pointer.x : 0
    const ty = this.parallaxEnabled ? this.pointer.y : 0
    this.parallax.set(damp(this.parallax.x, tx, 3, dt), damp(this.parallax.y, ty, 3, dt))
    this.apply()
    return Math.abs(this.parallax.x - tx) > 1e-4 || Math.abs(this.parallax.y - ty) > 1e-4
  }

  /** Push the pose to the camera (call after changing position/look). */
  apply() {
    if (!this.active) return
    this.camera.position.set(
      this.position.x + this.parallax.x * 0.12,
      this.position.y + this.parallax.y * 0.07,
      this.position.z,
    )
    this.camera.lookAt(this.look)
  }
}
