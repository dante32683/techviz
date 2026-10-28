// Amounts in thermo specs: a number (SI: Pa, m³, K, J, kg), a param expression, or a string
// with a unit ("1.0 atm", "22.4 L", "27 °C", "1.5 kJ", "0.50 kg", "28 g/mol"), converted to SI,
// and the number formats the drawing (3 significant figures) and the summary (4) use.

import { compileFor } from '../../expr.js'
import { SpecError } from '../../diag.js'
import { sig } from '../optics/units.js'

export { sig }

/** SI amount per unit, by dimension. Temperatures are offsets, handled in `amount`. */
export const UNITS = {
  P: { Pa: 1, kPa: 1e3, MPa: 1e6, atm: 101325, bar: 1e5, mmHg: 133.322, torr: 133.322 },
  V: { 'm^3': 1, 'm3': 1, 'm³': 1, L: 1e-3, l: 1e-3, mL: 1e-6, 'cm^3': 1e-6, cm3: 1e-6, 'cm³': 1e-6 },
  E: { J: 1, kJ: 1e3, MJ: 1e6, cal: 4.186, kcal: 4186, 'L·atm': 101.325, 'L*atm': 101.325, 'L atm': 101.325 },
  Pw: { W: 1, kW: 1e3, MW: 1e6 },
  S: { 'J/K': 1, 'kJ/K': 1e3 },
  n: { mol: 1 },
  m: { kg: 1, g: 1e-3 },
  M: { 'g/mol': 1e-3, 'kg/mol': 1 },
  v: { 'm/s': 1, 'km/s': 1e3 },
  c: { 'J/kg·K': 1, 'J/(kg·K)': 1, 'J/kgK': 1, 'J/kg·°C': 1, 'J/(kg·°C)': 1 },
  L: { 'J/kg': 1, 'kJ/kg': 1e3 },
  '': { '%': 0.01 },
}
const T_UNITS = { K: [1, 0], '°C': [1, 273.15], C: [1, 273.15], degC: [1, 273.15], '°F': [5 / 9, 255.372], F: [5 / 9, 255.372] }
const DIM_NAME = { P: 'a pressure', V: 'a volume', T: 'a temperature', E: 'an energy', Pw: 'a power', S: 'an entropy', n: 'an amount in mol', m: 'a mass', M: 'a molar mass', v: 'a speed', c: 'a specific heat', L: 'a latent heat', '': 'a plain number' }
const EXAMPLE = { P: '"1.0 atm"', V: '"22.4 L"', T: '"300 K"', E: '"1.5 kJ"', Pw: '"2.0 kW"', S: '"5.0 J/K"', n: '"2.0 mol"', m: '"0.50 kg"', M: '"28 g/mol"', v: '"500 m/s"', c: '"4186 J/kg·K"', L: '"334 kJ/kg"', '': '0.25' }
const NUM = '[-+−]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?'
const NUM_UNIT = new RegExp(`^\\s*(${NUM})(?:\\s*/\\s*(${NUM}))?(?:\\s*[×x*]\\s*10\\^\\{?(${NUM})\\}?)?\\s*([^\\s\\d*()^+\\-/.][^]*?)?\\s*$`)
const num = (s) => parseFloat(s.replace('−', '-'))

const unitDim = (u) => {
  if (u in T_UNITS) return 'T'
  for (const [d, t] of Object.entries(UNITS)) if (u in t) return d
  return null
}

/**
 * [SI value, dimension, unit] from a number (dimension null), a param expression, or a string
 * with a unit. Temperatures come back in kelvin.
 */
