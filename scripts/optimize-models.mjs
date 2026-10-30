// Asset pipeline: raw/<id>/model.glb + raw/<id>/photo.jpg  →  public/assets/<id>/*
//
//   preview.glb  ring neighbours   meshopt (WASM decoder ~20 KB), 512px WebP
//   full.glb     detail view       meshopt, 1024px WebP
//   ar.glb       Android Scene Viewer / iOS USDZ export
//                real-world scale, lying flat, Draco + JPEG (max compatibility)
//   poster.webp  far ring slots + DOM index
//
// Then all posters are packed into one atlas (public/assets/atlas.webp) so the
// 17 far slots of the ring render in a single draw call.
//
// Usage: npm run assets            (all portraits in raw/)
//        npm run assets -- p01     (one portrait)

import { readdirSync, mkdirSync, statSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import {
  center,
  dedup,
  draco,
  meshopt,
  prune,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import draco3d from 'draco3dgltf'
import sharp from 'sharp'

const RAW = 'raw'
const OUT = 'public/assets'

// Triangle targets (absolute, so every portrait lands in the same budget no
// matter how dense the scan is).
const PROFILES = {
  // Neighbours are small on screen: no metal/roughness map, constant factors.
  // TRELLIS UV atlases have many seams, which caps simplification near 40k.
  preview: { triangles: 24_000, error: 0.03, texture: 512, quality: 72, flatPbr: true },
  full: { triangles: 140_000, error: 0.01, texture: 1024, quality: 85 },
  ar: { triangles: 140_000, error: 0.01, texture: 1024, quality: 88 },
}

// Placeholder physical size until the artist gives real measurements.
const DEFAULT_HEIGHT_CM = 33

// Poster atlas layout (5 × 4 = 20 slots).
const ATLAS = { cols: 5, rows: 4, tileW: 256, tileH: 416 }

await MeshoptEncoder.ready
await MeshoptSimplifier.ready

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptEncoder,
  })

const only = process.argv[2]
const ids = readdirSync(RAW).filter((id) => statSync(`${RAW}/${id}`).isDirectory() && (!only || id === only))

const report = []
for (const id of ids) {
  const src = `${RAW}/${id}/model.glb`
  if (!existsSync(src)) continue
  mkdirSync(`${OUT}/${id}`, { recursive: true })
  const meta = readMeta(id)

  for (const [name, profile] of Object.entries(PROFILES)) {
    const doc = await io.read(src)
    const before = countTriangles(doc)
    if (profile.flatPbr) {
      for (const material of doc.getRoot().listMaterials()) {
        material.setMetallicRoughnessTexture(null).setMetallicFactor(0.15).setRoughnessFactor(0.65)
      }
    }
    await doc.transform(
      dedup(),
      weld(),
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: Math.min(1, profile.triangles / before),
        error: profile.error,
      }),
    )
    if (meta.board) addBoard(doc, meta.board)
    await doc.transform(
      center({ pivot: name === 'ar' ? 'below' : 'center' }),
      prune(),
      textureCompress({
        encoder: sharp,
        targetFormat: name === 'ar' ? 'jpeg' : 'webp',
        resize: [profile.texture, profile.texture],
        quality: profile.quality,
      }),
    )

    if (name === 'ar') {
      placeOnTable(doc, meta.heightCm / 100)
      await doc.transform(draco({ method: 'edgebreaker' }))
    } else {
      normalizeHeight(doc)
      await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }))
    }

    const file = `${OUT}/${id}/${name}.glb`
    await io.write(file, doc)
    report.push({ id, file: `${name}.glb`, triangles: countTriangles(doc), kb: kb(file) })
  }

  const poster = `${OUT}/${id}/poster.webp`
  await sharp(`${RAW}/${id}/photo.jpg`)
    .resize(ATLAS.tileW * 2, ATLAS.tileH * 2, { fit: 'cover' })
    .webp({ quality: 82 })
    .toFile(poster)
  report.push({ id, file: 'poster.webp', triangles: '-', kb: kb(poster) })

  // Auxiliary 2D image (caricature / photo) for the detail panel.
  const image = `${OUT}/${id}/image.webp`
  await sharp(`${RAW}/${id}/photo.jpg`).resize({ width: 900, withoutEnlargement: true }).webp({ quality: 80 }).toFile(image)
  report.push({ id, file: 'image.webp', triangles: '-', kb: kb(image) })
}

await buildAtlas()
console.table(report)

// ---------------------------------------------------------------------------

function readMeta(id) {
  const file = `${RAW}/${id}/meta.json`
  const meta = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  return { heightCm: meta.heightCm ?? DEFAULT_HEIGHT_CM, board: meta.board }
}

/**
 * TRELLIS strips the background, so the wooden board the objects are fixed to
 * is lost. Rebuild it as a 12-triangle box. `coverX`/`coverY` are the fractions
 * of the board (from left / from top, measured on the photo) that the objects'
 * bounding box spans, which gives the board's size and position.
 */
