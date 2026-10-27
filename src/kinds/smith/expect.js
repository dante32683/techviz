// expect: the values a spec's author believes, checked against the computed ones. Each wrong one
// is a warning that names it and gives the right value; the summary counts them.

import { SpecError } from '../../diag.js'
import { eng } from '../scope/units.js'
import { C, qty, cplx, n3, cfmt, si } from './rf.js'
import { elText } from './solve.js'

const QUANTITIES = {
  point: ['Z', 'z', 'y', 'gamma', 'ang', 'vswr', 'rl', 'ml'],
  move: ['Z', 'z', 'y', 'gamma', 'ang', 'vswr', 'rl', 'ml', 'value', 'd'],
  sweep: ['best', 'band'],
}
const close = (a, b, rel, abs) => Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b))

export function checkExpect(exp, S, env, diag) {
  if (exp === undefined) return ''
  if (!exp || typeof exp !== 'object' || Array.isArray(exp)) throw new SpecError('expect', 'expect is an object of id: {quantity: value}, like {"ZL": {"vswr": 2, "rl": "9.54 dB"}}')
  let n = 0
  const wrong = []
  const miss = (path, what, got, want) => { wrong.push(`${what} is ${got}, not ${want}`); diag.warn(path, `${what} is ${got}, not ${want}`) }
  for (const [id, want] of Object.entries(exp)) {
    if (id === 'match') {
      if (!S.match) throw new SpecError('expect.match', 'add "match" to the spec to check its components')
      const vals = Array.isArray(want) ? want : [want]
      const parsed = vals.map((v, k) => {
        if (typeof v !== 'string' || !/[HF]\s*$/.test(v)) throw new SpecError(`expect.match[${k}]`, 'give each component with its unit, like "1.84 pF" or "19.5 nH"')
        return { kind: /H\s*$/.test(v) ? 'L' : 'C', v: qty(v, env, `expect.match[${k}]`, ['H', 'F']), text: v }
      })
      n++
      const fits = (s) => parsed.every((p) => s.els.some((e) => e.kind === p.kind && e.value !== undefined && close(e.value, p.v, 0.02, 0)))
      if (!S.match.sols.some(fits)) {
        const msg = `no L-match solution uses ${parsed.map((p) => p.text).join(' and ')}; the solutions are ${S.match.sols.map((s, k) => `${k + 1}) ${s.els.map(elText).join(', then ')}`).join('; ')}`
        wrong.push(msg); diag.warn('expect.match', msg)
      }
      continue
    }
    const o = S.byId.get(id)
    if (!o || !QUANTITIES[o.type]) throw new SpecError(`expect.${id}`, `no point, move, or sweep with id "${id}"`)
    if (!want || typeof want !== 'object' || Array.isArray(want)) throw new SpecError(`expect.${id}`, `expect.${id} is an object like {"vswr": 2}`)
    for (const [q, v] of Object.entries(want)) {
      const path = `expect.${id}.${q}`, what = `${id} ${q}`
      if (!QUANTITIES[o.type].includes(q)) throw new SpecError(path, `a ${o.type} checks ${QUANTITIES[o.type].join(', ')}`)
      n++
      if (q === 'Z' || q === 'z' || q === 'y' || (q === 'gamma' && typeof v !== 'number' && !/^[\d.\s]+$/.test(String(v)))) {
        const got = q === 'gamma' ? o.g : o[q], w = cplx(v, env, path)
        const scale = q === 'Z' ? 0.02 * Math.max(C.abs(w), 1) + 0.5 : q === 'gamma' ? 0.01 : 0.02 * Math.max(C.abs(w), 1)
        if (!Number.isFinite(got[0]) || C.abs(C.sub(got, w)) > scale) miss(path, what, q === 'Z' ? `${cfmt(got)} Ω` : cfmt(got), cfmt(w))
      } else if (q === 'gamma') {
        const w = qty(v, env, path)
        if (!close(o.mag, w, 0.02, 0.005)) miss(path, `${id} |Γ|`, n3(o.mag), n3(w))
      } else if (q === 'ang') {
        const w = qty(v, env, path, ['°'])
        const dd = ((o.ang - w + 540) % 360) - 180
        if (Math.abs(dd) > 1) miss(path, `${id} angle of Γ`, `${n3(o.ang)}°`, `${n3(w)}°`)
      } else if (q === 'vswr') {
        const w = qty(v, env, path)
        if (!close(o.vswr, w, 0.02, 0)) miss(path, `${id} VSWR`, eng(o.vswr), n3(w))
      } else if (q === 'rl' || q === 'ml') {
        const w = qty(v, env, path, ['dB'])
        if (!close(o[q], w, 0.02, 0.1)) miss(path, `${id} ${q === 'rl' ? 'return loss' : 'mismatch loss'}`, eng(o[q], 'dB'), `${n3(w)} dB`)
      } else if (q === 'value') {
        if (o.value === undefined) throw new SpecError(path, `${id} has no component value (it needs an L or C and a frequency)`)
        const unit = o.el.kind === 'L' ? 'H' : 'F'
        const w = qty(v, env, path, [unit])
        if (!close(o.value, w, 0.02, 0)) miss(path, `${id} ${o.el.kind}`, si(o.value, unit), si(w, unit))
      } else if (q === 'd') {
        const w = qty(v, env, path)
        if (!close(o.d, w, 0.01, 0.002)) miss(path, `${id} length`, `${n3(o.d)}λ`, `${n3(w)}λ`)
      } else if (q === 'best') {
        const w = qty(v, env, path, ['Hz'])
        if (!close(o.best.f, w, 0.005, 0)) miss(path, `${id} best match`, eng(o.best.f, 'Hz'), eng(w, 'Hz'))
      } else if (q === 'band') {
        if (!Array.isArray(v) || v.length !== 2) throw new SpecError(path, 'band is [low, high], like ["2.40 GHz", "2.48 GHz"]')
        const [lo, hi] = v.map((x, k) => qty(x, env, `${path}[${k}]`, ['Hz']))
        const b = o.bands[0]
        if (!b) miss(path, `${id} band`, 'empty', `${eng(lo, 'Hz')} to ${eng(hi, 'Hz')}`)
        else if (!close(b.lo, lo, 0.005, 0) || !close(b.hi, hi, 0.005, 0)) miss(path, `${id} band`, `${eng(b.lo, 'Hz')} to ${eng(b.hi, 'Hz')}`, `${eng(lo, 'Hz')} to ${eng(hi, 'Hz')}`)
      }
    }
  }
  return wrong.length ? `expect: ${wrong.length} of ${n} wrong: ${wrong.join('; ')}` : `expect: ${n} checked, all match`
}
