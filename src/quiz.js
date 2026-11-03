// Quiz widget entry (dist/quiz.js): finds each <script type="application/json" data-quiz>
// spec and draws a closed-book answer sheet: a Start button that starts the timer, one
// block per question (KaTeX math, code blocks, choices or a text box, a "guess" box, an
// optional techviz figure), and a Submit button that sends every answer to the chat as
// one message with sendPrompt. Answers are kept in localStorage, so a redrawn widget
// keeps them. Spec fields: docs/quiz.md.

import { inline, letter, check, formatAnswers } from './quiz-core.js'

const KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/'
const BASE = (document.currentScript && document.currentScript.src.replace(/[^/]*$/, '')) || ''

const css = `
.tq{color:var(--text-primary);max-width:760px;font-size:14px;line-height:1.5}
.tq-bar{display:flex;gap:14px;align-items:baseline;padding:4px 48px 10px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--text-secondary)}
.tq-time{font-variant-numeric:tabular-nums;font-weight:600;color:var(--text-primary);min-width:3.2em}
.tq-time.over{color:var(--text-danger,#d33)}
.tq-intro{color:var(--text-secondary);margin:10px 0}
.tq-q{padding:14px 0;border-bottom:1px solid var(--border)}
.tq-text{font-weight:600;margin:0 0 8px}
.tq-text code,.tq-opt code{font-family:var(--font-mono,monospace);font-size:13px;background:var(--bg-accent);padding:1px 4px;border-radius:4px}
.tq pre{background:var(--bg-accent);border:1px solid var(--border);border-radius:6px;padding:10px 14px;margin:8px 0;overflow-x:auto}
.tq pre code{font-family:var(--font-mono,monospace);font-size:13px;line-height:1.5;white-space:pre;tab-size:4}
.tq-fig{margin:8px 0;max-width:420px}
.tq-opt{display:flex;gap:8px;align-items:baseline;padding:4px 8px;border-radius:6px;cursor:pointer}
.tq-opt:hover{background:var(--bg-accent)}
.tq-opt input{margin:0;flex:none;position:relative;top:1px}
.tq input[type=text],.tq textarea{width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text-primary);font:inherit}
.tq textarea{font-family:var(--font-mono,monospace);font-size:13px;resize:vertical}
.tq-guess{display:inline-flex;gap:6px;align-items:center;margin-top:8px;font-size:12px;color:var(--text-secondary);cursor:pointer}
.tq button{margin-top:14px;padding:7px 18px;border-radius:6px;border:1px solid var(--border);background:var(--bg-accent);color:var(--text-primary);font:inherit;cursor:pointer}
.tq button:disabled{opacity:.5;cursor:default}
.tq-note{color:var(--text-secondary);font-size:13px;margin-left:10px}
.tq-err{font:12px var(--font-mono,monospace);color:var(--text-danger,#c33);white-space:pre-wrap}
`

const el = (tag, cls, html) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html != null) e.innerHTML = html
  return e
}

