import type { Lang } from './content'

const strings = {
  statement: {
    tr: 'Gündelik nesnelerden kurulmuş yirmi yüz.',
    en: 'Twenty faces assembled from everyday objects.',
  },
  explore: { tr: 'Portreyi incele', en: 'Examine portrait' },
  hint: { tr: 'Sürükle ya da kaydır', en: 'Drag or scroll' },
  index: { tr: 'Dizin', en: 'Index' },
  close: { tr: 'Kapat', en: 'Close' },
  back: { tr: 'Halkaya dön', en: 'Back to the ring' },
  materials: { tr: 'Malzemeler', en: 'Materials' },
  notes: { tr: 'Notlar', en: 'Notes' },
  ar: { tr: 'Masanda gör', en: 'View on your table' },
  arPreparing: { tr: 'Hazırlanıyor…', en: 'Preparing…' },
  arDesktop: {
    tr: 'Artırılmış gerçeklik için bu sayfayı telefonunda aç.',
    en: 'Open this page on your phone to view it in AR.',
  },
  inspectHint: { tr: 'Etrafında dolaşmak için sürükle', en: 'Drag to walk around it' },
  loading: { tr: 'Yükleniyor', en: 'Loading' },
  prev: { tr: 'Önceki', en: 'Previous' },
  next: { tr: 'Sonraki', en: 'Next' },
} satisfies Record<string, Record<Lang, string>>

export type StringKey = keyof typeof strings

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('lang')
    if (saved === 'tr' || saved === 'en') return saved
  } catch {
    // storage unavailable (private mode) — fall through
  }
  return navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en'
}

export let lang: Lang = initialLang()

export function setLang(next: Lang) {
  lang = next
  document.documentElement.lang = next
  try {
    localStorage.setItem('lang', next)
  } catch {
    // ignore
  }
}

export function t(key: StringKey): string {
  return strings[key][lang]
}
