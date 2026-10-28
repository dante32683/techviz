// Reading linalg specs: matrices (rows of numbers, fractions, or expressions), named 2×2 maps
// (rotate, reflect, shear, scale, project), vectors given by coordinates or as combinations of
// earlier ones ("2u - v"), and the user's own row operations ("R2 - 2R1", "R1 <-> R3", "(1/2)R2").

import { SpecError } from '../../diag.js'
import * as N from './num.js'

const { Q, ZERO, ONE, add, mul, div, neg, isZero, fmt } = N

export function readMatrix(v, env, path) {
  if (!Array.isArray(v) || !v.length || !v.every(Array.isArray)) throw new SpecError(path, 'a matrix is a list of rows, like [[1, 2], [3, 4]]')
  const n = v[0].length
  if (!n) throw new SpecError(path, 'a matrix row needs at least one entry')
  v.forEach((r, i) => { if (r.length !== n) throw new SpecError(`${path}[${i}]`, `row ${i + 1} has ${r.length} entries; row 1 has ${n}`) })
  return v.map((r, i) => r.map((x, j) => N.parseNum(x, env, `${path}[${i}][${j}]`)))
}

export function readVector(v, env, path, dim) {
  if (!Array.isArray(v) || v.length < 1) throw new SpecError(path, 'a vector is a list of entries, like [2, 1]')
  if (dim && v.length !== dim) throw new SpecError(path, `${v.length} entries; this needs ${dim}`)
  return v.map((x, k) => N.parseNum(x, env, `${path}[${k}]`))
}

const DEG = Math.PI / 180
// cos and sin of θ°, exact on the quarter turns; snapping makes 30° and 60° multiples exact halves.
function cs(theta) {
  const t = N.toF(theta)
  const k = ((t % 360) + 360) % 360
  if (k % 90 === 0) return [[ONE, ZERO, neg(ONE), ZERO][k / 90], [ZERO, ONE, ZERO, neg(ONE)][k / 90]]
  const c = Math.cos(t * DEG), s = Math.sin(t * DEG)
  return [N.snap(c) ?? c, N.snap(s) ?? s]
}
const deg = (x) => `${fmt(x)}°`
const NAMED = ['rotate', 'reflect', 'shear', 'scale', 'project', 'matrix']

/**
 * A 2×2 map: rows, or {rotate: θ°}, {reflect: "x" | "y" | "y=x" | "y=-x" | θ° | [a, b]},
 * {shear: k, axis: "x" | "y"}, {scale: k | [kx, ky]}, {project: "x" | "y" | θ° | [a, b]},
 * or {matrix: rows}; any of them with a `name`. Returns {M, name, desc}.
 */
export function readMap(v, env, path, dflt = 'A') {
  if (Array.isArray(v)) return { M: readMatrix(v, env, path), name: dflt, desc: '' }
  if (!v || typeof v !== 'object') throw new SpecError(path, 'a matrix like [[1, 1], [0, 1]], or a named map like {"rotate": 90}, {"shear": 1}, {"reflect": "y"}, {"scale": [2, 1]}, {"project": [1, 2]}')
  const key = NAMED.find((k) => k in v)
  const name = v.name ?? dflt
  if (!key) throw new SpecError(path, `name the map with one of ${NAMED.join(', ')}`)
  const p = `${path}.${key}`, a = v[key]
  if (key === 'matrix') return { M: readMatrix(a, env, p), name, desc: '' }
  if (key === 'rotate') {
    const t = N.parseNum(a, env, p), [c, s] = cs(t)
    return { M: [[c, neg(s)], [s, c]], name, desc: `rotation by ${deg(t)}` }
  }
  if (key === 'shear') {
    const k = N.parseNum(a, env, p), axis = v.axis ?? 'x'
    if (axis !== 'x' && axis !== 'y') throw new SpecError(`${path}.axis`, 'axis is "x" (x moves by k·y) or "y" (y moves by k·x)')
    return { M: axis === 'x' ? [[ONE, k], [ZERO, ONE]] : [[ONE, ZERO], [k, ONE]], name, desc: `${axis}-shear by ${fmt(k)}` }
  }
  if (key === 'scale') {
    const [kx, ky] = Array.isArray(a) ? readVector(a, env, p, 2) : [N.parseNum(a, env, p), N.parseNum(a, env, p)]
    return { M: [[kx, ZERO], [ZERO, ky]], name, desc: N.eq(kx, ky) ? `scaling by ${fmt(kx)}` : `scaling x by ${fmt(kx)}, y by ${fmt(ky)}` }
  }
  // reflect and project: across or onto a line through the origin. With d = (a, b), c² = a²/|d|²,
  // s² = b²/|d|², and sc = ab/|d|², so a rational direction gives an exact matrix.
  const line = lineOf(a, env, p)
  if (line.origin && key === 'project') throw new SpecError(p, 'project onto a line: "x", "y", "y=x", an angle in degrees, or a direction [a, b]')
  if (line.origin) return { M: [[neg(ONE), ZERO], [ZERO, neg(ONE)]], name, desc: 'reflection through the origin' }
  const { cc, ss, sc } = line
  if (key === 'project') return { M: [[cc, sc], [sc, ss]], name, desc: `projection onto ${line.text}` }
  const two = Q(2)
  return { M: [[N.sub(cc, ss), mul(two, sc)], [mul(two, sc), N.sub(ss, cc)]], name, desc: `reflection across ${line.text}` }
}

