// Energy flow: a heat engine, refrigerator, or heat pump between a hot and a cold reservoir, as
// in OpenStax Vol. 2 Ch. 4: Q_h, Q_c, and W are amounts (positive), W = Q_h − Q_c, e = W/Q_h,
// K_R = Q_c/W, K_P = Q_h/W, against the Carnot limits from T_h and T_c. Arrow widths scale with
// each amount. The amounts come from the spec (any two, or one and e or K) or from a P-V cycle.

import { el, pathD } from '../../svg.js'
import { labelSvg, measure } from '../../label.js'
import { color } from '../../theme.js'
import { SpecError } from '../../diag.js'
import { V } from '../fbd/draw.js'
import { qty, sig, showE } from './units.js'
import { solveModel, R } from './gas.js'
import { lines } from './draw.js'
import { unitText, num3 } from './pv.js'

const DEVICES = { engine: 'engine', 'heat engine': 'engine', refrigerator: 'refrigerator', fridge: 'refrigerator', 'heat pump': 'heat pump', heatpump: 'heat pump', pump: 'heat pump' }

export function flowMode(spec, ctx, cv) {
  const { theme, diag, env } = ctx
  const facts = []
  let dev = spec.device === undefined ? null : DEVICES[String(spec.device).toLowerCase()]
  if (spec.device !== undefined && !dev) throw new SpecError('device', 'device is "engine", "refrigerator", or "heat pump"')
  let Qh = null, Qc = null, W = null, Th = null, Tc = null, power = false
  if (spec.cycle !== undefined || spec.states !== undefined) {
    // From a cycle: the gas's heat in and out and its net work.
    const M = solveModel(spec, env, diag)
    if (!M.closed) throw new SpecError('legs', 'an energy-flow diagram from states needs legs that close into a cycle')
    const engine = M.W > 0
    if (!dev) dev = engine ? 'engine' : 'refrigerator'
    if ((dev === 'engine') !== engine) throw new SpecError('device', `this cycle runs ${engine ? 'clockwise, so it is an engine' : 'counterclockwise, so it is a refrigerator or heat pump'}`)
    W = Math.abs(M.W); [Qh, Qc] = engine ? [M.Qin, M.Qout] : [M.Qout, M.Qin]
    if (M.n !== null) {
      if (engine) { Th = M.Th; Tc = M.Tc } else if (M.TcK != null) { Th = M.ThK; Tc = M.TcK }
    }
    facts.push(`from the cycle: ${M.gas.text}`)
  } else {
    if (!dev) dev = 'engine'
    const units = new Set()
    const E = (k) => {
      if (spec[k] === undefined) return null
      const [x, u] = qty(spec[k], 'E', env, k, { positive: k !== 'Qc' })
      if (x < 0) throw new SpecError(k, `${k} is an amount (positive or zero); the arrow shows the direction`)
      units.add(/W$/.test(u) ? 'W' : 'J')
      return x
    }
    Qh = E('Qh'); Qc = E('Qc'); W = E('W')
    if (units.size > 1) throw new SpecError('Qh', 'give every amount as energy (J) or every one as power (W), not both')
    power = units.has('W')
    const ratio = (k) => (spec[k] === undefined ? null : qty(spec[k], '', env, k, { positive: true })[0])
    const e = ratio('e'), K = ratio('K')
    if (e !== null && dev !== 'engine') throw new SpecError('e', 'e is an engine\'s efficiency; give a refrigerator or heat pump K')
    if (K !== null && dev === 'engine') throw new SpecError('K', 'K is a refrigerator\'s or heat pump\'s COP; give an engine e')
    if (e !== null && e >= 1) throw new SpecError('e', 'e = W/Q_h is below 1 (a fraction: 0.25, or "25%")')
    const known = [Qh, Qc, W].filter((x) => x !== null).length
    if (known === 3 && Math.abs(Qh - Qc - W) > 0.005 * Qh) diag.warn('W', `W should be Q_h − Q_c = ${showE(Qh - Qc, { n: 4, power })}, not ${showE(W, { n: 4, power })} (energy is conserved)`)
    if (known >= 2) {
      if (W === null) W = Qh - Qc
      else if (Qh === null) Qh = W + Qc
      else if (Qc === null) Qc = Qh - W
    } else if (known === 1 && (e !== null || K !== null)) {
      if (e !== null) {
        if (Qh !== null) W = e * Qh
        else if (W !== null) Qh = W / e
        else Qh = Qc / (1 - e), W = Qh - Qc
        if (Qc === null) Qc = Qh - W
      } else if (dev === 'refrigerator') {
        if (Qc !== null) W = Qc / K
        else if (W !== null) Qc = K * W
        else W = Qh / (K + 1), Qc = Qh - W
        if (Qh === null) Qh = Qc + W
      } else {
        if (Qh !== null) W = Qh / K
        else if (W !== null) Qh = K * W
        else W = Qc / (K - 1), Qh = Qc + W
        if (Qc === null) Qc = Qh - W
      }
    } else throw new SpecError('Qh', 'give two of Qh, Qc, W, or one of them and e (an engine) or K (a refrigerator or heat pump)')
    if (!(W > 0) || Qc < 0) throw new SpecError('W', `these amounts give W = ${showE(W, { power })} and Q_c = ${showE(Qc, { power })}; W is positive and Q_h = Q_c + W`)
    const T = (k) => (spec[k] === undefined ? null : qty(spec[k], 'T', env, k, { positive: true })[0])
    Th = T('Th'); Tc = T('Tc')
    if (Th !== null && Tc !== null && !(Th > Tc)) throw new SpecError('Tc', 'Tc is below Th')
  }

  // The figures of merit and the Carnot limits.
  const both = Th !== null && Tc !== null
  const show = (x, n = 3) => showE(x, { n, power })
  const res = { Qh, Qc, W, dev }
  const vals = {}
  const put = (key, v, o) => { vals[key] = { key: o.label ?? key, v, ...o } }
  const mag = 'is negative; Q_h, Q_c, and W are amounts here (positive), with the arrows for direction'
  const floor = Qh * 1e-4
  const eShow = (x) => show(x, 4)
  put('Qh', Qh, { dim: 'E', label: 'Q_h', floor, show: eShow, sign: mag, alts: [{ v: Qc, why: 'is Q_c; Q_h is the heat at the hot reservoir' }] })
  put('Qc', Qc, { dim: 'E', label: 'Q_c', floor, show: eShow, sign: mag, alts: [{ v: Qh, why: 'is Q_h; Q_c is the heat at the cold reservoir' }] })
  put('W', W, { dim: 'E', label: 'W', floor, show: eShow, sign: mag, alts: [{ v: Qh + Qc, why: 'is Q_h + Q_c; W = Q_h − Q_c' }] })
  if (both) {
    put('Th', Th, { dim: 'T', label: 'T_h', show: (x) => `${sig(x, 4)} K`, alts: [{ v: Th - 273.15, why: 'is in °C; T here is in kelvin' }] })
    put('Tc', Tc, { dim: 'T', label: 'T_c', show: (x) => `${sig(x, 4)} K`, alts: [{ v: Tc - 273.15, why: 'is in °C; T here is in kelvin' }] })
  }
  const cap = []
  const unit = power ? 'W' : 'J'
  const TT = both ? `${num3(Tc)}/${num3(Th)}` : ''
  const degC = (a, b) => both && Tc > 273.15 ? [{ v: a(Tc - 273.15, Th - 273.15), why: 'uses °C; the Carnot limit needs kelvin' }] : []
  let fig, lim, limName
  if (dev === 'engine') {
    const e = W / Qh, eC = both ? 1 - Tc / Th : null
    fig = e; lim = eC
    cap.push(`e = W/Q_{h} = ${sig(e, 3)}`)
    if (both) cap.push([`\\text{Carnot limit:} e_{C} = 1 − ${TT} = ${sig(eC, 3)}`, theme.muted])
    facts.push(`engine: Q_h ${show(Qh, 4)}, Q_c ${show(Qc, 4)}, W = Q_h − Q_c = ${show(W, 4)}, e = W/Q_h = ${sig(e, 4)}${both ? `; Carnot limit e_C = 1 − T_c/T_h = ${sig(eC, 4)} (T_c ${sig(Tc, 4)} K, T_h ${sig(Th, 4)} K)` : ''}`)
    put('e', e, { dim: '', label: 'e', alts: [{ v: 1 - e, why: 'is Q_c/Q_h; e = W/Q_h = 1 − Q_c/Q_h' }, { v: 100 * e, why: 'is in percent; e here is a fraction' }, ...(both ? [{ v: eC, why: 'is the Carnot limit 1 − T_c/T_h, not this engine\'s e' }] : [])] })
    if (both) put('eC', eC, { dim: '', label: 'e_C', alts: [{ v: Tc / Th, why: 'is T_c/T_h; e_C = 1 − T_c/T_h' }, { v: 100 * eC, why: 'is in percent; e here is a fraction' }, ...degC((c, h) => 1 - c / h)] })
    limName = 'e_C'
  } else {
    const fridge = dev === 'refrigerator'
    const K = fridge ? Qc / W : Qh / W
    const KC = both ? (fridge ? Tc : Th) / (Th - Tc) : null
    fig = K; lim = KC
    const sub = fridge ? 'R' : 'P'
    cap.push(`K_{${sub}} = Q_{${fridge ? 'c' : 'h'}}/W = ${sig(K, 3)}`)
    if (both) cap.push([`\\text{Carnot limit:} K_{${sub}} = ${fridge ? `T_{c}` : `T_{h}`}/(T_{h} − T_{c}) = ${sig(KC, 3)}`, theme.muted])
    facts.push(`${dev}: Q_c ${show(Qc, 4)}, W ${show(W, 4)}, Q_h = Q_c + W = ${show(Qh, 4)}, K_${sub} = Q_${fridge ? 'c' : 'h'}/W = ${sig(K, 4)}${both ? `; Carnot limit K_${sub} = ${fridge ? 'T_c' : 'T_h'}/(T_h − T_c) = ${sig(KC, 4)} (T_c ${sig(Tc, 4)} K, T_h ${sig(Th, 4)} K)` : ''}`)
    const other = fridge ? Qh / W : Qc / W
    const kAlts = [{ v: other, why: fridge ? 'is K_P = Q_h/W (a heat pump\'s); K_R = Q_c/W' : 'is K_R = Q_c/W (a refrigerator\'s); K_P = Q_h/W' }, { v: 1 / K, why: `is upside down: K_${sub} = Q_${fridge ? 'c' : 'h'}/W` }]
    if (both) kAlts.push({ v: KC, why: 'is the Carnot limit, not this device\'s K' })
    put('K', K, { dim: '', label: `K_${sub}`, alts: kAlts })
    vals[fridge ? 'KR' : 'KP'] = vals.K
    if (both) put('KC', KC, { dim: '', label: `K_${sub} (Carnot)`, alts: [{ v: (fridge ? Th : Tc) / (Th - Tc), why: fridge ? 'is T_h/(T_h − T_c), a heat pump\'s limit; K_R ≤ T_c/(T_h − T_c)' : 'is T_c/(T_h − T_c), a refrigerator\'s limit; K_P ≤ T_h/(T_h − T_c)' }, ...degC((c, h) => (fridge ? c : h) / (h - c))] })
    limName = `K_${sub}`
  }
  if (lim !== null && fig > lim * (1 + 1e-6)) {
    const msg = `${limName === 'e_C' ? 'e' : limName} = ${sig(fig, 3)} beats the Carnot limit ${sig(lim, 3)}: no ${dev} between ${sig(Th, 3)} K and ${sig(Tc, 3)} K can (the second law)`
    diag.warn(dev === 'engine' ? 'e' : 'K', msg)
    cap.push([`\\text{beats the Carnot limit: impossible}`, theme.highlight])
    facts.push(msg)
  }
  if (dev === 'engine' && Qc <= 1e-12 * Qh) diag.warn('Qc', 'Q_c = 0 means e = 1: an engine must give some heat to the cold reservoir (the second law, Kelvin form)')

  draw(cv, theme, res, { Th, Tc, power, cap })
  return { facts, vals, ids: {} }
}

