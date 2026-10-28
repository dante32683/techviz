// Amounts in optics specs: a number, a param expression, or a string with a unit: lengths
// ("30 cm", "600 nm", "0.10 mm", "1.2 m", "1/600 mm"), angles ("30 deg", "30°", "0.52 rad"),
// and the number formats the drawing (3 significant figures) and the summary (4) use.

import { compileFor } from '../../expr.js'
import { SpecError } from '../../diag.js'

/** Meters per length unit. */
export const LEN = { m: 1, cm: 1e-2, mm: 1e-3, um: 1e-6, 'μm': 1e-6, 'µm': 1e-6, nm: 1e-9, km: 1e3 }
const ANG = { deg: 1, '°': 1, degrees: 1, rad: 180 / Math.PI }
const NUM = '[-+−]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?'
const NUM_UNIT = new RegExp(`^\\s*(${NUM})(?:\\s*/\\s*(${NUM}))?\\s*([^\\s\\d*()^+\\-/.][^\\s]*)?\\s*$`)
const num = (s) => parseFloat(s.replace('−', '-'))

/** [value, kind] with kind 'len' (meters), 'angle' (degrees), or '' (a bare number or expression). */
export function amount(v, env, path) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new SpecError(path, `${v} isn't a finite number`)
    return [v, '']
  }
  if (typeof v !== 'string') throw new SpecError(path, `expected a number or a string like "30 cm", got ${JSON.stringify(v)}`)
  const m = NUM_UNIT.exec(v)
  if (m) {
    let n = num(m[1])
    if (m[2] !== undefined) n /= num(m[2])
    const u = m[3]
    if (!u) return [n, '']
    if (u in LEN) return [n * LEN[u], 'len']
    if (u in ANG) return [n * ANG[u], 'angle']
    throw new SpecError(path, `unknown unit in "${v}"; write lengths like "30 cm", "600 nm", "0.1 mm", "1.2 m" and angles like "30 deg"`)
  }
  try {
    return [compileFor(v, Object.keys(env)).fn(env), '']
  } catch (err) {
    throw new SpecError(path, `can't read ${JSON.stringify(v)}: ${err.message}`)
  }
}

/**
 * A length in `base` units ('m', 'cm', or 'mm'): a bare number is already in them, a string
 * with a length unit converts. An angle given here is an error.
 */
export function length(v, env, path, base = 'm') {
  const [n, kind] = amount(v, env, path)
  if (kind === 'angle') throw new SpecError(path, `"${v}" is an angle; this takes a length like "30 cm"`)
  const x = kind === 'len' ? n / LEN[base] : n
  if (!Number.isFinite(x)) throw new SpecError(path, `${JSON.stringify(v)} isn't a finite number`)
  return x
}

/** An angle in degrees: a bare number is degrees; "0.5 rad" converts. */
export function angle(v, env, path) {
  const [n, kind] = amount(v, env, path)
  if (kind === 'len') throw new SpecError(path, `"${v}" is a length; this takes an angle in degrees, like 30`)
  return n
}

/** A refractive index: a positive number; below 1 warns (only vacuum has n = 1). */
export function index(v, env, path, diag) {
  const [n, kind] = amount(v, env, path)
  if (kind) throw new SpecError(path, `an index of refraction is a plain number, like 1.50`)
  if (!(n > 0)) throw new SpecError(path, 'an index of refraction must be positive, like 1.33')
  if (n < 1 - 1e-9) diag?.warn(path, `n = ${n} is below 1; indices are at least 1 (air 1.00, water 1.33, glass 1.50)`)
  return n
}

/** x to `n` significant figures, zeros kept (30.0, 0.843), with a real minus sign. */
export function sig(x, n = 3) {
  if (!Number.isFinite(x)) return x > 0 ? '∞' : x < 0 ? '−∞' : '—'
  if (x === 0) return '0'
  const lead = Math.floor(Math.log10(Math.abs(x)) + 1e-9) + 1
  let s = x.toFixed(Math.max(0, Math.min(12, n - lead)))
  if (lead > n) s = String(Math.round(x / 10 ** (lead - n)) * 10 ** (lead - n))
  return s.replace(/^-/, '−').replace(/^−(0\.?0*)$/, '$1')
}

/** An angle in degrees: 41.8°, 0.344°. */
export const deg = (x, n = 3) => `${sig(x, n)}°`

const PREFIXES = [[1, 'm'], [1e-3, 'mm'], [1e-6, 'μm'], [1e-9, 'nm'], [1e-12, 'pm']]

/** A length in meters with the prefix that puts it in 1 to 999: 6.00 mm, 600 nm, 1.20 m. */
export function showLen(x, n = 3) {
  const a = Math.abs(x)
  if (!Number.isFinite(x)) return sig(x)
  if (!a) return '0 m'
  if (a >= 1000) return `${sig(x, n)} m`
  const [s, u] = PREFIXES.find(([s]) => a >= s * 0.9995) ?? PREFIXES[PREFIXES.length - 1]
  return `${sig(x / s, n)} ${u}`
}

/** A length already in `unit` (the rays mode's cm): 15.0 cm. */
export const inUnit = (x, unit, n = 3) => `${sig(x, n)} ${unit}`
