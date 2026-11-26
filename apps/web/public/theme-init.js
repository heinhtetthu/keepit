// Applies the saved theme and brand colour before first paint (external file: CSP forbids inline scripts).
(function () {
  try {
    var mode = localStorage.getItem('theme') || 'system'
    var dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    if (dark) document.documentElement.classList.add('dark')
    var css = localStorage.getItem('brand-css')
    if (css) { var s = document.createElement('style'); s.id = 'brand-vars'; s.textContent = css; document.head.appendChild(s) }
  } catch (e) { /* storage blocked: defaults apply */ }
})()
