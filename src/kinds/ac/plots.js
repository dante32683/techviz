// Frequency plots: Bode (|H| in dB and phase against log f, the exact curve over its dashed
// straight-line asymptotes, corners, −3 dB points, and slopes) and resonance (I or |Z| against
// f with f0, the half-power points, the bandwidth, and Q, one curve per swept value).

import { el, pathD } from '../../svg.js'
import { labelSvg, measure } from '../../label.js'
import { color } from '../../theme.js'
import { ticks, clipPolyline } from '../../geom.js'
import { V } from '../fbd/draw.js'
import { placeLabels, drawLabels } from '../fbd/place.js'
import { show, sig } from './units.js'
import { asymMag, asymPhase, breaks, sweep, minus3 } from './transfer.js'
import { arg, abs } from './complex.js'

const TAU = 2 * Math.PI

/** 1k, 10k, 2.5M: a compact tick label. */
export function short(v) {
  const a = Math.abs(v)
  for (const [s, p] of [[1e9, 'G'], [1e6, 'M'], [1e3, 'k']]) if (a >= s) return `${+(v / s).toPrecision(3)}${p}`
  if (a && a < 1) for (const [s, p] of [[1e-3, 'm'], [1e-6, 'μ'], [1e-9, 'n']]) if (a >= s * 0.9995) return `${+(v / s).toPrecision(3)}${p}`
  return String(+v.toPrecision(4)).replace(/^-/, '−')
}

/** A plot frame with grid, ticks, and titles; returns the scales. */
function frame(cv, theme, [L, T, R, B], xs, ys, { xLabels = true, xTitle, yTitle, yFmt = short }) {
  const fs = theme.size
  const X = xs.log ? (f) => L + ((Math.log10(f) - Math.log10(xs.lo)) / (Math.log10(xs.hi) - Math.log10(xs.lo))) * (R - L) : (f) => L + ((f - xs.lo) / (xs.hi - xs.lo)) * (R - L)
  const Y = (v) => B - ((v - ys.lo) / (ys.hi - ys.lo)) * (B - T)
  const g = []
  const grid = (x1, y1, x2, y2, op) => g.push(el('line', { x1, y1, x2, y2, stroke: theme.grid, 'stroke-width': 1, 'stroke-opacity': op }))
  let xt
  if (xs.log) {
    xt = []
    for (let k = Math.floor(Math.log10(xs.lo)); k <= Math.ceil(Math.log10(xs.hi)); k++) {
      for (let m = 1; m < 10; m++) {
        const f = m * 10 ** k
        if (f < xs.lo * 0.999 || f > xs.hi * 1.001) continue
        if (m === 1) xt.push(f)
        else grid(X(f), T, X(f), B, 0.55)
      }
    }
  } else xt = ticks(xs.lo, xs.hi, 5)
  for (const f of xt) {
    grid(X(f), T, X(f), B, 1)
    if (xLabels) cv.front.push(labelSvg(short(f), X(f), B + 15, theme, { size: fs - 1, fill: theme.muted }))
  }
  for (const v of ys.ticks) {
    grid(L, Y(v), R, Y(v), 1)
    cv.front.push(labelSvg(yFmt(v), L - 6, Y(v), theme, { anchor: 'end', size: fs - 1, fill: theme.muted, middle: true }))
  }
  cv.back.push(...g)
  cv.back.push(el('rect', { x: L, y: T, width: R - L, height: B - T, fill: 'none', stroke: theme.muted, 'stroke-width': 1 }))
  cv.trace([[L, T], [R, T], [R, B], [L, B]], 'frame', 1, true)
  const tw = Math.max(...ys.ticks.map((v) => measure(yFmt(v), fs - 1)))
  if (yTitle) cv.front.push(`<g transform="translate(${(L - tw - 16).toFixed(1)},${((T + B) / 2).toFixed(1)}) rotate(-90)">${labelSvg(yTitle, 0, 0, theme, { fill: theme.fg })}</g>`)
  if (xTitle) cv.front.push(labelSvg(xTitle, (L + R) / 2, B + 33, theme, { fill: theme.fg }))
  cv.ext.push([L - tw - 16 - fs, T - 4], [R + 4, B + (xTitle ? 38 : xLabels ? 20 : 4)])
  return { X, Y }
}

const yTicks = (lo, hi, steps) => {
  const st = steps.find((s) => (hi - lo) / s <= 6) ?? steps[steps.length - 1]
  const a = Math.floor(lo / st) * st, b = Math.ceil(hi / st) * st
  const out = []
  for (let v = a; v <= b + 1e-9; v += st) out.push(v)
  return { lo: a, hi: b, ticks: out }
}