function addBoard(doc, { color, coverX, coverY }) {
  const { min, max } = bounds(doc)
  const width = (max[0] - min[0]) / (coverX[1] - coverX[0])
  const height = (max[1] - min[1]) / (coverY[1] - coverY[0])
  const depth = height * 0.045
  const x0 = min[0] - coverX[0] * width
  const y1 = max[1] + coverY[0] * height
  const z1 = min[2] + depth * 0.15 // objects sink slightly into the surface
  const lo = [x0, y1 - height, z1 - depth]
  const hi = [x0 + width, y1, z1]

  const positions = []
  const normals = []
  const indices = []
  // One quad per face: [axis, sign]
  for (const [axis, sign] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
    const u = (axis + 1) % 3
    const v = (axis + 2) % 3
    const base = positions.length / 3
    for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const p = [0, 0, 0]
      p[axis] = sign > 0 ? hi[axis] : lo[axis]
      p[u] = a ? hi[u] : lo[u]
      p[v] = b ? hi[v] : lo[v]
      positions.push(...p)
      const n = [0, 0, 0]
      n[axis] = sign
      normals.push(...n)
    }
    // (u × v) points along +axis; flip winding for the negative face.
    if (sign > 0) indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    else indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
  }

  const buffer = doc.getRoot().listBuffers()[0]
  const accessor = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer)
  const linear = [1, 3, 5].map((i) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const material = doc.createMaterial('board').setBaseColorFactor([...linear, 1]).setRoughnessFactor(0.55).setMetallicFactor(0)
  const primitive = doc
    .createPrimitive()
    .setAttribute('POSITION', accessor('VEC3', new Float32Array(positions)))
    .setAttribute('NORMAL', accessor('VEC3', new Float32Array(normals)))
    .setIndices(accessor('SCALAR', new Uint16Array(indices)))
    .setMaterial(material)
  const node = doc.createNode('board').setMesh(doc.createMesh('board').addPrimitive(primitive))
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  scene.addChild(node)
}

function countTriangles(doc) {
  let count = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices()
      count += (indices ? indices.getCount() : prim.getAttribute('POSITION').getCount()) / 3
    }
  }
  return Math.round(count)
}

function bounds(doc) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const accessor of doc.getRoot().listAccessors()) {
    if (accessor.getType() !== 'VEC3') continue
    const isPosition = accessor.listParents().some((p) => p.getAttribute?.('POSITION') === accessor)
    if (!isPosition) continue
    const lo = accessor.getMin([])
    const hi = accessor.getMax([])
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], lo[i])
      max[i] = Math.max(max[i], hi[i])
    }
  }
  return { min, max }
}

/** Wraps the scene in a root node so the portrait is 1 unit tall (web). */
function normalizeHeight(doc) {
  const { min, max } = bounds(doc)
  wrapScene(doc, { scale: 1 / (max[1] - min[1]) })
}

/** Real-world size, lying face-up so it sits on a table in AR. */
function placeOnTable(doc, heightMeters) {
  const { min, max } = bounds(doc)
  const s = heightMeters / (max[1] - min[1])
  // -90° around X: the face (+Z) now points up (+Y); the back sits on the table.
  const r = Math.SQRT1_2
  wrapScene(doc, { scale: s, rotation: [-r, 0, 0, r], translation: [0, -min[2] * s, 0] })
}

function wrapScene(doc, { scale, rotation = [0, 0, 0, 1], translation = [0, 0, 0] }) {
  const root = doc.getRoot()
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  const wrapper = doc
    .createNode('portrait')
    .setScale([scale, scale, scale])
    .setRotation(rotation)
    .setTranslation(translation)
  for (const child of scene.listChildren()) {
    scene.removeChild(child)
    wrapper.addChild(child)
  }
  scene.addChild(wrapper)
}

async function buildAtlas() {
  const posters = readdirSync(OUT)
    .filter((id) => existsSync(`${OUT}/${id}/poster.webp`))
    .sort()
  if (!posters.length) return
  const { cols, rows, tileW, tileH } = ATLAS
  const composites = []
  for (let i = 0; i < cols * rows; i++) {
    // Until all 20 portraits exist, cycle the ones we have.
    const id = posters[i % posters.length]
    const tile = await sharp(`${OUT}/${id}/poster.webp`).resize(tileW, tileH).toBuffer()
    composites.push({ input: tile, left: (i % cols) * tileW, top: Math.floor(i / cols) * tileH })
  }
  await sharp({
    create: { width: cols * tileW, height: rows * tileH, channels: 3, background: '#000' },
  })
    .composite(composites)
    .webp({ quality: 80 })
    .toFile(`${OUT}/atlas.webp`)
  writeFileSync(`${OUT}/atlas.json`, JSON.stringify({ cols, rows, ids: posters }, null, 2))
  report.push({ id: '*', file: 'atlas.webp', triangles: '-', kb: kb(`${OUT}/atlas.webp`) })
}

function kb(file) {
  return Math.round(statSync(file).size / 1024)
}
