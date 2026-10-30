import { reducedMotion } from '../device'
import type { Stage } from './Stage'

export type Easing = (t: number) => number

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  inOutQuart: (t: number) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  outExpo: (t: number) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
}

/** Minimal tween driven by the stage loop (no extra RAF, no library). */
export function tween(
  stage: Stage,
  duration: number,
  onUpdate: (t: number) => void,
  easing: Easing = ease.inOutCubic,
): Promise<void> {
  if (reducedMotion || duration <= 0) {
    onUpdate(1)
    stage.invalidate()
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    let elapsed = 0
    const remove = stage.addTicker((dt) => {
      elapsed += dt
      const t = Math.min(1, elapsed / duration)
      onUpdate(easing(t))
      if (t < 1) return true
      remove()
      resolve()
      return false
    })
  })
}

/** Frame-rate independent exponential damping. */
export function damp(current: number, target: number, lambda: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}
