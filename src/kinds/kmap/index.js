// kmap: Karnaugh maps of 2 to 5 variables in Gray-code order (the Harris & Harris layout:
// the first variables across the top, the rest down the side; five variables as two maps
// split on the first). The kind finds the prime implicants and a minimum cover (shared
// Quine-McCluskey code in ../logic/bool.js) and draws each chosen group as a rounded loop,
// split where it wraps around an edge. Each group is a step, essential ones first.

import { SpecError, Diag } from '../../diag.js'
import { el } from '../../svg.js'
import { labelSvg, measure } from '../../label.js'
import { color } from '../../theme.js'
import { parseExpr, exprVars, mintermsOf, minimize, literals, sopText, posText, termText, sigma, cubeMinterms } from '../logic/bool.js'

const GRAY = { 1: [0, 1], 2: [0, 1, 3, 2] }
const CELL = 30
const r1 = (v) => Math.round(v * 10) / 10

function readFunction(spec) {
  const has = ['minterms', 'maxterms', 'expr'].filter((k) => spec[k] !== undefined)
  if (has.length !== 1) throw new SpecError(has[1] ?? 'minterms', has.length ? `give one of minterms, maxterms, or expr (got ${has.join(' and ')})` : 'give "minterms": [0, 2, 5], "maxterms": [1, 3], or "expr": "AB + C\'"')
  let vars = spec.vars
  if (vars !== undefined && (!Array.isArray(vars) || vars.some((v) => typeof v !== 'string' || !v))) throw new SpecError('vars', 'vars is a list of names, first = most significant bit: ["A", "B", "C", "D"]')
  let ast = null
  if (spec.expr !== undefined) {
    ast = parseExpr(spec.expr, { names: vars, path: 'expr' })
    if (!vars) vars = exprVars(ast).sort((a, b) => a.localeCompare(b))
    else for (const v of exprVars(ast)) if (!vars.includes(v)) throw new SpecError('expr', `"${v}" isn't in vars (${vars.join(', ')})`)
  }
  const list = (k) => {
    const v = spec[k] ?? []
    if (!Array.isArray(v) || v.some((m) => !Number.isInteger(m) || m < 0)) throw new SpecError(k, `${k} is a list of whole numbers, like [0, 2, 5]`)
    return [...new Set(v)].sort((a, b) => a - b)
  }
  const given = spec.expr === undefined ? list(spec.minterms !== undefined ? 'minterms' : 'maxterms') : []
  const dcs = list('dc')
  if (!vars) {
    const top = Math.max(1, ...given, ...dcs)
    const n = spec.n ?? Math.max(2, Math.ceil(Math.log2(top + 1)))
    vars = ['A', 'B', 'C', 'D', 'E'].slice(0, n)
  }
  const n = vars.length
  if (n < 2 || n > 5) throw new SpecError('vars', `a K-map here has 2 to 5 variables; got ${n}`)
  const size = 1 << n
  for (const [k, arr] of [[spec.minterms !== undefined ? 'minterms' : 'maxterms', given], ['dc', dcs]]) {
    const bad = arr.find((m) => m >= size)
    if (bad !== undefined) throw new SpecError(k, `${bad} is out of range for ${n} variables (0 to ${size - 1})`)
  }
  let ones
  if (ast) ones = mintermsOf(ast, vars).filter((m) => !dcs.includes(m))
  else if (spec.minterms !== undefined) ones = given
  else ones = Array.from({ length: size }, (_, m) => m).filter((m) => !given.includes(m) && !dcs.includes(m))
  const both = ones.filter((m) => dcs.includes(m))
  if (both.length) throw new SpecError('dc', `${both.join(', ')} ${both.length === 1 ? 'is' : 'are'} listed as both a ${spec.maxterms !== undefined ? 'maxterm' : 'minterm'} and a don't-care`)
  const zeros = Array.from({ length: size }, (_, m) => m).filter((m) => !ones.includes(m) && !dcs.includes(m))
  return { vars, n, ones, zeros, dcs }
}

function solve(spec) {
  const f = readFunction(spec)
  const form = spec.form ?? 'sop'
  if (!['sop', 'pos'].includes(form)) throw new SpecError('form', 'form is "sop" (group the 1s, default) or "pos" (group the 0s)')
  const sop = minimize(f.ones, f.dcs, f.n)
  const pos = minimize(f.zeros, f.dcs, f.n)
  const shown = form === 'sop' ? sop : pos
  // Groups in step order: essential primes first, then the rest of the cover.
  const groups = [...shown.essential, ...shown.cover.filter((p) => !shown.essential.includes(p))]
  return { ...f, form, sop, pos, groups }
}

// --- Drawing -------------------------------------------------------------------------

