// Exact numbers for linalg: rationals as {n, d} BigInt pairs in lowest terms (d > 0), with a JS
// float as the fallback for irrational inputs (√2/2, cos 30°). Arithmetic stays exact while both
// sides are rational; a float only appears when an input was one. Display snaps a float that sits
// within rounding error of a small fraction (cos 90° is 6e-17, which prints as 0).

import { compileFor, ExprError } from '../../expr.js'
import { SpecError } from '../../diag.js'

const bgcd = (a, b) => { if (a < 0n) a = -a; if (b < 0n) b = -b; while (b) [a, b] = [b, a % b]; return a }
export const isQ = (x) => typeof x === 'object' && x !== null

export function Q(n, d = 1n) {
  n = BigInt(n); d = BigInt(d)
  if (d === 0n) throw new RangeError('division by zero')
  if (d < 0n) { n = -n; d = -d }
  const g = bgcd(n, d) || 1n
  return { n: n / g, d: d / g }
}
export const ZERO = Q(0), ONE = Q(1)
export const toF = (x) => (isQ(x) ? Number(x.n) / Number(x.d) : x)
const EPS = 1e-10
export const isZero = (x) => (isQ(x) ? x.n === 0n : Math.abs(x) < EPS)
export const isOne = (x) => (isQ(x) ? x.n === 1n && x.d === 1n : Math.abs(x - 1) < EPS)
export const neg = (a) => (isQ(a) ? { n: -a.n, d: a.d } : -a)
export const add = (a, b) => (isQ(a) && isQ(b) ? Q(a.n * b.d + b.n * a.d, a.d * b.d) : toF(a) + toF(b))
export const sub = (a, b) => add(a, neg(b))
export const mul = (a, b) => (isQ(a) && isQ(b) ? Q(a.n * b.n, a.d * b.d) : toF(a) * toF(b))
export function div(a, b) {
  if (isZero(b)) throw new RangeError('division by zero')
  return isQ(a) && isQ(b) ? Q(a.n * b.d, a.d * b.n) : toF(a) / toF(b)
}
export const sign = (a) => (isQ(a) ? (a.n > 0n ? 1 : a.n < 0n ? -1 : 0) : Math.abs(a) < EPS ? 0 : Math.sign(a))
export const abs = (a) => (sign(a) < 0 ? neg(a) : a)
export const eq = (a, b) => (isQ(a) && isQ(b) ? a.n === b.n && a.d === b.d : Math.abs(toF(a) - toF(b)) <= 1e-9 * Math.max(1, Math.abs(toF(b))))
export const exact = (x) => isQ(x)

/** The fraction with denominator up to 1000 that a float sits on (within 1e-10), or null. */
export function snap(x) {
  if (isQ(x)) return x
  if (!Number.isFinite(x)) return null
  if (Math.abs(x) < EPS) return ZERO
  if (Math.abs(x) > 1e9) return null
  for (let d = 1; d <= 1000; d++) {
    const k = Math.round(x * d)
    if (Math.abs(x - k / d) < EPS * Math.max(1, Math.abs(x))) return Q(k, d)
  }
  return null
}

// A finite decimal ("0.25", "1e-3") as an exact rational.
function decimal(str) {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(str)
  if (!m || (!m[2] && !m[3])) return null
  const digits = (m[2] || '') + (m[3] || ''), e = BigInt(m[4] || 0) - BigInt((m[3] || '').length)
  let n = BigInt(digits || '0'), d = 1n
  if (e >= 0n) n *= 10n ** e
  else d = 10n ** -e
  return Q(m[1] === '-' ? -n : n, d)
}

/** A JSON number as an exact rational (0.1 is 1/10, what the author wrote). */
export function fromNumber(x) {
  if (Number.isInteger(x)) return Q(BigInt(x))
  return decimal(String(x)) ?? x
}

