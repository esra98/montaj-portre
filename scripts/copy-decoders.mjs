// Copies the WASM decoders that ship with three.js into /public so they are
// self-hosted (no third-party CDN, immutable caching, works offline).
import { cpSync, existsSync, mkdirSync } from 'node:fs'

const src = 'node_modules/three/examples/jsm/libs/draco/gltf'
const dest = 'public/decoders/draco'

if (existsSync(src)) {
  mkdirSync(dest, { recursive: true })
  for (const file of ['draco_decoder.wasm', 'draco_wasm_wrapper.js']) {
    cpSync(`${src}/${file}`, `${dest}/${file}`)
  }
  console.log('[decoders] draco → public/decoders/draco')
}
