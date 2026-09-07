/* endfield-palette.js —— 侧边栏“设置”菜单：谷地黄 / 武陵青 配色切换。
   参考 ymh0000123/dsh-theme-endfield：
     - localStorage 键 dsh-theme-endfield-palette，值 valley / wuling
     - 切换 = 给 <body> 加减一个 class（theme-endfield-wuling），CSS 变量自动重解析
     - 等高线画布已监听 body class 变化，切换后自动按新配色重绘 */
(function () {
  'use strict'
  const KEY = 'dsh-theme-endfield-palette'
  const btn = document.getElementById('endfield-palette-btn')
  const label = document.getElementById('endfield-palette-label')
  const read = () => (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) === 'wuling'
  const set = (wuling) => {
    if (typeof document !== 'undefined' && document.body) {
      if (wuling) document.body.classList.add('theme-endfield-wuling')
      else document.body.classList.remove('theme-endfield-wuling')
    }
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, wuling ? 'wuling' : 'valley')
    if (label) label.textContent = wuling ? '武陵青' : '谷地黄'
  }
  if (btn) {
    btn.addEventListener('click', () => set(!read()))
  }
  set(read())
  window.endfieldPalette = { read, set }
})()
