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
// Function names set upright with a space on each side, as TeX does: mg\sin\theta is "mg sin θ".
const OPERATORS = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'ln', 'log', 'exp', 'lim', 'max', 'min', 'det'])
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
  // A hyphen used as minus (after a space or at the start, before a space, digit or letter) prints as −.
  const s = String(src ?? '').replace(/\$/g, '').replace(/(^|\s|[=({])-(?=[\s\d.a-zA-Z\\(])/g, '$1−')
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
        } else if (OPERATORS.has(name)) {
          const prev = runs.length ? runs[runs.length - 1].text.slice(-1) : ''
          if (prev && !/[\s(]/.test(prev)) push(' ', shift, true)
          push(name, shift, true)
          if (i < str.length && !/[\s(^_}]/.test(str[i])) push(' ', shift, true)
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
      // A subscript ends a quantity, so a letter after it is a quantity too (m_{1}g),
      // while a superscript can end a number (10^{3} m), so its digits still count.
      prevText += r.shift === -1 ? '_' : r.text
      continue
    }
    // Accents from \vec, \hat and \bar are combining marks that stay with their letter.
    const parts = r.text.split(/([A-Za-zα-ωΑ-Ω][A-Za-zα-ωΑ-Ω\u0300-\u036f\u20d0-\u20ff]*)/)
    for (const part of parts) {
      if (!part) continue
      let italic = false
      const letters = part.replace(/[\u0300-\u036f\u20d0-\u20ff]/g, '')
      if (/^[A-Za-zα-ωΑ-Ω]+$/.test(part.charAt(0)) && letters.length <= 2 && !/^[Α-Ω]+$/.test(letters)) {
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

// Greek (except Ω) and math operators: the app's Anthropic Sans lacks them.
const MATH_GLYPHS = /([\u0370-\u03A8\u03AA-\u03FF\u2200-\u22FF\u2A00-\u2AFF]+)/

const WIDTHS = [
  [/[\u0300-\u036f\u20d0-\u20ff]/, 0],
  [/[il.,:;|!'’ ]/, 0.3], [/[fjrtI(){}\[\]\/\\-]/, 0.36], [/[mwMW]/, 0.86], [/[A-Z]/, 0.66],
  [/[0-9]/, 0.56], [/[α-ωΑ-Ω]/, 0.6], [/[ ]/, 0.17],
]
const charWidth = (ch) => { for (const [re, w] of WIDTHS) if (re.test(ch)) return w; return 0.54 }

// The table is Segoe UI's; Anthropic Sans, the app themes' font, runs about 6% wider.
// Every theme uses the wider figure, so a narrower font only gets a little more room.
const FONT_SCALE = 1.06

/** Approximate rendered width in px at font size `size`. */
export function measure(label, size = 13) {
  let w = 0
  for (const r of typeof label === 'string' ? parseLabel(label) : label) {
    const k = r.shift ? 0.72 : 1
    for (const ch of r.text) w += charWidth(ch) * size * k
  }
  return w * FONT_SCALE
}

// resvg can't set the \vec arrow (U+20D7) in an italic font that lacks it (Cambria Italic does),
// so a vector letter is drawn upright in Cambria Math from its math-italic code point instead.
const VEC_ARROW = /\u20d7/
const mathItalic = (text) => text.replace(/[A-Za-z]/g, (c) => c === 'h' ? '\u210e'
  : String.fromCodePoint(c <= 'Z' ? 0x1d434 + c.charCodeAt(0) - 65 : 0x1d44e + c.charCodeAt(0) - 97))

/**
 * An SVG <text> for a label. `anchor`: start | middle | end. `baseline`: the y
 * given is the alphabetic baseline unless `middle` (vertically centered).
 */
export function labelSvg(label, x, y, theme, { anchor = 'middle', size = theme.size, fill = theme.fg, middle = false, weight, mono = false } = {}) {
  const parsed = typeof label === 'string' ? parseLabel(label) : label
  if (!parsed.length) return ''
  // Upright Greek and math symbols get the math font, in pieces of their own.
  const runs = parsed.flatMap((r) => r.italic ? [r] : r.text.split(MATH_GLYPHS).filter(Boolean).map((text) => ({ ...r, text, math: MATH_GLYPHS.test(text) })))
    .map((r) => r.italic && VEC_ARROW.test(r.text) ? { ...r, text: mathItalic(r.text), italic: false, vec: true } : r)
  // With the app's Anthropic Sans, resvg sets every plain piece of a <text> in a bold serif
  // fallback once any piece holds a glyph the font lacks. Starting each piece at its own x
  // (a new text chunk) keeps the fallback to that piece, so those labels are laid out by hand.
  // An italic letter right after a subscript leans back into it (m_{1}g): give it a little room.
  const kern = (k) => (k > 0 && runs[k - 1].shift === -1 && runs[k].shift === 0 && runs[k].italic ? size * 0.12 : undefined)
  let xs = null
  if (/Anthropic Sans/.test(theme.font) && runs.some((r) => r.vec || MATH_GLYPHS.test(r.text))) {
    // Here the width has to be close, not generous: the table is near Anthropic Sans's own
    // advances, and the math font's italic runs about 10% narrower (checked with fontTools).
    const widths = runs.map((r) => (measure([r], size) / FONT_SCALE) * (r.italic || r.math || r.vec ? 0.9 : 1))
    const total = widths.reduce((a, b) => a + b, 0)
    let cx = x - (anchor === 'middle' ? total / 2 : anchor === 'end' ? total : 0)
    xs = widths.map((w, k) => { const at = cx + (kern(k) ?? 0); cx += w + (kern(k) ?? 0); return at.toFixed(2) })
  }
  let dyAcc = 0
  const spans = runs.map((r, k) => {
    const target = r.shift === -1 ? size * 0.3 : r.shift === 1 ? -size * 0.42 : 0
    const dy = target - dyAcc
    dyAcc = target
    const a = { x: xs?.[k], dx: !xs && kern(k) ? kern(k).toFixed(2) : undefined, dy: dy ? dy.toFixed(2) : undefined }
    if (r.shift) a['font-size'] = (size * 0.72).toFixed(1)
    if (r.italic) { a['font-style'] = 'italic'; a['font-family'] = theme.math }
    else if (r.vec) a['font-family'] = `Cambria Math, ${theme.math}`
    else if (r.math) a['font-family'] = theme.math
    return el('tspan', a, esc(r.text))
  })
  if (dyAcc) spans.push(el('tspan', { dy: (-dyAcc).toFixed(2) }, '​'))
  return el('text', {
    x, y: middle ? y + size * 0.35 : y, 'text-anchor': xs ? 'start' : anchor, 'font-size': size === theme.size ? undefined : size,
    fill, 'font-weight': weight, 'font-family': mono ? theme.mono : undefined,
  }, spans)
}