let katexReady = null
function loadKatex() {
  if (katexReady) return katexReady
  const link = el('link'); link.rel = 'stylesheet'; link.href = KATEX + 'katex.min.css'; document.head.appendChild(link)
  const load = (src) => new Promise((ok, fail) => { const s = el('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s) })
  katexReady = load(KATEX + 'katex.min.js').then(() => load(KATEX + 'contrib/auto-render.min.js'))
  return katexReady
}
const typeset = (root) => loadKatex().then(() => window.renderMathInElement(root, {
  delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
  throwOnError: false,
})).catch(() => {})

let figsLoaded = false
function loadFigures() {
  if (figsLoaded || window.techviz) return
  figsLoaded = true
  const s = el('script'); s.src = BASE + 'techviz.js'; document.head.appendChild(s)
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export function mount(script) {
  if (script.dataset.tqMounted) return
  script.dataset.tqMounted = '1'
  const root = el('div', 'tq')
  script.parentNode.insertBefore(root, script)
  let spec
  try { spec = JSON.parse(script.textContent) } catch (err) {
    root.appendChild(el('div', 'tq-err')).textContent = 'quiz: spec is not valid JSON: ' + err.message
    return
  }
  const problems = check(spec)
  if (problems.length) { root.appendChild(el('div', 'tq-err')).textContent = 'quiz: ' + problems.join('\n'); return }

  const key = 'tq:' + (spec.id || spec.title || 'quiz')
  let saved = {}
  try { saved = JSON.parse(localStorage.getItem(key) || '{}') } catch {}
  const state = { start: saved.start || 0, end: saved.end || 0, answers: saved.answers || spec.questions.map(() => ({})) }
  const save = () => { try { localStorage.setItem(key, JSON.stringify(state)) } catch {} }

  const n = spec.questions.length
  const bar = el('div', 'tq-bar')
  const clock = el('span', 'tq-time', '0:00')
  const meta = [spec.title, spec.subtitle, `${n} question${n === 1 ? '' : 's'}`, spec.closed === false ? null : 'closed book'].filter(Boolean)
  bar.append(clock, el('span', null, inline(meta.join(' · '))))
  root.appendChild(bar)

  const limit = spec.minutes ? spec.minutes * 60 : 0
  const elapsed = () => Math.floor(((state.end || Date.now()) - state.start) / 1000)
  const tick = () => {
    const s = elapsed()
    clock.textContent = limit ? `${fmt(s)} / ${fmt(limit)}` : fmt(s)
    clock.classList.toggle('over', limit > 0 && s > limit)
  }
  let timer = 0

  const pre = el('div')
  pre.appendChild(el('p', 'tq-intro', inline(spec.intro || 'Answer every question, then press Submit. Check "guess" on any answer you aren\'t sure of. The timer starts when you press Start.')))
  const go = el('button', null, 'Start')
  pre.appendChild(go)
  const body = el('div')
  body.style.display = 'none'
  root.append(pre, body)

  const inputs = []
  spec.questions.forEach((q, i) => {
    const a = state.answers[i] || (state.answers[i] = {})
    const box = el('div', 'tq-q')
    box.appendChild(el('p', 'tq-text', `${i + 1}. ${inline(q.q)}`))
    if (q.code) {
      const block = el('pre'); const code = el('code'); code.textContent = q.code.replace(/\n+$/, ''); block.appendChild(code); box.appendChild(block)
    }
    if (q.fig) {
      const fig = el('div', 'tq-fig'); const s = el('script'); s.type = 'application/json'; s.setAttribute('data-techviz', ''); s.textContent = JSON.stringify(q.fig)
      fig.appendChild(s); box.appendChild(fig); loadFigures()
    }
    if (q.after) box.appendChild(el('p', null, inline(q.after)))
    if (q.choices) {
      q.choices.forEach((c, j) => {
        const lab = el('label', 'tq-opt')
        const r = el('input'); r.type = 'radio'; r.name = key + ':' + i; r.value = String(j); r.checked = a.value === j
        r.onchange = () => { a.value = j; save() }
        inputs.push(r)
        lab.append(r, el('span', null, `${letter(j)}. ${inline(c)}`))
        box.appendChild(lab)
      })
    } else {
      const t = q.lines > 1 ? el('textarea') : el('input')
      if (q.lines > 1) t.rows = q.lines; else t.type = 'text'
      t.placeholder = q.placeholder || 'Your answer'
      t.value = a.value || ''
      t.oninput = () => { a.value = t.value; save() }
      inputs.push(t)
      box.appendChild(t)
    }
    const g = el('label', 'tq-guess'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!a.guess
    cb.onchange = () => { a.guess = cb.checked; save() }
    inputs.push(cb)
    g.append(cb, document.createTextNode('guess'))
    box.appendChild(g)
    body.appendChild(box)
  })

  const submit = el('button', null, 'Submit answers')
  const note = el('span', 'tq-note')
  body.append(submit, note)

  const begin = () => {
    pre.style.display = 'none'; body.style.display = 'block'
    tick(); if (!state.end) timer = setInterval(tick, 1000)
  }
  const lock = () => { submit.disabled = true; for (const x of inputs) x.disabled = true }
  go.onclick = () => { state.start = Date.now(); save(); begin() }
  submit.onclick = () => {
    state.end = Date.now(); clearInterval(timer); tick(); save(); lock()
    const msg = formatAnswers(spec, state.answers, elapsed())
    if (typeof window.sendPrompt === 'function') { window.sendPrompt(msg); note.textContent = 'Sent.' }
    else {
      note.textContent = 'Copy this into the chat:'
      const t = el('textarea'); t.rows = n + 2; t.value = msg; t.readOnly = true; body.appendChild(t)
    }
  }
  if (state.start) begin()
  if (state.end) { lock(); note.textContent = 'Sent.' }
  typeset(root)
}

export function mountAll(scope = document) {
  if (!document.getElementById('tq-style')) {
    const st = el('style'); st.id = 'tq-style'; st.textContent = css; document.head.appendChild(st)
  }
  for (const s of scope.querySelectorAll('script[type="application/json"][data-quiz]')) mount(s)
}

mountAll()
