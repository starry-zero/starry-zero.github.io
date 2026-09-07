/* endfield-codeblock.js —— 给代码块加 DSH 风格 banner（左语言名、右复制按钮）。
   数值取自 DSH 前端样式：--dsl-code-block-border-radius: 12px、
   --dsw-alias-markdown-code-block-banner: rgba(accent, 0.10)。 */
(function () {
  'use strict'
  const copyCode = (fig) => {
    const code = fig.querySelector('code')
    if (!code) return Promise.resolve()
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(code.innerText)
    }
    return Promise.resolve()
  }
  const flash = (btn) => {
    const old = btn.textContent
    btn.textContent = '已复制'
    btn.classList.add('copied')
    setTimeout(() => {
      btn.textContent = old
      btn.classList.remove('copied')
    }, 1200)
  }
  const init = () => {
    document.querySelectorAll('.post-body figure.highlight').forEach((fig) => {
      if (fig.querySelector('.endfield-code-banner')) return
      const lang = (fig.className.match(/highlight\s+([\w-]+)/) || [])[1] || ''
      const banner = document.createElement('div')
      banner.className = 'endfield-code-banner'
      const langEl = document.createElement('span')
      langEl.className = 'endfield-code-lang'
      langEl.textContent = lang.toUpperCase()
      const copyBtn = document.createElement('button')
      copyBtn.type = 'button'
      copyBtn.className = 'endfield-code-copy'
      copyBtn.textContent = '复制'
      copyBtn.addEventListener('click', () => {
        copyCode(fig).then(() => flash(copyBtn)).catch(() => flash(copyBtn))
      })
      banner.appendChild(langEl)
      banner.appendChild(copyBtn)
      fig.insertBefore(banner, fig.firstChild)
    })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true })
  else init()
})()
