import {
  Color,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  type Texture,
} from 'three'
import { BG } from './Stage'

export const RADIUS = 3.4
const DRUM_HEIGHT = 1.5
/** Posters sit on the board plane, just behind the relief objects. */
const POSTER_Z = -0.04

const TAU = Math.PI * 2

/**
 * The rotunda: 20 slots on the outside of a drum, facing outward. The front
 * slot (+Z) is the one being looked at. All posters are one InstancedMesh with
 * an atlas texture → a single draw call regardless of portrait count.
 */
export class Ring {
  readonly group = new Group()
  readonly slots: Group[] = []
  readonly posters: InstancedMesh
  readonly drum: Mesh
  readonly step: number

  angle = 0
  target = 0
  stiffness = 9

  onIndex?: (index: number) => void
  onTargetIndex?: (index: number) => void

  private readonly hidden: InstancedBufferAttribute
  private readonly posterMaterial: ShaderMaterial
  private lastIndex = -1
  private lastTargetIndex = -1
  private settleWaiters: (() => void)[] = []

  constructor(
    readonly count: number,
    aspect: number,
  ) {
    this.step = TAU / count

    const matrix = new Matrix4()
    const offset = new Matrix4().makeTranslation(0, 0, POSTER_Z)
    const tiles = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      const slot = new Group()
      const theta = i * this.step
      slot.position.set(Math.sin(theta) * RADIUS, 0, Math.cos(theta) * RADIUS)
      slot.rotation.y = theta
      slot.updateMatrix()
      this.slots.push(slot)
      this.group.add(slot)
      tiles[i] = i
    }

    this.posterMaterial = new ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uGrid: { value: [1, 1] },
        uRadius: { value: RADIUS },
      },
      vertexShader: POSTER_VERT,
      fragmentShader: POSTER_FRAG,
    })
    const plane = new PlaneGeometry(aspect, 1)
    this.hidden = new InstancedBufferAttribute(new Float32Array(count), 1)
    plane.setAttribute('aTile', new InstancedBufferAttribute(tiles, 1))
    plane.setAttribute('aHidden', this.hidden)
    this.posters = new InstancedMesh(plane, this.posterMaterial, count)
    for (let i = 0; i < count; i++) {
      this.posters.setMatrixAt(i, matrix.multiplyMatrices(this.slots[i].matrix, offset))
    }
    this.posters.computeBoundingSphere()
    this.posters.visible = false // until the atlas arrives
    this.group.add(this.posters)

    this.drum = new Mesh(
      new CylinderGeometry(RADIUS - 0.1, RADIUS - 0.1, DRUM_HEIGHT, 120, 1, true),
      new MeshStandardMaterial({ color: '#191613', roughness: 0.92, metalness: 0 }),
    )
    this.group.add(this.drum)

    // Two hairline light strips, like gallery LED rails.
    const strip = new CylinderGeometry(RADIUS - 0.095, RADIUS - 0.095, 0.006, 120, 1, true)
    const stripMaterial = new MeshBasicMaterial({ color: '#d9c7ae', fog: true })
    for (const y of [DRUM_HEIGHT / 2 - 0.04, -DRUM_HEIGHT / 2 + 0.04]) {
      const mesh = new Mesh(strip, stripMaterial)
      mesh.position.y = y
      this.group.add(mesh)
    }
  }

  setAtlas(texture: Texture, cols: number, rows: number) {
    this.posterMaterial.uniforms.uMap.value = texture
    this.posterMaterial.uniforms.uGrid.value = [cols, rows]
    this.posters.visible = true
  }

  /** Hide a slot's poster once its live model is in place. */
  setHidden(slot: number, hidden: boolean) {
    this.hidden.setX(slot, hidden ? 1 : 0)
    this.hidden.needsUpdate = true
  }

  wrap(index: number) {
    return ((index % this.count) + this.count) % this.count
  }

  get index() {
    return this.wrap(Math.round(this.angle / this.step))
  }

  get targetIndex() {
    return this.wrap(Math.round(this.target / this.step))
  }

  get settled() {
    return Math.abs(this.target - this.angle) < 1e-4
  }

  snap() {
    this.target = Math.round(this.target / this.step) * this.step
  }

  /** Rotate to `index` along the shortest way round. */
  goTo(index: number) {
    const half = this.count / 2
    let delta = this.wrap(index - this.targetIndex)
    if (delta >= half) delta -= this.count
    this.target = Math.round(this.target / this.step) * this.step + delta * this.step
  }

  whenSettled(): Promise<void> {
    if (this.settled) return Promise.resolve()
    return new Promise((resolve) => this.settleWaiters.push(resolve))
  }

  /** Jump without animation (intro / reduced motion). */
  set(angle: number) {
    this.angle = this.target = angle
    this.apply()
  }

  tick = (dt: number) => {
    if (this.settled) {
      if (this.angle !== this.target) {
        this.angle = this.target
        this.apply()
      }
      for (const resolve of this.settleWaiters.splice(0)) resolve()
      return false
    }
    this.angle += (this.target - this.angle) * (1 - Math.exp(-this.stiffness * dt))
    this.apply()
    return true
  }

  private apply() {
    this.group.rotation.y = -this.angle
    const index = this.index
    if (index !== this.lastIndex) {
      this.lastIndex = index
      this.onIndex?.(index)
    }
    const targetIndex = this.targetIndex
    if (targetIndex !== this.lastTargetIndex) {
      this.lastTargetIndex = targetIndex
      this.onTargetIndex?.(targetIndex)
    }
  }
}

