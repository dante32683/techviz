// Drawing primitives for fbd: a canvas that records every stroke as sample
// points (so labels can be placed clear of them), arrows, hatched mounts,
// springs, arcs, and the field markers. Screen coordinates: x right, y down.

import { el, pathD } from '../../svg.js'

export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, k) => [a[0] * k, a[1] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1],
  len: (a) => Math.hypot(a[0], a[1]),
  unit: (a) => { const l = Math.hypot(a[0], a[1]); return l ? [a[0] / l, a[1] / l] : [0, 0] },
  perp: (a) => [-a[1], a[0]],
  mid: (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
}

/** Screen unit vector for an angle in degrees, counterclockwise from +x with y up. */
export const dirOf = (deg) => [Math.cos((deg * Math.PI) / 180), -Math.sin((deg * Math.PI) / 180)]
/** Math angle in degrees (0 to 360) of a screen vector. */
export const degOf = (s) => (((Math.atan2(-s[1], s[0]) * 180) / Math.PI) % 360 + 360) % 360

export class Canvas {
  constructor() {
    this.back = []; this.mid = []; this.front = []
    this.obs = [] // [x, y, weight, tag]: stroke samples labels keep clear of
    this.ext = [] // every drawn point, for the bounding box
  }
  /** Record a polyline for label avoidance and the bounding box. */
  trace(points, tag, weight = 1, closed = false) {
    const pts = closed ? [...points, points[0]] : points
    if (pts.length === 1) this.obs.push([pts[0][0], pts[0][1], weight, tag])
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(V.len(V.sub(b, a)) / 3))
      for (let k = 0; k <= n; k++) this.obs.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, weight, tag])
    }
    this.ext.push(...points)
  }
  /** Sample the inside of a convex polygon every 6 px. */
  fill(poly, tag, weight) {
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1])
    for (let x = Math.min(...xs) + 3; x < Math.max(...xs); x += 6) for (let y = Math.min(...ys) + 3; y < Math.max(...ys); y += 6) {
      if (insidePoly([x, y], poly)) this.obs.push([x, y, weight, tag])
    }
  }
}

export function insidePoly([x, y], poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export const circlePoly = (c, r, n = 28) => Array.from({ length: n }, (_, k) => V.add(c, V.mul(dirOf((360 * k) / n), r)))

/** A straight arrow from tail to tip with a filled head. */
export function arrow(cv, tail, tip, stroke, { width = 2, dashed = false, tag, head = 10, layer = 'front' } = {}) {
  const L = V.len(V.sub(tip, tail))
  if (L < 1) return
  const d = V.unit(V.sub(tip, tail)), n = V.perp(d)
  const hl = Math.min(head, L * 0.55), hw = hl * 0.42
  const b0 = V.sub(tip, V.mul(d, hl)), shaftEnd = V.sub(tip, V.mul(d, hl * 0.8))
  cv[layer].push(el('line', { x1: tail[0], y1: tail[1], x2: shaftEnd[0], y2: shaftEnd[1], stroke, 'stroke-width': width, 'stroke-dasharray': dashed ? '5 3' : undefined }))
  const w1 = V.add(b0, V.mul(n, hw)), w2 = V.sub(b0, V.mul(n, hw))
  cv[layer].push(el('path', { d: pathD([tip, w1, w2], true), fill: stroke }))
  cv.trace([tail, tip], tag)
  cv.trace([w1, w2], tag)
}

/** A line with short hatch strokes on one side: ground, walls, ceilings, mounts. */
export function hatched(cv, a, b, side, stroke, tag = 'mount') {
  cv.mid.push(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke, 'stroke-width': 1.6 }))
  const L = V.len(V.sub(b, a)), t = V.unit(V.sub(b, a)), s = V.unit(side)
  const marks = []
  for (let k = 4; k < L - 1; k += 7) {
    const p = V.add(a, V.mul(t, k)), q = V.add(V.add(p, V.mul(s, 7)), V.mul(t, -5))
    marks.push(`M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`)
    cv.ext.push(q)
  }
  if (marks.length) cv.mid.push(el('path', { d: marks.join(''), stroke, 'stroke-width': 1 }))
  cv.trace([a, b], tag)
  cv.trace([V.add(a, V.mul(s, 4)), V.add(b, V.mul(s, 4))], tag)
  cv.trace([V.add(a, V.mul(s, 7)), V.add(b, V.mul(s, 7))], tag)
}

/** A zigzag spring between two points, with short straight leads. */
export function spring(cv, a, b, stroke, tag) {
  const L = V.len(V.sub(b, a)), t = V.unit(V.sub(b, a)), n = V.perp(t)
  const lead = Math.min(10, L * 0.15), coils = 8, amp = 6
  const pts = [a, V.add(a, V.mul(t, lead))]
  for (let k = 0; k < coils; k++) {
    const s = lead + ((L - 2 * lead) * (k + 0.5)) / coils
    pts.push(V.add(V.add(a, V.mul(t, s)), V.mul(n, k % 2 ? -amp : amp)))
  }
  pts.push(V.sub(b, V.mul(t, lead)), b)
  cv.mid.push(el('path', { d: pathD(pts), fill: 'none', stroke, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }))
  cv.trace(pts, tag)
}

/** Points on a circular arc from math angle a1 to a2 (degrees, either way round). */
export function arcPoints(c, r, a1, a2, n = 24) {
  return Array.from({ length: n + 1 }, (_, k) => V.add(c, V.mul(dirOf(a1 + ((a2 - a1) * k) / n), r)))
}

/** Signed sweep from a1 to a2 the short way round, in (-180, 180]. */
export const shortSweep = (a1, a2) => { let d = ((a2 - a1) % 360 + 540) % 360 - 180; if (d === -180) d = 180; return d }

/** ⊗ (into the page) or ⊙ (out of it). */
export function fieldMark(cv, c, into, stroke) {
  const r = 5.5
  cv.back.push(el('circle', { cx: c[0], cy: c[1], r, fill: 'none', stroke, 'stroke-width': 1.1 }))
  if (into) {
    const k = r * 0.68
    cv.back.push(el('path', { d: `M${c[0] - k} ${c[1] - k}L${c[0] + k} ${c[1] + k}M${c[0] + k} ${c[1] - k}L${c[0] - k} ${c[1] + k}`, stroke, 'stroke-width': 1.1 }))
  } else cv.back.push(el('circle', { cx: c[0], cy: c[1], r: 1.7, fill: stroke }))
}
