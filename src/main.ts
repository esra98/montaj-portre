import './styles.css'
import { arMode, launchAR, prepareAR } from './ar'
import { portraits, type Lang } from './content'
import { detectTier } from './device'
import type { Experience, Mode } from './gl/Experience'
import { lang, setLang, t, type StringKey } from './i18n'

const body = document.body
const canvas = document.querySelector<HTMLCanvasElement>('#gl')!
const detailEl = document.querySelector<HTMLElement>('.detail')!

let experience: Experience | undefined
let current = 0

// --- rendering ----------------------------------------------------------------

function bind(name: string, value: string) {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-bind="${name}"]`)) el.textContent = value
}

function renderPortrait(index: number) {
  current = index
  const p = portraits[index]
  bind('number', String(index + 1).padStart(2, '0'))
  bind('title', p.title[lang])
  bind('date', p.date[lang])
}

function renderDetail(index: number) {
  const p = portraits[index]
  const list = detailEl.querySelector('[data-bind="materials"]')!
  list.replaceChildren(
    ...p.materials[lang].map((m) => {
      const li = document.createElement('li')
      li.textContent = m
      return li
    }),
  )
  bind('notes', p.notes[lang])
  const img = detailEl.querySelector<HTMLImageElement>('[data-bind="image"]')!
  img.src = p.assets.image
  img.alt = p.title[lang]
}

function renderIndex() {
  const grid = document.querySelector('.index-grid')!
  grid.replaceChildren(
    ...portraits.map((p, i) => {
      const li = document.createElement('li')
      li.innerHTML = `<button data-index="${i}"><img loading="lazy" decoding="async" width="256" height="416" alt=""><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="t"></span></button>`
      li.querySelector('img')!.src = p.assets.poster
      li.querySelector('.t')!.textContent = p.title[lang]
      return li
    }),
  )
}

function renderText() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n as StringKey)
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-label]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nLabel as StringKey))
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-lang]')) {
    el.setAttribute('aria-pressed', String(el.dataset.lang === lang))
  }
  renderPortrait(current)
  renderDetail(current)
  renderIndex()
}

// --- routing (#p05 deep links, back button closes the detail view) --------------

function indexFromHash(): number | null {
  const id = location.hash.slice(1)
  const index = portraits.findIndex((p) => p.id === id)
  return index >= 0 ? index : null
}

function openPortrait(index: number) {
  if (!experience || experience.mode !== 'ring') return
  const hash = `#${portraits[index].id}`
  if (location.hash !== hash) history.pushState(null, '', hash)
  void experience.open(index)
}

function closePortrait() {
  if (location.hash) history.back()
  else void experience?.close()
}

addEventListener('popstate', () => {
  if (!experience) return
  const index = indexFromHash()
  if (index === null) void experience.close()
  else if (experience.mode === 'ring') void experience.open(index)
})

// --- UI events -------------------------------------------------------------------

function onMode(mode: Mode, index: number) {
  body.dataset.mode = mode
  const inDetail = mode === 'detail'
  detailEl.setAttribute('aria-hidden', String(!inDetail))
  detailEl.classList.remove('open')
  if (inDetail) {
    renderDetail(index)
    prepareAR(portraits[index])
  }
}

function toggleIndex(open: boolean) {
  body.classList.toggle('index-open', open)
  document.querySelector('.index')!.setAttribute('aria-hidden', String(!open))
}

document.addEventListener('click', async (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action], [data-lang], [data-index]')
  if (!target) return
  if (target.dataset.lang) {
    setLang(target.dataset.lang as Lang)
    renderText()
    return
  }
  if (target.dataset.index) {
    const index = Number(target.dataset.index)
    if (body.dataset.mode === 'fallback') return
    toggleIndex(false)
    experience?.goTo(index)
    return
  }
  switch (target.dataset.action) {
    case 'open':
      openPortrait(current)
      break
    case 'close':
      closePortrait()
      break
    case 'prev':
      experience?.next(-1)
      break
    case 'next':
      experience?.next(1)
      break
    case 'index':
      toggleIndex(true)
      break
    case 'index-close':
      toggleIndex(false)
      break
    case 'sheet':
      detailEl.classList.toggle('open')
      break
    case 'ar': {
      const slot = experience?.detailSlot
      if (slot === undefined) return
      target.textContent = t('arPreparing')
      try {
        await launchAR(portraits[slot], portraits[slot].title[lang])
      } finally {
        target.textContent = t('ar')
      }
      break
    }
  }
})

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (body.classList.contains('index-open')) toggleIndex(false)
    else if (experience?.mode === 'detail') closePortrait()
    return
  }
  if (experience?.mode !== 'ring' || body.classList.contains('index-open')) return
  if (e.key === 'ArrowRight') experience.next(1)
  else if (e.key === 'ArrowLeft') experience.next(-1)
  else if (e.key === 'Enter') openPortrait(current)
})

// --- boot ------------------------------------------------------------------------

async function boot() {
  setLang(lang)
  renderText()
  if (!arMode()) detailEl.classList.add('no-ar')

  const tier = detectTier()
  if (tier === 0) {
    body.dataset.mode = 'fallback'
    body.classList.add('ready')
    return
  }

  const deepLink = indexFromHash()
  // three.js is fetched only now, after the DOM shell has painted.
  const { Experience } = await import('./gl/Experience')
  experience = new Experience(canvas, tier, {
    index: renderPortrait,
    mode: onMode,
    ready: () => body.classList.add('ready'),
    busy: (busy) => body.classList.toggle('busy', busy),
  })
  if (deepLink !== null) history.replaceState(null, '', location.pathname + location.search)
  await experience.start(deepLink ?? 0)
  if (deepLink !== null) openPortrait(deepLink)
}

void boot()
