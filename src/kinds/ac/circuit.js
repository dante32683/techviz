// The circuit: parts (R, L, C by the first letter of the name) combined in series (+) and
// parallel (||), the impedance at one frequency, every part's voltage and current, a divider's
// transfer function as polynomials in s, the RLC resonance facts, and the expect check.

import { SpecError } from '../../diag.js'
import { cx, add, mul, div, inv, abs, arg, padd, pmul } from './complex.js'
import { qty, freq, amount, show, sig, rect, partValue } from './units.js'

export const UNIT = { R: 'Ω', L: 'H', C: 'F' }

/** The parts in spec order: {name, type, value}; `over` replaces values (a sweep). */
export function readParts(spec, env, diag, over = {}) {
  const src = spec.parts
  if (!src || typeof src !== 'object' || Array.isArray(src) || !Object.keys(src).length) {
    throw new SpecError('parts', 'parts names each component and its value, like {"R": "30 ohm", "L": "80 mH", "C": "20 uF"}')
  }
  return Object.entries(src).map(([name, v], i) => {
    const type = name[0]
    if (!UNIT[type] || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new SpecError(`parts.${name}`, 'a part name starts with R, L, or C (R, R1, L2, Cx)')
    const value = name in over ? over[name] : qty(v, env, `parts.${name}`, UNIT[type], diag)
    if (!(value > 0)) throw new SpecError(`parts.${name}`, `${name} must be positive`)
    return { name, type, value, i }
  })
}

/** Parses "R1 + (L || C)": + is series, || is parallel and binds tighter. */
export function parseExpr(src, names, path) {
  const toks = String(src).match(/\|\||∥|[A-Za-z][A-Za-z0-9_]*|\S/g) ?? []
  let i = 0
  const bad = (t) => new SpecError(path, `unexpected ${t ? `"${t}"` : 'end'} in "${src}"; join part names with + (series) and || (parallel), like "R + (L || C)"`)
  const group = (op, next) => {
    const items = [next()]
    while (toks[i] === op || (op === '||' && toks[i] === '∥')) { i++; items.push(next()) }
    if (items.length === 1) return items[0]
    return { op, items: items.flatMap((n) => (n.op === op ? n.items : [n])) }
  }
  const series = () => group('+', par)
  const par = () => group('||', atom)
  const atom = () => {
    const t = toks[i++]
    if (t === '(') { const n = series(); if (toks[i++] !== ')') throw bad(toks[i - 1]); return n }
    if (t && /^[A-Za-z]/.test(t)) {
      if (!names.includes(t)) throw new SpecError(path, `"${t}" isn't in parts (${names.join(', ')})`)
      return { part: t }
    }
    throw bad(t)
  }
  const n = series()
  if (i < toks.length) throw bad(toks[i])
  return n
}

export const leaves = (n) => (n.part ? [n.part] : n.items.flatMap(leaves))
/** "R + (L || C)"; `tex` writes ∥ for a label. */
export function text(n, top = true, tex = false) {
  if (n.part) return n.part
  const s = n.items.map((c) => text(c, false, tex)).join(n.op === '+' ? ' + ' : tex ? '\\parallel ' : ' || ')
  return top ? s : `(${s})`
}

/** The circuit tree from `circuit`: "series" (default), "parallel", or an expression. */
export function readCircuit(spec, parts, diag) {
  const names = parts.map((p) => p.name)
  const c = spec.circuit ?? 'series'
  let node
  if (c === 'series' || c === 'parallel') node = names.length === 1 ? { part: names[0] } : { op: c === 'series' ? '+' : '||', items: names.map((part) => ({ part })) }
  else if (typeof c === 'string') node = parseExpr(c, names, 'circuit')
  else throw new SpecError('circuit', 'circuit is "series", "parallel", or an expression like "R + (L || C)"')
  const used = leaves(node)
  const twice = used.find((n, k) => used.indexOf(n) !== k)
  if (twice) throw new SpecError('circuit', `${twice} appears twice; give each copy its own name (R1, R2)`)
  const unused = names.filter((n) => !used.includes(n))
  if (unused.length) diag.warn('circuit', `${unused.join(', ')} ${unused.length > 1 ? 'are' : 'is'} in parts but not in the circuit`)
  return node
}

export function zPart(p, w) {
  if (p.type === 'R') return cx(p.value)
  if (p.type === 'L') return cx(0, w * p.value)
  return cx(0, -1 / (w * p.value))
}

/** Impedance of a node at ω (rad/s); `P` maps part names to parts. */
export function zAt(n, P, w) {
  if (n.part) return zPart(P.get(n.part), w)
  if (n.op === '+') return n.items.reduce((s, c) => add(s, zAt(c, P, w)), cx(0))
  return inv(n.items.reduce((s, c) => add(s, inv(zAt(c, P, w))), cx(0)))
}

/** Source current and every part's {V, I} for source phasor Vs at ω. */
export function solve(node, P, w, Vs) {
  const Z = zAt(node, P, w), I = div(Vs, Z)
  const parts = new Map()
  const walk = (n, V, I) => {
    if (n.part) parts.set(n.part, { V, I })
    else if (n.op === '+') for (const c of n.items) walk(c, mul(I, zAt(c, P, w)), I)
    else for (const c of n.items) walk(c, V, div(V, zAt(c, P, w)))
  }
  walk(node, Vs, I)
  return { Z, I, parts }
}

// Impedance as a ratio of polynomials in s.
const same = (a, b) => a.length === b.length && a.every((x, k) => x === b[k])
const radd = (a, b) => (same(a.den, b.den) ? { num: padd(a.num, b.num), den: a.den } : { num: padd(pmul(a.num, b.den), pmul(b.num, a.den)), den: pmul(a.den, b.den) })
export function zS(n, P) {
  if (n.part) {
    const p = P.get(n.part)
    return p.type === 'R' ? { num: [p.value], den: [1] } : p.type === 'L' ? { num: [0, p.value], den: [1] } : { num: [1], den: [0, p.value] }
  }
  const kids = n.items.map((c) => zS(c, P))
  if (n.op === '+') return kids.reduce(radd)
  const y = kids.map((z) => ({ num: z.den, den: z.num })).reduce(radd)
  return { num: y.den, den: y.num }
}

/**
 * A divider: `out` names top-level series terms of the circuit ("C", "L + C"). Returns the
 * output and the rest as nodes; H = Z_out / (Z_out + Z_rest).
 */
export function divider(spec, node, parts) {
  if (node.op !== '+') throw new SpecError('circuit', 'a Bode plot from a circuit needs a series divider, like "R + C" with out "C"; or give poles and zeros')
  const names = parts.map((p) => p.name)
  const outNode = parseExpr(spec.out, names, 'out')
  const terms = outNode.op === '+' ? outNode.items : [outNode]
  const tops = node.items.map((c) => text(c))
  for (const t of terms) if (!tops.includes(text(t))) throw new SpecError('out', `"${text(t)}" isn't a series term of the circuit; out is one or more of ${tops.map((s) => `"${s}"`).join(', ')}`)
  const outT = terms.map((t) => text(t))
  const rest = node.items.filter((c) => !outT.includes(text(c)))
  if (!rest.length) throw new SpecError('out', 'out covers the whole circuit, so H = 1; leave at least one term out')
  const wrap = (items) => (items.length === 1 ? items[0] : { op: '+', items })
  return { out: wrap(terms), rest: wrap(rest) }
}

/** Series or parallel RLC (one L, one C, at most one R, nothing nested): f0, Q, BW, f1, f2. */
export function rlc(node, parts) {
  const by = (t) => parts.filter((p) => p.type === t)
  if (node.part || node.items.some((c) => !c.part) || by('L').length !== 1 || by('C').length !== 1 || by('R').length > 1) return null
  const L = by('L')[0].value, C = by('C')[0].value, R = by('R')[0]?.value
  const series = node.op === '+'
  const w0 = 1 / Math.sqrt(L * C)
  if (R === undefined) return { series, w0, f0: w0 / (2 * Math.PI), Q: Infinity }
  // Half-power points: ω = ∓a + √(a² + ω0²), a = R/2L (series) or 1/2RC (parallel).
  const a = series ? R / (2 * L) : 1 / (2 * R * C)
  const w1 = Math.sqrt(a * a + w0 * w0) - a, w2 = Math.sqrt(a * a + w0 * w0) + a
  const tau = 2 * Math.PI
  return { series, w0, f0: w0 / tau, Q: series ? (w0 * L) / R : R / (w0 * L), BW: (w2 - w1) / tau, f1: w1 / tau, f2: w2 / tau }
}

/** "Z = 30.00 + j30.16 − j132.6 = 30.00 − j102.5 Ω": every combination, inner ones first. */
export function steps(node, P, w) {
  const out = []
  const terms = (zs, unit) => zs.map((z, k) => {
    const s = rect(z, '')
    const wrapped = z.re && z.im && zs.length > 1 ? `(${s})` : s
    return k === 0 ? wrapped : wrapped.startsWith('−') ? ` − ${wrapped.slice(1)}` : ` + ${wrapped}`
  }).join('') + ` ${unit}`
  const walk = (n) => {
    if (n.part) return
    n.items.forEach(walk)
    const name = text(n)
    const zs = n.items.map((c) => zAt(c, P, w))
    if (n.op === '+') out.push(`${name}: Z = ${terms(zs, 'Ω')} = ${rect(zAt(n, P, w), 'Ω')}`)
    else out.push(`${name}: Y = ${terms(zs.map(inv), 'S')} = ${rect(inv(zAt(n, P, w)), 'S')}, Z = 1/Y = ${rect(zAt(n, P, w), 'Ω')}`)
  }
  walk(node)
  return out
}

/** The source: V (amplitude) and f, with the rms or peak convention. */
export function readSource(spec, env, diag, need) {
  if (need && spec.f === undefined) throw new SpecError('f', 'give the source frequency, like "f": "60 Hz" (or "377 rad/s")')
  const f = spec.f === undefined ? null : freq(spec.f, env, 'f', diag)
  const V = spec.V === undefined ? null : qty(spec.V, env, 'V', 'V', diag)
  if (spec.rms !== undefined && typeof spec.rms !== 'boolean') throw new SpecError('rms', 'rms is true (V and every computed V and I are rms, the default) or false (peak)')
  const rms = spec.rms !== false
  return { f, V, rms, word: rms ? 'rms' : 'peak' }
}

/**
 * Everything at the source frequency: the summary facts and the values expect checks.
 * Returns { facts, vals, sol, phi } (phi in degrees: source voltage phase minus current phase).
 */
export function analyze(node, parts, src) {
  const P = new Map(parts.map((p) => [p.name, p]))
  const w = 2 * Math.PI * src.f
  const V = src.V ?? 1
  const sol = solve(node, P, w, cx(V))
  if (!Number.isFinite(abs(sol.I)) || !Number.isFinite(abs(sol.Z))) {
    throw new SpecError('f', `at ${show(src.f, 'Hz')} the circuit's impedance is ${abs(sol.Z) ? 'infinite' : 'zero'} (ideal resonance with no R); add a resistance or move f`)
  }
  const vals = {}
  const put = (key, v, unit, label, more = {}) => { vals[key] = { v, unit, label, ...more } }
  const phi = arg(sol.Z)
  put('w', w, 'rad/s', 'ω'); put('f', src.f, 'Hz', 'f')
  const X = [], VI = []
  for (const p of parts) {
    if (p.type !== 'R') { const x = abs(zPart(p, w)); put(`x${p.name.toLowerCase()}`, x, 'Ω', `X_{${p.name}}`); X.push(`X_${p.name} ${show(x, 'Ω', 4)}`) }
  }
  put('x', sol.Z.im, 'Ω', 'X'); put('z', abs(sol.Z), 'Ω', '|Z|'); put('phi', phi, '°', 'φ', { angle: true })
  put('i', abs(sol.I), 'A', 'I', { amp: true }); put('v', V, 'V', 'V', { amp: true })
  for (const p of parts) {
    const { V: v, I: i } = sol.parts.get(p.name)
    put(`v${p.name.toLowerCase()}`, abs(v), 'V', `V_{${p.name}}`, { amp: true })
    put(`i${p.name.toLowerCase()}`, abs(i), 'A', `I_{${p.name}}`, { amp: true })
  }
  const pf = Math.cos((phi * Math.PI) / 180)
  // Average power: V_rms I_rms cos φ, or half of V₀I₀ cos φ in peak values.
  const Pavg = V * abs(sol.I) * pf * (src.rms ? 1 : 0.5)
  put('pf', pf, '', 'pf'); put('p', Pavg, 'W', 'P', { power: true })
  const res = rlc(node, parts)
  if (res) {
    put('f0', res.f0, 'Hz', 'f_{0}')
    if (Number.isFinite(res.Q)) { put('q', res.Q, '', 'Q'); put('bw', res.BW, 'Hz', 'Δf'); put('f1', res.f1, 'Hz', 'f_{1}'); put('f2', res.f2, 'Hz', 'f_{2}') }
  }

  const lead = Math.abs(phi) < 0.005 ? 'in phase (resistive)' : phi > 0 ? 'current lags the voltage (inductive)' : 'current leads the voltage (capacitive)'
  const series = node.op === '+' || node.part
  const each = (key) => parts.map((p) => `${key}_${p.name} ${show(abs(sol.parts.get(p.name)[key]), key === 'V' ? 'V' : 'A', 4)}`).join(', ')
  const facts = [
    `${node.part ? 'single part' : node.op === '+' && node.items.every((c) => c.part) ? 'series' : node.op === '||' && node.items.every((c) => c.part) ? 'parallel' : text(node)} ${parts.map((p) => `${p.name} ${partValue(p.value, UNIT[p.type])}`).join(', ')}`,
    `source ${src.V === null ? '1 V (default)' : show(V, 'V', 4)} ${src.word} at ${show(src.f, 'Hz', 4)}, ω ${show(w, 'rad/s', 4)}`,
    ...(X.length ? [X.join(', ')] : []),
    ...steps(node, P, w).map((s, k, all) => (k === all.length - 1 ? `${s} = ${show(abs(sol.Z), 'Ω', 4)} ∠ ${show(phi, '°', 4)}` : s)),
    `φ ${show(phi, '°', 4)}: ${lead}`,
    `I ${show(abs(sol.I), 'A', 4)} ${src.word}`,
    `${series ? each('V') : each('I')} ${src.word}${series ? '' : `; every V ${show(V, 'V', 4)}`}`,
    ...(series && !node.part && node.items.some((c) => !c.part) ? [`currents ${each('I')}`] : []),
    `pf ${sig(pf, 4)}${Math.abs(phi) < 0.005 ? '' : phi > 0 ? ' lagging' : ' leading'}, P ${show(Pavg, 'W', 4)} average`,
  ]
  if (res) facts.push(Number.isFinite(res.Q)
    ? `f0 ${show(res.f0, 'Hz', 4)}, Q ${sig(res.Q, 4)}, BW ${show(res.BW, 'Hz', 4)} (f1 ${show(res.f1, 'Hz', 4)}, f2 ${show(res.f2, 'Hz', 4)})`
    : `f0 ${show(res.f0, 'Hz', 4)} (no R: Q is infinite)`)
  return { facts, vals, sol, phi, w, V, P, res }
}

const ALIAS = { 'φ': 'phi', varphi: 'phi', 'ω': 'w', omega: 'w', 'δf': 'bw', deltaf: 'bw', 'f₀': 'f0', '|z|': 'z', zmag: 'z', powerfactor: 'pf' }
export const keyOf = (k) => { const s = String(k).toLowerCase().replace(/[_{}\s\\]/g, ''); return ALIAS[s] ?? s }

/** Checks `expect` against vals; a miss warns with the computed value and a likely cause. */
export function checkExpect(spec, vals, env, diag, src) {
  if (spec.expect === undefined) return null
  if (!spec.expect || typeof spec.expect !== 'object' || Array.isArray(spec.expect)) throw new SpecError('expect', 'expect is {"Z": "106.8 ohm", "phi": -73.7, "I": 0.843}')
  const out = []
  for (const [key, given] of Object.entries(spec.expect)) {
    const got = vals[keyOf(key)]
    if (!got) { diag.warn(`expect.${key}`, `"${key}" isn't computed here; checkable: ${Object.keys(vals).join(', ')}`); out.push(`${key} ?`); continue }
    const [want, unit] = amount(given, env, `expect.${key}`)
    if (unit && got.unit && unit !== got.unit) diag.warn(`expect.${key}`, `"${given}" is in ${unit}; ${got.label} is in ${got.unit}`)
    const near = (x, k = 1) => Math.abs(want - x) <= (got.angle ? Math.max(0.5, 0.01 * Math.abs(x)) : 0.01 * Math.abs(x) * k + 1e-12)
    if (near(got.v)) { out.push(`${key} ok`); continue }
    let why = 'is wrong'
    if (got.angle && near(-got.v)) why = 'has the wrong sign (φ is the source voltage phase minus the current phase)'
    else if (got.angle && Math.abs(want - (got.v * Math.PI) / 180) <= 0.01) why = 'is in radians; φ is in degrees'
    else if (got.amp && src.rms && near(got.v * Math.SQRT2, Math.SQRT2)) why = 'is the peak value; this spec uses rms'
    else if (got.amp && !src.rms && near(got.v / Math.SQRT2)) why = 'is the rms value; this spec uses peak'
    else if (got.power && near(got.v * 2, 2)) why = 'is twice the average power (V₀I₀ cos φ needs the ½)'
    diag.warn(`expect.${key}`, `${typeof given === 'number' ? sig(given, 4) : given} ${why}: ${got.label} = ${show(got.v, got.unit, 4)}${got.amp ? ` ${src.word}` : ''}`)
    out.push(`${key} WRONG`)
  }
  return `expect: ${out.join(', ')}`
}
