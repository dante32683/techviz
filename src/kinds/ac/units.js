// Amounts in ac specs: a number (SI), a param expression, or a string with a unit ("30 ohm",
// "80 mH", "20 uF", "60 Hz", "377 rad/s", "90 V", "-73.7 deg"), and number formatting: 3
// significant figures in the drawing, 4 in the summary.

import { compileFor } from '../../expr.js'
import { SpecError } from '../../diag.js'

const PREFIX = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, '': 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9 }
// Spellings of each unit, longest first so "rad/s" wins over "s" and "ohms" over "s".
const BASES = [['rad/s', 'rad/s'], ['ohms', 'Ω'], ['ohm', 'Ω'], ['Ohm', 'Ω'], ['Ω', 'Ω'], ['Hz', 'Hz'], ['deg', '°'], ['dB', 'dB'],
  ['°', '°'], ['H', 'H'], ['F', 'F'], ['V', 'V'], ['A', 'A'], ['W', 'W'], ['S', 'S'], ['', '']]
const NUM_UNIT = /^\s*([-+−]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*([^\s\d*()^+\-/.]\S*)?\s*$/

/** [value, unit] from a number, an expression of params, or "30 ohm"; unit is '' for a bare number. */
export function amount(v, env, path) {
  if (typeof v === 'number') return [v, '']
  if (typeof v !== 'string') throw new SpecError(path, `expected a number or a string like "30 ohm", got ${JSON.stringify(v)}`)
  const m = NUM_UNIT.exec(v)
  if (m) {
    const n = parseFloat(m[1].replace('−', '-'))
    const unit = m[2] ?? ''
    for (const [spell, base] of BASES) {
      if (!unit.endsWith(spell)) continue
      const p = unit.slice(0, unit.length - spell.length)
      if (p in PREFIX && !(spell === '' && p)) return [n * PREFIX[p], base]
    }
    throw new SpecError(path, `unknown unit in "${v}"; write it like "30 ohm", "80 mH", "20 uF", "60 Hz", or "90 V"`)
  }
  try {
    return [compileFor(v, Object.keys(env)).fn(env), '']
  } catch (err) {
    throw new SpecError(path, err.message)
  }
}

/** A value in `unit`; a string in another unit warns, so "20 uH" given for a capacitor is caught. */
export function qty(v, env, path, unit, diag) {
  const [n, u] = amount(v, env, path)
  if (u && u !== unit) diag?.warn(path, `"${v}" is in ${u}; this takes ${unit}`)
  if (!Number.isFinite(n)) throw new SpecError(path, `${JSON.stringify(v)} isn't a finite number`)
  return n
}

/** A frequency in Hz, from Hz or rad/s. */
export function freq(v, env, path, diag) {
  const [n, u] = amount(v, env, path)
  if (u === 'rad/s') return n / (2 * Math.PI)
  if (u && u !== 'Hz') diag?.warn(path, `"${v}" is in ${u}; a frequency takes Hz or rad/s`)
  if (!(n > 0)) throw new SpecError(path, 'a frequency must be positive')
  return n
}

const SI = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'μ'], [1e-9, 'n'], [1e-12, 'p']]

/** x to `n` significant figures, zeros kept (30.0, 0.843), with a real minus sign. */
export function sig(x, n = 3) {
  if (!Number.isFinite(x)) return x > 0 ? '∞' : x < 0 ? '−∞' : '—'
  if (x === 0) return '0'
  const lead = Math.floor(Math.log10(Math.abs(x)) + 1e-9) + 1
  let s = x.toFixed(Math.max(0, Math.min(12, n - lead)))
  if (lead > n) s = String(Math.round(x / 10 ** (lead - n)) * 10 ** (lead - n))
  return s.replace(/^-/, '−').replace(/^−(0\.?0*)$/, '$1')
}

/**
 * A value with its unit and an SI prefix outside 0.1 to 999 (0.843 A, 18.8 mA, 1.59 kHz, 20 μF).
 * Angles, dB, and plain ratios take no prefix; `trim` drops trailing zeros (for echoed inputs).
 */
export function show(x, unit = '', n = 3, trim = false) {
  const a = Math.abs(x)
  let [scale, p] = [1, '']
  if (unit && unit !== '°' && unit !== 'dB' && Number.isFinite(x) && a && (a >= 999.5 || a < 0.1)) [scale, p] = SI.find(([s]) => a >= s * 0.9995) ?? SI[SI.length - 1]
  let s = sig(x / scale, n)
  if (trim && s.includes('.')) s = s.replace(/\.?0+$/, '')
  return unit === '°' ? `${s}°` : unit ? `${s} ${p}${unit}` : s
}

/** An inductor, capacitor, or resistor value as given: 80 mH, 20 μF, 30 Ω (prefixes from 1 to 999). */
export function partValue(x, unit) {
  const a = Math.abs(x)
  const [scale, p] = a >= 1 && a < 1000 ? [1, ''] : SI.find(([s]) => a >= s * 0.9995) ?? SI[SI.length - 1]
  return `${+(x / scale).toPrecision(4)} ${p}${unit}`
}

/** Rectangular form a + jb or a − jb, each part to n figures with a shared unit. */
export function rect(z, unit, n = 4) {
  const im = Math.abs(z.im) < 1e-12 * Math.max(1, Math.abs(z.re)) ? 0 : z.im
  const re = Math.abs(z.re) < 1e-12 * Math.max(1, Math.abs(z.im)) ? 0 : z.re
  const sep = unit ? ` ${unit}` : ''
  if (!im) return `${sig(re, n)}${sep}`
  if (!re) return `${im < 0 ? '−' : ''}j${sig(Math.abs(im), n)}${sep}`
  return `${sig(re, n)} ${im < 0 ? '−' : '+'} j${sig(Math.abs(im), n)}${sep}`
}
