// Labels in a small TeX-like syntax: R_{1}, V_{in}, 10\,k\Omega, \tau = RC,
// i^{2}. Dollar signs are optional and stripped. Single-letter quantities
// (R, V_{s}, i) and lone lowercase Greek letters are italic; a letter right
// after a number is a unit and stays upright (12 V, 5 A).

import { el, esc } from './svg.js'

const SYMBOLS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ',
  sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  cdot: '·', times: '×', pm: '±', mp: '∓', deg: '°', circ: '°', infty: '∞', to: '→', rightarrow: '→',
  leftarrow: '←', leftrightarrow: '↔', approx: '≈', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠',
  partial: '∂', nabla: '∇', sqrt: '√', angle: '∠', propto: '∝', sum: 'Σ', int: '∫', oint: '∮',
  ell: 'ℓ', hbar: 'ħ', prime: '′', parallel: '∥', perp: '⊥', odot: '⊙', otimes: '⊗', dots: '…', ldots: '…',
  '%': '%', '#': '#', '&': '&', '_': '_', '{': '{', '}': '}', '$': '$',
}
const SPACES = { ',': ' ', ';': ' ', ':': ' ', ' ': ' ', quad: '  ', '!': '' }
const LOWER_GREEK = new Set('αβγδεζηθικλμνξπρστυφχψω')

function readGroup(s, i) {
  // s[i] is '{': return [content, index after the closing brace].
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++
    else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1]
  }
  return [s.slice(i + 1), s.length]
}

/** Parse into runs: { text, shift: 0 | -1 (sub) | 1 (sup), upright?: true }. */
export function parseLabel(src) {
  const s = String(src ?? '').replace(/\$/g, '')
  const runs = []
  const push = (text, shift, upright) => {
    if (!text) return
    const last = runs[runs.length - 1]
    if (last && last.shift === shift && !!last.upright === !!upright) last.text += text
    else runs.push(upright ? { text, shift, upright: true } : { text, shift })
  }
  const walk = (str, shift, upright) => {
    for (let i = 0; i < str.length; ) {
      const c = str[i]
      if (c === '\\') {
        const m = /^\\([A-Za-z]+|.)/.exec(str.slice(i))
        const name = m ? m[1] : ''
        i += m ? m[0].length : 1
        // As in TeX, one space after a command name only ends the name (\mu F is μF).
        if (/^[A-Za-z]+$/.test(name) && str[i] === ' ') i++
        if (name === 'text' || name === 'mathrm' || name === 'textrm' || name === 'operatorname') {
          if (str[i] === '{') { const [g, j] = readGroup(str, i); walk(g, shift, true); i = j }
        } else if (name === 'mathit' || name === 'mathbf' || name === 'boldsymbol' || name === 'vec' || name === 'hat' || name === 'bar' || name === 'overline') {
          if (str[i] === '{') { const [g, j] = readGroup(str, i); walk(g, shift, upright); i = j }
          if (name === 'vec') push('⃗', shift, upright)
          if (name === 'hat') push('̂', shift, upright)
          if (name === 'bar' || name === 'overline') push('̄', shift, upright)
        } else if (name === 'frac') {
          let a = '', b = ''
          if (str[i] === '{') { [a, i] = readGroup(str, i) }
          if (str[i] === '{') { [b, i] = readGroup(str, i) }
          walk(a, shift, upright); push('/', shift, true); walk(b, shift, upright)
        } else if (name in SPACES) push(SPACES[name], shift, true)
        else if (name in SYMBOLS) push(SYMBOLS[name], shift, upright)
        else push(name, shift, upright)
      } else if ((c === '_' || c === '^') && shift === 0) {
        const sh = c === '_' ? -1 : 1
        i++
        if (str[i] === '{') { const [g, j] = readGroup(str, i); walk(g, sh, upright); i = j }
        else if (str[i] === '\\') { const m = /^\\([A-Za-z]+|.)/.exec(str.slice(i)); walk(m[0], sh, upright); i += m[0].length }
        else if (i < str.length) { walk(str[i], sh, upright); i++ }
      } else if (c === '{' || c === '}') i++
      else { push(c, shift, upright); i++ }
    }
  }
  walk(s, 0, false)
  return italicize(runs)
}

// Italic follows math style: a word of one or two letters on the baseline is a
// quantity (R, V, RC, i, ω t), unless a number comes right before it, which makes
// it a unit (12 V, 5 mA, 10 kΩ). Longer words (clk, row, addr) and sub- and
// superscripts stay upright.
function italicize(runs) {
  const out = []
  let prevText = ''
  for (const r of runs) {
    if (r.upright || r.shift !== 0) {
      out.push({ text: r.text, shift: r.shift, italic: false })
      prevText += r.text
      continue
    }
    const parts = r.text.split(/([A-Za-zα-ωΑ-Ω]+)/)
    for (const part of parts) {
      if (!part) continue
      let italic = false
      if (/^[A-Za-zα-ωΑ-Ω]+$/.test(part) && part.length <= 2 && !/^[Α-Ω]+$/.test(part)) {
        const before = prevText.replace(/[\s\u2009\u00a0]+$/, '')
        italic = !/[0-9.]$/.test(before)
      }
      const last = out[out.length - 1]
      if (last && last.shift === 0 && last.italic === italic) last.text += part
      else out.push({ text: part, shift: 0, italic })
      prevText += part
    }
  }
  return out
}

const WIDTHS = [
  [/[il.,:;|!'’ ]/, 0.3], [/[fjrtI(){}\[\]]/, 0.36], [/[mwMW]/, 0.86], [/[A-Z]/, 0.66],
  [/[0-9]/, 0.56], [/[α-ωΑ-Ω]/, 0.6], [/[ ]/, 0.17],
]
const charWidth = (ch) => { for (const [re, w] of WIDTHS) if (re.test(ch)) return w; return 0.54 }

/** Approximate rendered width in px at font size `size`. */
export function measure(label, size = 13) {
  let w = 0
  for (const r of typeof label === 'string' ? parseLabel(label) : label) {
    const k = r.shift ? 0.72 : 1
    for (const ch of r.text) w += charWidth(ch) * size * k
  }
  return w
}

/**
 * An SVG <text> for a label. `anchor`: start | middle | end. `baseline`: the y
 * given is the alphabetic baseline unless `middle` (vertically centered).
 */
export function labelSvg(label, x, y, theme, { anchor = 'middle', size = theme.size, fill = theme.fg, middle = false, weight, mono = false } = {}) {
  const runs = typeof label === 'string' ? parseLabel(label) : label
  if (!runs.length) return ''
  let dyAcc = 0
  const spans = runs.map((r) => {
    const target = r.shift === -1 ? size * 0.3 : r.shift === 1 ? -size * 0.42 : 0
    const dy = target - dyAcc
    dyAcc = target
    const a = { dy: dy ? dy.toFixed(2) : undefined }
    if (r.shift) a['font-size'] = (size * 0.72).toFixed(1)
    if (r.italic) { a['font-style'] = 'italic'; a['font-family'] = theme.math }
    return el('tspan', a, esc(r.text))
  })
  if (dyAcc) spans.push(el('tspan', { dy: (-dyAcc).toFixed(2) }, '​'))
  return el('text', {
    x, y: middle ? y + size * 0.35 : y, 'text-anchor': anchor, 'font-size': size === theme.size ? undefined : size,
    fill, 'font-weight': weight, 'font-family': mono ? theme.mono : undefined,
  }, spans)
}