/** The diagram: reservoirs above and below, the device between, arrow widths to scale. */
function draw(cv, theme, { Qh, Qc, W, dev }, { Th, Tc, power, cap }) {
  const fs = theme.size - 1
  const HOT = color('red'), COLD = color('blue'), WORK = color('green')
  const rw = 210, rh = 30, gap = 132, dw = 92, dh = 36
  const yHot = 0, yCold = rh + gap, cy = rh + gap / 2
  const reservoir = (y, fill, label) => {
    cv.back.push(el('rect', { x: -rw / 2, y, width: rw, height: rh, rx: 4, fill, 'fill-opacity': 0.2, stroke: fill, 'stroke-width': 1.4 }))
    cv.front.push(labelSvg(label, 0, y + rh / 2, theme, { middle: true, size: fs }))
    cv.ext.push([-rw / 2, y], [rw / 2, y + rh])
  }
  reservoir(yHot, HOT, Th !== null ? `\\text{hot reservoir} T_{h} = ${num3(Th)} ${unitText('K')}` : '\\text{hot reservoir}')
  reservoir(yCold, COLD, Tc !== null ? `\\text{cold reservoir} T_{c} = ${num3(Tc)} ${unitText('K')}` : '\\text{cold reservoir}')
  cv.mid.push(el('rect', { x: -dw / 2, y: cy - dh / 2, width: dw, height: dh, rx: dh / 2, fill: theme.bg ?? 'none', stroke: theme.fg, 'stroke-width': 1.6 }))
  cv.front.push(labelSvg(`\\text{${dev}}`, 0, cy, theme, { middle: true, size: fs }))
  // Widths: the largest amount 26 px, none under 3 px.
  const big = Math.max(Qh, Qc, W)
  const wOf = (x) => Math.max(3, (26 * x) / big)
  const band = (a, b, w, fill) => {
    const d = V.unit(V.sub(b, a)), n = V.perp(d)
    const hl = Math.min(12 + w * 0.25, V.len(V.sub(b, a)) * 0.5), hw = w / 2 + 6
    const s = V.sub(b, V.mul(d, hl))
    const poly = [V.add(a, V.mul(n, w / 2)), V.add(s, V.mul(n, w / 2)), V.add(s, V.mul(n, hw)), b, V.sub(s, V.mul(n, hw)), V.sub(s, V.mul(n, w / 2)), V.sub(a, V.mul(n, w / 2))]
    cv.mid.push(el('path', { d: pathD(poly.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]), true), fill, 'fill-opacity': 0.85 }))
    cv.ext.push(...poly)
  }
  const show = (x) => showE(x, { power })
  const side = (x, y, label, anchor = 'start') => {
    cv.front.push(labelSvg(label, x, y, theme, { anchor, middle: true, size: fs }))
    const w = measure(label, fs)
    cv.ext.push([anchor === 'start' ? x : x - w, y - fs], [anchor === 'start' ? x + w : x, y + fs])
  }
  const top = cy - dh / 2, bot = cy + dh / 2
  const wh = wOf(Qh), wc = wOf(Qc), ww = wOf(W)
  if (dev === 'engine') {
    // Q_h comes down into the device, Q_c goes on down, W leaves to the right.
    band([0, yHot + rh], [0, top - 1], wh, HOT)
    band([0, bot], [0, yCold - 1], wc, COLD)
    band([dw / 2, cy], [dw / 2 + 62, cy], ww, WORK)
    side(Math.max(wh, 12) / 2 + 9, (yHot + rh + top) / 2, `Q_{h} = ${show(Qh)}`)
    side(Math.max(wc, 12) / 2 + 9, (bot + yCold) / 2, `Q_{c} = ${show(Qc)}`)
    side(dw / 2 + 68, cy, `W = ${show(W)}`)
  } else {
    // Q_c comes up from the cold side, W comes in from the right, Q_h goes up to the hot side.
    band([0, yCold], [0, bot + 1], wc, COLD)
    band([0, top], [0, yHot + rh + 1], wh, HOT)
    band([dw / 2 + 62, cy], [dw / 2 + 1, cy], ww, WORK)
    side(Math.max(wh, 12) / 2 + 9, (yHot + rh + top) / 2, `Q_{h} = ${show(Qh)}`)
    side(Math.max(wc, 12) / 2 + 9, (bot + yCold) / 2, `Q_{c} = ${show(Qc)}`)
    side(dw / 2 + 68, cy, `W = ${show(W)}`)
  }
  lines(cv, theme, -rw / 2, yCold + rh + 10, cap)
}
