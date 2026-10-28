// Wave optics, in OpenStax University Physics Volume 3's conventions (3.2, 3.4, 4.1, 4.4).
// slits: a single slit (a sin θ = mλ minima), a double slit (d sin θ = mλ bright fringes), or a
// grating, with the rays to one order, the path difference, the screen positions y = D tan θ,
// the fringes as a strip, and the intensity curve. film: thin-film interference in reflection
// near normal incidence, with the π shift at each surface counted and the thicknesses listed.
// Screen px, y down.

import { el } from '../../svg.js'
import { SpecError } from '../../diag.js'
import { arrow } from '../fbd/draw.js'
import { placeLabels, drawLabels, ringCands, extent } from '../fbd/place.js'
import { length, index, sig, deg, showLen } from './units.js'
import { RAY, seg, chevron, angleArc, medium, waveColor, V } from './draw.js'

const R2D = 180 / Math.PI
const NCAP = 20 // the most slits the intensity is drawn for
const asinD = (x) => Math.asin(x) * R2D
const tanD = (x) => Math.tan(x / R2D)
const sinD = (x) => Math.sin(x / R2D)
/** a and b differ by more than 1%. */
const differ = (a, b) => Math.abs(a - b) > 0.01 * Math.abs(b)
const L4 = (x) => showLen(x, 4)
const D4 = (x) => deg(x, 4)
const f2 = (v) => +v.toFixed(2)

/** A positive length in meters; outside [lo, hi] warns (a bare number is meters). */
function readLen(spec, key, env, diag, { lo, hi, eg, need, dflt }) {
  let v = spec[key]
  if (v === undefined) {
    if (need) throw new SpecError(key, need)
    v = dflt
  }
  const x = length(v, env, key, 'm')
  if (!(x > 0)) throw new SpecError(key, `${key} must be positive, like "${eg}"`)
  if (x < lo || x > hi) diag.warn(key, `${key} = ${showLen(x)} is implausible here; write it with its unit, like "${eg}" (a bare number is meters)`)
  return x
}

function int(v, path, lo, hi, dflt, msg) {
  if (v === undefined) return dflt
  if (!Number.isInteger(v) || v < lo || v > hi) throw new SpecError(path, msg)
  return v
}

/** Relative intensity at sin θ: N-slit interference (N capped) times the single-slit envelope. */
function intensity(st, { N, d, a, lambda }) {
  let I = 1
  if (N >= 2) {
    const phi = (2 * Math.PI * d * st) / lambda, n = Math.min(N, NCAP), s = Math.sin(phi / 2)
    I = Math.abs(s) < 1e-12 ? 1 : (Math.sin((n * phi) / 2) / (n * s)) ** 2
  }
  if (a) I *= envelope(st, a, lambda)
  return I
}
function envelope(st, a, lambda) {
  const b = (Math.PI * a * st) / lambda
  return Math.abs(b) < 1e-12 ? 1 : (Math.sin(b) / b) ** 2
}

const list = (xs, f, max = 4) => xs.slice(0, max).map(f).join(', ') + (xs.length > max ? ', …' : '')

