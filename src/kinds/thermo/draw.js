// Drawing helpers shared by the thermo modes: a plot frame (L-shaped axes from the origin, light
// grid, ticks, titles), polylines and filled regions traced for label avoidance, a direction
// arrowhead partway along a curve, compact tables, and a row of color keys. Screen px, y down.

import { el, pathD } from '../../svg.js'
import { labelSvg, measure } from '../../label.js'
import { ticks } from '../../geom.js'
import { V, insidePoly } from '../fbd/draw.js'

/** A compact tick label: 0.5, 12, 1500, −2.5. */
export const tick = (v) => String(+v.toPrecision(4)).replace(/^-/, '−')

/** Axis range and ticks covering [lo, hi] with a little headroom; lo stays at 0 when it's 0. */
export function axisRange(lo, hi, target = 5, pad = 0.1, fromZero = lo === 0) {
  const span = hi - lo || Math.abs(hi) || 1
  const a = fromZero ? lo : lo - span * pad, b = hi + span * pad
  const t = ticks(a, b, target)
  const step = t.length > 1 ? t[1] - t[0] : span
  return { lo: fromZero ? lo : Math.min(a, t[0]), hi: Math.max(b, t[t.length - 1]), ticks: t, step }
}

/**
 * A plot frame `w` × `h` with its top-left at (0, 0): grid, L-shaped axes with arrowheads,
 * tick labels, and titles. Returns the scales X, Y (data to screen) and the box.
 */
export function frame(cv, theme, { w, h, xs, ys, xTitle, yTitle, edge = false }) {
  const fs = theme.size - 1
  const X = (x) => ((x - xs.lo) / (xs.hi - xs.lo)) * w
  const Y = (y) => h - ((y - ys.lo) / (ys.hi - ys.lo)) * h
  const g = []
  const x0 = X(Math.max(xs.lo, Math.min(xs.hi, 0))), y0 = Y(Math.max(ys.lo, Math.min(ys.hi, 0)))
  // Tick labels are traced as boxes so other labels keep off them.
  const box = (x0, y0, x1, y1) => { for (let x = x0; x <= x1; x += 3) for (let y = y0; y <= y1; y += 3) cv.obs.push([x, y, 1, 'tick']) }
  for (const v of xs.ticks) {
    if (X(v) > 0.5) g.push(el('line', { x1: X(v), y1: 0, x2: X(v), y2: h, stroke: theme.grid, 'stroke-width': 1 }))
    cv.front.push(labelSvg(tick(v), X(v), h + 14, theme, { size: fs, fill: theme.muted }))
    const tw = measure(tick(v), fs)
    box(X(v) - tw / 2, h + 4, X(v) + tw / 2, h + 15)
  }
  for (const v of ys.ticks) {
    if (Y(v) < h - 0.5) g.push(el('line', { x1: 0, y1: Y(v), x2: w, y2: Y(v), stroke: theme.grid, 'stroke-width': 1 }))
    cv.front.push(labelSvg(tick(v), -5, Y(v), theme, { anchor: 'end', size: fs, fill: theme.muted, middle: true }))
    box(-5 - measure(tick(v), fs), Y(v) - 5, -5, Y(v) + 5)
  }
  cv.back.push(...g)
  // The axes: through the origin when it's inside the frame, else along the edges.
  const ax = !edge && xs.lo <= 0 && xs.hi >= 0 ? x0 : 0, ay = !edge && ys.lo <= 0 && ys.hi >= 0 ? y0 : h
  const head = (tip, d) => { const n = V.perp(d), b = V.sub(tip, V.mul(d, 7)); return el('path', { d: pathD([tip, V.add(b, V.mul(n, 3)), V.sub(b, V.mul(n, 3))], true), fill: theme.muted }) }
  cv.back.push(el('line', { x1: 0, y1: ay, x2: w + 8, y2: ay, stroke: theme.muted, 'stroke-width': 1.2 }), head([w + 10, ay], [1, 0]))
  cv.back.push(el('line', { x1: ax, y1: h, x2: ax, y2: -8, stroke: theme.muted, 'stroke-width': 1.2 }), head([ax, -10], [0, -1]))
  cv.trace([[0, ay], [w + 10, ay]], 'axis', 1)
  cv.trace([[ax, h], [ax, -10]], 'axis', 1)
  const tw = Math.max(...ys.ticks.map((v) => measure(tick(v), fs)))
  if (yTitle) cv.front.push(`<g transform="translate(${(-tw - 14).toFixed(1)},${(h / 2).toFixed(1)}) rotate(-90)">${labelSvg(yTitle, 0, 0, theme, { fill: theme.fg, size: fs })}</g>`)
  if (xTitle) cv.front.push(labelSvg(xTitle, w / 2, h + 30, theme, { fill: theme.fg, size: fs }))
  cv.ext.push([-tw - 14 - fs, -12], [w + 12, h + (xTitle ? 34 : 18)])
  return { X, Y, w, h, bottom: h + (xTitle ? 34 : 18), left: -tw - 14 - fs }
}

