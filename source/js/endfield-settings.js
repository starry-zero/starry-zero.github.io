/* endfield-settings.js —— DSH 风格的设置面板。
   左侧分栏：配色 / 背景；参照 endfield 文档的 row 布局与强调色规范。 */
(function () {
  'use strict'
  const PALETTE = window.endfieldPalette
  const CONTOUR = window.endfieldContour
  const MODE_KEY = 'dsh-theme-endfield-mode'
  const overlay = document.getElementById('endfield-settings')
  const closeBtn = document.getElementById('endfield-settings-close')
  const sideItems = Array.prototype.slice.call(document.querySelectorAll('.endfield-settings-side-item'))
  const panes = Array.prototype.slice.call(document.querySelectorAll('.endfield-settings-pane'))

  const readMode = () => (typeof localStorage !== 'undefined' && localStorage.getItem(MODE_KEY)) || 'light'
  const applyMode = (mode) => {
    const h = document.documentElement
    h.classList.toggle('endfield-dark', mode === 'dark')
    if (typeof localStorage !== 'undefined') localStorage.setItem(MODE_KEY, mode)
    syncModeButtons()
  }
  const all = (sel, fn) => Array.prototype.slice.call(document.querySelectorAll(sel)).forEach(fn)

  const syncPaletteButtons = () => {
    const w = PALETTE ? PALETTE.read() : false
    all('[data-palette]', b => b.classList.toggle('active', (b.getAttribute('data-palette') === 'wuling') === w))
  }
  const syncModeButtons = () => {
    const m = readMode()
    all('[data-mode]', b => b.classList.toggle('active', b.getAttribute('data-mode') === m))
  }
  const syncContourButtons = () => {
    if (!CONTOUR) return
    all('[data-contour-enable]', b => b.classList.toggle('active', (b.getAttribute('data-contour-enable') === 'on') === CONTOUR.isOn()))
    all('[data-contour-anim]', b => b.classList.toggle('active', (b.getAttribute('data-contour-anim') === 'on') === CONTOUR.isAnimOn()))
    all('[data-fps]', b => b.classList.toggle('active', Number(b.getAttribute('data-fps')) === CONTOUR.readFps()))
  }
  const syncAll = () => { syncPaletteButtons(); syncModeButtons(); syncContourButtons() }

  const open = () => { if (overlay) { overlay.classList.add('open'); syncAll() } }
  const close = () => { if (overlay) overlay.classList.remove('open') }

  Array.prototype.slice.call(document.querySelectorAll('.endfield-settings-trigger, #endfield-settings-open'))
    .forEach((t) => t.addEventListener('click', open))
  if (closeBtn) closeBtn.addEventListener('click', close)
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })
  }

  sideItems.forEach((item) => {
    item.addEventListener('click', () => {
      sideItems.forEach(x => x.classList.remove('active'))
      item.classList.add('active')
      const tab = item.getAttribute('data-tab')
      panes.forEach(p => p.classList.toggle('active', p.getAttribute('data-pane') === tab))
    })
  })

  all('[data-palette]', b => b.addEventListener('click', () => { PALETTE.set(b.getAttribute('data-palette') === 'wuling'); syncPaletteButtons() }))
  all('[data-mode]', b => b.addEventListener('click', () => applyMode(b.getAttribute('data-mode'))))
  all('[data-contour-enable]', b => b.addEventListener('click', () => { CONTOUR.setEnabled(b.getAttribute('data-contour-enable') === 'on'); syncContourButtons() }))
  all('[data-contour-anim]', b => b.addEventListener('click', () => { CONTOUR.setAnim(b.getAttribute('data-contour-anim') === 'on'); syncContourButtons() }))
  all('[data-fps]', b => b.addEventListener('click', () => { CONTOUR.setFps(Number(b.getAttribute('data-fps'))); syncContourButtons() }))

  applyMode(readMode())
  syncAll()
})()