export function slitsMode(spec, ctx, cv) {
  const { theme, diag, env } = ctx
  const N = int(spec.N, 'N', 1, 1e7, 2, 'N is the number of slits, a whole number: 1 (a single slit), 2 (a double slit, the default), or more (a grating)')
  const single = N === 1
  const lambda = readLen(spec, 'lambda', env, diag, { lo: 1e-8, hi: 1e-4, eg: '600 nm', need: 'lambda is the wavelength, like "600 nm"' })
  const D = readLen(spec, 'D', env, diag, { lo: 1e-2, hi: 100, eg: '1.0 m', dflt: '1.0 m' })
  let d = null, a = null
  if (!single) d = readLen(spec, 'd', env, diag, { lo: 1e-7, hi: 1e-2, eg: '0.10 mm', need: 'd is the slit separation, like "0.10 mm" (a grating: "1/600 mm" for 600 lines/mm)' })
  else if (spec.d !== undefined) diag.warn('d', 'a single slit (N = 1) has no separation; its width is a, and d is ignored')
  if (single || spec.a !== undefined) a = readLen(spec, 'a', env, diag, { lo: 1e-7, hi: 1e-2, eg: '0.050 mm', need: 'a is the slit width, like "0.050 mm"' })
  if (!single && a && a >= d) throw new SpecError('a', `the slit width a = ${showLen(a)} must be smaller than the separation d = ${showLen(d)}`)
  // w sin θ = mλ: maxima of the slits (w = d), or minima of a single slit (w = a).
  const w = single ? a : d, wn = single ? 'a' : 'd'
  const ratio = w / lambda
  if (!(ratio > 1)) throw new SpecError(wn, `${wn} = ${showLen(w)} is no larger than λ = ${showLen(lambda)}, so no ${single ? 'minimum' : 'order past m = 0'} forms; ${wn} must be larger than λ`)
  const mmax = Math.floor(ratio + 1e-9)
  const top = mmax * lambda < w * (1 - 1e-12) ? mmax : mmax - 1 // the highest order with sin θ < 1
  const orders = int(spec.orders, 'orders', 1, 6, 3, 'orders is how many orders to mark each side, 1 to 6 (default 3)')
  const show = int(spec.show, 'show', -1e6, 1e6, 1, 'show is the order whose rays are drawn, a whole number like 1 or −2')
  if (single && show === 0) throw new SpecError('show', 'a single slit marks minima, m = ±1, ±2, …; show must not be 0')
  if (Math.abs(show) > top) throw new SpecError('show', `order ${show} would need |sin θ| = ${sig(Math.abs(show) / ratio, 3)} > 1; this pattern has orders up to ±${top}`)
  const K = Math.min(Math.max(orders, Math.abs(show)), top)
  const th = (m) => asinD((m * lambda) / w) // signed, degrees
  const yAt = (m) => D * tanD(th(m))
  const ySmall = (m) => (m * lambda * D) / w

  // Missing orders: a maximum d sin θ = mλ that falls on an envelope zero a sin θ = kλ, which
  // happens every q·d/a orders when that's whole for some q ≤ 4 (d/a = 4: 4, 8, …; 2.5: 5, 10, …).
  const missing = []
  if (!single && a) {
    const q = [1, 2, 3, 4].find((k) => Math.abs((k * d) / a - Math.round((k * d) / a)) < 1e-6)
    const step = q ? Math.round((q * d) / a) : 0
    for (let m = step; step && m <= Math.min(top, 1e5); m += step) missing.push(m)
  }
  const isMissing = (m) => missing.includes(Math.abs(m))

  // Layout: the outermost marked order sits Y px from the center. The screen is to scale with
  // the y marks where it can be (large angles), else 110 px away (θ drawn larger). Past about
  // 54° the screen stops at 64 px and θ is drawn smaller.
  const Y = 88, yOut = yAt(K)
  const L = Math.max(64, Math.min(110, (Y * D) / yOut))
  const s = Y / yOut
  const H = Y + 14 // half the screen's (and barrier's) height
  const P = [L, f2(-s * yAt(show))]
  const fs = theme.size, small = theme.size - 1
  const wc = waveColor(lambda)
  const labels = []

  // Incoming plane wavefronts.
  const Hw = Math.min(46, H - 10)
  for (const x of [-18, -28, -38]) seg(cv, [x, -Hw], [x, Hw], wc, { width: 1.4, layer: 'back', tag: 'wave' })
  labels.push({ label: spec.values === false ? '\\lambda' : `\\lambda = ${showLen(lambda)}`, size: small, fill: theme.muted, cands: [[-28, -Hw - 11], [-28, Hw + 11], [-40, -Hw - 11]] })

  // The barrier and its slits (spacing exaggerated); a single slit's rays start at its edges.
  const nDraw = single ? 2 : Math.min(N, 5)
  const gap = single ? 30 : N === 2 ? 34 : 12
  const src = Array.from({ length: nDraw }, (_, k) => [0, (k - (nDraw - 1) / 2) * gap])
  const half = single ? gap / 2 : 2.5
  const openings = single ? [[-half, half]] : src.map((p) => [p[1] - half, p[1] + half])
  let yPrev = -H
  for (const [o0, o1] of [...openings, [H, H]]) {
    if (o0 - yPrev > 0.5) {
      cv.mid.push(el('line', { x1: 0, y1: f2(yPrev), x2: 0, y2: f2(o0), stroke: theme.fg, 'stroke-width': 3 }))
      cv.trace([[0, yPrev], [0, o0]], 'barrier')
    }
    yPrev = o1
  }
  // The path difference is drawn at the pair of slits farthest from P, clear of the other rays.
  const pair = single || nDraw === 2 ? [0, 1] : show > 0 ? [nDraw - 2, nDraw - 1] : show < 0 ? [0, 1] : [1, 2]
  if (N > 5) {
    // A gap mark (more slits than drawn), at the other end from that pair.
    const g = pair[0] === 0 ? 3 : 0
    const y = (src[g][1] + src[g + 1][1]) / 2
    for (const dy of [-3.5, 0, 3.5]) cv.front.push(el('circle', { cx: -6, cy: f2(y + dy), r: 1.1, fill: theme.fg }))
    cv.trace([[-6, y - 4], [-6, y + 4]], 'gap')
  }

  // The dashed centerline, the rays to P, and θ.
  seg(cv, [0, 0], [L, 0], theme.muted, { width: 1, dashed: true, dash: '4 3', layer: 'back', tag: 'normal', weight: 0.5 })
  for (const p of src) {
    seg(cv, p, P, RAY.main)
    chevron(cv, p, P, RAY.main, { at: 0.4 })
  }
  cv.front.push(el('circle', { cx: P[0], cy: P[1], r: 2.6, fill: RAY.main }))
  const thd = Math.atan2(-P[1], L) * R2D // the drawn angle
  if (show !== 0) {
    const O = [0, 0]
    if (!src.some((p) => Math.abs(p[1]) < 0.5)) seg(cv, O, P, theme.muted, { width: 1, dashed: true, dash: '3 3', layer: 'back', tag: 'mid', weight: 0.5 })
    const r = Math.max(30, Math.min(70, L * 0.62))
    const cands = angleArc(cv, O, r, 0, thd, theme.fg)
    const sgn = Math.sign(thd)
    for (const ang of [-9, -18]) {
      const u = [Math.cos((ang * sgn) / R2D), -Math.sin((ang * sgn) / R2D)]
      cands.push((wd, ht) => V.add(O, V.mul(u, r + 4 + extent(u, wd, ht))))
    }
    labels.push({ label: `\\theta_{${Math.abs(show)}}`, size: fs, fill: theme.fg, cands })

    // The path difference: from the nearer source, a perpendicular onto the farther one's ray
    // cuts off the extra length w sin θ.
    const [A, B] = pair.map((k) => src[k])
    const [near, far] = V.len(V.sub(P, A)) < V.len(V.sub(P, B)) ? [A, B] : [B, A]
    const F = V.add(P, V.mul(V.unit(V.sub(far, P)), V.len(V.sub(P, near))))
    seg(cv, near, F, theme.muted, { width: 1, dashed: true, dash: '2 2', layer: 'back', tag: 'constr', weight: 0.5 })
    seg(cv, far, F, RAY.second, { width: 3.2, layer: 'front', tag: 'extra' })
    const u1 = V.unit(V.sub(near, F)), u2 = V.unit(V.sub(far, F)), k = 3.5
    const c = V.add(F, V.add(V.mul(u1, k), V.mul(u2, k)))
    cv.mid.push(el('path', { d: `M${f2(F[0] + u1[0] * k)} ${f2(F[1] + u1[1] * k)}L${f2(c[0])} ${f2(c[1])}L${f2(F[0] + u2[0] * k)} ${f2(F[1] + u2[1] * k)}`, fill: 'none', stroke: theme.muted, 'stroke-width': 0.9 }))
    // Beside the highlight, right of the barrier and away from the rays.
    const sy = Math.sign(far[1] - near[1])
    labels.push({ label: `${wn}\\sin\\theta`, size: small, fill: RAY.second, cands: [
      ...[5, 14, 24].map((dy) => (wd, ht) => [5 + wd / 2, far[1] + sy * (ht / 2 + dy)]),
      ...ringCands(V.mid(far, F), 8, [0.6, 0.8 * sy]),
    ] })
  }
  // The spacing (or width) at the slits.
  const [pA, pB] = pair.map((k) => src[k])
  labels.push({ label: wn, size: small, fill: theme.fg, cands: [[-9, (pA[1] + pB[1]) / 2], [-9, pA[1] - 10], [-9, pB[1] + 10]].map((q) => (wd) => [q[0] - wd / 2 + 4, q[1]]) })

  // The screen with the fringes marked: maxima with their orders, or a single slit's minima.
  cv.mid.push(el('line', { x1: L, y1: -H, x2: L, y2: H, stroke: theme.fg, 'stroke-width': 2 }))
  cv.trace([[L, -H], [L, H]], 'screen')
  const marks = []
  for (let m = -K; m <= K; m++) if (!(single && m === 0)) marks.push(m)
  const ypx = (m) => -s * yAt(m)
  for (const m of marks) {
    const y = f2(ypx(m)), gone = isMissing(m)
    cv.mid.push(el('line', { x1: L - 6, y1: y, x2: L, y2: y, stroke: gone ? theme.faint : theme.fg, 'stroke-width': 1.2, 'stroke-dasharray': gone ? '2 1.5' : undefined }))
    cv.trace([[L - 6, y], [L, y]], 'tick')
  }
  // Order numbers in a column right of the intensity curve, level with their marks: the shown
  // order first, then outward from the center, each kept only where it clears the ones before.
  const named = []
  for (const m of [show, 0, ...[...marks].sort((p, q) => Math.abs(p) - Math.abs(q) || q - p)]) {
    if (marks.includes(m) && !named.includes(m) && named.every((k) => Math.abs(ypx(k) - ypx(m)) >= 17)) named.push(m)
  }

  // The intensity: a strip of bands on the screen, and I(y) to the right with I horizontal.
  const Iat = (yp) => intensity(Math.sin(Math.atan(-yp / s / D)), { N, d, a, lambda })
  const x0 = L + 3, x1 = L + 13
  const rows = []
  for (let yp = -H; yp < H; yp += 1.5) {
    const I = (Iat(yp + 0.25) + Iat(yp + 0.75) + Iat(yp + 1.25)) / 3
    const op = Math.round(I * 0.9 * 20) / 20
    const last = rows[rows.length - 1]
    if (last && last.op === op) last.y1 = yp + 1.5
    else rows.push({ y0: yp, y1: yp + 1.5, op })
  }
  for (const r of rows) if (r.op > 0) cv.back.push(el('rect', { x: x0, y: f2(r.y0), width: x1 - x0, height: f2(r.y1 - r.y0 + 0.02), fill: wc, 'fill-opacity': r.op }))
  cv.back.push(el('rect', { x: x0, y: -H, width: x1 - x0, height: 2 * H, fill: 'none', stroke: theme.faint, 'stroke-width': 0.8 }))
  cv.trace([[x0, -H], [x0, H]], 'strip'); cv.trace([[x1, -H], [x1, H]], 'strip')
  const xc = L + 22, Wc = 50
  const ys = []
  for (let yp = -H; yp <= H; yp += 0.5) ys.push(yp)
  for (let m = -K; m <= K; m++) ys.push(-s * yAt(m))
  ys.sort((p, q) => p - q)
  const curve = ys.map((yp) => [xc + Wc * Iat(yp), yp])
  cv.back.push(el('line', { x1: xc, y1: -H, x2: xc, y2: H, stroke: theme.faint, 'stroke-width': 1 }))
  cv.trace([[xc, -H], [xc, H]], 'axis', 0.3)
  if (!single && a) {
    const env = ys.map((yp) => [xc + Wc * envelope(Math.sin(Math.atan(-yp / s / D)), a, lambda), yp])
    cv.mid.push(el('path', { d: 'M' + env.map((p) => `${f2(p[0])} ${f2(p[1])}`).join('L'), fill: 'none', stroke: theme.muted, 'stroke-width': 1, 'stroke-dasharray': '3 2' }))
    cv.trace(env, 'env', 0.4)
  }
  cv.mid.push(el('path', { d: 'M' + curve.map((p) => `${f2(p[0])} ${f2(p[1])}`).join('L'), fill: 'none', stroke: theme.fg, 'stroke-width': 1.4, 'stroke-linejoin': 'round' }))
  cv.trace(curve, 'curve')
  for (const m of named) {
    labels.push({ label: sig(m, 1), size: small, fill: isMissing(m) ? theme.faint : theme.muted, cands: [0, -3, 3].map((dy) => (wd) => [xc + Wc + 8 + wd / 2, ypx(m) + dy]) })
  }
  arrow(cv, [xc, -H - 9], [xc + Wc + 8, -H - 9], theme.muted, { width: 1, head: 6, tag: 'axis', layer: 'back' })
  labels.push({ label: 'I', size: small, fill: theme.muted, cands: [(wd) => [xc + Wc + 14 + wd / 2, -H - 9], (wd) => [xc + Wc + 4, -H - 18]] })

  // D, slits to screen.
  const yD = H + 12
  for (const [p, q] of [[[L / 2, yD], [0, yD]], [[L / 2, yD], [L, yD]]]) arrow(cv, p, q, theme.muted, { width: 1, head: 6, tag: 'dim', layer: 'back' })
  labels.push({ label: spec.values === false ? 'D' : `D = ${showLen(D)}`, size: small, fill: theme.muted, cands: [[L / 2, yD + 11], [L / 2, yD - 10]] })

  const placed = placeLabels(labels, cv)
  drawLabels(placed, cv, theme)
  const crowded = placed.filter((q) => q.hard > 0).map((q) => q.label)
  if (crowded.length) diag.note('', `crowded: ${crowded.join(', ')} sit on backing boxes`)

  // Facts and checkable values.
  const ms = Array.from({ length: Math.min(K, Math.max(3, Math.abs(show))) }, (_, i) => i + 1).filter((m) => m <= top)
  const kind = single ? 'single slit' : N === 2 ? 'double slit' : `grating N = ${N}`
  const facts = [`${kind}: ${single ? `a = ${L4(a)}` : `d = ${L4(d)}${N > 2 ? ` (${sig(1e-3 / d, 4)} lines/mm)` : ''}${a ? `, a = ${L4(a)}` : ''}`}, λ = ${L4(lambda)}, D = ${L4(D)}`]
  facts.push(`${single ? 'minima a sin θ = mλ' : 'maxima d sin θ = mλ'}: ${ms.map((m) => `θ_${m} = ${D4(th(m))}`).join(', ')}`)
  facts.push(`y = D tan θ: ${ms.map((m) => `y_${m} = ${L4(yAt(m))}${differ(yAt(m), ySmall(m)) ? ` (small-angle mλD/${wn} = ${L4(ySmall(m))})` : ''}`).join(', ')}`)
  const dy = single ? null : (lambda * D) / d
  const w0 = single ? 2 * yAt(1) : null
  if (single) facts.push(`central maximum width 2y_1 = ${L4(w0)}`)
  else facts.push(`Δy = λD/d = ${L4(dy)}`)
  facts.push(`m_max = floor(${wn}/λ) = ${mmax}${single ? ' (minima)' : ''}`)
  if (!single && a) facts.push(missing.length ? `missing orders (d/a = ${sig(d / a, 4)}): m = ${list(missing, String)}` : `no missing orders (d/a = ${sig(d / a, 4)})`)
  if (N > NCAP) facts.push(`intensity drawn for N = ${NCAP} slits (the peaks narrow further with N = ${N})`)
  if (Math.abs(show) && isMissing(show)) facts.push(`order ${show} is missing: the rays drawn to it arrive at an envelope zero`)
  const notTo = Math.abs(show) && Math.abs(Math.abs(thd) - Math.abs(th(show))) > Math.max(0.5, 0.05 * Math.abs(th(show)))
  facts.push(`drawing: ${single ? 'slit width' : 'slit spacing'} not to scale${notTo ? `; θ_${Math.abs(show)} drawn at ${deg(Math.abs(thd), 3)}` : ''}; screen marks at true y`)

  const vals = {}
  const angleVal = (m, label, alts) => ({ v: th(m), kind: 'angle', label, show: D4, alts })
  const lenVal = (v, label, alts) => ({ v, kind: 'len', base: 'm', label, show: L4, alts })
  const asinOk = (x) => (Math.abs(x) < 1 ? [asinD(x)] : [])
  for (const m of [1, 2, 3].filter((m) => m <= top)) {
    const alts = []
    const sa = ((m * lambda) / w) * R2D
    if (differ(sa, th(m))) alts.push({ v: sa, why: `uses the small-angle θ ≈ mλ/${wn}; θ = sin⁻¹(mλ/${wn})` })
    if (single) for (const v of asinOk(((m + 0.5) * lambda) / a)) alts.push({ v, why: `is near a secondary maximum, a sin θ ≈ (m + ½)λ; θ_${m} is the m-th minimum, a sin θ = mλ` })
    else {
      for (const h of [0.5, -0.5]) for (const v of asinOk(((m + h) * lambda) / d)) alts.push({ v, why: `is a dark fringe, d sin θ = (m + ½)λ; θ_${m} is the m-th bright one, d sin θ = mλ` })
      if (a) for (const v of asinOk((m * lambda) / a)) alts.push({ v, why: 'uses the slit width a in place of the separation d' })
    }
    vals[`theta${m}`] = angleVal(m, `θ_${m}`, alts)
    const yAlts = []
    if (differ(ySmall(m), yAt(m))) yAlts.push({ v: ySmall(m), why: `is the small-angle mλD/${wn}; at θ_${m} = ${deg(th(m), 4)}, y = D tan θ` })
    const ysin = D * sinD(th(m))
    if (differ(ysin, yAt(m)) && differ(ysin, ySmall(m))) yAlts.push({ v: ysin, why: 'uses D sin θ; y = D tan θ' })
    if (!single) {
      for (const h of [0.5, -0.5]) for (const t of asinOk(((m + h) * lambda) / d)) yAlts.push({ v: D * tanD(t), why: `is a dark fringe's position; y_${m} is the m-th bright fringe` })
      if (a) for (const t of asinOk((m * lambda) / a)) yAlts.push({ v: D * tanD(t), why: 'uses the slit width a in place of the separation d' })
    }
    vals[`y${m}`] = lenVal(yAt(m), `y_${m}`, yAlts)
  }
  if (!single) {
    vals.dy = lenVal(dy, 'Δy', [
      { v: dy / 2, why: 'is half the spacing (a bright fringe to the next dark one)' },
      ...(a ? [{ v: (lambda * D) / a, why: 'uses the slit width a in place of the separation d' }] : []),
      { v: (lambda * d) / D, why: 'has d and D swapped: Δy = λD/d' },
    ])
  } else {
    vals.w0 = lenVal(w0, 'w_0', [
      { v: w0 / 2, why: 'is y_1, the half-width; the central maximum runs from −y_1 to y_1' },
      ...(differ((2 * lambda * D) / a, w0) ? [{ v: (2 * lambda * D) / a, why: 'is the small-angle 2λD/a; w_0 = 2D tan θ_1' }] : []),
    ])
  }
  vals.mmax = { v: mmax, kind: '', label: 'm_max', show: String, alts: [{ v: 2 * mmax + 1, why: `counts every ${single ? 'minimum and the center' : 'maximum'} (2m_max + 1); m_max is the highest order` }, { v: ratio, why: `is ${wn}/λ unrounded; m_max = floor(${wn}/λ)` }] }

  // Caption: Δy where the small-angle spacing holds, else the angles.
  const caption = []
  // values: false leaves the numbers out (a figure to work from).
  if (spec.values === false) { /* no caption */ } else if (single) caption.push(`y_{1} = D\\tan\\theta_{1} = ${showLen(w0 / 2)}, w_{0} = ${showLen(w0)}`)
  else if (!differ(yAt(1), ySmall(1))) caption.push(`\\Delta y = \\lambda D/d = ${showLen(dy)}`)
  else caption.push(ms.slice(0, 3).map((m) => `\\theta_{${m}} = ${deg(th(m), 3)}`).join(', '))
  return { facts, vals, caption }
}

