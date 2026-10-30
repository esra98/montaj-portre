export type Lang = 'tr' | 'en'
export type Text = Record<Lang, string>

export interface PortraitAssets {
  preview: string
  full: string
  ar: string
  poster: string
  image: string
}

export interface Portrait {
  id: string
  title: Text
  date: Text
  materials: Record<Lang, string[]>
  notes: Text
  /** Width / height of the physical board. */
  aspect: number
  assets: PortraitAssets
}

const BASE = import.meta.env.BASE_URL

function assetsFor(id: string): PortraitAssets {
  const dir = `${BASE}assets/${id}`
  return {
    preview: `${dir}/preview.glb`,
    full: `${dir}/full.glb`,
    ar: `${dir}/ar.glb`,
    poster: `${dir}/poster.webp`,
    image: `${dir}/image.webp`,
  }
}

export const ATLAS = { url: `${BASE}assets/atlas.webp`, cols: 5, rows: 4 }

const PLACEHOLDER_NOTES: Text = {
  tr: 'Yer tutucu metin. Bu alan sanatçının portreye dair notları için ayrıldı: modelin kim olduğu, nesnelerin nereden geldiği, yüzün nasıl ortaya çıktığı. Gündelik nesneler bir araya geldiğinde, onlara doğru açıdan bakınca bir yüz belirir.',
  en: 'Placeholder text. This space is reserved for the artist’s notes on the portrait: who the sitter is, where the objects came from, how the face emerged. When everyday objects come together, a face appears once you look from the right angle.',
}

const first: Portrait = {
  id: 'p01',
  title: { tr: 'Ali', en: 'Ali' },
  date: { tr: '17 Haziran 2003', en: '17 June 2003' },
  materials: {
    tr: ['Vidalar ve çiviler', 'Somun', 'Bilye', 'Perde halkası', 'Çekmece kulpu', 'Ahşap pano'],
    en: ['Screws and nails', 'Nut', 'Ball bearing', 'Curtain ring', 'Drawer pull', 'Wooden board'],
  },
  notes: PLACEHOLDER_NOTES,
  aspect: 0.61,
  assets: assetsFor('p01'),
}

// Until the remaining 19 scans are processed, every slot reuses p01's assets.
export const portraits: Portrait[] = Array.from({ length: 20 }, (_, i) => {
  if (i === 0) return first
  const n = String(i + 1).padStart(2, '0')
  return {
    ...first,
    id: `p${n}`,
    title: { tr: `Portre ${n}`, en: `Portrait ${n}` },
    date: { tr: 'Tarih —', en: 'Date —' },
  }
})