/**
 * A spec value: a number, a fraction or decimal string ("-3/4", "1.5"), or an expression with
 * params ("sqrt(2)/2", "cos(pi/6)", "k"). Rationals stay exact; an expression's value is snapped
 * to a small fraction when it sits on one, else kept as a float.
 */
export function parseNum(v, env, path) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new SpecError(path, 'a finite number')
    return fromNumber(v)
  }
  if (typeof v === 'string') {
    const s = v.trim().replace(/−/g, '-').replace(/\s+/g, '')
    const m = /^([+-]?)\(?([\d.]+(?:e[+-]?\d+)?)(?:\/([\d.]+))?\)?$/i.exec(s)
    if (m) {
      const a = decimal(m[2]), b = m[3] ? decimal(m[3]) : ONE
      if (a && b && !isZero(b)) { const x = div(a, b); return m[1] === '-' ? neg(x) : x }
    }
    let x
    try { x = compileFor(s, Object.keys(env ?? {})).fn(env ?? {}) } catch (e) {
      if (e instanceof ExprError) throw new SpecError(path, `${e.message}; write a number, a fraction like "3/4", or an expression like "sqrt(2)/2"`)
      throw e
    }
    if (!Number.isFinite(x)) throw new SpecError(path, `"${v}" is not a finite number`)
    return snap(x) ?? x
  }
  throw new SpecError(path, `${JSON.stringify(v)} is not a number; write 2, "3/4", or "sqrt(2)/2"`)
}

const MINUS = '−'

/** "−3/2", "4", "0.866": the exact fraction, or 4 significant digits for an irrational float. */
export function fmt(x) {
  if (!isQ(x)) {
    const s = snap(x)
    if (s) return fmt(s)
    const t = String(Number(x.toPrecision(4)))
    return t.replace(/^-/, MINUS)
  }
  const a = x.n < 0n ? -x.n : x.n
  return (x.n < 0n ? MINUS : '') + (x.d === 1n ? String(a) : `${a}/${x.d}`)
}

/** A coefficient on a symbol: "u", "−u", "2u", "(3/2)u", "−(3/2)u"; `lead` false adds the sign as " + " or " − ". */
export function coef(x, sym, lead = true) {
  const s = sign(x)
  const m = abs(x)
  const sm = snap(m)
  const body = isOne(m) ? sym : sm && sm.d !== 1n ? `(${fmt(m)})${sym}` : `${fmt(m)}${sym}`
  if (lead) return (s < 0 ? MINUS : '') + body
  return (s < 0 ? ` ${MINUS} ` : ' + ') + body
}

/** √x for a rational x ≥ 0 as c·√r with r squarefree: {c, r} (r = 1n when x is a perfect square). */
export function sqrtQ(x) {
  if (!isQ(x) || x.n < 0n) return null
  if (x.n === 0n) return { c: ZERO, r: 1n }
  let N = x.n * x.d, c = 1n, r = 1n
  // √(n/d) = √(n·d)/d; pull square factors out of n·d.
  for (let k = 2n; k * k <= N && k < 100000n; k++) while (N % (k * k) === 0n) { N /= k * k; c *= k }
  r = N
  return { c: Q(c, x.d), r }
}

/** "√13", "3√2", "√13/2", "2": c·√r as text. */
export function surdText(c, r) {
  if (r === 1n) return fmt(c)
  const a = c.n < 0n ? -c.n : c.n
  const num = `${c.n < 0n ? MINUS : ''}${a === 1n ? '' : a}√${r}`
  return c.d === 1n ? num : `${num}/${c.d}`
}

/** A float value of c·√r. */
export const surdF = (c, r) => toF(c) * Math.sqrt(Number(r))

/** "(1, −2, 3/2)". */
export const vecText = (v) => `(${v.map(fmt).join(', ')})`
/** "[[1, 2], [3, 4]]". */
export const matText = (M) => `[${M.map((r) => `[${r.map(fmt).join(', ')}]`).join(', ')}]`
