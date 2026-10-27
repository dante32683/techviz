// Drawing primitives for ds: cells, values, small index text, pointer arrows along polylines
// with rounded corners, and the NULL slash. Everything goes on fbd's Canvas (layers plus the
// stroke samples and extents that label placement and the bounding box use).

import { el, pathD } from '../../svg.js'
import { labelSvg, measure } from '../../label.js'
import { V } from '../fbd/draw.js'

export const VAL = 13 // value font size
export const IDX = 10.5 // index and annotation font size
export const NAME = 12 // pointer and marker names (mono)

const raw = (s) => [{ text: String(s), shift: 0 }]
/** Width of plain text (values) or mono text (names). */
export const textW = (s, size = VAL, mono = false) => (mono ? String(s).length * size * 0.6 : measure(raw(s), size))

/** Plain text (no TeX: values stay upright), recorded for the bounding box. */
export function text(cv, s, x, y, theme, { size = VAL, fill = theme.fg, anchor = 'middle', mono = false, weight, layer = 'front' } = {}) {
  const w = textW(s, size, mono)
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x
  cv.ext.push([x0, y - size * 0.8], [x0 + w, y + size * 0.25])
  cv[layer].push(labelSvg(raw(s), x, y, theme, { size, fill, anchor, mono, weight }))
}

/** A box; `tint` fills it with a palette color at low opacity. */
export function box(cv, x, y, w, h, theme, { stroke = theme.fg, width = 1.3, tint, opacity = 0.2, dash, rx = 2, tag = 'cell', layer = 'mid' } = {}) {
  cv[layer].push(el('rect', { x, y, width: w, height: h, rx, fill: tint ?? 'none', 'fill-opacity': tint ? opacity : undefined, stroke, 'stroke-width': width, 'stroke-dasharray': dash }))
  cv.trace([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], tag, 1, true)
}

/** The NULL mark: a diagonal across a pointer field. */
export function slash(cv, x, y, w, h, stroke) {
  cv.mid.push(el('line', { x1: x + 2, y1: y + h - 2, x2: x + w - 2, y2: y + 2, stroke, 'stroke-width': 1.2 }))
}

export const dot = (cv, p, fill) => cv.front.push(el('circle', { cx: p[0], cy: p[1], r: 2.6, fill }))

/**
 * An arrow along a polyline with rounded corners and a filled head at the last point.
 * `tag` records the stroke for label placement.
 */
export function arrow(cv, pts, stroke, { width = 1.3, head = 7, dash, tag = 'link', layer = 'front', r = 6 } = {}) {
  if (pts.length < 2) return
  const end = pts[pts.length - 1], prev = pts[pts.length - 2]
  const d = V.unit(V.sub(end, prev)), n = V.perp(d)
  const hl = Math.min(head, V.len(V.sub(end, prev)) * 0.8), hw = hl * 0.42
  const base = V.sub(end, V.mul(d, hl))
  const line = [...pts.slice(0, -1), V.sub(end, V.mul(d, hl * 0.8))]
  cv[layer].push(el('path', { d: rounded(line, r), fill: 'none', stroke, 'stroke-width': width, 'stroke-dasharray': dash, 'stroke-linejoin': 'round' }))
  cv[layer].push(el('path', { d: pathD([end, V.add(base, V.mul(n, hw)), V.sub(base, V.mul(n, hw))], true), fill: stroke }))
  cv.trace(pts, tag, 0.6)
}

/** A plain line (tree edges). */
export function line(cv, a, b, stroke, { width = 1.3, dash, tag = 'edge', layer = 'back' } = {}) {
  cv[layer].push(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke, 'stroke-width': width, 'stroke-dasharray': dash }))
  cv.trace([a, b], tag, 0.6)
}

/** Path data for a polyline with corners rounded to radius r. */
export function rounded(pts, r) {
  if (pts.length < 3 || !r) return pathD(pts)
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1]
    const k = Math.min(r, V.len(V.sub(b, a)) / 2, V.len(V.sub(c, b)) / 2)
    const p = V.add(b, V.mul(V.unit(V.sub(a, b)), k)), q = V.add(b, V.mul(V.unit(V.sub(c, b)), k))
    d += `L${f(p[0])} ${f(p[1])}Q${f(b[0])} ${f(b[1])} ${f(q[0])} ${f(q[1])}`
  }
  const z = pts[pts.length - 1]
  return d + `L${f(z[0])} ${f(z[1])}`
}
const f = (v) => (Math.round(v * 10) / 10).toString()

/** Where the segment from p (outside) toward q (inside the box) crosses the box's edge. */
export function clipToBox(p, q, [x, y, w, h], pad = 1) {
  const x0 = x - pad, y0 = y - pad, x1 = x + w + pad, y1 = y + h + pad
  let t = 1
  const dx = q[0] - p[0], dy = q[1] - p[1]
  for (const [edge, v, dv] of [[x0, p[0], dx], [x1, p[0], dx], [y0, p[1], dy], [y1, p[1], dy]]) {
    if (!dv) continue
    const s = (edge - v) / dv
    if (s <= 0 || s >= t) continue
    const xs = p[0] + dx * s, ys = p[1] + dy * s
    if (xs >= x0 - 0.01 && xs <= x1 + 0.01 && ys >= y0 - 0.01 && ys <= y1 + 0.01) t = s
  }
  return [p[0] + dx * t, p[1] + dy * t]
}

/** Translate everything drawn so the bounding box starts at the margin. */
export function finish(cv, margin = 14) {
  const xs = cv.ext.map((p) => p[0]), ys = cv.ext.map((p) => p[1])
  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys)
  const body = el('g', { transform: `translate(${f(margin - x0)},${f(margin - y0)})` }, [...cv.back, ...cv.mid, ...cv.front])
  return { body, width: Math.ceil(x1 - x0 + 2 * margin), height: Math.ceil(y1 - y0 + 2 * margin) }
}
