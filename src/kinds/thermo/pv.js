// P-V and T-S diagrams: states joined by processes, a direction arrow on each leg, legs colored
// by the sign of Q, the work shaded (the loop for a cycle, under each curve otherwise, green for
// W > 0 and purple for W < 0), optional isotherms, and the tables: states (P, V, T), legs (W, Q,
// ΔE_int, ΔS), then Q_in, Q_out, and e against the Carnot limit (or K_R and K_P run backward).

import { SpecError } from '../../diag.js'
import { color } from '../../theme.js'
import { V } from '../fbd/draw.js'
import { placeLabels, drawLabels, ringCands, extent } from '../fbd/place.js'
import { solveModel, R } from './gas.js'
import { qty, sig, signed, displayUnit, perUnit, energyUnit, showE } from './units.js'
import { frame, axisRange, curve, region, arrowOn, along, centroid, insideSpots, table, lines, keys, dot, rule } from './draw.js'

const PLOT = { w: 230, h: 160 }
const WCOL = { pos: color('green'), neg: color('purple') }
export const unitText = (u) => `\\text{${u}}`
/** 3 significant figures, but whole numbers from 1000 up (1097, not 1100). */
export const num3 = (x) => (Math.abs(x) >= 999.5 ? String(Math.round(x)).replace(/^-/, '−') : sig(x, 3))

