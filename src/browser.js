// Widget entry: finds each <script type="application/json" data-techviz> spec on
// the page, draws it with the host theme, and adds a slider per param and back
// and next buttons for steps. Interaction redraws locally, with no model call.

import { render, parseLabel } from './index.js'

const css = `
.tv-wrap{display:block;margin:0.25rem 0}
.tv-svg svg{max-width:100%;height:auto;display:block;margin:0 auto}
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
  const controls = document.createElement('div'); controls.className = 'tv-controls'
  root.append(svgBox, controls)
  const state = { params: {}, step: undefined }
  let pending = false
  const draw = () => {
    pending = false
    const r = render(spec, { theme: 'host', params: state.params, step: state.step, uid })
    if (!r.svg) { svgBox.innerHTML = ''; const e = document.createElement('div'); e.className = 'tv-err'; e.textContent = 'techviz: ' + r.text; svgBox.appendChild(e); return r }
    svgBox.innerHTML = r.svg
    return r
  }
  const redraw = () => { if (!pending) { pending = true; requestAnimationFrame(draw) } }
  const first = draw()
  const c = first?.controls
  if (!c) return
  for (const p of c.params) {
    const wrap = document.createElement('label'); wrap.className = 'tv-param'
    const input = document.createElement('input')
    Object.assign(input, { type: 'range', min: p.min, max: p.max, step: p.step, value: p.value })
    const out = document.createElement('span'); out.className = 'tv-val'
    const show = () => { out.textContent = fmtVal(Number(input.value), p.step) + (p.unit ? ' ' + p.unit : '') }
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

export function mountAll(scope = document) {
  if (!document.getElementById('tv-style')) {
    const st = document.createElement('style'); st.id = 'tv-style'; st.textContent = css; document.head.appendChild(st)
  }
  for (const s of scope.querySelectorAll('script[type="application/json"][data-techviz]')) mount(s)
}

export { render }

mountAll()