/** A polyline (screen points), traced. */
export function curve(cv, pts, stroke, { width = 2, dash, layer = 'mid', tag = 'curve', weight = 1, opacity } = {}) {
  if (pts.length < 2) return
  cv[layer].push(el('path', { d: pathD(pts.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)])), fill: 'none', stroke, 'stroke-width': width, 'stroke-dasharray': dash, 'stroke-linejoin': 'round', 'stroke-linecap': dash ? undefined : 'round', 'stroke-opacity': opacity }))
  cv.trace(pts, tag, weight)
}

/** A tinted region (screen polygon) behind the curves; not traced, so labels may sit on it. */
export function region(cv, poly, fill, opacity = 0.2) {
  if (poly.length < 3) return
  cv.back.push(el('path', { d: pathD(poly.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]), true), fill, 'fill-opacity': opacity, stroke: 'none' }))
}

/** The point and unit direction at fraction `at` of a polyline's length. */
export function along(pts, at = 0.5) {
  const lens = [0]
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + V.len(V.sub(pts[i], pts[i - 1])))
  const L = lens[lens.length - 1], s = L * at
  let i = 1
  while (i < pts.length - 1 && lens[i] < s) i++
  const a = pts[i - 1], b = pts[i], seg = lens[i] - lens[i - 1] || 1
  return { p: V.add(a, V.mul(V.sub(b, a), (s - lens[i - 1]) / seg)), d: V.unit(V.sub(b, a)), length: L }
}

/** A filled arrowhead partway along a polyline, pointing the way it runs. */
export function arrowOn(cv, pts, fill, { at = 0.5, size = 8 } = {}) {
  const { p, d, length } = along(pts, at)
  if (length < size * 2.5) return
  const n = V.perp(d), tip = V.add(p, V.mul(d, size / 2)), base = V.sub(tip, V.mul(d, size))
  const tri = [tip, V.add(base, V.mul(n, size * 0.45)), V.sub(base, V.mul(n, size * 0.45))]
  cv.mid.push(el('path', { d: pathD(tri.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]), true), fill }))
  cv.trace(tri, 'arrow', 1, true)
}

/**
 * Spots inside a polygon (screen) for its label, roomiest first: grid points ranked by their
 * clearance from the outline, spread at least 14 px apart.
 */
export function insideSpots(poly, count = 8) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1])
  const pts = []
  for (let x = Math.min(...xs) + 2; x < Math.max(...xs); x += 4) for (let y = Math.min(...ys) + 2; y < Math.max(...ys); y += 4) {
    if (!insidePoly([x, y], poly)) continue
    let d = Infinity
    for (const q of poly) d = Math.min(d, Math.hypot(q[0] - x, (q[1] - y) * 1.8))
    pts.push([x, y, d])
  }
  pts.sort((a, b) => b[2] - a[2])
  const out = []
  for (const p of pts) if (out.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) >= 14)) { out.push(p); if (out.length >= count) break }
  return out.map(([x, y]) => [x, y])
}

/** Polygon centroid (screen), for the label of an enclosed area. */
export function centroid(poly) {
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length], k = x0 * y1 - x1 * y0
    a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k
  }
  if (Math.abs(a) < 1e-9) return V.mul(poly.reduce((s, p) => V.add(s, p), [0, 0]), 1 / poly.length)
  return [cx / (3 * a), cy / (3 * a)]
}

