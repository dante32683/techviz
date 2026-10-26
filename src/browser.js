// Widget entry: finds each <script type="application/json" data-techviz> spec on
// the page, draws it with the host theme, and adds a slider per param and back
// and next buttons for steps. Interaction redraws locally, with no model call.
// Each figure has an expand button (or a click on the drawing): fullscreen where
// the frame allows it, else the figure spans the panel's width and the host grows
// the panel to fit, as it does for any content change.

import { render, prepare, parseLabel } from './index.js'

const css = `
.tv-wrap{display:block;margin:0}
.tv-svg{position:relative;width:fit-content;max-width:100%;margin:0 auto}
.tv-svg svg{max-width:100%;height:auto;display:block;margin:0 auto;cursor:zoom-in}
.tv-zoom{position:absolute;top:2px;right:2px;width:24px;height:24px;padding:0;display:flex;align-items:center;justify-content:center;font:15px/1 var(--font-sans,sans-serif);color:var(--text-secondary,#666);background:transparent;border:1px solid transparent;border-radius:6px;cursor:pointer;opacity:.55}
.tv-svg:hover .tv-zoom,.tv-zoom:focus-visible{opacity:1;border-color:var(--border,#ccc)}
.tv-big{grid-column:1/-1}
.tv-big .tv-svg{width:100%}
.tv-big .tv-svg svg{width:100%;max-width:none;cursor:zoom-out}
.tv-wrap:fullscreen,.tv-item:fullscreen{display:flex;flex-direction:column;box-sizing:border-box;padding:20px;background:var(--tv-fs-bg,Canvas);overflow:auto}
:fullscreen .tv-wrap{display:flex;flex-direction:column;flex:1;min-height:0}
:fullscreen .tv-svg{flex:1;min-height:0;width:100%}
:fullscreen .tv-svg svg{width:100%;height:100%;max-width:none;cursor:zoom-out}
.tv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr));gap:14px 20px;align-items:start}
.tv-item{min-width:0}
.tv-item .tv-svg,.tv-item .tv-svg svg{margin:0}
.tv-cap{margin:0 0 4px;font-size:14px;line-height:1.35;color:var(--text-primary)}
.tv-cap small{display:block;font-size:13px;color:var(--text-secondary)}
.tv-controls{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;margin-top:8px;font-size:13px;color:var(--text-secondary)}
.tv-param{display:flex;align-items:center;gap:8px}
.tv-param input[type=range]{width:150px;accent-color:#378ADD}
.tv-val{font-family:var(--font-mono);color:var(--text-primary);min-width:5.5em}
.tv-steps{display:flex;align-items:center;gap:8px}
.tv-steps button{font:inherit;padding:2px 10px;border-radius:var(--radius,8px);border:1px solid var(--border-strong,#888);background:transparent;color:var(--text-primary);cursor:pointer}
.tv-steps button:disabled{opacity:.4;cursor:default}
.tv-step-label{color:var(--text-primary)}
.tv-err{font:12px var(--font-mono);color:var(--text-danger,#c33);white-space:pre-wrap}
.tv-math{font-family:Cambria,'Cambria Math','Times New Roman',serif}
`

function labelHtml(src) {
  const span = document.createElement('span')
  for (const r of parseLabel(src)) {
    const node = document.createElement(r.shift === -1 ? 'sub' : r.shift === 1 ? 'sup' : 'span')
    node.textContent = r.text
    if (r.italic) { node.style.fontStyle = 'italic'; node.className = 'tv-math' }
    span.appendChild(node)
  }
  return span
}

const fmtVal = (v, step) => {
  const d = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)))
  return v.toFixed(d).replace(/^-/, '−')
}

let count = 0

// One figure is enlarged at a time: the tv-item around the drawing, or the drawing's own wrapper.
let big = null
const collapse = () => {
  if (!big) return
  const el = big; big = null
  if (document.fullscreenElement === el) document.exitFullscreen().catch(() => {})
  el.classList.remove('tv-big')
  syncZoom(el)
}
const syncZoom = (el) => {
  const on = big === el
  for (const b of el.querySelectorAll('.tv-zoom')) {
    b.textContent = on ? '\u2715' : '\u2922'
    b.title = b.ariaLabel = on ? 'Shrink (Esc)' : 'Enlarge'
  }
}
// Fullscreen first; a frame without allow="fullscreen" rejects it, so the figure grows in place.
const expand = (el) => {
  collapse()
  big = el
  const inPlace = () => { if (big === el) { el.classList.add('tv-big'); syncZoom(el) } }
  if (!document.fullscreenEnabled || !el.requestFullscreen) return inPlace()
  syncZoom(el)
  el.style.setProperty('--tv-fs-bg', backdrop(el))
  try { el.requestFullscreen().catch(inPlace) } catch { inPlace() }
}
// The frame is transparent, so fullscreen needs its own background: dark under light text.
const backdrop = (el) => {
  const probe = document.createElement('span'); probe.style.color = 'var(--text-primary, CanvasText)'
  el.appendChild(probe)
  const m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(getComputedStyle(probe).color)
  probe.remove()
  if (!m) return 'Canvas'
  return 0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3] > 128 ? '#1f1f1e' : '#ffffff'
}
const toggle = (el) => (big === el ? collapse() : expand(el))

