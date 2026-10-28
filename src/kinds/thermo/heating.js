// A heating curve (OpenStax Vol. 2 §1.5, Fig. 1.15): temperature against heat added, warming
// stretches Q = mcΔT and flat phase changes Q = mL_f and Q = mL_v, for water (c_ice 2090,
// c_water 4186, c_steam 2020 J/kg·K, L_f 334, L_v 2256 kJ/kg) or a substance given in full.
// Ends at a temperature ("to") or after a given heat ("Q"), which may stop partway through a
// phase change (the mass changed so far is stated).

import { SpecError } from '../../diag.js'
import { color } from '../../theme.js'
import { placeLabels, drawLabels } from '../fbd/place.js'
import { qty, sig, energyUnit, showE } from './units.js'
import { frame, axisRange, curve, along, table, lines, dot } from './draw.js'
import { unitText, num3 } from './pv.js'

const WATER = { names: ['ice', 'water', 'steam'], c: [2090, 4186, 2020], Tm: 273.15, Tb: 373.15, Lf: 334e3, Lv: 2256e3 }
const PHASE = ['solid', 'liquid', 'gas']

function readSubstance(spec, env) {
  const s = spec.substance ?? 'water'
  if (s === 'water') return WATER
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new SpecError('substance', 'substance is "water" or {"Tm": "327 °C", "Tb": "1750 °C", "c": [130, 140, 140], "Lf": "24.5 kJ/kg", "Lv": "871 kJ/kg"}')
  const T = (k) => qty(s[k], 'T', env, `substance.${k}`)[0]
  if (s.Tm === undefined || s.Tb === undefined) throw new SpecError('substance', 'give Tm and Tb, the melting and boiling points')
  const c = Array.isArray(s.c) ? s.c : [s.c, s.c, s.c]
  if (c.length !== 3 || c.some((x) => x === undefined)) throw new SpecError('substance.c', 'c is the specific heat [solid, liquid, gas] in J/kg·K')
  const out = {
    names: Array.isArray(s.names) && s.names.length === 3 ? s.names.map(String) : PHASE,
    c: c.map((x, i) => qty(x, 'c', env, `substance.c[${i}]`, { positive: true })[0]),
    Tm: T('Tm'), Tb: T('Tb'),
    Lf: qty(s.Lf, 'L', env, 'substance.Lf', { positive: true })[0], Lv: qty(s.Lv, 'L', env, 'substance.Lv', { positive: true })[0],
  }
  if (!(out.Tb > out.Tm)) throw new SpecError('substance.Tb', 'Tb is above Tm')
  return out
}

