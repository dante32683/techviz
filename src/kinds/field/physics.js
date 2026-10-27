// The physics for field: sources read from the spec (problem units, y up, SI values), and the
// electric field and potential they make at a point in the page. Point charges use Coulomb's
// law, infinite lines 2kλ/d, finite segments the closed-form integral, and infinite planes
// σ/2ε₀ (parallel plates are two planes of ±σ, so σ/ε₀ between and 0 outside).

import { SpecError } from '../../diag.js'
import { val, direction, fmt } from '../truss/solve.js'

export { val, direction, fmt }
export const K = 8.9875517923e9
export const EPS0 = 8.8541878128e-12

const PREFIX = { p: 1e-12, n: 1e-9, u: 1e-6, μ: 1e-6, µ: 1e-6, m: 1e-3, '': 1, k: 1e3 }
const UNIT = { point: 'C', line: 'C/m', segment: 'C/m', plane: 'C/m^2', plates: 'C/m^2' }
const KEY = { point: 'q', line: 'lambda', segment: 'lambda', plane: 'sigma', plates: 'sigma' }

export const unitVec = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]
export const W = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, k) => [a[0] * k, a[1] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1],
  len: (a) => Math.hypot(a[0], a[1]),
  unit: (a) => { const l = Math.hypot(a[0], a[1]); return l ? [a[0] / l, a[1] / l] : [0, 0] },
  perp: (a) => [-a[1], a[0]],
}
/** Math angle in degrees (0 to 360) of a world vector. */
export const angleOf = (v) => (((Math.atan2(v[1], v[0]) * 180) / Math.PI) % 360 + 360) % 360

/** A charge amount: a number (SI), an expression of params, or a string with its unit like "55.5 pC/m^2". */
export function amount(v, type, env, path) {
  if (typeof v === 'string') {
    const s = v.trim().replace('−', '-')
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return parseFloat(s)
    const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([pnuμµmk]?)C(\/m(\^?2|²)?)?$/.exec(s)
    if (m) {
      const unit = m[3] ? (m[4] ? 'C/m^2' : 'C/m') : 'C'
      if (unit !== UNIT[type]) throw new SpecError(path, `a ${type} takes ${KEY[type]} in ${UNIT[type]}, like "2 n${UNIT[type]}"; got ${unit}`)
      return parseFloat(m[1]) * PREFIX[m[2]]
    }
  }
  return val(v, env, path)
}

