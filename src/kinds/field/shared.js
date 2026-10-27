// Shared by field and bfield: the view (problem coordinates to screen px), the grid of short
// field arrows, and charged sheets (a line with +/− marks). Both kinds lay out in problem
// coordinates (length units, y up) and size the longer side of the view to SIDE px.

import { el } from '../../svg.js'
import { SpecError } from '../../diag.js'
import { clipSegment } from '../../geom.js'
import { V, Canvas, arrow, circlePoly, fieldMark } from '../fbd/draw.js'
import { val, W } from './physics.js'

export const SIDE = 280 // the view's longer side in px
export const GRID = 28 // field-arrow spacing in px
export const LENGTH = { m: 1, cm: 1e-2, mm: 1e-3, km: 1e3, um: 1e-6, μm: 1e-6, nm: 1e-9 }

/**
 * The view: `spec.view`, or the anchors' box padded (by a third) and kept within 3:2; `tall` caps
 * height over width (1.5 by default; 1 keeps it no taller than wide, for narrow panels).
 */
export function fitView(spec, env, anchors, padBy = 1 / 3, tall = 1.5) {
  if (spec.view !== undefined) {
    const v = spec.view
    if (!v || !Array.isArray(v.x) || !Array.isArray(v.y) || v.x.length !== 2 || v.y.length !== 2) throw new SpecError('view', 'view is {"x": [xmin, xmax], "y": [ymin, ymax]} in length units')
    const vx = v.x.map((t, k) => val(t, env, `view.x[${k}]`)), vy = v.y.map((t, k) => val(t, env, `view.y[${k}]`))
    if (!(vx[1] > vx[0]) || !(vy[1] > vy[0])) throw new SpecError('view', 'view ranges run from min to max')
    return { vx, vy }
  }
  const xs = anchors.map((p) => p[0]), ys = anchors.map((p) => p[1])
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const size = Math.max(x1 - x0, y1 - y0) || 1, pad = size * padBy
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad
  const w = x1 - x0, h = y1 - y0
  if (w < h / tall) { const g = (h / tall - w) / 2; x0 -= g; x1 += g }
  if (h < w / 1.5) { const g = (w / 1.5 - h) / 2; y0 -= g; y1 += g }
  return { vx: [x0, x1], vy: [y0, y1] }
}

/** Screen mapping for a view: P (world to px), sd (world direction to screen), clipping helpers. */
export function screen(vx, vy) {
  const S = SIDE / Math.max(vx[1] - vx[0], vy[1] - vy[0])
  const Wpx = (vx[1] - vx[0]) * S, Hpx = (vy[1] - vy[0]) * S
  const P = (p) => [(p[0] - vx[0]) * S, (vy[1] - p[1]) * S]
  const sd = (d) => V.unit([d[0], -d[1]])
  const worldRect = [vx[0], vx[1], vy[0], vy[1]]
  const inView = (p) => p[0] >= vx[0] - 1e-9 && p[0] <= vx[1] + 1e-9 && p[1] >= vy[0] - 1e-9 && p[1] <= vy[1] + 1e-9
  const far = 4 * Math.max(vx[1] - vx[0], vy[1] - vy[0]) + 4 * Math.max(...[...vx, ...vy].map(Math.abs))
  /** The visible part of the infinite line through `at` along `u`, in screen px, or null. */
  const visible = (at, u) => {
    const seg = clipSegment(W.sub(at, W.mul(u, far)), W.add(at, W.mul(u, far)), worldRect)
    return seg && seg.map(P)
  }
  const toWorld = (c) => [vx[0] + c[0] / S, vy[1] - c[1] / S]
  return { vx, vy, S, Wpx, Hpx, P, sd, worldRect, inView, visible, toWorld, far }
}

/**
 * A uniform grid of short arrows along a field, fainter where weaker, skipping spots near strokes
 * (tags matching `pass` don't block) and label boxes. `at(world)` gives [x, y] or [x, y, z]; a
 * cell whose field mostly leaves the page gets ⊙/⊗ instead (only those with `marksOnly`).
 */
export function arrowGrid(cv, view, at, boxes, theme, { pass = /^$/, marksOnly = false, floor = 0 } = {}) {
  const { Wpx, Hpx, toWorld } = view
  const nx = Math.max(1, Math.floor(Wpx / GRID)), ny = Math.max(1, Math.floor(Hpx / GRID))
  const ox = (Wpx - (nx - 1) * GRID) / 2, oy = (Hpx - (ny - 1) * GRID) / 2
  const cells = []
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const c = [ox + i * GRID, oy + j * GRID], E = at(toWorld(c))
    if (!E) continue
    const m = Math.hypot(E[0], E[1], E[2] ?? 0)
    if (!Number.isFinite(m) || m <= floor) continue
    cells.push({ c, E, m })
  }
  const ms = cells.map((q) => Math.log(q.m)).sort((a, b) => a - b)
  const lo = ms[Math.floor(ms.length * 0.1)] ?? 0, hi = ms[Math.floor(ms.length * 0.9)] ?? 0
  let n = 0
  for (const { c, E, m } of cells) {
    const out = Math.abs(E[2] ?? 0) > Math.hypot(E[0], E[1])
    if (marksOnly && !out) continue
    const half = 10, box = [c[0] - half, c[1] - half, c[0] + half, c[1] + half]
    if (boxes.some((b) => b[0] < box[2] + 3 && box[0] < b[2] + 3 && b[1] < box[3] + 3 && box[1] < b[3] + 3)) continue
    if (cv.obs.some(([px, py, , tag]) => !pass.test(tag) && px > box[0] - 2 && px < box[2] + 2 && py > box[1] - 2 && py < box[3] + 2)) continue
    const tmp = new Canvas()
    if (out) fieldMark(tmp, c, E[2] < 0, theme.muted)
    else {
      const d = V.unit([E[0], -E[1]])
      arrow(tmp, V.sub(c, V.mul(d, 8)), V.add(c, V.mul(d, 8)), theme.muted, { width: 1.2, head: 6, layer: 'back' })
    }
    const op = hi > lo ? 0.35 + 0.65 * Math.min(1, Math.max(0, (Math.log(m) - lo) / (hi - lo))) : 1
    cv.back.push(op < 1 ? el('g', { opacity: op.toFixed(2) }, tmp.back) : tmp.back.join(''))
    n++
  }
  return n
}

/** A + or − mark centered at c. */
export function glyph(cv, c, sign, stroke, size = 3.5) {
  const d = `M${c[0] - size} ${c[1]}L${c[0] + size} ${c[1]}` + (sign > 0 ? `M${c[0]} ${c[1] - size}L${c[0]} ${c[1] + size}` : '')
  cv.mid.push(el('path', { d, stroke, 'stroke-width': 1.5, 'stroke-linecap': 'round' }))
}

/** A charged straight line on screen from a to b: a thick line with +/− marks on side `n`. */
export function sheet(cv, a, b, amt, stroke, tag, { width = 3, n, marks = true } = {}) {
  cv.mid.push(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke, 'stroke-width': width, 'stroke-linecap': 'butt' }))
  cv.trace([a, b], tag)
  if (!marks) return
  const L = V.len(V.sub(b, a)), t = V.unit(V.sub(b, a)), side = n ?? V.perp(t)
  for (let k = 14; k < L - 6; k += 24) {
    const c = V.add(V.add(a, V.mul(t, k)), V.mul(side, width / 2 + 6))
    glyph(cv, c, Math.sign(amt), stroke)
    cv.trace(circlePoly(c, 4, 6), tag, 1, true)
  }
}