const POSTER_VERT = /* glsl */ `
  attribute float aTile;
  attribute float aHidden;
  uniform vec2 uGrid;
  uniform float uRadius;
  varying vec2 vUv;
  varying float vFront;
  varying float vHidden;

  void main() {
    vec4 center = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vFront = clamp(center.z / uRadius, -1.0, 1.0);
    float col = mod(aTile, uGrid.x);
    float row = floor(aTile / uGrid.x);
    vUv = (vec2(col, uGrid.y - 1.0 - row) + uv) / uGrid;
    vHidden = aHidden;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }
`

// Depth cue for free: slots further round the drum sample a blurrier mip
// (fake depth of field) and fall off into the dark.
const POSTER_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying float vFront;
  varying float vHidden;

  void main() {
    if (vHidden > 0.5) discard;
    float f = smoothstep(-0.1, 1.0, vFront);
    vec3 color = texture2D(uMap, vUv, (1.0 - f) * 3.5).rgb;
    color *= mix(0.08, 0.95, f * f);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`

/** Large floor with a baked-looking glow around the drum and a pool of light in front. */
export function createFloor(y: number) {
  const material = new ShaderMaterial({
    uniforms: {
      uBg: { value: BG },
      uWarm: { value: new Color('#3a2f25') },
      uRadius: { value: RADIUS },
    },
    vertexShader: /* glsl */ `
      varying vec2 vPos;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vPos = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBg;
      uniform vec3 uWarm;
      uniform float uRadius;
      varying vec2 vPos;
      void main() {
        float d = length(vPos);
        float halo = exp(-pow((d - uRadius) / 1.4, 2.0));
        vec2 p = vPos - vec2(0.0, uRadius + 1.2);
        float pool = exp(-dot(p, p) / 2.2);
        float fade = 1.0 - smoothstep(4.0, 14.0, d);
        vec3 color = uBg + uWarm * (halo * 0.35 + pool * 0.8) * fade;
        // Dither to avoid banding in the dark gradient.
        float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        color += (n - 0.5) / 255.0;
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
  })
  const floor = new Mesh(new PlaneGeometry(40, 40), material)
  floor.rotation.x = -Math.PI / 2
  floor.position.y = y
  return floor
}