/** A product or sum term with real overbars: [{name, neg}] literals, colored. */
function termSvg(lits, x, y, theme, fill, { sum = false, size = 13 } = {}) {
  const out = []
  let cx = x
  // SVG drops a label's edge spaces, so a symbol is centered in the width it takes with them.
  const put = (t, pad = 0) => { const w = measure(`\\text{${t}}`, size) + 2 * pad; out.push(labelSvg(`\\text{${t}}`, cx + w / 2, y, theme, { size, fill })); cx += w }
  if (sum) put('(')
  lits.forEach((l, i) => {
    if (sum && i) put('+', 3)
    const tex = /^[A-Za-z]$/.test(l.name) ? l.name : `\\text{${l.name}}`
    const w = measure(tex, size) * (tex.length === 1 ? 0.86 : 1) // measure() is generous for one italic letter
    out.push(labelSvg(tex, cx + w / 2, y, theme, { size, fill }))
    if (l.neg) out.push(el('line', { x1: r1(cx + 1), y1: r1(y - size * 0.82), x2: r1(cx + w - 0.5), y2: r1(y - size * 0.82), stroke: fill, 'stroke-width': 1.1 }))
    cx += w + (sum ? 0 : 1)
  })
  if (sum) put(')')
  if (!lits.length) put(sum ? '0' : '1')
  return { svg: out.join(''), w: cx - x }
}

/** The cyclic run of indices (in Gray order) a term's bits select along one axis. */
function axisSet(p, bits, shift, order) {
  // bits: the variable count on this axis; shift: its position in the minterm.
  const mask = ((1 << bits) - 1) << shift
  return order.map((code, i) => [code, i]).filter(([code]) => ((code << shift) & ~p.mask & mask) === (p.value & mask)).map(([, i]) => i)
}

/** Split a cyclic run into contiguous pieces: [[a, b, openLow, openHigh]]. */
function pieces(set, len) {
  if (set.length === len) return [[0, len - 1, false, false]]
  const s = new Set(set)
  if (s.has(0) && s.has(len - 1)) {
    let hi = 0; while (s.has(hi + 1)) hi++
    let lo = len - 1; while (s.has(lo - 1)) lo--
    return [[0, hi, true, false], [lo, len - 1, false, true]]
  }
  return [[Math.min(...set), Math.max(...set), false, false]]
}

