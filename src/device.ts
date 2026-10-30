/**
 * 0 — no WebGL2: static DOM gallery
 * 1 — mobile / low memory: preview models in the ring, DPR ≤ 1.5
 * 2 — desktop: full model in the front slot, DPR ≤ 2
 */
export type Tier = 0 | 1 | 2

export function detectTier(): Tier {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')
  if (!gl) return 0
  gl.getExtension('WEBGL_lose_context')?.loseContext()

  const coarse = matchMedia('(pointer: coarse)').matches
  const small = Math.min(screen.width, screen.height) < 700
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  const cores = navigator.hardwareConcurrency ?? 8
  return coarse || small || memory <= 4 || cores <= 4 ? 1 : 2
}

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