export function mount(script) {
  if (script.dataset.tvMounted) return
  script.dataset.tvMounted = '1'
  let spec
  const root = document.createElement('div')
  root.className = 'tv-wrap'
  script.parentNode.insertBefore(root, script)
  // A placeholder the author put before the spec is replaced by the drawing.
  const prev = root.previousElementSibling
  if (prev && prev.hasAttribute('data-techviz-placeholder')) prev.remove()
  try { spec = JSON.parse(script.textContent) } catch (err) {
    root.innerHTML = ''
    const e = document.createElement('div'); e.className = 'tv-err'; e.textContent = 'techviz: spec is not valid JSON: ' + err.message; root.appendChild(e)
    return
  }
  const uid = 'tv' + ++count
  const svgBox = document.createElement('div'); svgBox.className = 'tv-svg'
  const fig = () => root.closest('.tv-item') || root
  svgBox.addEventListener('click', (e) => { if (e.target.closest('svg')) toggle(fig()) })
  const zoom = document.createElement('button')
  zoom.type = 'button'; zoom.className = 'tv-zoom'
  zoom.textContent = '\u2922'; zoom.title = zoom.ariaLabel = 'Enlarge'
  zoom.addEventListener('click', (e) => { e.stopPropagation(); toggle(fig()) })
  const controls = document.createElement('div'); controls.className = 'tv-controls'
  root.append(svgBox, controls)
  const state = { params: {}, step: undefined }
  let pending = false
  const draw = () => {
    pending = false
    const r = render(spec, { theme: 'host', params: state.params, step: state.step, uid })
    if (!r.svg) { svgBox.innerHTML = ''; const e = document.createElement('div'); e.className = 'tv-err'; e.textContent = 'techviz: ' + r.text; svgBox.appendChild(e); return r }
    svgBox.innerHTML = r.svg
    svgBox.appendChild(zoom)
    return r
  }
  const redraw = () => { if (!pending) { pending = true; requestAnimationFrame(draw) } }
  prepare(spec).then(() => build(), (err) => {
    const e = document.createElement('div'); e.className = 'tv-err'; e.textContent = `techviz: could not load the ${spec.kind} engine: ${err?.message ?? err}`; root.appendChild(e)
  })
  const build = () => {
  const first = draw()
  const c = first?.controls
  if (!c) return
  for (const p of c.params) {
    const wrap = document.createElement('label'); wrap.className = 'tv-param'
    const input = document.createElement('input')
    Object.assign(input, { type: 'range', min: p.min, max: p.max, step: p.step, value: p.value })
    const out = document.createElement('span'); out.className = 'tv-val'
    // A space before a unit (1.0 ms), none before a degree or percent sign (30°).
    const show = () => { out.textContent = fmtVal(Number(input.value), p.step) + (p.unit ? (/^[°′″%]$/.test(p.unit) ? '' : ' ') + p.unit : '') }
    show()
    input.addEventListener('input', () => { state.params[p.name] = Number(input.value); show(); redraw() })
    wrap.append(labelHtml(p.label), input, out)
    controls.appendChild(wrap)
  }
  if (c.steps.length) {
    const box = document.createElement('div'); box.className = 'tv-steps'
    const back = document.createElement('button'); back.textContent = '‹ Back'
    const next = document.createElement('button'); next.textContent = 'Next ›'
    const lab = document.createElement('span'); lab.className = 'tv-step-label'
    // Stepped diagrams start at the first step in the widget.
    state.step = 0
    const sync = () => {
      back.disabled = state.step <= 0
      next.disabled = state.step >= c.steps.length - 1
      lab.textContent = `${state.step + 1}/${c.steps.length}  ${c.steps[state.step]}`
    }
    back.onclick = () => { state.step--; sync(); redraw() }
    next.onclick = () => { state.step++; sync(); redraw() }
    sync(); draw()
    box.append(back, next, lab)
    controls.appendChild(box)
  }
  if (!controls.children.length) controls.remove()
  }
}

export function mountAll(scope = document) {
  if (!document.getElementById('tv-style')) {
    const st = document.createElement('style'); st.id = 'tv-style'; st.textContent = css; document.head.appendChild(st)
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') collapse() })
    // Esc or the browser's own exit leaves fullscreen without a click here.
    document.addEventListener('fullscreenchange', () => { if (big && !document.fullscreenElement) collapse() })
  }
  for (const s of scope.querySelectorAll('script[type="application/json"][data-techviz]')) mount(s)
}

export { render, prepare }

mountAll()