export function amount(v, env, path) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new SpecError(path, `${v} isn't a finite number`)
    return [v, null, '']
  }
  if (typeof v !== 'string') throw new SpecError(path, `expected a number or a string like "1.0 atm", got ${JSON.stringify(v)}`)
  const m = NUM_UNIT.exec(v)
  if (m) {
    let n = num(m[1])
    if (m[2] !== undefined) n /= num(m[2])
    if (m[3] !== undefined) n *= 10 ** num(m[3])
    const u = (m[4] ?? '').replace(/\s+$/, '')
    if (!u) return [n, null, '']
    const d = unitDim(u)
    if (d === 'T') { const [k, off] = T_UNITS[u]; return [n * k + off, 'T', u === 'C' || u === 'degC' ? '°C' : u === 'F' ? '°F' : u] }
    if (d !== null) return [n * UNITS[d][u], d, u]
    throw new SpecError(path, `unknown unit in "${v}"; write it like "1.0 atm", "22.4 L", "300 K", "27 °C", "1.5 kJ", or "0.50 kg"`)
  }
  try {
    return [compileFor(v, Object.keys(env)).fn(env), null, '']
  } catch (err) {
    throw new SpecError(path, `can't read ${JSON.stringify(v)}: ${err.message}`)
  }
}

/**
 * A value of dimension `dim` in SI. A bare number is SI (or `bare`, SI per bare unit); a string
 * in another dimension is an error. Returns [value, unit written or ''].
 */
export function qty(v, dim, env, path, { bare = 1, positive = false } = {}) {
  const [n, d, u] = amount(v, env, path)
  if (d !== null && d !== dim && !(dim === 'E' && d === 'Pw') && !(dim === '' && u === '%')) throw new SpecError(path, `"${v}" is ${DIM_NAME[d]}; this takes ${DIM_NAME[dim]}, like ${EXAMPLE[dim]}`)
  const x = d === null ? (dim === 'T' ? n : n * bare) : n
  if (!Number.isFinite(x)) throw new SpecError(path, `${JSON.stringify(v)} isn't a finite number`)
  if (dim === 'T' && x < 0) throw new SpecError(path, d === null ? `${v} K is below absolute zero; a bare temperature is kelvin, so write Celsius as "${v} °C"` : `"${v}" is below absolute zero`)
  if (positive && !(x > 0)) throw new SpecError(path, `${DIM_NAME[dim]} here must be positive`)
  return [x, u]
}

/** The display unit for a pressure or volume: the one written, else an SI unit sized to `max`. */
export function displayUnit(dim, written, max) {
  if (written && UNITS[dim][written]) return written === 'm3' || written === 'm^3' ? 'm³' : written === 'cm3' || written === 'cm^3' ? 'cm³' : written === 'l' ? 'L' : written
  if (dim === 'P') return max >= 1e6 ? 'MPa' : max >= 1e3 ? 'kPa' : 'Pa'
  return max >= 5e-3 ? 'm³' : max >= 5e-6 ? 'L' : 'cm³'
}
export const perUnit = (dim, u) => UNITS[dim][u] ?? (u === 'm³' ? 1 : u === 'cm³' ? 1e-6 : 1)

/** "+1.52", "−0.405", "0": a signed value, 3 significant figures, zero when tiny next to `scale`. */
export function signed(x, n = 3, scale = 0) {
  if (Math.abs(x) <= Math.abs(scale) * 1e-6 || x === 0) return '0'
  const s = n === 3 && Math.abs(x) >= 999.5 ? String(Math.round(x)).replace(/^-/, '−') : sig(x, n)
  return x > 0 ? `+${s}` : s
}

/** The energy unit for a set of values: J below 10⁴ J, else kJ (MJ past 10⁷). */
export function energyUnit(values, power = false) {
  const m = Math.max(0, ...values.map(Math.abs).filter(Number.isFinite))
  const kilo = power ? 999.5 : 1e4
  const [k, u] = m >= kilo * 1e3 ? [1e6, 'M'] : m >= kilo ? [1e3, 'k'] : [1, '']
  return { k, u: u + (power ? 'W' : 'J') }
}

/** An energy in J with its unit: "1.52 kJ", "405 J", "+3.40 kJ" (signed). */
export function showE(x, { n = 3, sign = false, power = false } = {}) {
  const { k, u } = energyUnit([x], power)
  const s = n === 3 && Math.abs(x / k) >= 999.5 ? String(Math.round(x / k)).replace(/^-/, '−') : sig(x / k, n)
  return `${sign ? signed(x / k, n) : s} ${u}`
}

/** A temperature in K: "300 K"; °C when the author wrote °C: "300 K (26.9 °C)". */
export const showT = (x, n = 3) => `${sig(x, n)} K`
