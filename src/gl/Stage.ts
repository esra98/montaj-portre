import {
  Color,
  NeutralToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { Tier } from '../device'

/** Returns true while it still needs frames. */
export type Ticker = (dt: number) => boolean

export const BG = new Color('#0e0d0c')

/**
 * Renderer + render-on-demand loop. The RAF loop only runs while a ticker is
 * active (spring, tween, damping) or frames were requested; a still page costs
 * zero GPU time.
 */
export class Stage {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(32, 1, 0.05, 60)

  private readonly tickers = new Set<Ticker>()
  private pendingFrames = 0
  private raf = 0
  private last = 0
  private readonly maxDpr: number

  // Adaptive resolution: drop DPR when sustained frame time is too high.
  private slowFrames = 0
  private sampledFrames = 0

  private readonly stats: HTMLElement | null

  constructor(canvas: HTMLCanvasElement, tier: Tier) {
    this.maxDpr = tier === 2 ? 2 : 1.5
    const dpr = Math.min(devicePixelRatio, this.maxDpr)
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: dpr < 2,
      powerPreference: 'high-performance',
      stencil: false,
    })
    this.renderer.setPixelRatio(dpr)
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = NeutralToneMapping
    this.renderer.setClearColor(BG)

    // One-off procedural studio environment (no HDR download).
    const pmrem = new PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.55
    pmrem.dispose()

    this.scene.add(this.camera)

    this.stats = new URLSearchParams(location.search).has('debug') ? createStats() : null

    addEventListener('resize', this.resize)
    this.resize()
  }

  onResize?: (width: number, height: number) => void

  private resize = () => {
    const { innerWidth: w, innerHeight: h } = window
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.onResize?.(w, h)
    this.camera.updateProjectionMatrix()
    this.invalidate()
  }

  invalidate(frames = 1) {
    this.pendingFrames = Math.max(this.pendingFrames, frames)
    this.wake()
  }

  addTicker(ticker: Ticker): () => void {
    this.tickers.add(ticker)
    this.wake()
    return () => this.tickers.delete(ticker)
  }

  wake() {
    if (this.raf) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  private loop = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now

    let active = false
    for (const ticker of this.tickers) if (ticker(dt)) active = true

    this.renderer.render(this.scene, this.camera)
    if (this.pendingFrames > 0) this.pendingFrames--
    if (active) this.govern(dt)
    if (this.stats) updateStats(this.stats, this.renderer)

    this.raf = active || this.pendingFrames > 0 ? requestAnimationFrame(this.loop) : 0
  }

  private govern(dt: number) {
    if (dt > 0.1) return // tab switch / shader compile hitch, not a trend
    this.sampledFrames++
    if (dt > 1 / 45) this.slowFrames++
    if (this.sampledFrames < 90) return
    const ratio = this.renderer.getPixelRatio()
    if (this.slowFrames > 45 && ratio > 1) {
      this.renderer.setPixelRatio(Math.max(1, ratio - 0.25))
      this.resize()
    }
    this.sampledFrames = this.slowFrames = 0
  }
}

function createStats() {
  const el = document.createElement('pre')
  el.className = 'stats'
  document.body.append(el)
  return el
}

function updateStats(el: HTMLElement, renderer: WebGLRenderer) {
  const { render, memory } = renderer.info
  el.textContent =
    `calls ${render.calls}  tris ${render.triangles.toLocaleString()}\n` +
    `geo ${memory.geometries}  tex ${memory.textures}  dpr ${renderer.getPixelRatio()}`
}