/**
 * A compact table at (x, y) (top-left): `head` cells in muted, `rows` of cells, the first column
 * left-aligned and the rest right-aligned. A cell is a label string or { text, fill }. Returns
 * the bottom y and the width.
 */
export function table(cv, theme, x, y, head, rows, { size = theme.size - 1, gap = 12 } = {}) {
  const rh = size + 5
  const txt = (c) => (typeof c === 'object' && c ? c.text : c ?? '')
  const ncol = head.length
  const widths = Array.from({ length: ncol }, (_, j) => Math.max(...[head, ...rows].map((r) => measure(txt(r[j]), size))))
  const xs = [x]
  for (let j = 1; j < ncol; j++) xs.push(xs[j - 1] + widths[j - 1] + gap + (j === 1 ? 0 : 0))
  const right = (j) => xs[j] + widths[j]
  const W = right(ncol - 1) - x
  const put = (c, j, by, fill) => {
    const t = txt(c)
    if (!t) return
    const f = (typeof c === 'object' && c?.fill) || fill
    cv.front.push(j === 0 ? labelSvg(t, xs[0], by, theme, { anchor: 'start', size, fill: f }) : labelSvg(t, right(j), by, theme, { anchor: 'end', size, fill: f }))
  }
  head.forEach((c, j) => put(c, j, y + size, theme.muted))
  cv.back.push(el('line', { x1: x, y1: y + rh - 1, x2: x + W, y2: y + rh - 1, stroke: theme.grid, 'stroke-width': 1 }))
  rows.forEach((r, i) => r.forEach((c, j) => put(c, j, y + rh * (i + 1) + size + 1, j === 0 ? theme.muted : theme.fg)))
  const bottom = y + rh * (rows.length + 1) + 3
  cv.ext.push([x, y], [x + W, bottom])
  return { bottom, width: W }
}

/** Lines of text at (x, y), left-aligned, one per row. Returns the bottom y. */
export function lines(cv, theme, x, y, list, { size = theme.size - 1, fill = theme.fg } = {}) {
  const rh = size + 5
  list.forEach((t, i) => {
    const [text, f] = Array.isArray(t) ? t : [t, fill]
    cv.front.push(labelSvg(text, x, y + rh * i + size, theme, { anchor: 'start', size, fill: f }))
    cv.ext.push([x, y + rh * i], [x + measure(text, size), y + rh * (i + 1)])
  })
  return y + rh * list.length + (list.length ? 3 : 0)
}

/** A row of color keys (a short line sample and a label each) at (x, y). Returns the bottom y. */
export function keys(cv, theme, x, y, list, { size = theme.size - 1 } = {}) {
  let cx = x
  for (const { label, color, dash, fill } of list) {
    const cy = y + size / 2 + 2
    if (fill) cv.front.push(el('rect', { x: cx, y: cy - 5, width: 14, height: 10, fill, 'fill-opacity': 0.3, rx: 2 }))
    else cv.front.push(el('line', { x1: cx, y1: cy, x2: cx + 14, y2: cy, stroke: color, 'stroke-width': 2.2, 'stroke-dasharray': dash }))
    cv.front.push(labelSvg(label, cx + 18, cy, theme, { anchor: 'start', size, fill: theme.muted, middle: true }))
    cx += 18 + measure(label, size) + 12
  }
  cv.ext.push([x, y], [cx - 12, y + size + 4])
  return y + size + 8
}

/** A filled dot (through el(), so a host-theme var() color moves into style). */
export const dot = (cv, p, r, fill, layer = 'front') => cv[layer].push(el('circle', { cx: +p[0].toFixed(2), cy: +p[1].toFixed(2), r, fill }))

/** A thin straight line, not traced. */
export const rule = (cv, a, b, stroke, { width = 1, dash, layer = 'front' } = {}) =>
  cv[layer].push(el('line', { x1: +a[0].toFixed(2), y1: +a[1].toFixed(2), x2: +b[0].toFixed(2), y2: +b[1].toFixed(2), stroke, 'stroke-width': width, 'stroke-dasharray': dash }))
