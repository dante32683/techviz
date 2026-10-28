// expect: the values a spec says it should come out to, checked against the computed ones.
// Modes return `vals` keyed canonically ('W', 'W:AB', 'P:B', 'e', 'KR', 'vrms'), each
// { v, dim, label, bare, show, sign, alts: [{v, why}] }. Keys as written ("W_AB", "ΔE_{int,BC}",
// "T_C", "Q_h", "e_C", "v_rms") resolve to those. A miss warns with the computed value and, where
// it can tell, why: the sign of W or Q, C_p for C_V, °C for kelvin, L·atm for joules, …

import { SpecError } from '../../diag.js'
import { amount, sig } from './units.js'

const Q_NAMES = { w: 'W', q: 'Q', deint: 'dE', de: 'dE', du: 'dE', eint: 'dE', ds: 'dS', p: 'P', v: 'V', t: 'T', s: 'dS' }
const GLOBAL = {
  w: 'W', wnet: 'W', q: 'Q', qnet: 'Q', de: 'dE', deint: 'dE', du: 'dE', qin: 'Qin', qout: 'Qout', qh: 'Qh', qc: 'Qc',
  e: 'e', ec: 'eC', ecarnot: 'eC', emax: 'eC', kr: 'KR', kp: 'KP', k: 'K', cop: 'K', krc: 'KRC', kpc: 'KPC', kcarnot: 'KC', th: 'Th', tc: 'Tc', n: 'n',
  vp: 'vp', vavg: 'vavg', vbar: 'vavg', 'v̄': 'vavg', vmean: 'vavg', vrms: 'vrms', qtotal: 'Q', tf: 'Tf', tfinal: 'Tf', m: 'm',
}

/** The canonical key for a key as written, given the leg and state ids (case kept). */
export function canon(key, { legs = [], states = [] } = {}) {
  const s = String(key).replace(/[$\\{}\s]/g, '').replace(/^(Δ|∆|delta)/i, 'd').replace(/E_?int/, 'Eint').replace(/→|->|-|>/g, '')
  const low = s.toLowerCase().replace(/_/g, '')
  const m = /^([A-Za-zΔ]+?)[_,](.+)$/.exec(s)
  if (m) {
    const q = Q_NAMES[m[1].toLowerCase()], sub = m[2].replace(/[_,]/g, '')
    const leg = legs.find((id) => id === sub) ?? legs.find((id) => id.toLowerCase() === sub.toLowerCase())
    const st = states.find((id) => id === sub) ?? states.find((id) => id.toLowerCase() === sub.toLowerCase())
    if (q && ['W', 'Q', 'dE', 'dS'].includes(q) && leg) return `${q}:${leg}`
    if (q && ['P', 'V', 'T'].includes(q) && st && !(q === 'T' && /^[hc]$/.test(sub) && !states.includes(sub))) return `${q}:${st}`
    if (/^\d+$/.test(sub) && q === 'Q') return `Q:${sub}`
  }
  if (GLOBAL[low]) return GLOBAL[low]
  // "WAB", "QBC": a quantity letter and a leg id with no underscore.
  for (const [p, q] of [['deint', 'dE'], ['de', 'dE'], ['du', 'dE'], ['ds', 'dS'], ['w', 'W'], ['q', 'Q']]) {
    if (!low.startsWith(p)) continue
    const leg = legs.find((id) => id.toLowerCase() === low.slice(p.length))
    if (leg) return `${q}:${leg}`
  }
  for (const [p, q] of [['p', 'P'], ['v', 'V'], ['t', 'T']]) {
    const st = states.find((id) => id === s.slice(1) || id.toLowerCase() === low.slice(1))
    if (low.startsWith(p) && st) return `${q}:${st}`
  }
  return s
}

export function checkExpect(spec, vals, env, diag, ids) {
  if (spec.expect === undefined) return null
  if (!spec.expect || typeof spec.expect !== 'object' || Array.isArray(spec.expect)) throw new SpecError('expect', 'expect is an object of values, like {"W_AB": "1.57 kJ", "e": 0.40}')
  const out = []
  for (const [key, given] of Object.entries(spec.expect)) {
    const path = `expect.${key}`
    const got = vals[canon(key, ids)]
    if (!got) { diag.warn(path, `"${key}" isn't computed here; checkable: ${Object.values(vals).map((x) => x.key).filter(Boolean).join(', ')}`); out.push(`${key} ?`); continue }
    const [n, dim, u] = amount(given, env, path)
    let want = n
    if (dim === null) want = got.dim === 'T' ? n : n * (got.bare ?? 1)
    else if (dim !== got.dim && !(got.dim === '' && u === '%') && !(got.dim === 'E' && dim === 'Pw')) {
      diag.warn(path, `"${given}" has the wrong kind of unit for ${got.key}`); out.push(`${key} WRONG`); continue
    }
    const tol = (x) => 0.01 * Math.abs(x) + (got.floor ?? 1e-12)
    const near = (x) => Math.abs(want - x) <= tol(x)
    if (near(got.v)) { out.push(`${key} ok`); continue }
    let why = 'is wrong'
    const alt = (got.alts ?? []).find((a) => Number.isFinite(a.v) && Math.abs(a.v - got.v) > tol(got.v) && near(a.v))
    if (alt) why = alt.why
    else if (Math.abs(got.v) > (got.floor ?? 0) && near(-got.v)) why = got.sign ?? 'has the wrong sign'
    const shown = typeof given === 'number' ? sig(given, 4) : given
    diag.warn(path, `${shown} ${why}: ${got.key} = ${got.show ? got.show(got.v) : sig(got.v, 4)}`)
    out.push(`${key} WRONG`)
  }
  return `expect: ${out.join(', ')}`
}