export function pvMode(spec, ctx, cv, { ts = false } = {}) {
  const { theme, diag, env } = ctx
  const M = solveModel(spec, env, diag)
  const { gas, n, states, legs } = M
  if (!legs.length && spec.states === undefined) throw new SpecError('legs', 'a P-V diagram needs legs')
  if (ts && n === null) throw new SpecError('n', 'a T-S diagram needs n (mol), or a state with P, V, and T')
  const facts = [`${gas.text}${n !== null ? `, n = ${sig(n, 4)} mol` : ''}`]
  const fs = theme.size - 1
  const hl = new Set(spec.highlight ?? [])

  // Display units: the ones written (or "units"), else SI sized to the values.
  const maxP = Math.max(...states.map((s) => s.P), ...legs.flatMap((L) => L.pts.map((p) => p[1])))
  const maxV = Math.max(...states.map((s) => s.V), ...legs.flatMap((L) => L.pts.map((p) => p[0])))
  const pu = displayUnit('P', spec.units?.P ?? M.units.P, maxP), vu = displayUnit('V', spec.units?.V ?? M.units.V, maxV)
  const pk = perUnit('P', pu), vk = perUnit('V', vu)
  const A0 = states[0]
  const Tof = (P, Vv) => (P * Vv) / (n * R)
  const Sof = (P, Vv) => n * R * (gas.cv * Math.log((P * Vv) / (A0.P * A0.V)) + Math.log(Vv / A0.V))
  const data = ts ? ([Vv, P]) => [Sof(P, Vv), Tof(P, Vv)] : ([Vv, P]) => [Vv / vk, P / pk]

  // The frame.
  const all = [...legs.flatMap((L) => L.pts), ...states.map((s) => [s.V, s.P])].map(data)
  const xMin = Math.min(...all.map((p) => p[0])), xMax = Math.max(...all.map((p) => p[0]))
  // S has no natural zero: its axis spans the cycle with room each side, the T axis at the edge.
  const xs = ts ? axisRange(xMin, xMax, 5, 0.08, false) : axisRange(0, xMax)
  const ys = axisRange(0, Math.max(...all.map((p) => p[1])))
  const F = frame(cv, theme, { ...PLOT, xs, ys, edge: ts, xTitle: ts ? `S − S_{${A0.id}} (${unitText('J/K')})` : `V (${unitText(vu)})`, yTitle: ts ? `T (${unitText('K')})` : `P (${unitText(pu)})` })
  const scr = (p) => { const [x, y] = data(p); return [F.X(x), F.Y(y)] }

  // Isotherms behind everything (P-V only): a list of temperatures, or true for the hottest and coldest states.
  const isoLabels = []
  if (spec.isotherms && !ts) {
    let list
    if (spec.isotherms === true) {
      const hot = states.reduce((a, b) => (b.P * b.V > a.P * a.V ? b : a)), cold = states.reduce((a, b) => (b.P * b.V < a.P * a.V ? b : a))
      list = [hot, cold].filter((s, i, arr) => arr.indexOf(s) === i).map((s) => ({ c: s.P * s.V, label: n !== null ? `${sig(s.T, 3)} ${unitText('K')}` : `T_{${s.id}}` }))
    } else if (Array.isArray(spec.isotherms)) {
      if (n === null) throw new SpecError('isotherms', 'isotherms at given temperatures need n (mol)')
      list = spec.isotherms.map((t, i) => { const [T] = qty(t, 'T', env, `isotherms[${i}]`, { positive: true }); return { c: n * R * T, label: `${sig(T, 3)} ${unitText('K')}` } })
    } else throw new SpecError('isotherms', 'isotherms is true (through the hottest and coldest states) or a list of temperatures, like ["300 K", "600 K"]')
    for (const { c, label } of list) {
      const v0 = Math.max(c / (ys.hi * pk), 1e-12), v1 = xs.hi * vk
      if (!(v1 > v0)) continue
      const pts = Array.from({ length: 49 }, (_, k) => { const Vv = v0 * (v1 / v0) ** (k / 48); return scr([Vv, c / Vv]) })
      curve(cv, pts, theme.faint, { width: 1, dash: '2 3', layer: 'back', tag: 'iso', weight: 0.4 })
      const end = pts[pts.length - 1]
      isoLabels.push({ label, size: fs - 1, fill: theme.muted, cands: [[end[0] - 4, end[1] - 9], [end[0] - 18, end[1] - 10], [end[0] - 40, end[1] - 12], (w) => [end[0] + w / 2 + 4, end[1]]], ignore: ['iso'] })
    }
  }

  // Work (P-V) or heat (T-S): the loop's inside, or under each leg down to the axis.
  const tiny = 1e-6 * Math.max(1, ...legs.map((L) => Math.abs(L.Q) + Math.abs(L.W)))
  const mid0 = V.mul(states.map((s) => scr([s.V, s.P])).reduce((a, b) => V.add(a, b), [0, 0]), 1 / states.length)
  const areaLabels = []
  const legScr = legs.map((L) => L.pts.map(scr))
  const amountOf = (L) => (ts ? L.Q : L.W)
  if (M.closed) {
    const poly = legScr.flat()
    const net = ts ? M.Q : M.W
    region(cv, poly, net > 0 ? WCOL.pos : WCOL.neg, 0.22)
    const spots = insideSpots(poly)
    const c = spots[0] ?? centroid(poly)
    const E = energyUnit([net])
    // Inside the loop where it fits; else beside it, with a leader to the roomiest inside spot.
    const outward = V.unit(V.sub(c, mid0))[0] || V.unit(V.sub(c, mid0))[1] ? V.unit(V.sub(c, mid0)) : [1, -1]
    areaLabels.push({ label: `${ts ? 'Q_{net}' : 'W'} = ${signed(net / E.k, 3)} ${unitText(E.u)}`, size: fs, fill: theme.fg, anchor: c, cands: [...spots, ...[22, 40, 62].flatMap((r) => ringCands(c, r, outward))] })
  } else {
    const shaded = []
    legs.forEach((L, i) => {
      const a = amountOf(L)
      if (Math.abs(a) <= tiny) return
      const pts = legScr[i]
      const base = F.Y(0)
      region(cv, [...pts, [pts[pts.length - 1][0], base], [pts[0][0], base]], a > 0 ? WCOL.pos : WCOL.neg, 0.16)
      shaded.push([L, pts])
    })
    if (shaded.length === 1) {
      const [L, pts] = shaded[0], a = amountOf(L)
      const m = along(pts, 0.5).p, c = [m[0], (m[1] + F.Y(0)) / 2]
      const E = energyUnit([a])
      areaLabels.push({ label: `${ts ? 'Q' : 'W'} = ${signed(a / E.k, 3)} ${unitText(E.u)}`, size: fs, fill: theme.fg, cands: [c, V.add(c, [0, 12]), V.add(c, [0, -12]), V.add(c, [20, 8])] })
    }
  }

  // Legs: colored by the sign of Q, an arrowhead at the middle.
  const qColor = (L) => (L.Q > tiny ? theme.positive : L.Q < -tiny ? theme.negative : theme.fg)
  // Leaders from area labels placed outside their area.
  const leaders = (placed) => {
    for (const q of placed) {
      if (!q.anchor) continue
      const [x1, y1, x2, y2] = q.box, [ax, ay] = q.anchor
      if (ax > x1 - 2 && ax < x2 + 2 && ay > y1 - 2 && ay < y2 + 2) continue
      const px = Math.max(x1, Math.min(x2, ax)), py = Math.max(y1, Math.min(y2, ay))
      rule(cv, [px, py], [ax, ay], theme.muted)
      dot(cv, [ax, ay], 1.8, theme.muted)
    }
  }
  legs.forEach((L, i) => {
    const wide = hl.has(L.id) || hl.has(`${L.from.id}${L.to.id}`)
    curve(cv, legScr[i], qColor(L), { width: wide ? 3.4 : 2, tag: `leg:${L.id}` })
    arrowOn(cv, legScr[i], qColor(L), { size: wide ? 10 : 8 })
  })
  const pos = new Map(states.map((s) => [s, scr([s.V, s.P])]))
  const mid = V.mul([...pos.values()].reduce((a, b) => V.add(a, b), [0, 0]), 1 / Math.max(1, pos.size))
  for (const [s, p] of pos) {
    dot(cv, p, hl.has(s.id) ? 4.2 : 3.2, theme.fg)
    cv.trace([p], 'state', 1)
  }
  const stateLabels = [...pos].map(([s, p]) => {
    let out = V.unit(V.sub(p, mid))
    if (!out[0] && !out[1]) out = [0, -1]
    return { label: s.id, size: theme.size, fill: theme.fg, cands: ringCands(p, 5, out) }
  })
  const procLabels = spec.processes === false ? [] : legs.filter((L) => L.proc !== 'line').map((L) => {
    const i = legs.indexOf(L)
    const pts = legScr[i]
    const cands = []
    for (const t of [0.5, 0.32, 0.68]) {
      const { p, d } = along(pts, t)
      let nrm = V.perp(d)
      if (V.dot(nrm, V.sub(p, mid)) < 0) nrm = V.mul(nrm, -1)
      for (const s of [1, -1]) cands.push((w, h) => V.add(p, V.mul(nrm, s * (5 + extent(nrm, w, h)))))
    }
    return { label: `\\text{${L.process}}`, size: fs - 1, fill: theme.muted, cands, leg: L }
  })
  const placed = placeLabels([...stateLabels, ...areaLabels, ...procLabels, ...isoLabels], cv)
  const dropped = placed.filter((q) => q.leg && q.hard > 0)
  drawLabels(placed.filter((q) => !(q.leg && q.hard > 0)), cv, theme)
  leaders(placed)

  // Below the plot: the color keys, then the tables and the cycle's totals.
  let y = F.bottom + 4
  const k = []
  if (legs.some((L) => L.Q > tiny)) k.push({ label: 'Q > 0', color: theme.positive })
  if (legs.some((L) => L.Q < -tiny)) k.push({ label: 'Q < 0', color: theme.negative })
  if (legs.some((L) => Math.abs(L.Q) <= tiny)) k.push({ label: 'Q = 0', color: theme.fg })
  if (!areaLabels.length) {
    if (legs.some((L) => amountOf(L) > tiny)) k.push({ label: ts ? 'Q > 0' : 'W > 0', fill: WCOL.pos })
    if (legs.some((L) => amountOf(L) < -tiny)) k.push({ label: ts ? 'Q < 0' : 'W < 0', fill: WCOL.neg })
  }
  y = keys(cv, theme, F.left + 4, y, k)
  const x0 = F.left + 4
  const which = spec.table ?? true
  if (!(which === true || which === false || which === 'states' || which === 'legs')) throw new SpecError('table', 'table is true (both), "states", "legs", or false')
  const withT = n !== null
  if (which === true || which === 'states') {
    const head = ['', `P (${unitText(pu)})`, `V (${unitText(vu)})`, ...(withT ? [`T (${unitText('K')})`] : [])]
    y = table(cv, theme, x0, y + 2, head, states.map((s) => [s.id, num3(s.P / pk), num3(s.V / vk), ...(withT ? [num3(s.T)] : [])])).bottom
  }
  const withS = withT && (spec.entropy ?? ts)
  const eu = energyUnit(legs.flatMap((L) => [L.W, L.Q, L.dE]))
  const scale = Math.max(...legs.map((L) => Math.abs(L.W) + Math.abs(L.Q)), 1e-30)
  const sS = Math.max(...legs.map((L) => Math.abs(L.dS ?? 0)), 1e-30)
  if (legs.length && (which === true || which === 'legs')) {
    const head = ['', `W (${unitText(eu.u)})`, `Q (${unitText(eu.u)})`, `\\text{Δ}E_{int} (${unitText(eu.u)})`, ...(withS ? [`\\text{Δ}S (${unitText('J/K')})`] : [])]
    const row = (name, W, Q, dE, dS, bold) => [name, signed(W / eu.k, 3, scale / eu.k), signed(Q / eu.k, 3, scale / eu.k), signed(dE / eu.k, 3, scale / eu.k), ...(withS ? [signed(dS, 3, sS)] : [])]
    const rows = legs.map((L) => row(`${L.from.id}→${L.to.id}`, L.W, L.Q, L.dE, L.dS))
    if (M.closed || (M.chain && legs.length > 1)) rows.push(row(M.closed ? '\\text{cycle}' : '\\text{total}', M.W, M.Q, M.dE, withS ? legs.reduce((s, L) => s + L.dS, 0) : 0))
    y = table(cv, theme, x0, y + 4, head, rows).bottom
  }
  const cap = []
  const E3 = (x) => showE(x)
  if (M.closed) {
    const TcTh = M.Th !== null ? `1 − ${num3(M.Tc)}/${num3(M.Th)}` : '1 − T_{c}/T_{h}'
    const warmIn = n !== null ? `${num3(M.coldIn / (n * R))} ${unitText('K')}` : '\\text{its hottest}'
    cap.push(`Q_{in} = ${E3(M.Qin)}, Q_{out} = ${E3(M.Qout)}`)
    if (M.engine) {
      cap.push(`e = W/Q_{in} = ${sig(M.e, 3)}`)
      cap.push([`\\text{Carnot limit:} e_{C} = ${TcTh} = ${sig(M.eC, 3)}`, theme.muted])
    } else if (M.W < 0) {
      cap.push(`K_{R} = Q_{in}/|W| = ${sig(M.KR, 3)}, K_{P} = Q_{out}/|W| = ${sig(M.KP, 3)}`)
      if (M.KRC !== undefined) cap.push([`\\text{Carnot limits:} K_{R} = ${sig(M.KRC, 3)}, K_{P} = ${sig(M.KPC, 3)}`, theme.muted])
      else cap.push([`\\text{no Carnot limit: heat enters up to } ${warmIn}`, theme.muted])
    }
    for (const L of M.split) cap.push([`${L.from.id}→${L.to.id}: ${showE(L.qin)} \\text{ in, then } ${showE(L.qout)} \\text{ out}`, theme.muted])
  }
  lines(cv, theme, x0, y + 2, cap)

  // The summary and the checkable values.
  const T4 = (x) => `${sig(x, 4)} K`
  for (const s of states) facts.push(`${s.id}: P ${sig(s.P / pk, 4)} ${pu}, V ${sig(s.V / vk, 4)} ${vu}${withT ? `, T ${T4(s.T)}` : ''}`)
  const e4 = (x) => showE(x, { n: 4, sign: true })
  for (const L of legs) facts.push(`${L.from.id}→${L.to.id} ${L.process}: W ${e4(L.W)}, Q ${e4(L.Q)}, ΔE_int ${e4(L.dE)}${L.dS !== null ? `, ΔS ${signed(L.dS, 4, sS)} J/K` : ''}`)
  if (M.closed) {
    const lim = M.Th !== null ? ` (T_c ${T4(M.Tc)}, T_h ${T4(M.Th)})` : ''
    if (M.engine) facts.push(`cycle clockwise (an engine): W_net ${e4(M.W)}, Q_in ${showE(M.Qin, { n: 4 })}, Q_out ${showE(M.Qout, { n: 4 })}, e = W/Q_in = ${sig(M.e, 4)}; Carnot limit 1 − T_c/T_h = ${sig(M.eC, 4)}${lim}`)
    else {
      const carnot = M.KRC !== undefined
        ? `Carnot K_R = T_c/(T_h − T_c) = ${sig(M.KRC, 4)}, K_P = ${sig(M.KPC, 4)}${M.TcK != null ? ` (T_c ${T4(M.TcK)}, the hottest intake; T_h ${T4(M.ThK)}, the coldest exhaust)` : ''}`
        : `no Carnot comparison: the gas takes in heat at up to ${n !== null ? T4(M.coldIn / (n * R)) : 'a T'} but gives it out down to ${n !== null ? T4(M.hotOut / (n * R)) : 'a lower T'}, so it doesn't work between two reservoirs`
      facts.push(`cycle counterclockwise (a refrigerator or heat pump): W_net ${e4(M.W)}, Q_in ${showE(M.Qin, { n: 4 })} (from the cold side), Q_out ${showE(M.Qout, { n: 4 })}, K_R = Q_in/|W| = ${sig(M.KR, 4)}, K_P = Q_out/|W| = ${sig(M.KP, 4)}; ${carnot}`)
    }
    for (const L of M.split) facts.push(`${L.from.id}→${L.to.id} takes in ${showE(L.qin, { n: 4 })} and gives out ${showE(L.qout, { n: 4 })} along the way; e above counts each leg's net Q (counting the inflow along the way, Q_in = ${showE(M.QinTrue, { n: 4 })}${M.engine ? `, e = ${sig(M.W / M.QinTrue, 4)}` : ''})`)
  } else if (M.chain && legs.length > 1) facts.push(`total ${states[0].id}→${legs[legs.length - 1].to.id}: W ${e4(M.W)}, Q ${e4(M.Q)}, ΔE_int ${e4(M.dE)}`)
  if (dropped.length) facts.push(`process names left off (no clear spot): ${dropped.map((q) => `${q.leg.from.id}→${q.leg.to.id}`).join(', ')}`)
  return { facts, vals: pvVals(M, { pk, pu, vk, vu, scale, sS }), ids: { legs: legs.map((L) => L.id), states: states.map((s) => s.id) } }
}

