/* marked-highlight.js
 * 为 hexo-renderer-marked 注册 `==文字==` 高亮扩展（渲染为 <mark>）。
 * 参考 endfield：高亮用强调色。配色由 styles.styl 中的 mark 样式接管。 */
'use strict'

hexo.extend.filter.register('marked:extensions', function (extensions) {
  extensions.push({
    name: 'mark',
    level: 'inline',
    start (src) { return src.indexOf('==') },
    tokenizer (src) {
      const m = /^==([^=\n]+)==/.exec(src)
      if (m) return { type: 'mark', raw: m[0], text: m[1] }
    },
    renderer (token) {
      return `<mark>${token.text}</mark>`
    }
  })
  return extensions
})