function draw(sol, shownGroups, spec, theme, uid) {
  const { vars, n, ones, dcs } = sol
  const sub = n === 5 ? 2 : 1 // five variables: two 4-variable maps split on the first
  const mv = n === 5 ? vars.slice(1) : vars
  const cb = Math.ceil(mv.length / 2), rb = mv.length - cb // column bits (top), row bits (side)
  const cols = GRAY[cb], rows = GRAY[rb]
  const W = cols.length * CELL, H = rows.length * CELL
  const colVars = mv.slice(0, cb).join(''), rowVars = mv.slice(cb).join('')
  const out = [], loops = []
  const fs = 12
  const left = Math.max(34, measure(rowVars, fs) + 22)
  const mapTop = (s) => 34 + s * (H + 46)
  const x0 = left
  const name = spec.name ?? (sol.form === 'pos' ? 'Y' : 'Y')
  const hl = new Set((spec.highlight ?? []).map(Number))
  for (let s = 0; s < sub; s++) {
    const y0 = mapTop(s)
    if (sub > 1) out.push(labelSvg(`${vars[0]} = ${s}`, x0 + W / 2, y0 - 26, theme, { size: fs, fill: theme.fg }))
    // Corner: the axis variables either side of a diagonal.
    out.push(el('line', { x1: x0, y1: y0, x2: x0 - 20, y2: y0 - 20, stroke: theme.muted, 'stroke-width': 1 }))
    out.push(labelSvg(colVars, x0 - 8, y0 - 15, theme, { size: fs, anchor: 'start', fill: theme.fg }))
    out.push(labelSvg(rowVars, x0 - 12, y0 - 2, theme, { size: fs, anchor: 'end', fill: theme.fg }))
    cols.forEach((code, c) => out.push(labelSvg(`\\text{${code.toString(2).padStart(cb, '0')}}`, x0 + c * CELL + CELL / 2, y0 - 7, theme, { size: 10.5, fill: theme.muted })))
    rows.forEach((code, r) => out.push(labelSvg(`\\text{${code.toString(2).padStart(rb, '0')}}`, x0 - 7, y0 + r * CELL + CELL / 2, theme, { size: 10.5, fill: theme.muted, anchor: 'end', middle: true })))
    rows.forEach((rc, r) => cols.forEach((cc, c) => {
      const m = (s << 4) * (n === 5 ? 1 : 0) + ((cc << rb) | rc)
      const x = x0 + c * CELL, y = y0 + r * CELL
      if (hl.has(m)) out.push(el('rect', { x, y, width: CELL, height: CELL, fill: theme.highlight, 'fill-opacity': 0.2 }))
      const v = ones.includes(m) ? '1' : dcs.includes(m) ? 'X' : '0'
      out.push(labelSvg(`\\text{${v}}`, x + CELL / 2, y + CELL / 2 + 1, theme, { size: 13, fill: v === '0' ? theme.muted : theme.fg, middle: true }))
      out.push(labelSvg(`\\text{${m}}`, x + CELL - 2.5, y + 8, theme, { size: 7, fill: theme.faint, anchor: 'end' }))
    }))
    for (let i = 0; i <= cols.length; i++) out.push(el('line', { x1: x0 + i * CELL, y1: y0, x2: x0 + i * CELL, y2: y0 + H, stroke: theme.fg, 'stroke-width': i % cols.length ? 0.8 : 1.4 }))
    for (let i = 0; i <= rows.length; i++) out.push(el('line', { x1: x0, y1: y0 + i * CELL, x2: x0 + W, y2: y0 + i * CELL, stroke: theme.fg, 'stroke-width': i % rows.length ? 0.8 : 1.4 }))
    // Groups: each piece is a rounded rectangle inset by its group's level; a wrapped side runs
    // past the map's edge and is clipped there, so the loop reads as open.
    const clip = `${uid}-k${s}`, fillClip = `${uid}-kf${s}`
    out.push(el('clipPath', { id: clip }, [el('rect', { x: x0 - 4, y: y0 - 4, width: W + 8, height: H + 8 })]))
    out.push(el('clipPath', { id: fillClip }, [el('rect', { x: x0, y: y0, width: W, height: H })]))
    shownGroups.forEach((p, gi) => {
      const mapBits = n === 5 ? 1 << 4 : 0
      if (n === 5 && !(p.mask & mapBits) && ((p.value & mapBits) ? 1 : 0) !== s) return
      const cs = axisSet(p, cb, rb, cols), rs = axisSet(p, rb, 0, rows)
      if (!cs.length || !rs.length) return
      const inset = 3 + (gi % 4) * 2.2
      const stroke = color(gi)
      for (const [c1, c2, cl, ch] of pieces(cs, cols.length)) for (const [q1, q2, rl, rh] of pieces(rs, rows.length)) {
        let x1 = x0 + c1 * CELL + inset, x2 = x0 + (c2 + 1) * CELL - inset, y1 = y0 + q1 * CELL + inset, y2 = y0 + (q2 + 1) * CELL - inset
        if (cl) x1 -= 2 * CELL
        if (ch) x2 += 2 * CELL
        if (rl) y1 -= 2 * CELL
        if (rh) y2 += 2 * CELL
        const box = { x: r1(x1), y: r1(y1), width: r1(x2 - x1), height: r1(y2 - y1), rx: 9 }
        loops.push(el('rect', { ...box, fill: stroke, 'fill-opacity': 0.13, 'clip-path': `url(#${fillClip})` }))
        loops.push(el('rect', { ...box, fill: 'none', stroke, 'stroke-width': 1.8, 'clip-path': `url(#${clip})` }))
      }
    })
  }
  // The expression under the map, each term in its group's color.
  const yE = mapTop(sub - 1) + H + 26
  let x = x0
  const parts = []
  const head = labelSvg(`${/^[A-Za-z]$/.test(name) ? name : `\\text{${name}}`} =`, x, yE, theme, { size: 13, anchor: 'start', fill: theme.fg })
  parts.push(head)
  x += measure(`${name} =`, 13) + 5
  const terms = shownGroups.map((p, gi) => ({ p, gi }))
  const rowW = Math.max(W + left, 150)
  let line = 0
  if (!terms.length) parts.push(labelSvg('\\text{?}', x, yE, theme, { size: 13, anchor: 'start', fill: theme.muted }))
  terms.forEach(({ p, gi }, i) => {
    const lits = sol.form === 'sop' ? literals(p, vars) : literals(p, vars).map((l) => ({ ...l, neg: !l.neg }))
    const t = termSvg(lits, 0, 0, theme, color(gi), { sum: sol.form === 'pos' })
    const sepW = i && sol.form === 'sop' ? measure(' + ', 13) : 0
    if (x + sepW + t.w > rowW + 40 && i) { line++; x = x0 + measure(`${name} =`, 13) + 5 }
    const y = yE + line * 20
    if (sepW && x > x0 + measure(`${name} =`, 13) + 6) { parts.push(labelSvg('\\text{+}', x + sepW / 2, y, theme, { size: 13, fill: theme.fg })); x += sepW }
    parts.push(termSvg(lits, x, y, theme, color(gi), { sum: sol.form === 'pos' }).svg)
    x += t.w + (sol.form === 'pos' ? 1 : 0)
  })
  const width = Math.max(x0 + W, x, rowW) + 14
  const height = yE + line * 20 + 8
  return { body: el('g', { transform: 'translate(10,6)' }, [...out, ...loops, ...parts]), width: width + 10, height: height + 10 }
}