/** Checkable values with the likely slips for each. */
function pvVals(M, { pk, pu, vk, vu, scale, sS }) {
  const { gas, n, states, legs } = M
  const g = gas.gamma
  const vals = {}
  const floorE = scale * 1e-4
  const put = (key, v, o) => { vals[key] = { key: o.label ?? key, v, ...o } }
  const E = (key, v, label, alts, sign) => put(key, v, { dim: 'E', label, floor: floorE, show: (x) => showE(x, { n: 4, sign: true }), alts: [...alts, { v: v / 101.325, why: 'is in L·atm; 1 L·atm = 101.3 J' }], sign })
  const WSIGN = 'has the wrong sign: W is the work done by the gas, positive when it expands (ΔE_int = Q − W)'
  const QSIGN = 'has the wrong sign: Q is positive when heat flows into the gas'
  const LAW = 'comes from ΔE_int = Q + W; OpenStax\'s first law is ΔE_int = Q − W, with W done by the gas'
  for (const L of legs) {
    const id = `${L.from.id}${L.to.id}`
    const wAlts = []
    if (L.proc === 'T') {
      wAlts.push({ v: L.W / Math.LN10, why: 'uses log₁₀; the isothermal work is nRT ln(V_f/V_i)' })
      if (L.from.T !== null && L.from.T > 273.15) wAlts.push({ v: (L.W * (L.from.T - 273.15)) / L.from.T, why: 'uses T in °C; nRT needs kelvin' })
    }
    E(`W:${L.id}`, L.W, `W_${id}`, wAlts, WSIGN)
    const qAlts = [{ v: L.dE - L.W, why: LAW }]
    if (L.proc === 'V') qAlts.push({ v: L.Q * g, why: 'uses C_p; at constant volume Q = nC_VΔT' })
    if (L.proc === 'P') qAlts.push({ v: L.Q / g, why: 'uses C_V; at constant pressure Q = nC_pΔT' })
    if (L.proc === 'T') qAlts.push({ v: 0, why: 'is ΔE_int; on an isotherm ΔE_int = 0, so Q = W' })
    if (L.proc === 'S') qAlts.push({ v: L.W, why: 'is W; an adiabatic leg has Q = 0' }, { v: L.dE, why: 'is ΔE_int; an adiabatic leg has Q = 0' })
    E(`Q:${L.id}`, L.Q, `Q_${id}`, qAlts, QSIGN)
    E(`dE:${L.id}`, L.dE, `ΔE_int ${id}`, [{ v: L.dE * g, why: 'uses C_p; ΔE_int = nC_VΔT on every path' }, { v: L.Q + L.W, why: LAW }, { v: L.Q, why: 'is Q; ΔE_int = Q − W' }], 'has the wrong sign: ΔE_int > 0 when T rises')
    if (L.dS !== null) {
      const sAlts = []
      if (L.proc === 'T' && L.from.T > 273.15) sAlts.push({ v: L.Q / (L.from.T - 273.15), why: 'uses T in °C; ΔS = Q/T needs kelvin' })
      const lnT = Math.log(L.to.T / L.from.T)
      if (L.proc === 'V') sAlts.push({ v: n * (gas.cv + 1) * R * lnT, why: 'uses C_p; at constant volume ΔS = nC_V ln(T_f/T_i)' })
      if (L.proc === 'P') sAlts.push({ v: n * gas.cv * R * lnT, why: 'uses C_V; at constant pressure ΔS = nC_p ln(T_f/T_i)' })
      put(`dS:${L.id}`, L.dS, { dim: 'S', label: `ΔS_${id}`, floor: sS * 1e-4, show: (x) => `${signed(x, 4, sS)} J/K`, alts: sAlts, sign: 'has the wrong sign: ΔS > 0 when heat flows in (reversibly)' })
    }
  }
  for (const s of states) {
    const alts = { P: [], V: [], T: [] }
    if (s.via && s.via.leg.proc === 'S' && n !== null) {
      const a = s.via.from, k = s.given[0]
      for (const g2 of [5 / 3, 7 / 5].filter((x) => Math.abs(x - g) > 1e-6)) {
        let P2, V2
        if (k === 'V') { V2 = s.V; P2 = a.P * (a.V / s.V) ** g2 }
        else if (k === 'P') { P2 = s.P; V2 = a.V * (a.P / s.P) ** (1 / g2) }
        else { V2 = a.V * (a.T / s.T) ** (1 / (g2 - 1)); P2 = (n * R * s.T) / V2 }
        const why = `uses γ = ${sig(g2, 3)}; this gas has γ = ${sig(g, 3)}`
        alts.P.push({ v: P2, why }); alts.V.push({ v: V2, why }); alts.T.push({ v: (P2 * V2) / (n * R), why })
      }
      if (k === 'V') alts.T.push({ v: a.T * (a.V / s.V) ** g, why: 'uses T V^γ; along an adiabat T V^{γ−1} stays constant' })
    }
    put(`P:${s.id}`, s.P, { dim: 'P', label: `P_${s.id}`, bare: pk, show: (x) => `${sig(x / pk, 4)} ${pu}`, alts: alts.P })
    put(`V:${s.id}`, s.V, { dim: 'V', label: `V_${s.id}`, bare: vk, show: (x) => `${sig(x / vk, 4)} ${vu}`, alts: alts.V })
    if (s.T !== null) put(`T:${s.id}`, s.T, { dim: 'T', label: `T_${s.id}`, show: (x) => `${sig(x, 4)} K`, alts: [{ v: s.T - 273.15, why: 'is in °C; T here is in kelvin' }, ...alts.T] })
  }
  const netSign = M.closed && M.W < 0 ? 'has the wrong sign: W is the work done by the gas, negative around a counterclockwise cycle' : WSIGN
  E('W', M.W, M.closed ? 'W_net' : 'W', [], netSign)
  E('Q', M.Q, M.closed ? 'Q_net' : 'Q', [], QSIGN)
  E('dE', M.dE, 'ΔE_int', [], 'has the wrong sign')
  if (n !== null) put('n', n, { dim: 'n', label: 'n', show: (x) => `${sig(x, 4)} mol` })
  if (!M.closed) return vals
  const mag = 'is negative; Q_in and Q_out are amounts (positive)'
  E('Qin', M.Qin, 'Q_in', [{ v: M.Qout, why: 'is Q_out; Q_in is the heat flowing into the gas' }], mag)
  E('Qout', M.Qout, 'Q_out', [{ v: M.Qin, why: 'is Q_in; Q_out is the heat flowing out of the gas' }], mag)
  const [Qh, Qc] = M.engine ? [M.Qin, M.Qout] : [M.Qout, M.Qin]
  E('Qh', Qh, 'Q_h', [{ v: Qc, why: 'is Q_c; Q_h is the heat exchanged on the hot side' }], mag)
  E('Qc', Qc, 'Q_c', [{ v: Qh, why: 'is Q_h; Q_c is the heat exchanged on the cold side' }], mag)
  const r = M.ratio
  const eCalts = [{ v: r, why: 'is T_c/T_h; e_C = 1 − T_c/T_h' }, { v: 100 * M.eC, why: 'is in percent; e here is a fraction' }]
  if (M.Th !== null && M.Tc > 273.15) eCalts.push({ v: 1 - (M.Tc - 273.15) / (M.Th - 273.15), why: 'uses °C; the Carnot limit needs kelvin' })
  if (M.engine) put('eC', M.eC, { dim: '', label: 'e_C', alts: eCalts })
  if (M.Th !== null) {
    put('Th', M.Th, { dim: 'T', label: 'T_h', show: (x) => `${sig(x, 4)} K`, alts: [{ v: M.Th - 273.15, why: 'is in °C; T here is in kelvin' }] })
    put('Tc', M.Tc, { dim: 'T', label: 'T_c', show: (x) => `${sig(x, 4)} K`, alts: [{ v: M.Tc - 273.15, why: 'is in °C; T here is in kelvin' }] })
  }
  if (M.engine) {
    const alts = [{ v: 1 - M.e, why: 'is Q_out/Q_in; e = W/Q_in = 1 − Q_out/Q_in' }, { v: M.eC, why: 'is the Carnot limit 1 − T_c/T_h; this cycle\'s e = W/Q_in is lower' }, { v: 100 * M.e, why: 'is in percent; e here is a fraction' }]
    if (M.QinTrue) alts.push({ v: M.W / M.QinTrue, why: `counts the heat flowing in along ${M.split.map((L) => `${L.from.id}→${L.to.id}`).join(', ')} piece by piece; e here is W over the positive legs' net Q` })
    put('e', M.e, { dim: '', label: 'e', alts })
  } else if (M.W < 0) {
    const minmax = [{ v: r / (1 - r), why: 'uses the coldest and hottest states; run backward this cycle takes in heat above its coldest state, so that Carnot COP doesn\'t bound it' }]
    put('KR', M.KR, { dim: '', label: 'K_R', alts: [{ v: M.KP, why: 'is K_P = Q_h/|W| (a heat pump\'s); K_R = Q_c/|W|' }, { v: 1 / M.KR, why: 'is upside down: K_R = Q_c/|W|' }, { v: M.KRC, why: 'is the Carnot K_R = T_c/(T_h − T_c); this cycle\'s is lower' }, ...minmax] })
    put('KP', M.KP, { dim: '', label: 'K_P', alts: [{ v: M.KR, why: 'is K_R = Q_c/|W|; K_P = Q_h/|W| = K_R + 1' }, { v: 1 / M.KP, why: 'is upside down: K_P = Q_h/|W|' }, { v: M.KPC, why: 'is the Carnot K_P = T_h/(T_h − T_c); this cycle\'s is lower' }] })
    vals.K = vals.KR
    if (M.KRC !== undefined) {
      put('KRC', M.KRC, { dim: '', label: 'K_R (Carnot)' })
      put('KPC', M.KPC, { dim: '', label: 'K_P (Carnot)' })
    }
  }
  return vals
}
