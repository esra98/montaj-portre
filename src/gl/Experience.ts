import {
  DirectionalLight,
  Fog,
  ImageBitmapLoader,
  MathUtils,
  Quaternion,
  Raycaster,
  Spherical,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { ATLAS, portraits } from '../content'
import type { Tier } from '../device'
import { Director, type Pose } from './Director'
import { LiveSlots, type Live } from './LiveSlots'
import { ModelCache } from './ModelCache'
import { createFloor, RADIUS, Ring } from './Ring'
import { RingInput } from './RingInput'
import { BG, Stage } from './Stage'
import { ease, tween } from './tween'

export type Mode = 'intro' | 'ring' | 'detail' | 'transition'

export interface ExperienceEvents {
  index: (index: number) => void
  mode: (mode: Mode, index: number) => void
  ready: () => void
  busy: (busy: boolean) => void
}

const FLOOR_Y = -0.95
/** Where a portrait is pulled out to for inspection. */
const DETAIL_TARGET = new Vector3(0, 0, RADIUS + 0.9)
const RING_SINK = -2.8
const IDENTITY = new Quaternion()

export class Experience {
  readonly stage: Stage
  readonly ring: Ring
  mode: Mode = 'intro'

  private readonly live: LiveSlots
  private readonly director: Director
  private readonly controls: OrbitControls
  private readonly raycaster = new Raycaster()
  private readonly ndc = new Vector2()
  private detail?: { slot: number; live: Live }
  private wide = true

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly tier: Tier,
    private readonly events: ExperienceEvents,
  ) {
    const stage = (this.stage = new Stage(canvas, tier))
    const { scene, camera } = stage

    this.ring = new Ring(portraits.length, portraits[0].aspect)
    scene.add(this.ring.group, createFloor(FLOOR_Y))
    scene.fog = new Fog(BG, 7, 15)

    // Key light rides with the camera so the piece stays lit as you walk round it.
    const key = new DirectionalLight('#fff3e3', 2.2)
    key.position.set(-1.4, 1.8, 0.6)
    key.target.position.set(0, 0, RADIUS + 0.5)
    camera.add(key)
    scene.add(key.target)

    const cache = new ModelCache(tier === 2 ? 3 : 1)
    this.live = new LiveSlots(
      stage,
      this.ring,
      cache,
      (slot, role) => portraits[slot].assets[role],
      tier === 2 ? 'full' : 'preview',
    )

    this.director = new Director(camera)
    this.controls = this.createControls()

    this.ring.onIndex = (index) => this.events.index(index)
    this.ring.onTargetIndex = (index) => {
      if (this.mode === 'ring') this.live.update(index)
    }

    stage.addTicker(this.ring.tick)
    stage.addTicker(this.director.tick)
    stage.addTicker((dt) => (this.controls.enabled ? this.controls.update(dt) : false))
    stage.onResize = (w, h) => this.layout(w, h)
    this.layout(innerWidth, innerHeight)

    new RingInput(canvas, this.ring, {
      enabled: () => this.mode === 'ring',
      wake: () => stage.wake(),
      tap: (x, y) => this.tap(x, y),
      hover: (x, y) => this.hover(x, y),
    })
  }

  // --- public API -----------------------------------------------------------

  async start(initial = 0) {
    this.events.busy(true)
    this.ring.setAtlas(await loadAtlas(), ATLAS.cols, ATLAS.rows)

    const end = initial * this.ring.step
    const start = end - this.ring.step * 6
    this.ring.set(start)
    this.live.update(initial)

    const from = this.introPose()
    const to = this.ringPose()
    this.director.lerpPose(from, to, 0)
    this.director.apply()
    this.events.ready()

    await tween(
      this.stage,
      3.6,
      (t) => {
        this.director.lerpPose(from, to, t)
        this.director.apply()
        this.ring.set(MathUtils.lerp(start, end, t))
      },
      ease.inOutQuart,
    )
    this.setMode('ring')
    this.director.parallaxEnabled = this.tier === 2
    this.events.busy(false)
  }

  next(direction: 1 | -1) {
    if (this.mode !== 'ring') return
    this.ring.goTo(this.ring.targetIndex + direction)
    this.stage.wake()
  }

  goTo(index: number) {
    if (this.mode !== 'ring') return
    this.ring.goTo(index)
    this.stage.wake()
  }

  async open(slot = this.ring.targetIndex) {
    if (this.mode !== 'ring') return
    this.mode = 'transition'
    if (this.ring.targetIndex !== slot) {
      this.ring.goTo(slot)
      this.live.update(slot)
    }
    this.stage.wake()
    await this.ring.whenSettled()

    this.events.busy(true)
    await this.live.get(slot)?.ready
    this.events.busy(false)
    const taken = this.live.get(slot)?.model ? this.live.take(slot) : undefined
    if (!taken) {
      this.mode = 'ring'
      return
    }

    this.detail = { slot, live: taken }
    this.setMode('detail', true)
    this.director.parallaxEnabled = false
    void this.live.upgrade(taken, portraits[slot].assets.full)

    const { wrapper } = taken
    this.stage.scene.attach(wrapper)
    const fromPos = wrapper.position.clone()
    const fromQuat = wrapper.quaternion.clone()
    const fromPose = this.director.current()
    const toPose = this.detailPose()
    const fromShift = this.director.shift.clone()
    const toShift = this.detailShift()

    await tween(this.stage, 1.5, (t) => {
      wrapper.position.lerpVectors(fromPos, DETAIL_TARGET, t)
      wrapper.quaternion.slerpQuaternions(fromQuat, IDENTITY, t)
      this.ring.group.position.y = RING_SINK * t
      this.director.lerpPose(fromPose, toPose, t)
      this.director.shift.lerpVectors(fromShift, toShift, t)
      this.director.applyShift()
      this.director.apply()
    })

    this.ring.group.visible = false
    this.director.active = false
    this.controls.target.copy(DETAIL_TARGET)
    this.controls.enabled = true
    this.controls.update()
    this.mode = 'detail'
  }

  async close() {
    if (this.mode !== 'detail' || !this.detail) return
    const { slot, live: taken } = this.detail
    this.mode = 'transition'
    this.setMode('ring', true)
    this.controls.enabled = false
    this.ring.group.visible = true

    // Arc back round the piece (spherical interpolation) instead of cutting
    // straight through it if the visitor is standing behind.
    const camera = this.stage.camera
    const fromLook = this.controls.target.clone()
    const fromOrbit = new Spherical().setFromVector3(camera.position.clone().sub(fromLook))
    const toPose = this.ringPose()
    const toOrbit = new Spherical().setFromVector3(toPose.position.clone().sub(toPose.look))
    fromOrbit.theta = MathUtils.euclideanModulo(fromOrbit.theta + Math.PI, Math.PI * 2) - Math.PI
    const fromShift = this.director.shift.clone()
    const toShift = this.ringShift()

    const { wrapper } = taken
    const fromPos = wrapper.position.clone()
    const home = new Vector3(0, 0, RADIUS)
    const orbit = new Spherical()
    this.director.active = true

    await tween(this.stage, 1.4, (t) => {
      wrapper.position.lerpVectors(fromPos, home, t)
      this.ring.group.position.y = RING_SINK * (1 - t)
      orbit.set(
        MathUtils.lerp(fromOrbit.radius, toOrbit.radius, t),
        MathUtils.lerp(fromOrbit.phi, toOrbit.phi, t),
        MathUtils.lerp(fromOrbit.theta, toOrbit.theta, t),
      )
      this.director.look.lerpVectors(fromLook, toPose.look, t)
      this.director.position.setFromSpherical(orbit).add(this.director.look)
      this.director.shift.lerpVectors(fromShift, toShift, t)
      this.director.applyShift()
      this.director.apply()
    })

    this.ring.group.position.y = 0
    this.ring.group.updateMatrixWorld(true)
    this.live.restore(slot, taken)
    wrapper.position.set(0, 0, 0)
    wrapper.quaternion.identity()
    this.detail = undefined
    this.setMode('ring')
    this.live.update(this.ring.targetIndex)
    this.director.parallaxEnabled = this.tier === 2
    this.stage.invalidate()
  }

  /** Model currently in the detail view (for AR export etc). */
  get detailSlot() {
    return this.detail?.slot
  }

  // --- internals ------------------------------------------------------------

  private setMode(mode: Mode, announceOnly = false) {
    if (!announceOnly) this.mode = mode
    this.canvas.dataset.mode = mode
    this.events.mode(mode, this.ring.targetIndex)
  }

  private createControls() {
    const controls = new OrbitControls(this.stage.camera, this.canvas)
    controls.enabled = false
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = false
    controls.rotateSpeed = 0.7
    controls.minDistance = 0.8
    controls.maxDistance = 3.4
    // Full 360° walk-around; stop just above the floor.
    controls.minPolarAngle = 0.2
    controls.maxPolarAngle = 1.9
    controls.addEventListener('change', () => this.stage.invalidate())
    return controls
  }

  private layout(width: number, height: number) {
    this.wide = width >= 900 && width > height
    const shift = this.mode === 'detail' ? this.detailShift() : this.ringShift()
    this.director.shift.copy(shift)
    this.director.resize(width, height)
    if (this.mode === 'ring') {
      const pose = this.ringPose()
      this.director.position.copy(pose.position)
      this.director.look.copy(pose.look)
      this.director.apply()
    }
  }

  private ringShift() {
    return this.wide ? new Vector2(0.2, 0) : new Vector2(0, 0.05)
  }

  private detailShift() {
    return this.wide ? new Vector2(0.2, 0) : new Vector2(0, 0.2)
  }

  private ringPose(): Pose {
    const distance = this.wide ? this.director.fit(1.6, 1, 0.54) : this.director.fit(0.8, 1, 0.85)
    return {
      position: new Vector3(0, 0.12, RADIUS + distance),
      look: new Vector3(0, 0.02, RADIUS),
    }
  }

  private introPose(): Pose {
    return {
      position: new Vector3(0, 5.5, RADIUS + 12),
      look: new Vector3(0, -0.4, 0),
    }
  }

  private detailPose(): Pose {
    const distance = this.wide ? this.director.fit(0.8, 1, 0.72) : this.director.fit(0.8, 1, 0.66)
    return {
      position: DETAIL_TARGET.clone().add(new Vector3(0, 0.08, distance)),
      look: DETAIL_TARGET.clone(),
    }
  }

  private pick(x: number, y: number): number | null {
    this.ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1)
    this.raycaster.setFromCamera(this.ndc, this.stage.camera)
    const [hit] = this.raycaster.intersectObjects([this.ring.posters, this.ring.drum], false)
    return hit?.object === this.ring.posters ? (hit.instanceId ?? null) : null
  }

  private tap(x: number, y: number) {
    const slot = this.pick(x, y)
    if (slot === null) return
    if (slot === this.ring.targetIndex) void this.open(slot)
    else this.goTo(slot)
  }

  private hover(x: number, y: number) {
    this.canvas.style.cursor = this.pick(x, y) === null ? 'grab' : 'pointer'
    if (this.director.parallaxEnabled) {
      this.director.setPointer((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1)
      this.stage.wake()
    }
  }
}

async function loadAtlas() {
  const bitmap = await new ImageBitmapLoader()
    .setOptions({ imageOrientation: 'flipY' })
    .loadAsync(ATLAS.url)
  const texture = new Texture(bitmap)
  texture.flipY = false // already flipped at decode
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}