export default {
  kind: 'kmap',
  fields: ['vars', 'n', 'minterms', 'maxterms', 'dc', 'expr', 'form', 'expect', 'name', 'highlight'],
  collections: [],
  steps(spec) {
    const sol = solve(spec)
    const lab = (p) => (sol.form === 'sop' ? termText(p, sol.vars) : posText([p], sol.vars, [0]))
    if (sol.groups.length < 2) return []
    return [{ label: 'the map', __groups: 0 }, ...sol.groups.map((p, k) => ({ label: `${lab(p)}${sol.groups.length && (sol.form === 'sop' ? sol.sop : sol.pos).essential.includes(p) ? ' (essential)' : ''}`, __groups: k + 1 }))]
  },
  render(spec, { theme, diag, uid }) {
    const sol = solve(spec)
    const k = Number.isInteger(spec.__groups) ? spec.__groups : sol.groups.length
    const shown = sol.groups.slice(0, k)
    const { vars, ones, zeros, dcs, n } = sol
    const facts = [`kmap ${n} variables (${vars.join(', ')}; ${vars[0]} is the MSB): ${spec.name ?? 'Y'} = ${sigma(ones, dcs)}`]
    const res = sol.form === 'sop' ? sol.sop : sol.pos
    const txt = (p) => (sol.form === 'sop' ? termText(p, vars) : posText([p], vars, [0]))
    facts.push(`prime implicants${sol.form === 'pos' ? ' of the 0s' : ''}: ${res.primes.map(txt).join(', ') || 'none'}; essential: ${res.essential.map(txt).join(', ') || 'none'}`)
    const lits = (c) => c.reduce((s, p) => s + literals(p, vars).length, 0)
    facts.push(`minimal SOP: ${sopText(sol.sop.cover, vars, ones)} (${sol.sop.cover.length} terms, ${lits(sol.sop.cover)} literals)`)
    if (sol.form === 'pos') facts.push(`minimal POS: ${posText(sol.pos.cover, vars, zeros)} (${sol.pos.cover.length} factors, ${lits(sol.pos.cover)} literals)`)
    // Wraparound and corner groups, named so a reader can check the loops.
    const wraps = sol.groups.map((p) => {
      const m = cubeMinterms(p, n)
      return { p, m }
    }).filter(({ p }) => {
      const mv = n === 5 ? 4 : n, cb = Math.ceil(mv / 2), rb = mv - cb
      const cs = axisSet(p, cb, rb, GRAY[cb]), rs = axisSet(p, rb, 0, GRAY[rb])
      return pieces(cs, GRAY[cb].length).length > 1 || pieces(rs, GRAY[rb].length).length > 1
    })
    if (wraps.length) facts.push(`wraparound groups: ${wraps.map(({ p, m }) => `${txt(p)} (m${m.join(',')})`).join(', ')}`)
    if (!res.exact) diag.note('', 'the minimum cover search hit its limit; the cover shown is near-minimal')
    if (spec.expect !== undefined) {
      if (typeof spec.expect !== 'string') throw new SpecError('expect', 'expect is an expression string, like "B\'D\' + BD"')
      const ast = parseExpr(spec.expect, { names: vars, path: 'expect' })
      for (const v of exprVars(ast)) if (!vars.includes(v)) throw new SpecError('expect', `"${v}" isn't one of ${vars.join(', ')}`)
      const got = mintermsOf(ast, vars)
      const wrong = [...ones.filter((m) => !got.includes(m)), ...zeros.filter((m) => got.includes(m))].sort((a, b) => a - b)
      if (wrong.length) {
        diag.warn('expect', `"${spec.expect}" is wrong at m${wrong.join(', m')} (${wrong.map((m) => (ones.includes(m) ? 'should be 1' : 'should be 0')).join(', ')})`)
        facts.push(`expect ${spec.expect}: WRONG at m${wrong.join(',')}`)
      } else {
        // Equal on the cares; is it minimal too?
        const isSum = !/\)\s*\(/.test(spec.expect) && /\+/.test(spec.expect.replace(/\([^()]*\)/g, ''))
        const minimal = sol.form === 'sop' ? sol.sop.cover : sol.pos.cover
        const termsGiven = isSum ? spec.expect.split('+').length : spec.expect.split(')(').length
        facts.push(`expect ${spec.expect}: matches${termsGiven > minimal.length ? `, but the minimum has ${minimal.length} terms` : ''}`)
      }
    }
    if (shown.length < sol.groups.length) facts.push(`showing ${shown.length} of ${sol.groups.length} groups`)
    const out = draw(sol, shown, spec, theme, uid)
    return { ...out, summary: facts.join('; '), alt: `${n}-variable Karnaugh map` }
  },
}
