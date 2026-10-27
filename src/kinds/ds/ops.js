// Shared helpers for ds: reading op strings, values, and comparisons.

import { SpecError } from '../../diag.js'

/** "12" → 12, "-3.5" → -3.5, anything else stays a string. */
export const val = (s) => (typeof s === 'string' && /^-?\d+(\.\d+)?$/.test(s.trim()) ? Number(s) : s)

/** Numbers compare numerically, anything else as text. */
export const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)

export const show = (v) => (v === null || v === undefined ? '-' : String(v))
export const list = (a) => `[${a.map(show).join(', ')}]`

/**
 * The spec's ops as [{verb, args, text, path}]. `verbs` maps each accepted verb to the number
 * of arguments (a number, or a list of allowed counts); `help` is the line the error shows.
 */
export function readOps(spec, verbs, help) {
  if (spec.ops === undefined) return []
  if (!Array.isArray(spec.ops)) throw new SpecError('ops', `ops is a list of strings, like ${help}`)
  return spec.ops.map((op, i) => {
    const path = `ops[${i}]`
    if (typeof op !== 'string' || !op.trim()) throw new SpecError(path, `each op is a string, like ${help}`)
    const [verb, ...args] = op.trim().split(/\s+/)
    const v = verb.toLowerCase()
    if (!(v in verbs)) throw new SpecError(path, `unknown op "${verb}"; this structure takes ${Object.keys(verbs).join(', ')} (${help})`)
    const want = [].concat(verbs[v])
    if (!want.includes(args.length)) throw new SpecError(path, `"${op}": ${v} takes ${want.join(' or ')} argument${want.join() === '1' ? '' : 's'} (${help})`)
    return { verb: v, args, text: op.trim(), path }
  })
}

/** An integer index argument, checked against [lo, hi]. */
export function index(s, lo, hi, path, what = 'index') {
  const n = Number(s)
  if (!Number.isInteger(n)) throw new SpecError(path, `${what} "${s}" is not a whole number`)
  if (n < lo || n > hi) throw new SpecError(path, `${what} ${n} is out of range (${lo} to ${hi})`)
  return n
}

/** Values from the structure field: a list of numbers or strings. */
export function values(spec, key, example) {
  const a = spec[key]
  if (!Array.isArray(a)) throw new SpecError(key, `${key} is a list of values, like ${example}`)
  a.forEach((x, i) => { if (typeof x !== 'number' && typeof x !== 'string') throw new SpecError(`${key}[${i}]`, 'values are numbers or short strings') })
  return [...a]
}
