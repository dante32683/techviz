// Graphviz (viz-js WASM) loader. Node imports it from node_modules; the browser
// loads the CDN global build (`Viz`), so the 1.3 MB engine stays out of the
// widget bundle. The specifier is a variable so esbuild leaves the import alone.

const CDN = 'https://cdn.jsdelivr.net/npm/@viz-js/viz@3.31.0/dist/viz-global.js'
let viz = null
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

export async function loadViz() {
  if (viz) return viz
  loading ??= (async () => {
    let mod
    if (typeof window !== 'undefined') {
      if (!window.Viz?.instance) await loadScript(CDN)
      mod = window.Viz
    } else {
      const name = '@viz-js/viz'
      mod = await import(name)
    }
    if (!mod?.instance) throw new Error('viz-js loaded without instance()')
    viz = await mod.instance()
    return viz
  })()
  try { return await loading } catch (err) { loading = null; throw err }
}

export const getViz = () => viz