const line = (cv, pts, box, attrs, tag) => {
  const [L, T, R, B] = box
  for (const seg of clipPolyline(pts.filter((p) => Number.isFinite(p[1])), [L, R, T, B])) {
    cv.mid.push(el('path', { d: pathD(seg), fill: 'none', 'stroke-linejoin': 'round', ...attrs }))
    if (tag) cv.trace(seg, tag)
  }
}

/**
 * Keeps labels inside the frames: stroke samples with a heavy weight on a 5 px grid around them,
 * outside every box. Returns a function that removes them again.
 */
function fence(cv, boxes) {
  const n = cv.obs.length
  const x0 = Math.min(...boxes.map((b) => b[0])) - 60, x1 = Math.max(...boxes.map((b) => b[2])) + 60
  const y0 = Math.min(...boxes.map((b) => b[1])) - 40, y1 = Math.max(...boxes.map((b) => b[3])) + 40
  for (let x = x0; x <= x1; x += 5) for (let y = y0; y <= y1; y += 5) {
    if (!boxes.some(([L, T, R, B]) => x > L + 1 && x < R - 1 && y > T + 1 && y < B - 1)) cv.obs.push([x, y, 4, 'fence'])
  }
  return () => cv.obs.splice(n)
}

/** Spots beside a screen polyline at fractions `ts` of its length, offset across its local direction. */
function besideCurve(pts, ts) {
  const ok = pts.filter((p) => Number.isFinite(p[1]))
  return ts.flatMap((t) => {
    const i = Math.round(t * (ok.length - 1)), p = ok[i]
    const a = ok[Math.max(0, i - 8)], b = ok[Math.min(ok.length - 1, i + 8)]
    let n = V.unit(V.perp(V.sub(b, a)))
    if (n[1] > 0) n = V.mul(n, -1)
    return [1, -1].map((s) => (w, h) => V.add(p, V.mul(n, s * (6 + Math.abs(n[0]) * w / 2 + Math.abs(n[1]) * h / 2))))
  })
}

/** A legend (line sample and label per curve) in the corner of `box` with the fewest strokes. */
function legend(cv, theme, list, [L, T, R, B], top = false) {
  const fs = theme.size - 1, row = fs + 5
  const w = 26 + Math.max(...list.map((t) => measure(t.label, fs))), h = row * list.length + 4
  const low = [[L + 6, B - 6 - h], [R - 6 - w, B - 6 - h]], high = [[R - 6 - w, T + 6], [L + 6, T + 6]]
  const spots = top ? [...high, ...low] : [...low, ...high]
  const hits = (x, y) => cv.obs.filter(([px, py]) => px > x - 3 && px < x + w + 3 && py > y - 3 && py < y + h + 3).reduce((s, o) => s + o[2], 0)
  const [x, y] = spots.reduce((best, s) => (hits(...s) < hits(...best) ? s : best))
  cv.front.push(el('rect', { x, y, width: w, height: h, rx: 3, fill: theme.halo, 'fill-opacity': 0.85, stroke: theme.grid }))
  list.forEach((t, k) => {
    const cy = y + 2 + row * k + row / 2
    cv.front.push(el('line', { x1: x + 5, y1: cy, x2: x + 20, y2: cy, stroke: t.color, 'stroke-width': 2.4 }))
    cv.front.push(labelSvg(t.label, x + 25, cy, theme, { anchor: 'start', size: fs, fill: theme.fg, middle: true }))
  })
  for (let px = x; px <= x + w; px += 4) for (let py = y; py <= y + h; py += 4) cv.obs.push([px, py, 5, 'legend'])
}

/** Candidate centers around a point that keep a w × h box inside `box`. */
const around = (p, box, offs) => (w, h) => {
  for (const [dx, dy] of offs) {
    const c = [p[0] + dx * (w / 2 + 5), p[1] + dy * (h / 2 + 5)]
    if (c[0] - w / 2 >= box[0] + 2 && c[0] + w / 2 <= box[2] - 2 && c[1] - h / 2 >= box[1] + 2 && c[1] + h / 2 <= box[3] - 2) return c
  }
  return [p[0], p[1]]
}
const inside = (p, box, offs) => offs.map((o) => around(p, box, [o]))

/**
 * Bode plot of the transfer functions `tfs` ([{tf, label, color}]); asymptotes and marks for the first.
 * Returns facts for the summary and the vals expect reads.
 */