export function heatingMode(spec, ctx, cv) {
  const { theme, diag, env } = ctx
  const S = readSubstance(spec, env)
  if (spec.m === undefined) throw new SpecError('m', 'give m, the mass, like "0.50 kg"')
  const [m] = qty(spec.m, 'm', env, 'm', { positive: true })
  if (spec.from === undefined) throw new SpecError('from', 'give from, the starting temperature, like "-20 °C"')
  const [T0] = qty(spec.from, 'T', env, 'from')
  const hasTo = spec.to !== undefined, hasQ = spec.Q !== undefined
  if (hasTo === hasQ) throw new SpecError('to', 'give either to (the final temperature) or Q (the heat added)')
  const T1 = hasTo ? qty(spec.to, 'T', env, 'to')[0] : null
  const Qgive = hasQ ? qty(spec.Q, 'E', env, 'Q', { positive: true })[0] : null
  if (hasTo && !(T1 > T0)) throw new SpecError('to', 'a heating curve runs up in temperature: to is above from (for cooling, swap them; Q is then the heat removed)')
  const endAt = spec.end === undefined ? null : PHASE.indexOf(spec.end)
  if (spec.end !== undefined && endAt < 0) throw new SpecError('end', 'end is "solid", "liquid", or "gas": the phase at a final temperature on a plateau')

  // Walk up: warm in the phase, change phase at Tm and Tb.
  let phase = T0 < S.Tm ? 0 : T0 < S.Tb ? 1 : 2
  const segs = []
  let T = T0, Q = 0, left = Qgive ?? Infinity
  const stopT = T1 ?? Infinity
  for (let guard = 0; guard < 6 && left > 1e-9; guard++) {
    const top = phase === 0 ? S.Tm : phase === 1 ? S.Tb : Infinity
    const target = Math.min(top, stopT)
    if (target > T + 1e-9) {
      const need = m * S.c[phase] * (target - T)
      const q = Math.min(need, left), T2 = T + q / (m * S.c[phase])
      segs.push({ kind: 'warm', phase, Ta: T, Tb: T2, Qa: Q, Q: q, label: S.names[phase], formula: 'mcΔT' })
      Q += q; left -= q; T = T2
      if (q < need) break
    }
    if (T >= stopT - 1e-9 && !(endAt !== null && endAt > phase && Math.abs(T - top) < 1e-6)) break
    if (phase === 2) break
    const L = phase === 0 ? S.Lf : S.Lv
    const need = m * L, q = Math.min(need, left)
    segs.push({ kind: 'change', phase, Ta: T, Tb: T, Qa: Q, Q: q, label: phase === 0 ? '\\text{melts}' : '\\text{boils}', formula: phase === 0 ? 'mL_{f}' : 'mL_{v}', frac: q / need })
    Q += q; left -= q
    if (q < need) break
    phase++
  }
  if (!segs.length) throw new SpecError('to', 'nothing to draw: the start and end are the same state')
  const last = segs[segs.length - 1]
  const Tend = last.Tb
  const partial = last.kind === 'change' && last.frac < 1 - 1e-9
  if (hasQ && left > 1e-6 * Qgive) diag.warn('Q', 'Q runs past what the curve covers')

  // The plot: T in °C against Q.
  const eu = energyUnit([Q])
  const C = (t) => t - 273.15
  const ys = axisRange(C(Math.min(T0, Tend)), C(Math.max(T0, Tend)), 5, 0.12, false)
  const xs = axisRange(0, Q / eu.k, 4)
  const F = frame(cv, theme, { w: 230, h: 150, xs, ys, edge: true, xTitle: `Q (${unitText(eu.u)})`, yTitle: `T (${unitText('°C')})` })
  const P = (q, t) => [F.X(q / eu.k), F.Y(C(t))]
  const labels = []
  const colors = [color('blue'), color('teal'), color('coral')]
  segs.forEach((s, i) => {
    const pts = [P(s.Qa, s.Ta), P(s.Qa + s.Q, s.Tb)]
    const stroke = s.kind === 'change' ? color('amber') : colors[s.phase]
    curve(cv, pts, stroke, { width: 2.4, tag: `seg${i}` })
    const cands = []
    for (const t of [0.5, 0.3, 0.7]) {
      const { p } = along(pts, t)
      for (const [dx, dy] of [[0, -10], [0, 12], [-20, -8], [20, 8], [-24, 0], [24, 0], [16, 16]]) cands.push((w) => [p[0] + Math.sign(dx) * (Math.abs(dx) + (dx ? w / 2 - 10 : 0)), p[1] + dy])
    }
    labels.push({ label: s.kind === 'change' ? s.label : `\\text{${s.label}}`, size: theme.size - 2, fill: stroke, cands, seg: i })
  })
  for (const [q, t] of [[0, T0], [Q, Tend]]) { const p = P(q, t); dot(cv, p, 3, theme.fg); cv.trace([p], 'end', 1) }
  const placed = placeLabels(labels, cv)
  drawLabels(placed.filter((q) => q.hard === 0), cv, theme)

  // The table: each stretch's Q, then the total.
  const row = (s) => [s.kind === 'warm' ? `\\text{${s.label}}: mcΔT` : `${s.label}: ${s.formula}`,
    s.kind === 'warm' ? `${sig(s.Tb - s.Ta, 3)}` : s.frac < 1 - 1e-9 ? `${sig(s.frac * 100, 3)}\\%` : '', num3(s.Q / eu.k)]
  let y = table(cv, theme, F.left + 4, F.bottom + 6, ['', `\\text{Δ}T (${unitText('K')})`, `Q (${unitText(eu.u)})`], [...segs.map(row), ['\\text{total}', '', num3(Q / eu.k)]]).bottom
  const cap = []
  if (partial) cap.push(`${sig(last.frac * m, 3)} ${unitText('kg')} ${last.phase === 0 ? '\\text{melted}' : '\\text{boiled}'} \\text{of} ${sig(m, 3)} ${unitText('kg')}`)
  else cap.push(`\\text{ends at} ${sig(C(Tend), 3)} ${unitText('°C')}`)
  lines(cv, theme, F.left + 4, y + 2, cap)

  const facts = [`m ${sig(m, 4)} kg from ${sig(C(T0), 4)} °C`, ...segs.map((s) => `${s.kind === 'warm' ? `${s.label} ${sig(C(s.Ta), 4)} → ${sig(C(s.Tb), 4)} °C: Q = mcΔT = ${sig(m, 4)}·${sig(S.c[s.phase], 4)}·${sig(s.Tb - s.Ta, 4)}` : `${s.phase === 0 ? 'melting' : 'boiling'} at ${sig(C(s.Ta), 4)} °C: Q = ${s.frac < 1 - 1e-9 ? `${sig(s.frac, 4)} of ` : ''}m L = ${sig(m, 4)}·${sig(s.phase === 0 ? S.Lf : S.Lv, 4)}`} = ${showE(s.Q, { n: 4 })}`),
    `total Q ${showE(Q, { n: 4 })}, ends at ${sig(C(Tend), 4)} °C${partial ? ` with ${sig(last.frac * m, 4)} kg of ${sig(m, 4)} kg ${last.phase === 0 ? 'melted' : 'boiled'}` : ''}`]
  const vals = {}
  const warm = segs.filter((s) => s.kind === 'warm').reduce((a, s) => a + s.Q, 0)
  const alts = [{ v: warm, why: 'leaves out the latent heat: a phase change takes Q = mL at constant T' }]
  if (segs.some((s) => s.kind === 'change' && s.phase === 0)) alts.push({ v: Q + m * (S.Lv - S.Lf), why: 'uses L_v for melting; melting takes L_f' })
  const altC = segs.reduce((a, s) => a + (s.kind === 'warm' ? m * S.c[1] * (s.Tb - s.Ta) : s.Q), 0)
  alts.push({ v: altC, why: `uses c of the liquid for every phase; ${S.names[0]} and ${S.names[2]} have their own c` })
  vals.Q = { key: 'Q', v: Q, dim: 'E', floor: Q * 1e-6, show: (x) => showE(x, { n: 4 }), alts }
  segs.forEach((s, i) => { vals[`Q:${i + 1}`] = { key: `Q_${i + 1}`, v: s.Q, dim: 'E', floor: Q * 1e-6, show: (x) => showE(x, { n: 4 }) } })
  vals.Tf = { key: 'T_f', v: Tend, dim: 'T', show: (x) => `${sig(x, 4)} K (${sig(C(x), 4)} °C)`, alts: [] }
  return { facts, vals, ids: {} }
}