// A line through the origin, as the products c², s², and sc of its unit direction.
function lineOf(a, env, p) {
  const NAMES = { x: [[ONE, ZERO], 'the x-axis'], y: [[ZERO, ONE], 'the y-axis'], 'y=x': [[ONE, ONE], 'y = x'], 'y=-x': [[ONE, neg(ONE)], 'y = −x'] }
  let d, text
  if (a === 'origin') return { origin: true, text: 'the origin' }
  if (typeof a === 'string' && NAMES[a.replace(/\s+/g, '')]) [d, text] = NAMES[a.replace(/\s+/g, '')]
  else if (Array.isArray(a)) { d = readVector(a, env, p, 2); text = `the line through ${N.vecText(d)}` }
  else { const t = N.parseNum(a, env, p); d = cs(t); text = `the line at ${deg(t)}` }
  if (d.every(isZero)) throw new SpecError(p, 'the direction is the zero vector')
  const n2 = add(mul(d[0], d[0]), mul(d[1], d[1]))
  const f = (x) => { const y = div(x, n2); return N.isQ(y) ? y : N.snap(y) ?? y }
  return { cc: f(mul(d[0], d[0])), ss: f(mul(d[1], d[1])), sc: f(mul(d[0], d[1])), text }
}

/** Vectors: [{id, v, label, color}], where v is coordinates or a combination of earlier ids. */
export function readVectors(list, env, path = 'vectors') {
  if (!Array.isArray(list) || !list.length) throw new SpecError(path, 'vectors is a list like [{"id": "u", "v": [2, 1]}]')
  const byId = new Map(), out = []
  list.forEach((it, i) => {
    const p = `${path}[${i}]`
    if (!it || typeof it !== 'object' || Array.isArray(it)) throw new SpecError(p, 'each vector is {"id": "u", "v": [2, 1]}')
    if (typeof it.id !== 'string' || !it.id) throw new SpecError(`${p}.id`, 'each vector needs an id (its default label)')
    const v = typeof it.v === 'string' ? combination(it.v, byId, env, `${p}.v`) : readVector(it.v, env, `${p}.v`)
    const o = { ...it, v, label: it.label ?? it.id, i }
    byId.set(it.id, o); out.push(o)
  })
  const dim = out[0].v.length
  for (const o of out) if (o.v.length !== dim) throw new SpecError(`${path}[${o.i}].v`, `every vector needs ${dim} entries (all in ℝ² or all in ℝ³)`)
  if (dim !== 2 && dim !== 3) throw new SpecError(`${path}[0].v`, 'vectors are drawn in ℝ² or ℝ³')
  return { list: out, byId, dim }
}