export function drawBode(cv, theme, tfs, { range, phase = true }) {
  const fs = theme.size
  const tf0 = tfs[0].tf
  const corners = tf0.fac.map((F) => F.w / TAU)
  let [lo, hi] = range ?? []
  if (!range) {
    const cs = corners.length ? corners : [1000]
    lo = 10 ** Math.floor(Math.log10(Math.min(...cs)) - 1.5)
    hi = 10 ** Math.ceil(Math.log10(Math.max(...cs)) + 1.5)
  }
  const data = tfs.map((t) => sweep(t.tf, lo, hi))
  const asym = breaks(tf0, lo, hi, false).map((f) => [f, asymMag(tf0, f)])
  const asymP = breaks(tf0, lo, hi, true).map((f) => [f, asymPhase(tf0, f)])
  const dbs = data.flat().map((p) => p.db).filter(Number.isFinite)
  const top = Math.max(...dbs, ...asym.map((p) => p[1]))
  const bottom = Math.max(Math.min(...dbs, ...asym.map((p) => p[1])), top - 80)
  const my = yTicks(bottom - 3, top + 3, [10, 20, 40])
  const phs = data.flat().map((p) => p.ph)
  const py = yTicks(Math.min(...phs, ...asymP.map((p) => p[1])), Math.max(...phs, ...asymP.map((p) => p[1])), [45, 90])
  if (py.hi - py.lo < 90) { py.lo -= 45; py.hi += 45; py.ticks = [py.lo, ...py.ticks, py.hi] }

  const L = 0, R = 250, mag = [L, 0, R, 136], ph = [L, 152, R, 152 + 100]
  const xs = { lo, hi, log: true }
  const M = frame(cv, theme, mag, xs, my, { xLabels: !phase, xTitle: phase ? null : 'f (\\text{Hz})', yTitle: '|H| (\\text{dB})' })
  const A = phase ? frame(cv, theme, ph, xs, py, { xTitle: 'f (\\text{Hz})', yTitle: '\\angle H', yFmt: (v) => `${short(v)}°` }) : null
  const items = []

  // Corners: dotted lines through both panels, each labeled at the top.
  const visible = tf0.fac.filter((F) => F.w / TAU > lo && F.w / TAU < hi)
  const uniq = visible.filter((F, k) => !visible.slice(0, k).some((G) => Math.abs(G.w / F.w - 1) < 1e-3))
  for (const F of uniq) {
    const f = F.w / TAU, x = M.X(f)
    cv.back.push(el('line', { x1: x, y1: mag[1], x2: x, y2: phase ? ph[3] : mag[3], stroke: theme.muted, 'stroke-width': 1, 'stroke-dasharray': '2 3' }))
    cv.trace([[x, mag[1]], [x, mag[3]]], 'corner', 0.4)
    const name = uniq.length === 1 ? (F.pair ? 'f_{0} = ' : 'f_{c} = ') : ''
    items.push({ label: `${name}${show(f, 'Hz')}`, size: fs - 1, fill: theme.fg, cands: [
      ...inside([x, mag[1]], mag, [[1, 1], [-1, 1], [1, 2.4], [-1, 2.4], [1, 4], [-1, 4]]),
      ...inside([x, mag[3]], mag, [[1, -1], [-1, -1], [1, -2.4], [-1, -2.4]])] })
  }
  const curveLabels = []

  // Asymptotes (first curve), then the exact curves over them.
  const dash = { stroke: theme.muted, 'stroke-width': 1.5, 'stroke-dasharray': '6 4' }
  line(cv, asym.map(([f, v]) => [M.X(f), M.Y(v)]), mag, dash, 'asym')
  if (A) line(cv, asymP.map(([f, v]) => [A.X(f), A.Y(v)]), ph, dash, 'asym')
  data.forEach((pts, k) => {
    const c = tfs[k].color
    line(cv, pts.map((p) => [M.X(p.f), M.Y(p.db)]), mag, { stroke: c, 'stroke-width': 2.2 }, `f:m${k}`)
    if (A) line(cv, pts.map((p) => [A.X(p.f), A.Y(p.ph)]), ph, { stroke: c, 'stroke-width': 2.2 }, `f:p${k}`)
  })
  // Swept curves run close together, so they get a legend in the emptiest corner of |H|.
  if (tfs.length > 1) legend(cv, theme, tfs, mag)

  // Slopes on the asymptote segments long enough to label.
  for (let k = 1; k < asym.length; k++) {
    const [f1, v1] = asym[k - 1], [f2, v2] = asym[k]
    const slope = (v2 - v1) / Math.log10(f2 / f1)
    const a = [M.X(f1), M.Y(v1)], b = [M.X(f2), M.Y(v2)]
    if (Math.abs(slope) < 1 || V.len(V.sub(b, a)) < 50) continue
    const mid = V.mid(a, b)
    if (mid[1] < mag[1] + 8 || mid[1] > mag[3] - 8) continue
    const n = V.unit(V.perp(V.sub(b, a)))
    const s = Math.round(slope / 20) * 20
    items.push({ label: `${s > 0 ? '+' : '−'}${Math.abs(s)} dB/dec`, size: fs - 1, fill: theme.muted, cands: [-1, 1].flatMap((sg) => [0, 0.2, -0.2].map((t) => (w, h) => V.add(V.add(mid, V.mul(V.sub(b, a), t)), V.mul(n, sg * (6 + Math.abs(n[0]) * w / 2 + Math.abs(n[1]) * h / 2))))) })
  }

  // −3 dB points of the first curve: dots, joined when there are two.
  const m3 = minus3(tf0, data[0])
  const c0 = tfs[0].color
  const dots = m3.f.map((f) => [M.X(f), M.Y(m3.lvl)])
  if (dots.length === 2) {
    cv.mid.push(el('line', { x1: dots[0][0], y1: dots[0][1], x2: dots[1][0], y2: dots[1][1], stroke: c0, 'stroke-width': 1.2, 'stroke-dasharray': '4 3' }))
    cv.trace(dots, 'bw', 0.6)
  }
  for (const d of dots) { cv.front.push(el('circle', { cx: d[0], cy: d[1], r: 3.6, fill: c0, stroke: theme.bg ?? 'none', 'stroke-width': 1 })); cv.trace([d], 'dot') }
  if (dots.length === 2) {
    const m = V.mid(dots[0], dots[1]), [a, b] = dots
    items.splice(uniq.length, 0, { label: '−3 dB', size: fs - 1, fill: c0, cands: [
      (w, h) => [m[0], m[1] + h / 2 + 5], (w, h) => [m[0], m[1] - h / 2 - 5], (w) => [b[0] + w / 2 + 8, b[1]], (w) => [a[0] - w / 2 - 8, a[1]],
      (w, h) => [b[0] + w / 2 + 6, b[1] + h], (w, h) => [a[0] - w / 2 - 6, a[1] + h]] })
  } else if (dots.length) items.splice(uniq.length, 0, { label: '−3 dB', size: fs - 1, fill: c0, cands: inside(dots[0], mag, [[1.2, -1], [-1.2, 1], [1.2, 1], [-1.2, -1]]) })
  items.push(...curveLabels)
  // The exact phase at each corner, except where |H| is zero (a zero on the jω axis).
  if (A) for (const F of uniq) {
    // The exact phase there, on the same branch as the drawn curve.
    const f = F.w / TAU, p = data[0].reduce((m, q) => (Math.abs(Math.log(q.f / f)) < Math.abs(Math.log(m.f / f)) ? q : m))
    // An ideal tank's Y is exactly 0 at f0; a hair off it, H is its limit.
    let h = tf0.H(f)
    if (!Number.isFinite(abs(h))) h = tf0.H(f * (1 + 1e-9))
    if (!Number.isFinite(abs(h)) || 20 * Math.log10(abs(h)) < m3.top - 100) continue
    let e = arg(h)
    e += 360 * Math.round((p.ph - e) / 360)
    const d = [A.X(f), A.Y(e)]
    cv.front.push(el('circle', { cx: d[0], cy: d[1], r: 3.2, fill: c0 }))
    cv.trace([d], 'dot')
    items.push({ label: `${sig(Math.abs(e) < 0.005 ? 0 : e, 3)}°`, size: fs - 1, fill: c0, cands: inside(d, ph, [[1.2, -1], [1.2, 1], [-1.2, 1], [-1.2, -1]]) })
  }
  const unfence = fence(cv, A ? [mag, ph] : [mag])
  const placed = placeLabels(items, cv)
  unfence()
  drawLabels(placed, cv, theme)
  return { lo, hi, m3, corners: uniq.map((F) => F.w / TAU), crowded: placed.filter((q) => q.hard) }
}

