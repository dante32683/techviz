// expect: the values a spec says it should come out to, checked against the computed ones.
// Each mode returns `vals`: { key: { v, kind: 'len' | 'angle' | '', base, label, show, alts } }.
// A miss warns with the computed value and, where it can tell, why: the sign convention, an
// angle in radians or measured from the surface, or one of the mode's own `alts` ({v, why}).

import { SpecError } from '../../diag.js'
import { amount, LEN, sig } from './units.js'

/** "d_i", "θ_c", "Δy", "lambda_n" all reduce to one spelling: di, thetac, dy, lambdan. */
export const keyOf = (k) => String(k).toLowerCase().replace(/θ/g, 'theta').replace(/λ/g, 'lambda').replace(/δ/g, 'delta')
  .replace(/Δ|∆/gi, 'd').replace(/[\\_{}\s]/g, '')

export function checkExpect(spec, vals, env, diag) {
  if (spec.expect === undefined) return null
  if (!spec.expect || typeof spec.expect !== 'object' || Array.isArray(spec.expect)) throw new SpecError('expect', 'expect is an object of values, like {"di": 15, "m": -0.5}')
  const table = new Map(Object.entries(vals).map(([k, v]) => [keyOf(k), v]))
  const out = []
  for (const [key, given] of Object.entries(spec.expect)) {
    const got = table.get(keyOf(key))
    const path = `expect.${key}`
    if (!got) { diag.warn(path, `"${key}" isn't computed here; checkable: ${Object.keys(vals).join(', ')}`); out.push(`${key} ?`); continue }
    if (got.words) {
      // A description like "real, inverted": every word given must be one the result has.
      const want = String(given).toLowerCase().split(/[\s,;]+/).filter(Boolean)
      const bad = want.filter((w) => !got.words.includes(w))
      if (bad.length) { diag.warn(path, `"${given}" is wrong: the ${got.label} is ${got.words.join(', ')}`); out.push(`${key} WRONG`) } else out.push(`${key} ok`)
      continue
    }
    const [n, kind] = amount(given, env, path)
    let want = n
    if (kind === 'len') {
      if (got.kind !== 'len') { diag.warn(path, `"${given}" is a length; ${got.label} isn't`); out.push(`${key} WRONG`); continue }
      want = n / LEN[got.base ?? 'm']
    } else if (kind === 'angle' && got.kind !== 'angle') { diag.warn(path, `"${given}" is an angle; ${got.label} isn't`); out.push(`${key} WRONG`); continue }
    const tol = (x) => got.kind === 'angle' ? Math.max(0.1, 0.01 * Math.abs(x)) : 0.01 * Math.abs(x) + 1e-15
    const near = (x) => Math.abs(want - x) <= tol(x)
    if (Number.isFinite(got.v) ? near(got.v) : want === got.v) { out.push(`${key} ok`); continue }
    let why = 'is wrong'
    const alt = (got.alts ?? []).find((a) => near(a.v))
    if (alt) why = alt.why
    else if (got.v && near(-got.v)) why = got.sign ?? 'has the wrong sign'
    else if (got.kind === 'angle' && Math.abs(want - (got.v * Math.PI) / 180) <= 0.01 * Math.abs((got.v * Math.PI) / 180) + 1e-4) why = 'is in radians; angles here are in degrees'
    else if (got.kind === 'angle' && near(90 - got.v)) why = 'is measured from the surface; angles here are from the normal'
    const shown = typeof given === 'number' ? sig(given, 4) : given
    diag.warn(path, `${shown} ${why}: ${got.label} = ${got.show ? got.show(got.v) : sig(got.v, 4)}`)
    out.push(`${key} WRONG`)
  }
  return `expect: ${out.join(', ')}`
}
