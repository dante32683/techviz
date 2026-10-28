// The Maxwell–Boltzmann speed distribution (OpenStax Vol. 2 §2.4):
//   f(v) = 4π (M/2πRT)^{3/2} v² e^{−Mv²/2RT}, with M in kg/mol,
// and its three speeds v_p = √(2RT/M), v̄ = √(8RT/πM), v_rms = √(3RT/M). One curve per gas and
// temperature given; a single curve gets all three speeds marked.

import { SpecError } from '../../diag.js'
import { color } from '../../theme.js'
import { placeLabels, drawLabels } from '../fbd/place.js'
import { qty, sig } from './units.js'
import { readGas, R } from './gas.js'
import { frame, axisRange, curve, table, keys, dot, rule } from './draw.js'
import { unitText, num3 } from './pv.js'

export function speedsMode(spec, ctx, cv) {
  const { theme, diag, env } = ctx
  const gasList = Array.isArray(spec.gas) ? spec.gas : [spec.gas ?? 'N2']
  const Tlist = Array.isArray(spec.T) ? spec.T : [spec.T]
  if (spec.T === undefined) throw new SpecError('T', 'give T, like "300 K", or a list to compare')
  if (gasList.length > 1 && Tlist.length > 1) throw new SpecError('T', 'compare several gases at one T, or one gas at several T')
  const curves = []
  for (const [gi, g] of gasList.entries()) for (const [ti, t] of Tlist.entries()) {
    const gas = readGas({ gas: g }, env, { needCv: false })
    if (gas.M === null) throw new SpecError(gasList.length > 1 ? `gas[${gi}]` : 'gas', 'a speed distribution needs the molar mass: a named gas (N2, O2, He, Ar, H2, CO2, H2O, air) or {"M": "28 g/mol"}')
    const [T] = qty(t, 'T', env, Tlist.length > 1 ? `T[${ti}]` : 'T', { positive: true })
    const M = gas.M
    const vp = Math.sqrt((2 * R * T) / M), vavg = Math.sqrt((8 * R * T) / (Math.PI * M)), vrms = Math.sqrt((3 * R * T) / M)
    const f = (v) => 4 * Math.PI * (M / (2 * Math.PI * R * T)) ** 1.5 * v * v * Math.exp((-M * v * v) / (2 * R * T))
    const name = typeof g === 'string' ? g.replace(/(\d)/g, '_{$1}') : 'gas'
    curves.push({ gas, T, M, vp, vavg, vrms, f, name, label: gasList.length > 1 ? `\\text{${name}}` : `${num3(T)} ${unitText('K')}` })
  }
  const vmax = Math.max(...curves.map((c) => c.vrms)) * 2.3
  const fmax = Math.max(...curves.map((c) => c.f(c.vp)))
  const ks = fmax > 0 ? 10 ** Math.floor(Math.log10(fmax)) : 1
  const xs = axisRange(0, vmax, 5, 0), ys = axisRange(0, fmax / ks, 4)
  const exp = Math.round(Math.log10(ks))
  const F = frame(cv, theme, { w: 230, h: 140, xs, ys, xTitle: `v (${unitText('m/s')})`, yTitle: `f(v) (10^{${exp}} ${unitText('s/m')})` })
  const one = curves.length === 1
  const labels = []
  curves.forEach((c, i) => {
    const stroke = one ? color('blue') : color(i)
    const pts = Array.from({ length: 121 }, (_, k) => { const v = (xs.hi * k) / 120; return [F.X(v), F.Y(c.f(v) / ks)] })
    curve(cv, pts, stroke, { width: 2, tag: `f${i}` })
    const marks = one ? [['v_{p}', c.vp, color('teal')], ['\\bar{v}', c.vavg, color('amber')], ['v_{rms}', c.vrms, color('coral')]] : [['', c.vp, stroke]]
    for (const [lab, v, col] of marks) {
      const top = [F.X(v), F.Y(c.f(v) / ks)]
      if (one) rule(cv, top, [top[0], F.h], col, { width: 1.4, dash: '4 3', layer: 'mid' })
      dot(cv, top, 3, col)
      cv.trace([top], 'mark', 1)
      if (one) cv.trace([top, [top[0], F.h]], 'mark', 0.6)
      if (lab) labels.push({ label: lab, size: theme.size - 1, fill: col, cands: [[top[0] + 14, top[1] + 30], [top[0] + 14, top[1] + 52], [top[0] + 14, top[1] + 74], [top[0] - 14, top[1] + 52], [top[0] + 14, F.h - 10], [top[0] - 14, F.h - 10], [top[0], top[1] - 12]] })
    }
  })
  drawLabels(placeLabels(labels, cv), cv, theme)
  let y = F.bottom + 4
  if (!one) y = keys(cv, theme, F.left + 4, y, curves.map((c, i) => ({ label: c.label, color: color(i) })))
  const head = ['', `v_{p} (${unitText('m/s')})`, `\\bar{v} (${unitText('m/s')})`, `v_{rms} (${unitText('m/s')})`]
  table(cv, theme, F.left + 4, y + 2, head, curves.map((c) => [one ? `\\text{${c.name}}, ${num3(c.T)} ${unitText('K')}` : c.label, num3(c.vp), num3(c.vavg), num3(c.vrms)]))
  const facts = curves.map((c) => `${typeof c.gas.name === 'string' ? c.gas.name : 'gas'} (M ${sig(c.M * 1000, 4)} g/mol) at ${sig(c.T, 4)} K: v_p = √(2RT/M) = ${sig(c.vp, 4)} m/s, v_avg = √(8RT/πM) = ${sig(c.vavg, 4)} m/s, v_rms = √(3RT/M) = ${sig(c.vrms, 4)} m/s, peak f ${sig(c.f(c.vp), 4)} s/m`)
  if (curves.length > 1 && spec.expect !== undefined) diag.note('expect', 'expect checks the first curve')
  const c = curves[0], vals = {}
  const slips = (v, others) => [
    { v: v / Math.sqrt(1000), why: 'uses M in g/mol; M is in kg/mol here (28 g/mol = 0.028 kg/mol)' },
    ...(c.T > 273.15 ? [{ v: v * Math.sqrt((c.T - 273.15) / c.T), why: 'uses T in °C; it needs kelvin' }] : []), ...others]
  const speed = (key, label, v, others) => { vals[key] = { key: label, v, dim: 'v', show: (x) => `${sig(x, 4)} m/s`, alts: slips(v, others) } }
  speed('vp', 'v_p', c.vp, [{ v: c.vrms, why: 'is v_rms = √(3RT/M); v_p = √(2RT/M)' }, { v: c.vavg, why: 'is v̄ = √(8RT/πM); v_p = √(2RT/M)' }])
  speed('vavg', 'v_avg', c.vavg, [{ v: c.vrms, why: 'is v_rms; v̄ = √(8RT/πM)' }, { v: c.vp, why: 'is v_p; v̄ = √(8RT/πM)' }])
  speed('vrms', 'v_rms', c.vrms, [{ v: c.vp, why: 'is v_p = √(2RT/M); v_rms = √(3RT/M)' }, { v: c.vavg, why: 'is v̄; v_rms = √(3RT/M)' }])
  return { facts, vals, ids: {} }
}