// ---- film -------------------------------------------------------------------------------

function readMedia(spec, env, diag) {
  const m = spec.media
  const eg = 'media is three layers, above, the film, and below: [{"n": 1.00, "label": "air"}, {"n": 1.33, "label": "soap"}, {"n": 1.00, "label": "air"}]'
  if (!Array.isArray(m) || m.length !== 3) throw new SpecError('media', eg)
  return m.map((x, i) => {
    const p = `media[${i}]`
    if (typeof x === 'number' || typeof x === 'string') return { n: index(x, env, p, diag), label: null }
    if (!x || typeof x !== 'object' || x.n === undefined) throw new SpecError(p, `each layer is {"n": 1.33, "label": "soap"}`)
    if (x.label !== undefined && typeof x.label !== 'string') throw new SpecError(`${p}.label`, 'label is a short name, like "glass"')
    return { n: index(x.n, env, `${p}.n`, diag), label: x.label ?? null }
  })
}

const WORDS = ['\\text{no}', 'one', 'two'] // a two-letter word would be set as italic quantities

export function filmMode(spec, ctx, cv) {
  const { theme, diag, env } = ctx
  const media = readMedia(spec, env, diag)
  const [n1, n2, n3] = media.map((m) => m.n)
  const lambda = readLen(spec, 'lambda', env, diag, { lo: 1e-8, hi: 1e-4, eg: '600 nm', need: 'lambda is the vacuum wavelength, like "600 nm"' })
  const t = spec.t === undefined ? null : readLen(spec, 't', env, diag, { lo: 1e-9, hi: 1e-4, eg: '100 nm' })
  const want = spec.want ?? 'bright'
  if (want !== 'bright' && want !== 'dark') throw new SpecError('want', 'want is "bright" (constructive in reflection, the default) or "dark"')
  if (n2 === n1 || n2 === n3) diag.warn('media', `the film's index equals the one ${n2 === n1 ? 'above' : 'below'} it, so that surface doesn't reflect`)

  // A π shift wherever light reflects off a higher index.
  const topShift = n2 > n1, botShift = n3 > n2
  const shifts = topShift + botShift
  const ln = lambda / n2
  // The condition with (m + ½): bright for an odd count, dark for an even one.
  const halfFor = (wnt) => (shifts % 2 === 1) === (wnt === 'bright')
  const tOf = (m, h) => ((h ? m + 0.5 : m) * ln) / 2
  const minOf = (wnt) => (halfFor(wnt) ? tOf(0, true) : tOf(1, false))
  const h = halfFor(want)
  const ts = [0, 1, 2, 3].map((m) => tOf(m, h))
  const tmin = minOf(want)
  const other = want === 'bright' ? 'dark' : 'bright'
  const cond = (wnt) => (halfFor(wnt) ? '2t = (m + ½)λ_n' : '2t = mλ_n')
  // As t = …: label.js sets a letter after a digit upright, as a unit ("2t" would read 2 t).
  // "1/2", not "½": label.js measures ½ narrower than Anthropic Sans sets it.
  const condTex = (wnt) => (halfFor(wnt) ? 't = (m + 1/2)\\lambda_{n}/2' : 't = m\\lambda_{n}/2')

  // Drawing: three bands, the film exaggerated; the rays at a small angle for clarity.
  const X = 270, yT = 0, yB = 40, up = -82, down = 74
  const names = media.map((m) => m.label)
  medium(cv, [[0, up], [X, up], [X, yT], [0, yT]], n1)
  medium(cv, [[0, yT], [X, yT], [X, yB], [0, yB]], n2)
  medium(cv, [[0, yB], [X, yB], [X, down], [0, down]], n3)
  for (const y of [yT, yB]) {
    cv.mid.push(el('line', { x1: 0, y1: y, x2: X, y2: y, stroke: theme.muted, 'stroke-width': 1.2 }))
    cv.trace([[0, y], [X, y]], 'surface', 0.8)
  }
  const ti = 24 / R2D, tf = Math.asin(Math.min(1, (n1 * Math.sin(ti)) / n2))
  const A = [96, yT], len = 80
  const inc = V.add(A, [-len * Math.sin(ti), -len * Math.cos(ti)])
  const outDir = [Math.sin(ti), -Math.cos(ti)]
  const r1 = V.add(A, V.mul(outDir, len))
  const B = [A[0] + (yB - yT) * Math.tan(tf), yB], C = [A[0] + 2 * (yB - yT) * Math.tan(tf), yT]
  const r2 = V.add(C, V.mul(outDir, len))
  const c1 = RAY.main, c2 = RAY.second
  seg(cv, inc, A, c1); chevron(cv, inc, A, c1)
  seg(cv, A, r1, c1); chevron(cv, A, r1, c1, { at: 0.55 })
  seg(cv, A, B, c2); seg(cv, B, C, c2); seg(cv, C, r2, c2); chevron(cv, C, r2, c2, { at: 0.55 })
  const small = theme.size - 1
  const labels = []
  for (const [tip, from, lab, fill] of [[r1, A, '1', c1], [r2, C, '2', c2]]) {
    const u = V.unit(V.sub(tip, from))
    labels.push({ label: lab, size: theme.size, fill, cands: [(wd, ht) => V.add(tip, V.mul(u, 5 + extent(u, wd, ht))), (wd, ht) => V.add(tip, [-5 - wd / 2, 2]), (wd, ht) => V.add(tip, [5 + wd / 2, 2])] })
  }
  // Phase shift at each reflection.
  const shiftText = (on) => (on ? '\\pi' : '\\text{no shift}')
  labels.push({ label: shiftText(topShift), size: small, fill: theme.fg, cands: [(wd) => [A[0] - 12 - wd / 2, yT - 12], (wd) => [A[0] - 20 - wd / 2, yT - 12], (wd) => [A[0] - 12 - wd / 2, yT - 24]] })
  labels.push({ label: shiftText(botShift), size: small, fill: theme.fg, cands: [(wd) => [B[0], yB + 12], (wd) => [B[0] - 10 - wd / 2, yB + 12], (wd) => [B[0] + 10 + wd / 2, yB + 12], (wd) => [B[0] - 8 - wd / 2, yB - 12]] })
  // Each medium's n.
  const mText = (i) => `${names[i] ? `${names[i]}, ` : ''}n = ${sig(media[i].n, 3)}`
  for (const [i, y] of [[0, (up + yT) / 2], [1, (yT + yB) / 2], [2, (yB + down) / 2]]) {
    const dys = i === 1 ? [0] : [0, -16, 16]
    labels.push({ label: mText(i), size: small, fill: theme.muted, cands: [...dys.map((dy) => (wd) => [X - 8 - wd / 2, y + dy]), ...dys.map((dy) => (wd) => [8 + wd / 2, y + dy])] })
  }
  // The thickness.
  const xt = 12
  arrow(cv, [xt, (yT + yB) / 2], [xt, yT], theme.fg, { width: 1, head: 6, tag: 'dim', layer: 'mid' })
  arrow(cv, [xt, (yT + yB) / 2], [xt, yB], theme.fg, { width: 1, head: 6, tag: 'dim', layer: 'mid' })
  labels.push({ label: t ? `t = ${showLen(t)}` : 't', size: small, fill: theme.fg, cands: [(wd) => [xt + 5 + wd / 2, (yT + yB) / 2], (wd) => [xt + 5 + wd / 2, (yT + yB) / 2 + 8]] })
  const placed = placeLabels(labels, cv)
  drawLabels(placed, cv, theme)
  const crowded = placed.filter((q) => q.hard > 0).map((q) => q.label)
  if (crowded.length) diag.note('', `crowded: ${crowded.join(', ')} sit on backing boxes`)

  // Facts.
  const nm = (i) => `${names[i] ? `${names[i]} ` : ''}${sig(media[i].n, 4)}`
  const facts = [`media (above, film, below): ${[0, 1, 2].map(nm).join(' | ')}; λ = ${L4(lambda)}`]
  const sh = (on, a, b) => (on ? `π shift (${sig(b, 4)} > ${sig(a, 4)})` : `no shift (${sig(b, 4)} ${b === a ? '=' : '<'} ${sig(a, 4)})`)
  facts.push(`top reflection ${sh(topShift, n1, n2)}, bottom ${sh(botShift, n2, n3)}: ${shifts} shift${shifts === 1 ? '' : 's'}`)
  facts.push(`λ_n = λ/n = ${L4(ln)}`)
  facts.push(`near-normal incidence: extra path 2t`)
  facts.push(`${want} in reflection: ${cond(want)}, t = ${h ? '(2m + 1)λ_n/4' : 'mλ_n/2'}; m = 0 to 3: ${ts.map((x) => (x ? L4(x) : '0')).join(', ')}`)
  facts.push(`t_min = ${L4(tmin)} (m = ${h ? 0 : 1}${h ? '' : `; t → 0 is also ${want}, the m = 0 limit`})`)
  facts.push(`${other}: ${cond(other)}, t_min = ${L4(minOf(other))}`)
  if (t) {
    const cyc = (2 * t) / ln + shifts / 2
    let f = ((cyc % 1) + 1) % 1
    if (1 - f < 5e-4) f = 0 // shows as 0, not 2.00π
    const near = Math.min(f, 1 - f), state = near < 0.05 ? 'bright' : Math.abs(f - 0.5) < 0.05 ? 'dark' : `in between (nearer ${near < 0.25 ? 'bright' : 'dark'})`
    facts.push(`at t = ${L4(t)}: phase difference 2π(2t/λ_n)${shifts ? ` + ${shifts === 1 ? 'π' : '2π'}` : ''} = ${sig(2 * cyc, 4)}π ≡ ${f < 5e-4 ? '0' : `${sig(2 * f, 3)}π`} (mod 2π): ${showLen(lambda)} is ${state} in reflection`)
    const odd = shifts % 2 === 1
    const vis = []
    for (let m = odd ? 0 : 1; m < 1000; m++) {
      const lv = (2 * n2 * t) / (m + (odd ? 0.5 : 0))
      if (lv < 380e-9) break
      if (lv <= 750e-9) vis.push(lv)
    }
    facts.push(`strongly reflected visible λ (380 to 750 nm): ${vis.length ? vis.map(L4).join(', ') : 'none'}`)
  }

  const show = (x) => L4(x)
  const alts = [{ v: minOf(other), why: `is the ${other} thickness; want is ${want}` }]
  for (let m = h ? 1 : 2; m <= 3; m++) alts.push({ v: tOf(m, h), why: `is the m = ${m} thickness, not the minimum` })
  alts.push({ v: tmin * n2, why: 'uses λ in vacuum; λ_n = λ/n in the film' })
  if (n3 !== n2) alts.push({ v: (tmin * n2) / n3, why: "uses the index below the film; λ_n = λ/n with the film's n" })
  const vals = {
    t: { v: tmin, kind: 'len', base: 'm', label: 't_min', show, alts },
    lambdan: { v: ln, kind: 'len', base: 'm', label: 'λ_n', show, alts: [{ v: lambda * n2, why: 'multiplies by n; λ_n = λ/n' }, { v: lambda, why: 'is λ in vacuum; λ_n = λ/n in the film' }] },
  }
  const caption = [`${WORDS[shifts]} \\pi{} shift${shifts === 1 ? '' : 's'}: ${want} when ${condTex(want)}`]
  if (spec.values !== false) caption.push(`\\lambda_{n} = ${showLen(ln)}, t_{min} = ${showLen(tmin)}`)
  return { facts, vals, caption }
}