// "2u - v", "u + (1/2)w", "-3/2 v": a linear combination of earlier vectors.
function combination(src, byId, env, path) {
  const s = src.replace(/\s+/g, '').replace(/−/g, '-')
  const re = /([+-]?)(\(?[\d.]+(?:\/[\d.]+)?\)?)?\*?([A-Za-z]\w*)/gy
  let m, pos = 0, v = null
  while (pos < s.length && (m = re.exec(s))) {
    pos = re.lastIndex
    const o = byId.get(m[3])
    if (!o) throw new SpecError(path, `"${m[3]}" isn't an earlier vector (${[...byId.keys()].join(', ') || 'none yet'})`)
    let c = m[2] ? N.parseNum(m[2].replace(/[()]/g, ''), env, path) : ONE
    if (m[1] === '-') c = neg(c)
    const t = o.v.map((x) => mul(c, x))
    v = v ? v.map((x, k) => add(x, t[k])) : t
  }
  if (pos !== s.length || !v) throw new SpecError(path, `can't read "${src}"; write coordinates like [2, 1] or a combination like "2u - v"`)
  return v
}

/**
 * A row operation in the usual hand notation, rows numbered from 1: "R2 - 2R1" or
 * "R2 <- R2 - 2R1" (replacement), "R1 <-> R3" or "swap R1 R3", "(1/2)R2", "R2/2", "-R3".
 */
export function parseOp(src, m, env, path) {
  const bad = () => new SpecError(path, `can't read "${src}"; write a row operation like "R2 - 2R1", "R1 <-> R3", or "(1/2)R2"`)
  if (typeof src !== 'string') throw bad()
  const s = src.replace(/\s+/g, '').replace(/−/g, '-').replace(/↔/g, '<->').replace(/←/g, '<-').replace(/→/g, '->').replace(/r(?=\d)/g, 'R')
  const row = (d) => { const i = Number(d) - 1; if (!(i >= 0 && i < m)) throw new SpecError(path, `there is no row ${d}; rows are 1 to ${m}`); return i }
  let x
  if ((x = /^R(\d+)<->R(\d+)$/.exec(s)) || (x = /^swap\(?R?(\d+),?R(\d+)\)?$/i.exec(s))) {
    const i = row(x[1]), j = row(x[2])
    if (i === j) throw new SpecError(path, 'swap two different rows')
    return { type: 'swap', i, j }
  }
  let target = null, rhs = s
  if ((x = /^R(\d+)(?:<-|=)(.+)$/.exec(s))) { target = row(x[1]); rhs = x[2] }
  else if ((x = /^(.+)->R(\d+)$/.exec(s))) { target = row(x[2]); rhs = x[1] }
  const re = /([+-]?)(\(?-?[\d.]+(?:\/[\d.]+)?\)?)?\*?R(\d+)(?:([/*])(\(?-?[\d.]+(?:\/[\d.]+)?\)?))?/gy
  const terms = new Map()
  let pos = 0, t
  while (pos < rhs.length && (t = re.exec(rhs))) {
    pos = re.lastIndex
    let c = t[2] ? N.parseNum(t[2].replace(/[()]/g, ''), env, path) : ONE
    if (t[4]) { const k = N.parseNum(t[5].replace(/[()]/g, ''), env, path); c = t[4] === '/' ? div(c, k) : mul(c, k) }
    if (t[1] === '-') c = neg(c)
    const i = row(t[3])
    if (target === null) target = i
    terms.set(i, add(terms.get(i) ?? ZERO, c))
  }
  if (pos !== rhs.length || !terms.size) throw bad()
  const a = terms.get(target) ?? ZERO
  const others = [...terms.entries()].filter(([i]) => i !== target)
  if (isZero(a)) throw new SpecError(path, `"${src}" drops R${target + 1}; keep it in its own new value (R${target + 1} + kR_j) so the reduction is reversible`)
  if (others.length > 1) throw new SpecError(path, `"${src}" mixes in more than one other row; split it into two operations`)
  if (!others.length) return { type: 'scale', i: target, k: a }
  const [j, b] = others[0]
  return N.isOne(a) ? { type: 'add', i: target, j, k: b } : { type: 'comb', i: target, a, j, b }
}
