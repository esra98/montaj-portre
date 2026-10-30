import type { Portrait } from './content'

export type ArMode = 'quicklook' | 'sceneviewer' | null

/** iOS → AR Quick Look (USDZ), Android → Scene Viewer (glb), else none. */
export function arMode(): ArMode {
  const anchor = document.createElement('a')
  if (anchor.relList?.supports?.('ar')) return 'quicklook'
  if (/android/i.test(navigator.userAgent)) return 'sceneviewer'
  return null
}

const usdzCache = new Map<string, Promise<string>>()

/**
 * Start building the USDZ as soon as the detail view opens, so the tap on
 * "View on your table" can open Quick Look straight away.
 */
export function prepareAR(portrait: Portrait) {
  if (arMode() !== 'quicklook') return
  usdzFor(portrait).catch((error) => console.warn('[ar] usdz export failed', error))
}

export async function launchAR(portrait: Portrait, title: string) {
  const mode = arMode()
  const glb = new URL(portrait.assets.ar, location.href).href

  if (mode === 'sceneviewer') {
    // resizable=false keeps the portrait at its true physical size.
    const params = new URLSearchParams({ file: glb, mode: 'ar_preferred', title, resizable: 'false' })
    const fallback = encodeURIComponent(location.href)
    location.href =
      `intent://arvr.google.com/scene-viewer/1.0?${params}` +
      `#Intent;scheme=https;package=com.google.android.googlequicksearchbox;` +
      `action=android.intent.action.VIEW;S.browser_fallback_url=${fallback};end;`
    return
  }

  if (mode === 'quicklook') {
    const url = await usdzFor(portrait)
    const anchor = document.createElement('a')
    anchor.rel = 'ar'
    // Fixed scale: the visitor sees the real size of the board.
    anchor.href = `${url}#allowsContentScaling=0`
    anchor.append(document.createElement('img'))
    anchor.click()
  }
}

function usdzFor(portrait: Portrait) {
  let pending = usdzCache.get(portrait.id)
  if (!pending) {
    pending = exportUSDZ(portrait.assets.ar)
    usdzCache.set(portrait.id, pending)
    pending.catch(() => usdzCache.delete(portrait.id))
  }
  return pending
}

/** Loaded only on iOS, only when needed: GLTF + Draco → USDZ in the browser. */
async function exportUSDZ(url: string) {
  const [{ GLTFLoader }, { DRACOLoader }, { USDZExporter }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/loaders/DRACOLoader.js'),
    import('three/addons/exporters/USDZExporter.js'),
  ])
  const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}decoders/draco/`)
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(url)
  draco.dispose()
  const data = await new USDZExporter().parseAsync(gltf.scene)
  return URL.createObjectURL(new Blob([data as BlobPart], { type: 'model/vnd.usdz+zip' }))
}
