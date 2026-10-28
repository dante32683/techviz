// expect: the values a spec's author believes, checked against the computed ones. Each wrong one
// is a warning that names it and gives the right value; the summary counts them.

import { SpecError } from '../../diag.js'
import { qty } from '../scope/units.js'
import { dB, dBm, hz } from './cascade.js'

// Totals, and what a block id checks: its output level (a sink's input), its input, the gain and
// NF from the input to its output, the noise floor there, and a mixer's frequencies.
const TOTALS = { gain: ['G', 'dB'], nf: ['nf', 'dB'], out: ['out', 'dBm'], snr: ['snr', 'dB'], sensitivity: ['sens', 'dBm'], mds: ['mds', 'dBm'], iip3: ['iip3', 'dBm'], oip3: ['oip3', 'dBm'], sfdr: ['sfdr', 'dB'] }
const PER_BLOCK = ['level', 'in', 'gain', 'nf', 'noise', 'lo', 'if', 'image']
const TOL_DB = 0.1, TOL_F = 0.005

export function checkExpect(exp, S, env, diag) {
  if (exp === undefined) return ''
  if (!exp || typeof exp !== 'object' || Array.isArray(exp)) throw new SpecError('expect', 'expect is an object like {"nf": 1.7, "lna": {"level": -70}}')
  const byId = new Map()
  for (const s of S.stages) { if (s.id) byId.set(s.id, s); for (const q of s.branch ?? []) if (q.id) byId.set(q.id, q) }
  let n = 0
  const wrong = []
  const miss = (path, msg) => { wrong.push(msg); diag.warn(path, msg) }
  const cmpDb = (path, what, got, v, unit) => {
    const w = qty(v, env, path, unit === 'dBm' ? ['dBm'] : ['dB'], diag)
    n++
    if (got === null || got === undefined) miss(path, `${what} isn't computed (${unit === 'dBm' ? 'give the input level' : 'a gain or NF is missing'})`)
    else if (Math.abs(got - w) > TOL_DB) miss(path, `${what} is ${unit === 'dBm' ? dBm(got) : dB(got, 2)}, not ${unit === 'dBm' ? dBm(w) : dB(w, 2)}`)
  }
  const cmpHz = (path, what, got, v) => {
    const w = qty(v, env, path, ['Hz'], diag)
    n++
    if (got === null || got === undefined) miss(path, `${what} isn't computed (give f, and the mixer's lo or if)`)
    else if (Math.abs(got - w) > TOL_F * Math.abs(w)) miss(path, `${what} is ${hz(got)}, not ${hz(w)}`)
  }
  for (const [key, want] of Object.entries(exp)) {
    if (TOTALS[key]) {
      const [field, unit] = TOTALS[key]
      cmpDb(`expect.${key}`, key === 'nf' ? 'the cascade NF' : key === 'gain' ? 'the cascade gain' : key === 'out' ? 'the output level' : key, S.T[field], want, unit)
      continue
    }
    const s = byId.get(key)
    if (!s) throw new SpecError(`expect.${key}`, `expect takes ${Object.keys(TOTALS).join(', ')}, or a block id (${[...byId.keys()].join(', ') || 'give blocks an id'})`)
    if (!want || typeof want !== 'object' || Array.isArray(want)) throw new SpecError(`expect.${key}`, `expect.${key} is an object like {"level": -70, "nf": 1.5}`)
    const plan = S.plans.find((p) => p.s === s)
    for (const [q, v] of Object.entries(want)) {
      const path = `expect.${key}.${q}`
      if (!PER_BLOCK.includes(q)) throw new SpecError(path, `a block checks ${PER_BLOCK.join(', ')}`)
      if (q === 'level') cmpDb(path, `${s.name} ${s.out ? 'output' : 'input'} level`, s.out ? s.out.level : s.in.level, v, 'dBm')
      else if (q === 'in') cmpDb(path, `${s.name} input level`, s.in.level, v, 'dBm')
      else if (q === 'gain') cmpDb(path, `the gain to ${s.name}'s output`, s.out?.G, v, 'dB')
      else if (q === 'nf') cmpDb(path, `the NF to ${s.name}'s output`, s.out?.nf, v, 'dB')
      else if (q === 'noise') cmpDb(path, `the noise floor at ${s.name}'s output`, s.out?.N, v, 'dBm')
      else {
        if (s.type !== 'mixer') throw new SpecError(path, `${q} belongs to a mixer`)
        cmpHz(path, `${s.name} ${q === 'if' ? 'IF' : q === 'lo' ? 'LO' : 'image'}`, plan?.[q], v)
      }
    }
  }
  return wrong.length ? `expect: ${wrong.length} of ${n} wrong: ${wrong.join('; ')}` : `expect: ${n} checked, all match`
}

