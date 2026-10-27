// The RF math behind smith: complex numbers as [re, im], reflection quantities, the loads a spec
// can give (Z, Y, Γ, or an R, L, C model at a frequency), the moves along a chart (a lossless
// line, series and shunt L or C, a quarter-wave transformer), and the two-element L-section match.
// Impedances here are normalized to Z0 unless a name says ohms.

import { compileFor } from '../../expr.js'
import { SpecError } from '../../diag.js'

export const C = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
  div: (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d] },
  scale: (a, k) => [a[0] * k, a[1] * k],
  abs: (a) => Math.hypot(a[0], a[1]),
  arg: (a) => Math.atan2(a[1], a[0]),
  polar: (r, th) => [r * Math.cos(th), r * Math.sin(th)],
}
const ONE = [1, 0]
export const LIGHT = 299792458

/** Γ from a normalized z; z = Infinity (an open) gives Γ = 1. */
export function gammaOf(z) {
  if (!Number.isFinite(z[0]) || !Number.isFinite(z[1])) return [1, 0]
  return C.div(C.sub(z, ONE), C.add(z, ONE))
}
/** Normalized z from Γ; Γ = 1 gives [Infinity, 0]. */
export function zOf(g) {
  const d = C.sub(ONE, g)
  if (Math.hypot(d[0], d[1]) < 1e-12) return [Infinity, 0]
  return C.div(C.add(ONE, g), d)
}
/** Normalized y from Γ (y is z of −Γ). */
export const yOf = (g) => zOf([-g[0], -g[1]])

/** The reflection facts for Γ: |Γ|, angle (°), VSWR, return loss and mismatch loss (dB). */
export function facts(g) {
  const m = C.abs(g), mag = m < 1e-9 ? 0 : m
  return {
    mag, ang: (C.arg(g) * 180) / Math.PI,
    vswr: mag >= 1 ? Infinity : (1 + mag) / (1 - mag),
    rl: mag === 0 ? Infinity : -20 * Math.log10(mag),
    ml: mag >= 1 ? Infinity : -10 * Math.log10(1 - mag * mag),
  }
}
export const magFromVswr = (s) => (s - 1) / (s + 1)
export const magFromRl = (db) => 10 ** (-db / 20)

// ---- Amounts: a number (SI), a param expression, or a string with a unit ("2.4 GHz", "10 nH").