/** Resonance curves: y(f) for each [{y: f => value, label, color, res}] with f0, half-power points, and Q. */
export function drawResonance(cv, theme, curves, { range, log, yName, unit, f0 }) {
  const fs = theme.size
  const bwMax = Math.max(...curves.map((c) => (Number.isFinite(c.res?.BW) ? c.res.BW : 0)), f0 * 0.1)
  let [lo, hi] = range ?? [Math.max(0, f0 - 3 * bwMax), f0 + 3 * bwMax]
  if (log && !range) { lo = 10 ** Math.floor(Math.log10(f0 / 10)); hi = 10 ** Math.ceil(Math.log10(f0 * 10)) }
  if (!range && !log) { const t = ticks(lo, hi, 5), st = t[1] - t[0]; lo = Math.max(0, Math.floor(lo / st) * st); hi = Math.ceil(hi / st) * st }
  const n = 600
  const fAt = (k) => (log ? lo * (hi / lo) ** (k / n) : lo + ((hi - lo) * k) / n)
  let data = curves.map((c) => Array.from({ length: n + 1 }, (_, k) => { const f = fAt(k); return [f, f > 0 ? c.y(f) : NaN] }))
  let peak = Math.max(...curves.map((c) => c.y(f0)).filter(Number.isFinite), ...data.flat().map((p) => p[1]).filter(Number.isFinite))
  // Ticks in plain numbers: the axis takes an SI prefix (mA, kΩ) instead.
  const [k, pre] = [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'μ']].find(([s]) => peak >= s * 0.95) ?? [1e-6, 'μ']
  data = data.map((pts) => pts.map(([f, v]) => [f, v / k]))
  peak /= k
  const yv = (c, f) => c.y(f) / k
  const yTitle = `${yName} (\\text{${pre}${unit}})`
  const yt = ticks(0, peak * 1.06, 4), yst = yt[1] - yt[0]
  if (yt[yt.length - 1] < peak * 1.04) yt.push(yt[yt.length - 1] + yst)
  const ys = { lo: 0, hi: yt[yt.length - 1], ticks: yt }
  const box = [0, 0, 250, 170]
  const P = frame(cv, theme, box, { lo, hi, log }, ys, { xTitle: 'f (\\text{Hz})', yTitle })
  const items = []
  const x0 = P.X(f0)
  cv.back.push(el('line', { x1: x0, y1: box[1], x2: x0, y2: box[3], stroke: theme.muted, 'stroke-width': 1.1, 'stroke-dasharray': '5 4' }))
  cv.trace([[x0, box[1]], [x0, box[3]]], 'f0', 0.5)
  items.push({ label: `f_{0} = ${show(f0, 'Hz')}`, size: fs - 1, fill: theme.fg, cands: inside([x0, box[1]], box, [[1, 1], [-1, 1], [1, 2.6], [-1, 2.6]]) })
  const screens = data.map((pts) => pts.map(([f, v]) => [P.X(f), P.Y(v)]))
  screens.forEach((pts, j) => line(cv, pts, box, { stroke: curves[j].color, 'stroke-width': 2.2 }, `f:${j}`))
  curves.forEach((c, j) => {
    const r = c.res
    const pk = [x0, P.Y(yv(c, f0))]
    if (r && Number.isFinite(r.BW) && r.f1 > lo && r.f2 < hi) {
      const lvl = c.half / k
      const a = [P.X(r.f1), P.Y(lvl)], b = [P.X(r.f2), P.Y(lvl)]
      cv.mid.push(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: c.color, 'stroke-width': 1.3, 'stroke-dasharray': '4 3' }))
      for (const d of [a, b]) cv.front.push(el('circle', { cx: d[0], cy: d[1], r: 3.4, fill: c.color }))
      cv.trace([a, b], `f:${j}`, 0.6)
      const m = V.mid(a, b)
      items.push({ label: c.bwLabel, size: fs - 1, fill: c.color, own: `f:${j}`, cands: [
        (w, h) => [m[0], m[1] + h / 2 + 5], (w) => [b[0] + w / 2 + 8, b[1]], (w) => [a[0] - w / 2 - 8, a[1]],
        (w, h) => [m[0], m[1] - h / 2 - 5], (w, h) => [b[0] + w / 2 + 8, b[1] + h], (w, h) => [a[0] - w / 2 - 8, a[1] + h]] })
    }
    // One curve: its label beside the peak. Swept curves get a legend instead.
    if (curves.length === 1) items.push({ label: c.label, size: fs - 1, fill: c.color, own: `f:${j}`, cands: [
      (w, h) => [pk[0] + w / 2 + 8, pk[1] + h / 2], (w, h) => [pk[0] - w / 2 - 8, pk[1] + h / 2], (w, h) => [pk[0], pk[1] - h / 2 - 6],
      ...besideCurve(screens[j], [0.62, 0.38, 0.75, 0.25])] })
  })
  if (curves.length > 1) legend(cv, theme, curves, box, true)
  const unfence = fence(cv, [box])
  const placed = placeLabels(items, cv)
  unfence()
  drawLabels(placed, cv, theme)
  return { lo, hi, crowded: placed.filter((q) => q.hard) }
}
