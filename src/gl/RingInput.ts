import type { Ring } from './Ring'

interface Callbacks {
  enabled: () => boolean
  wake: () => void
  tap: (x: number, y: number) => void
  hover: (x: number, y: number) => void
}

/**
 * Wheel, drag with momentum and snapping, all mapped onto the ring's target
 * angle. No scroll hijacking: the page itself never scrolls in the ring view.
 */
export class RingInput {
  private dragging = false
  private pointerId = -1
  private startX = 0
  private startY = 0
  private startTarget = 0
  private startTime = 0
  private lastX = 0
  private lastTime = 0
  private velocity = 0
  private wheelTimer = 0

  constructor(
    private readonly el: HTMLElement,
    private readonly ring: Ring,
    private readonly cb: Callbacks,
  ) {
    el.addEventListener('pointerdown', this.down)
    el.addEventListener('pointermove', this.move)
    el.addEventListener('pointerup', this.up)
    el.addEventListener('pointercancel', this.up)
    el.addEventListener('wheel', this.wheel, { passive: false })
  }

  /** Radians per pixel: a full-width drag turns about 2.5 slots. */
  private get perPixel() {
    return (this.ring.step * 2.5) / Math.max(320, this.el.clientWidth)
  }

  private down = (e: PointerEvent) => {
    if (!this.cb.enabled() || this.dragging) return
    this.dragging = true
    this.pointerId = e.pointerId
    this.startX = this.lastX = e.clientX
    this.startY = e.clientY
    this.startTime = this.lastTime = e.timeStamp
    this.startTarget = this.ring.target
    this.velocity = 0
    this.ring.stiffness = 18
    this.el.setPointerCapture(e.pointerId)
  }

  private move = (e: PointerEvent) => {
    if (!this.dragging) {
      if (e.pointerType === 'mouse' && this.cb.enabled()) this.cb.hover(e.clientX, e.clientY)
      return
    }
    if (e.pointerId !== this.pointerId) return
    const dt = Math.max(1, e.timeStamp - this.lastTime)
    this.velocity = 0.8 * ((e.clientX - this.lastX) / dt) + 0.2 * this.velocity
    this.lastX = e.clientX
    this.lastTime = e.timeStamp
    this.ring.target = this.startTarget - (e.clientX - this.startX) * this.perPixel
    this.cb.wake()
  }

  private up = (e: PointerEvent) => {
    if (!this.dragging || e.pointerId !== this.pointerId) return
    this.dragging = false
    this.ring.stiffness = 9
    const moved = Math.hypot(e.clientX - this.startX, e.clientY - this.startY)
    if (moved < 8 && e.timeStamp - this.startTime < 400) {
      this.ring.target = this.startTarget
      this.cb.tap(e.clientX, e.clientY)
      return
    }
    // Momentum: project the release velocity (px/ms) forward, then snap.
    this.ring.target -= this.velocity * 220 * this.perPixel
    this.ring.snap()
    this.cb.wake()
  }

  private wheel = (e: WheelEvent) => {
    if (!this.cb.enabled()) return
    e.preventDefault()
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    const pixels = e.deltaMode === 1 ? delta * 32 : delta
    this.ring.target += Math.max(-120, Math.min(120, pixels)) * this.perPixel * 0.8
    this.cb.wake()
    clearTimeout(this.wheelTimer)
    this.wheelTimer = window.setTimeout(() => {
      this.ring.snap()
      this.cb.wake()
    }, 140)
  }
}