const PREFIX = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, c: 1e-2, '': 1, k: 1e3, M: 1e6, G: 1e9 }
const BASES = ['ohm', 'Ω', 'Hz', 'dB', 'deg', '°', 'S', 'H', 'F', 'm']
const NUM_UNIT = /^\s*([-+−]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*([A-Za-zΩµμ°]+)\s*$/

/** Reads an amount; `want` lists the base units that fit (a "10 nH" given as a capacitance errors). */
export function qty(v, env, path, want = []) {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') throw new SpecError(path, `expected a number or a string like "10 nH", got ${JSON.stringify(v)}`)
  const m = NUM_UNIT.exec(v)
  if (m) {
    const n = parseFloat(m[1].replace('−', '-'))
    for (const b of BASES) {
      if (!m[2].endsWith(b)) continue
      const p = m[2].slice(0, m[2].length - b.length)
      if (!(p in PREFIX) || (p === 'c' && b !== 'm')) continue
      const base = b === 'ohm' ? 'Ω' : b === 'deg' ? '°' : b
      if (want.length && !want.includes(base)) throw new SpecError(path, `"${v}" is in ${base}; this takes ${want.join(' or ')}`)
      return n * PREFIX[p]
    }
    throw new SpecError(path, `unknown unit in "${v}"; write it like "50 ohm", "2.4 GHz", "10 nH", "1.5 pF", or "3 cm"`)
  }
  try {
    return compileFor(v, Object.keys(env)).fn(env)
  } catch (err) {
    throw new SpecError(path, err.message)
  }
}

/** A complex value: [re, im] (each an amount) or a string like "40 + j30", "25-30j", "-j50". */
export function cplx(v, env, path) {
  if (Array.isArray(v) && v.length === 2) return [qty(v[0], env, `${path}[0]`), qty(v[1], env, `${path}[1]`)]
  if (typeof v === 'number') return [v, 0]
  if (typeof v === 'string') {
    const s = v.replace(/\s+/g, '').replace(/−/g, '-')
    const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)?(?:([-+])j((?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)?|([-+](?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)j)?$/i.exec(s)
    const lone = /^([-+]?)j((?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)?$/i.exec(s)
    if (lone) return [0, (lone[1] === '-' ? -1 : 1) * (lone[2] === undefined ? 1 : parseFloat(lone[2]))]
    if (m && s) {
      const re = m[1] !== undefined ? parseFloat(m[1]) : 0
      const im = m[2] ? (m[2] === '-' ? -1 : 1) * (m[3] === undefined ? 1 : parseFloat(m[3])) : m[4] ? parseFloat(m[4]) : 0
      return [re, im]
    }
  }
  throw new SpecError(path, `expected [re, im] or a string like "40 + j30", got ${JSON.stringify(v)}`)
}

// ---- Loads: R, L, C in series (or parallel), or R with a resonance f0 and Q.

export const MODEL_KEYS = ['R', 'L', 'C', 'f0', 'Q', 'parallel']

/** Reads a model {R, L, C, parallel} or {R, f0, Q, parallel}; returns Z(f) in ohms and a description. */
export function readModel(o, env, path) {
  const R = o.R === undefined ? undefined : qty(o.R, env, `${path}.R`, ['Ω'])
  let L = o.L === undefined ? undefined : qty(o.L, env, `${path}.L`, ['H'])
  let Cap = o.C === undefined ? undefined : qty(o.C, env, `${path}.C`, ['F'])
  const par = !!o.parallel
  let desc
  if (o.f0 !== undefined || o.Q !== undefined) {
    if (o.f0 === undefined || o.Q === undefined || R === undefined) throw new SpecError(path, 'a resonant load needs R, f0, and Q (L and C follow from them)')
    if (L !== undefined || Cap !== undefined) throw new SpecError(path, 'give L and C, or f0 and Q, not both')
    const f0 = qty(o.f0, env, `${path}.f0`, ['Hz']), Q = qty(o.Q, env, `${path}.Q`), w0 = 2 * Math.PI * f0
    // Series: Q = ω0 L / R. Parallel: Q = R / (ω0 L).
    L = par ? R / (Q * w0) : (Q * R) / w0
    Cap = 1 / (w0 * w0 * L)
    desc = { par, R, f0, Q }
  }
  if (R === undefined && L === undefined && Cap === undefined) throw new SpecError(path, 'a load model needs R, L, or C')
  const Z = (f) => {
    const w = 2 * Math.PI * f
    if (par) {
      let y = [0, 0]
      if (R !== undefined) y = C.add(y, [1 / R, 0])
      if (L !== undefined) y = C.add(y, [0, -1 / (w * L)])
      if (Cap !== undefined) y = C.add(y, [0, w * Cap])
      return C.div(ONE, y)
    }
    let z = [R ?? 0, 0]
    if (L !== undefined) z = C.add(z, [0, w * L])
    if (Cap !== undefined) z = C.add(z, [0, -1 / (w * Cap)])
    return z
  }
  return { Z, R, L, C: Cap, parallel: par, desc, needsF: L !== undefined || Cap !== undefined }
}

// ---- Moves. Each returns the end Γ, a sampled path of Γ values, and the facts to report.

const TAU = 2 * Math.PI
const mod2pi = (a) => ((a % TAU) + TAU) % TAU

/** Γ angles where the |Γ| = ρ circle meets a target ("r=1", "g=1", "max", "min"). */
function targetAngles(rho, to, path) {
  if (to === 'max') return [0]
  if (to === 'min') return [Math.PI]
  if (to === 'r=1' || to === 'g=1') {
    const c = to === 'r=1' ? rho : -rho // r = 1: cos θ = ρ; g = 1: cos θ = −ρ
    if (rho > 1) throw new SpecError(path, `|Γ| = ${rho.toFixed(3)} > 1 never meets the ${to} circle`)
    const a = Math.acos(Math.max(-1, Math.min(1, c)))
    return [a, -a]
  }
  throw new SpecError(path, `a line moves to "r=1", "g=1", "max" (the voltage maximum), or "min"; got "${to}"`)
}

/**
 * A lossless line of `d` wavelengths (toward the generator unless `load`), of characteristic
 * impedance zc (normalized; 1 is the chart's own line). With `to`, d is found: the shortest line
 * that reaches the target.
 */
export function lineMove(g0, { d, load = false, zc = 1, to }, path) {
  if (to !== undefined) {
    if (zc !== 1) throw new SpecError(path, '"to" works on a line of the chart\'s own Z0; leave out zc')
    const rho = C.abs(g0), th = C.arg(g0)
    if (rho < 1e-9) d = 0
    else {
      const turns = targetAngles(rho, to, path).map((t) => (load ? mod2pi(t - th) : mod2pi(th - t))).filter((a) => a > 1e-7)
      d = turns.length ? Math.min(...turns) / (4 * Math.PI) : 0
    }
  }
  const sgn = load ? -1 : 1
  const at = (t) => {
    const bl = TAU * d * t * sgn
    if (zc === 1) return C.mul(g0, C.polar(1, -2 * bl))
    // Z = Zc (ZL cos βl + j Zc sin βl) / (Zc cos βl + j ZL sin βl), normalized to Z0.
    const zl = zOf(g0), c = Math.cos(bl), s = Math.sin(bl)
    if (!Number.isFinite(zl[0])) return gammaOf(C.div([zc * c, 0], [0, s]))
    const num = C.add(C.scale(zl, c), [0, zc * s])
    const den = C.add([zc * c, 0], C.mul([0, s], zl))
    return gammaOf(C.scale(C.div(num, den), zc))
  }
  const n = Math.max(24, Math.ceil(Math.abs(d) * 240))
  const pts = Array.from({ length: n + 1 }, (_, k) => at(k / n))
  return { end: at(1), pts, d }
}

/**
 * A series or shunt reactance: series moves z along its constant-r circle by jx; shunt moves y along
 * its constant-g circle by jb. `kind` is "L" or "C". The change is `delta` (normalized x or b), or
 * found from `to`: "g=1" or "r=1" (the first meeting in the element's direction) or "match".
 */
export function lumpedMove(g0, { shunt, kind, delta, to }, path, diag) {
  const w = shunt ? yOf(g0) : zOf(g0)
  if (!Number.isFinite(w[0])) throw new SpecError(path, `a ${shunt ? 'shunt' : 'series'} element at ${shunt ? 'a short' : 'an open'} does nothing; move along the line first`)
  const [re, im] = w
  const up = kind === (shunt ? 'C' : 'L') // series L adds +jx; shunt C adds +jb
  const name = `a ${shunt ? 'shunt' : 'series'} ${kind}`
  if (to !== undefined) {
    if (to === 'match') {
      delta = -im
      if (Math.abs(re - 1) > 0.02) diag?.warn(path, `${name} only reaches the center from the ${shunt ? 'g' : 'r'} = 1 circle; this point has ${shunt ? 'g' : 'r'} = ${re.toFixed(3)}, so it stops at ${shunt ? 'y' : 'z'} = ${re.toFixed(3)}`)
    } else if (to === (shunt ? 'r=1' : 'g=1')) {
      // Series: Re(1/(r + jx)) = 1 at x = ±√(r − r²). Shunt: Re(1/(g + jb)) = 1 at b = ±√(g − g²).
      if (re > 1 + 1e-9) throw new SpecError(path, `${name} moves along ${shunt ? 'g' : 'r'} = ${re.toFixed(3)}, which never meets the ${to} circle; put a ${shunt ? 'series' : 'shunt'} element first`)
      const t = Math.sqrt(Math.max(0, re - re * re))
      const ds = [t - im, -t - im].filter((dd) => (up ? dd > 1e-9 : dd < -1e-9))
      if (!ds.length) throw new SpecError(path, `${name} moves ${shunt ? 'b' : 'x'} ${up ? 'up' : 'down'} from ${im.toFixed(3)} and never meets the ${to} circle; use a ${shunt ? 'shunt' : 'series'} ${kind === 'L' ? 'C' : 'L'}`)
      delta = ds.reduce((a, b) => (Math.abs(a) < Math.abs(b) ? a : b))
    } else throw new SpecError(`${path}.to`, `${name} moves to "${shunt ? 'r=1' : 'g=1'}" or "match"; got "${to}"`)
    if (delta !== 0 && (delta > 0) !== up) throw new SpecError(path, `the move needs ${shunt ? 'b' : 'x'} ${delta > 0 ? '+' : ''}${delta.toFixed(3)}, which takes a ${shunt ? 'shunt' : 'series'} ${kind === 'L' ? 'C' : 'L'}`)
  }
  if (delta !== 0 && (delta > 0) !== up) diag?.warn(path, `${name} ${up ? 'adds' : 'subtracts'} reactance; ${shunt ? 'b' : 'x'} ${delta > 0 ? '+' : ''}${delta} has the wrong sign`)
  const n = 160
  // Sample evenly in the angle around the circle, not in x, so long moves near the open stay smooth.
  const a0 = Math.atan2(im, re + 1), a1 = Math.atan2(im + delta, re + 1)
  const pts = []
  for (let k = 0; k <= n; k++) {
    const v = (re + 1) * Math.tan(a0 + ((a1 - a0) * k) / n)
    const g = gammaOf([re, v])
    pts.push(shunt ? [-g[0], -g[1]] : g)
  }
  const end = shunt ? C.scale(gammaOf([re, im + delta]), -1) : gammaOf([re, im + delta])
  return { end, pts, delta }
}

/** Component value for a normalized change at f: series x = ωL/Z0 or −1/(ωC Z0); shunt b = ωC Z0 or −Z0/(ωL). */
export function componentValue({ shunt, kind }, delta, f, z0) {
  const w = TAU * f
  if (!shunt) return kind === 'L' ? (delta * z0) / w : 1 / (w * -delta * z0)
  return kind === 'C' ? delta / (w * z0) : z0 / (w * -delta)
}
/** The normalized change a component value makes at f (the inverse of componentValue). */
export function deltaOf({ shunt, kind }, value, f, z0) {
  const w = TAU * f
  if (!shunt) return kind === 'L' ? (w * value) / z0 : -1 / (w * value * z0)
  return kind === 'C' ? w * value * z0 : -z0 / (w * value)
}

/**
 * Every L-section match from normalized z to the center. Shunt-first (shunt at the load, then
 * series) needs g ≤ 1; series-first needs r ≤ 1 (Pozar 5.1). Each solution lists its two elements
 * nearest the load first, with normalized changes.
 */
export function lMatch(z) {
  const out = []
  const y = C.div(ONE, z)
  if (y[0] <= 1 + 1e-9 && y[0] > 0) {
    const t = Math.sqrt(Math.max(0, y[0] - y[0] * y[0]))
    for (const bt of t > 1e-12 ? [t, -t] : [0]) {
      const db = bt - y[1], dx = bt / y[0]
      out.push({ order: 'shunt-first', els: [{ shunt: true, kind: db >= 0 ? 'C' : 'L', delta: db }, { shunt: false, kind: dx >= 0 ? 'L' : 'C', delta: dx }] })
    }
  }
  if (z[0] <= 1 + 1e-9 && z[0] > 0) {
    const t = Math.sqrt(Math.max(0, z[0] - z[0] * z[0]))
    for (const xt of t > 1e-12 ? [t, -t] : [0]) {
      const dx = xt - z[1], db = xt / z[0]
      out.push({ order: 'series-first', els: [{ shunt: false, kind: dx >= 0 ? 'L' : 'C', delta: dx }, { shunt: true, kind: db >= 0 ? 'C' : 'L', delta: db }] })
    }
  }
  // An element of zero change isn't there.
  for (const s of out) s.els = s.els.filter((e) => Math.abs(e.delta) > 1e-9)
  return out
}

// ---- Formatting.

/** Up to 3 significant figures, trailing zeros dropped, − for minus. */
export function n3(v) {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '−∞' : '—'
  if (Math.abs(v) < 5e-4) return '0'
  let s = String(+v.toPrecision(3))
  if (/e/.test(s)) s = v.toExponential(2)
  return s.replace('-', '−')
}
/** A complex number as "0.8 + j0.6", "1 − j1.22", "j0.5", "2"; `tol` sets what counts as zero. */
export function cfmt([re, im], tol = 1e-3) {
  if (!Number.isFinite(re) || !Number.isFinite(im)) return '∞'
  const big = Math.max(1, Math.abs(re), Math.abs(im))
  const r = Math.abs(re) < tol * big ? 0 : re, i = Math.abs(im) < tol * big ? 0 : im
  if (!i) return n3(r)
  const j = `j${n3(Math.abs(i))}`
  if (!r) return i < 0 ? `−${j}` : j
  return `${n3(r)} ${i < 0 ? '−' : '+'} ${j}`
}
const SI = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'μ'], [1e-9, 'n'], [1e-12, 'p']]
/** A component or frequency with an SI prefix to 3 significant figures: 0.923 pF, 19.5 nH, 2.45 GHz. */
export function si(v, unit) {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  const [s, p] = a === 0 ? [1, ''] : SI.find(([k]) => a >= k * 0.9995) ?? SI[SI.length - 1]
  return `${n3(v / s)} ${p}${unit}`
}
/** An angle in degrees to a tenth, a whole one without the decimal: 90°, −52.4°. */
export const deg = (a) => `${(Math.abs(a) < 0.05 ? 0 : a).toFixed(1).replace(/\.0$/, '').replace('-', '−')}°`
/** Γ in polar form: 0.333∠90°, or 0 at the center. */
export const polarText = (mag, ang) => (mag < 5e-4 ? '0' : `${n3(mag)}∠${deg(ang)}`)
