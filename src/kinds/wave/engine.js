// WaveDrom loader. Node imports it from node_modules; the browser loads the
// CDN build (a global `wavedrom`), which keeps it out of the widget bundle.
// The specifier is a variable so esbuild leaves the import alone.

const CDN = 'https://cdn.jsdelivr.net/npm/wavedrom@3.7.0/wavedrom.unpkg.min.js'
let engine = null
let loading = null

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`could not load ${src}`))
    document.head.appendChild(s)
  })
}

export async function loadWavedrom() {
  if (engine) return engine
  loading ??= (async () => {
    let wd
    if (typeof window !== 'undefined') {
      if (!window.wavedrom?.renderAny) await loadScript(CDN)
      wd = window.wavedrom
    } else {
      const name = 'wavedrom'
      const m = await import(name)
      wd = m.default ?? m
    }
    if (!wd?.renderAny || !wd?.waveSkin) throw new Error('WaveDrom loaded without renderAny')
    engine = wd
    return wd
  })()
  try { return await loading } catch (err) { loading = null; throw err }
}

export const wavedrom = () => engine
