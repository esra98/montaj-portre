import { Group, type Object3D } from 'three'
import type { ModelCache } from './ModelCache'
import type { Ring } from './Ring'
import type { Stage } from './Stage'

export type Role = 'preview' | 'full'

export interface Live {
  url: string
  wrapper: Group
  model?: Object3D
  /** Previous model kept on screen until this one is ready (no poster flash). */
  replacing?: Live
  ready: Promise<void>
}

/**
 * Real 3D models only for the front slot and its two neighbours; the other 17
 * stay posters. Loads follow the ring's *target*, so models start streaming as
 * soon as a swipe is released, before the ring arrives.
 */
export class LiveSlots {
  private live = new Map<number, Live>()

  constructor(
    private readonly stage: Stage,
    private readonly ring: Ring,
    private readonly cache: ModelCache,
    private readonly urlFor: (slot: number, role: Role) => string,
    private readonly frontRole: Role,
  ) {}

  update(center: number) {
    const want = new Map<number, string>()
    for (const d of [0, 1, -1]) {
      const slot = this.ring.wrap(center + d)
      want.set(slot, this.urlFor(slot, d === 0 ? this.frontRole : 'preview'))
    }
    for (const [slot, live] of this.live) {
      if (!want.has(slot)) this.drop(slot, live)
    }
    for (const [slot, url] of want) {
      const current = this.live.get(slot)
      if (current?.url !== url) this.load(slot, url, current)
    }
  }

  get(slot: number) {
    return this.live.get(slot)
  }

  /** Detach a slot's live model (detail view). The ring won't touch it. */
  take(slot: number): Live | undefined {
    const live = this.live.get(slot)
    this.live.delete(slot)
    return live
  }

  /** Give a taken model back to its slot. */
  restore(slot: number, live: Live) {
    const existing = this.live.get(slot)
    if (existing) this.drop(slot, existing)
    this.live.set(slot, live)
    this.ring.slots[slot].attach(live.wrapper)
    this.ring.setHidden(slot, true)
  }

  /** Swap the model inside a wrapper (e.g. preview → full in the detail view). */
  async upgrade(live: Live, url: string) {
    if (live.url === url) return
    const model = await this.cache.acquire(url)
    await this.stage.renderer.compileAsync(model, this.stage.camera, this.stage.scene)
    const old = live.model
    const oldUrl = live.url
    live.wrapper.add(model)
    live.model = model
    live.url = url
    if (old) {
      old.removeFromParent()
      this.cache.release(oldUrl)
    }
    this.stage.invalidate()
  }

  private load(slot: number, url: string, replacing?: Live) {
    const live: Live = { url, wrapper: new Group(), replacing, ready: Promise.resolve() }
    this.live.set(slot, live)
    live.ready = this.populate(slot, live)
  }

  private async populate(slot: number, live: Live) {
    const { url, replacing } = live
    const isCurrent = () => this.live.get(slot) === live

    let model: Object3D
    try {
      model = await this.cache.acquire(url)
      // Compile off the critical path (KHR_parallel_shader_compile) so the
      // swap from poster to model never hitches.
      await this.stage.renderer.compileAsync(model, this.stage.camera, this.stage.scene)
    } catch (error) {
      console.warn('[live] failed to load', url, error)
      if (isCurrent()) {
        if (replacing) this.live.set(slot, replacing)
        else this.live.delete(slot)
      }
      return
    }
    if (!isCurrent()) {
      this.cache.release(url)
      return
    }

    live.wrapper.add(model)
    live.model = model
    this.ring.slots[slot].add(live.wrapper)
    this.ring.setHidden(slot, true)
    if (live.replacing) {
      this.dispose(live.replacing)
      live.replacing = undefined
    }
    this.stage.invalidate()
  }

  private drop(slot: number, live: Live) {
    this.live.delete(slot)
    this.dispose(live)
    this.ring.setHidden(slot, false)
    this.stage.invalidate()
  }

  private dispose(live: Live) {
    if (live.replacing) this.dispose(live.replacing)
    live.wrapper.removeFromParent()
    if (live.model) this.cache.release(live.url)
    live.model = undefined
  }
}
