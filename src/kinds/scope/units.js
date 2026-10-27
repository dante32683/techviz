// Amounts in scope specs: a number (SI), an expression of params, or a string with a unit
// ("2 V", "200 us", "1 kHz", "10 MSa/s", "-20 dBm"), and engineering formatting for readouts.

import { compileFor } from '../../expr.js'
import { SpecError } from '../../diag.js'

const PREFIX = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, '': 1, k: 1e3, M: 1e6, G: 1e9 }
// Longest first, so "dBm" wins over "m" and "Sa/s" over "s".
const BASES = ['Sa/s', 'b/s', 'bps', 'pts', 'dBm', 'dBV', 'dBc', 'dB', 'Hz', 'deg', 'UI', 'V', 's', '°', '%', '']
const NUM_UNIT = /^\s*([-+−]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*([^\s\d*()^+-][^\s]*)\s*$/

/**
 * Reads an amount. `want` lists the base units that make sense ("V", "s", "Hz"); a string
 * whose unit isn't one of them warns, so "2 ms" given as a voltage is caught.
 */
export function qty(v, env, path, want = [], diag) {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') throw new SpecError(path, `expected a number or a string like "2 V", got ${JSON.stringify(v)}`)
  const m = NUM_UNIT.exec(v)
  if (m) {
    const n = parseFloat(m[1].replace('−', '-'))
    const unit = m[2].replace(/\/div$/, '')
    for (const b of BASES) {
      if (!unit.endsWith(b)) continue
      const p = unit.slice(0, unit.length - b.length)
      if (!(p in PREFIX)) continue
      if (b && want.length && !want.includes(b)) diag?.warn(path, `"${v}" is in ${b}; this takes ${want.join(' or ')}`)
      return n * PREFIX[p] * (b === '%' ? 0.01 : 1)
    }
    throw new SpecError(path, `unknown unit in "${v}"; write it like "2 V", "200 us", "1 kHz", or "10 MSa/s"`)
  }
  try {
    return compileFor(v, Object.keys(env)).fn(env)
  } catch (err) {
    throw new SpecError(path, err.message)
  }
}

const SI = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'μ'], [1e-9, 'n'], [1e-12, 'p']]

/** 4.00 V, 1.00 kHz, 17.5 ns, −2.00 V: `digits` significant figures, zeros kept (instrument style). */
export function eng(v, unit = '', digits = 3, trim = false) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  let [scale, p] = a === 0 ? [1, ''] : SI.find(([s]) => a >= s * 0.9995) ?? SI[SI.length - 1]
  if (unit === '%' || unit === '°' || unit.startsWith('dB')) [scale, p] = [1, '']
  let m = v / scale
  // Keep `digits` significant figures, but never more decimals than needed for 999.
  const lead = Math.abs(m) >= 1 ? Math.floor(Math.log10(Math.abs(m) * 1.0000001)) + 1 : 1
  let s = m.toFixed(Math.max(0, digits - lead))
  if (trim && s.includes('.')) s = s.replace(/\.?0+$/, '')
  if (/^-?0(\.0+)?$/.test(s)) s = s.replace('-', '')
  s = s.replace(/^-/, '−')
  const sep = unit === '%' || unit === '°' ? '' : ' '
  return unit || p ? `${s}${sep}${p}${unit}` : s
}

/** A settings value: 2 V, 200 mV, 200 μs (trailing zeros dropped). */
export const engS = (v, unit) => eng(v, unit, 3, true)

/** 1-2-5 step at or above x. */
export function nice125(x) {
  const e = Math.floor(Math.log10(x)), m = x / 10 ** e
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * 10 ** e
}

/** A seeded uniform generator (mulberry32) and a standard normal from it. */
export function rng(seed = 1) {
  let a = (Math.floor(seed * 2654435761) ^ 0x9e3779b9) >>> 0
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  let spare = null
  const gauss = () => {
    if (spare !== null) { const s = spare; spare = null; return s }
    let u = 0
    while (u === 0) u = uni()
    const r = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * uni()
    spare = r * Math.sin(th)
    return r * Math.cos(th)
  }
  return { uni, gauss }
}
