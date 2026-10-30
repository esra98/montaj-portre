import { Mesh, type Material, type Object3D, Texture } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)

interface Entry {
  root: Promise<Object3D>
  refs: number
  lastUsed: number
}

/**
 * Ref-counted glTF cache. Callers get a cheap clone (shared geometry and
 * materials). Unused models stay warm in a small LRU and are then disposed,
 * which keeps GPU memory bounded no matter how many of the 20 are visited.
 */
export class ModelCache {
  private entries = new Map<string, Entry>()

  constructor(private readonly keepIdle: number) {}

  async acquire(url: string): Promise<Object3D> {
    let entry = this.entries.get(url)
    if (!entry) {
      entry = { root: loader.loadAsync(url).then((gltf) => prepare(gltf.scene)), refs: 0, lastUsed: 0 }
      this.entries.set(url, entry)
    }
    entry.refs++
    try {
      return (await entry.root).clone()
    } catch (error) {
      entry.refs--
      this.entries.delete(url)
      throw error
    }
  }

  release(url: string) {
    const entry = this.entries.get(url)
    if (!entry) return
    entry.refs = Math.max(0, entry.refs - 1)
    entry.lastUsed = performance.now()
    this.evict()
  }

  private evict() {
    const idle = [...this.entries].filter(([, e]) => e.refs === 0).sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    while (idle.length > this.keepIdle) {
      const [url, entry] = idle.shift()!
      this.entries.delete(url)
      entry.root.then(dispose, () => {})
    }
  }
}

function prepare(root: Object3D) {
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    for (const material of materialsOf(obj)) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) value.anisotropy = 4
      }
    }
  })
  return root
}

function dispose(root: Object3D) {
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    obj.geometry.dispose()
    for (const material of materialsOf(obj)) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) value.dispose()
      }
      material.dispose()
    }
  })
}

function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}