/** A signed SI value with a prefix: +55.5 \text{pC/m}^{2} for a label, +55.5 pC/m^2 for text. */
export function si(x, unit, tex = true) {
  const e = x ? Math.max(-12, Math.min(3, Math.floor(Math.log10(Math.abs(x)) / 3) * 3)) : 0
  const pre = { '-12': 'p', '-9': 'n', '-6': 'μ', '-3': 'm', 0: '', 3: 'k' }[e]
  const sq = unit.endsWith('^2'), base = `${pre}${sq ? unit.slice(0, -2) : unit}`
  const u = tex ? `\\text{${base}}${sq ? '^{2}' : ''}` : `${base}${sq ? '^2' : ''}`
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${fmt(Math.abs(x) / 10 ** e)} ${u}`
}

const pair = (p, env, path) => {
  if (!Array.isArray(p) || p.length !== 2) throw new SpecError(path, 'a position is [x, y] in length units (y up)')
  const x = val(p[0], env, `${path}[0]`), y = val(p[1], env, `${path}[1]`)
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new SpecError(path, 'coordinates must be finite numbers')
  return [x, y]
}
export { pair }

const TYPES = 'point, line, segment, plane, plates'

/**
 * Read `sources`: `drawn` in length units for drawing, and `simple` in meters (scaled by `lu`,
 * meters per length unit) for the physics, with plates split into two planes.
 */
export function readSources(spec, env, lu = 1) {
  if (!Array.isArray(spec.sources) || !spec.sources.length) {
    throw new SpecError('sources', `sources lists the charges: {"type": ${TYPES}, ...}, like {"type": "point", "at": [0, 0], "q": "2 nC"}`)
  }
  const drawn = [], simple = []
  spec.sources.forEach((s, i) => {
    const path = `sources[${i}]`
    if (!s || typeof s !== 'object') throw new SpecError(path, 'a source is an object with a type')
    const type = s.type ?? 'point'
    if (!UNIT[type]) throw new SpecError(`${path}.type`, `type is one of ${TYPES}`)
    const key = KEY[type]
    if (s[key] === undefined) throw new SpecError(`${path}.${key}`, `a ${type} needs ${key} (${UNIT[type]}), a number or a string like "2 n${UNIT[type]}"`)
    const amt = amount(s[key], type, env, `${path}.${key}`)
    if (!Number.isFinite(amt)) throw new SpecError(`${path}.${key}`, `${key} must be a finite number`)
    const src = { i, path, type, id: s.id, amt, unit: UNIT[type], label: s.label, color: s.color }
    if (type === 'point') src.at = pair(s.at ?? [0, 0], env, `${path}.at`)
    else if (type === 'line') {
      src.at = pair(s.at ?? [0, 0], env, `${path}.at`)
      if (s.angle !== undefined) { src.deg = val(s.angle, env, `${path}.angle`); src.u = unitVec(src.deg) }
    } else if (type === 'segment') {
      src.a = pair(s.from, env, `${path}.from`); src.b = pair(s.to, env, `${path}.to`)
      src.L = W.len(W.sub(src.b, src.a))
      if (!(src.L > 0)) throw new SpecError(`${path}.to`, 'a segment needs two different ends')
      src.u = W.unit(W.sub(src.b, src.a)); src.deg = angleOf(src.u)
    } else if (type === 'plane') {
      src.at = pair(s.at ?? [0, 0], env, `${path}.at`)
      src.deg = val(s.angle ?? 0, env, `${path}.angle`); src.u = unitVec(src.deg)
    } else {
      src.at = pair(s.at ?? [0, 0], env, `${path}.at`)
      src.gap = val(s.gap ?? 1, env, `${path}.gap`)
      if (!(src.gap > 0)) throw new SpecError(`${path}.gap`, 'gap (the plate separation, length units) must be positive')
      const e = direction(s.dir ?? 'down', env, `${path}.dir`)
      src.e = e; src.u = W.perp(e); src.deg = angleOf(src.u)
      const sig = Math.abs(amt)
      // E runs from the + plate to the − plate; a negative sigma swaps which side is +.
      const plus = W.sub(src.at, W.mul(e, (Math.sign(amt) * src.gap) / 2)), minus = W.add(src.at, W.mul(e, (Math.sign(amt) * src.gap) / 2))
      src.plates = [{ at: plus, amt: sig }, { at: minus, amt: -sig }]
      for (const p of src.plates) simple.push({ type: 'plane', at: p.at, u: src.u, amt: p.amt, owner: src })
      drawn.push(src)
      return
    }
    drawn.push(src)
    simple.push({ ...src, owner: src })
  })
  const m = (p) => p && W.mul(p, lu)
  const scaled = simple.map((s) => ({ ...s, at: m(s.at), a: m(s.a), b: m(s.b), L: s.L && s.L * lu }))
  for (const s of scaled) if (s.type === 'plane' || (s.type === 'line' && s.u)) s.n = W.perp(s.u)
  return { drawn, simple: scaled }
}

/** E (V/m, world vector) and V (volts, with each source's own zero) at p. */
export function fieldAt(simple, p) {
  let ex = 0, ey = 0, v = 0
  for (const s of simple) {
    if (s.type === 'point') {
      const r = W.sub(p, s.at), d2 = W.dot(r, r), d = Math.sqrt(d2)
      ex += (K * s.amt * r[0]) / (d2 * d); ey += (K * s.amt * r[1]) / (d2 * d); v += (K * s.amt) / d
    } else if (s.type === 'line') {
      let r = W.sub(p, s.at)
      if (s.u) r = W.sub(r, W.mul(s.u, W.dot(r, s.u)))
      const d2 = W.dot(r, r)
      ex += (2 * K * s.amt * r[0]) / d2; ey += (2 * K * s.amt * r[1]) / d2; v -= K * s.amt * Math.log(d2)
    } else if (s.type === 'segment') {
      const r = W.sub(p, s.a), n = W.perp(s.u)
      const x0 = W.dot(r, s.u), h = W.dot(r, n)
      const ra = Math.hypot(x0, h), rb = Math.hypot(x0 - s.L, h)
      const along = K * s.amt * (1 / rb - 1 / ra)
      const hh = Math.max(Math.abs(h), 1e-9 * s.L)
      const across = Math.abs(h) < 1e-9 * s.L ? 0 : ((K * s.amt) / h) * (x0 / ra - (x0 - s.L) / rb)
      ex += along * s.u[0] + across * n[0]; ey += along * s.u[1] + across * n[1]
      v += K * s.amt * (Math.asinh(x0 / hh) - Math.asinh((x0 - s.L) / hh))
    } else {
      const d = W.dot(W.sub(p, s.at), s.n), E = s.amt / (2 * EPS0)
      const sg = d > 0 ? 1 : d < 0 ? -1 : 0
      ex += sg * E * s.n[0]; ey += sg * E * s.n[1]; v -= E * Math.abs(d)
    }
  }
  return { E: [ex, ey], V: v }
}

/** Distance (length units) from p to a simple source, for singular-point checks and stops. */
export function distTo(s, p) {
  if (s.type === 'point' || (s.type === 'line' && !s.u)) return W.len(W.sub(p, s.at))
  if (s.type === 'segment') {
    const r = W.sub(p, s.a), t = Math.max(0, Math.min(s.L, W.dot(r, s.u)))
    return W.len(W.sub(r, W.mul(s.u, t)))
  }
  return Math.abs(W.dot(W.sub(p, s.at), s.n))
}

/** Signed side of a straight source (plane, in-page line, segment's line), for crossing tests. */
export const sideOf = (s, p) => W.dot(W.sub(p, s.at ?? s.a), s.n ?? W.perp(s.u))
