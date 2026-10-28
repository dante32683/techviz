// Drawing for linalg: a coordinate plane at 1:1 aspect (grid, axes, tick numbers that give way to
// the drawing), an isometric view for ℝ³, line clipping, right-angle marks, bracketed matrices
// with pivots, tinted rows, row-operation notes and column headers, and readouts that flow in
// rows and mix text with matrices.

import { el, pathD } from '../../svg.js'
import { labelSvg, measure } from '../../label.js'
import { V } from '../fbd/draw.js'

/** A window [x0, x1] × [y0, y1] in whole units around `pts`, holding the origin and ±1. */
export function fitWindow(pts, { pad = 0.35, range } = {}) {
  if (range) {
    const r = typeof range === 'number' ? [-range, range, -range, range] : range
    return { x0: r[0], x1: r[1], y0: r[2], y1: r[3] }
  }
  const xs = [-0.6, 1, ...pts.map((p) => p[0])].filter(Number.isFinite), ys = [-0.6, 1, ...pts.map((p) => p[1])].filter(Number.isFinite)
  return { x0: Math.floor(Math.min(...xs) - pad), x1: Math.ceil(Math.max(...xs) + pad), y0: Math.floor(Math.min(...ys) - pad), y1: Math.ceil(Math.max(...ys) + pad) }
}

/** A 2D plane: P maps data to screen (y up), u px per unit, one grid line per `step` units. */
export function plane(win, { maxW = 250, maxH = 230, maxU = 46 } = {}) {
  const sx = win.x1 - win.x0, sy = win.y1 - win.y0
  const u = Math.max(8, Math.min(maxU, maxW / sx, maxH / sy))
  const step = [1, 2, 5, 10, 20, 50].find((s) => s * u >= 15) ?? 100
  return { ...win, u, step, dim: 2, P: (p) => [p[0] * u, -p[1] * u] }
}

/** The isometric view of ℝ³: x₁ toward the lower left, x₂ to the lower right, x₃ up. */
export function iso(L, { maxW = 250, maxH = 230 } = {}) {
  const c = Math.cos(Math.PI / 6), s = 0.5
  // The view spans 2·c·L across and (1 + s)·L top to bottom plus the negative stubs.
  const u = Math.max(10, Math.min(40, maxW / (2 * c * L * 1.25), maxH / ((1 + s) * L * 1.35)))
  return { L, u, dim: 3, P: (p) => [u * c * (p[1] - p[0]), u * (s * (p[0] + p[1]) - p[2])] }
}

/** The part of the line p + t·d inside the window, as two points, or null. */
export function clipLine(pl, p, d) {
  let t0 = -Infinity, t1 = Infinity
  for (const [pk, dk, lo, hi] of [[p[0], d[0], pl.x0, pl.x1], [p[1], d[1], pl.y0, pl.y1]]) {
    if (Math.abs(dk) < 1e-12) { if (pk < lo || pk > hi) return null; continue }
    let a = (lo - pk) / dk, b = (hi - pk) / dk
    if (a > b) [a, b] = [b, a]
    t0 = Math.max(t0, a); t1 = Math.min(t1, b)
  }
  if (!(t1 > t0)) return null
  return [[p[0] + t0 * d[0], p[1] + t0 * d[1]], [p[0] + t1 * d[0], p[1] + t1 * d[1]]]
}

/** Grid lines and axes into cv.back; returns tick spots [label, screen point, side] to place last. */
export function drawPlane(cv, pl, theme, { grid = true } = {}) {
  const { P, step } = pl
  const ticks = []
  const line = (a, b, stroke, w) => { const A = P(a), B = P(b); cv.back.push(el('line', { x1: A[0], y1: A[1], x2: B[0], y2: B[1], stroke, 'stroke-width': w })) }
  const k0 = (lo) => Math.ceil(lo / step) * step
  for (let x = k0(pl.x0); x <= pl.x1; x += step) {
    if (x && grid) line([x, pl.y0], [x, pl.y1], theme.grid, 1)
    if (x) ticks.push([String(x).replace('-', '−'), V.add(P([x, 0]), [0, 11]), 'x'])
  }
  for (let y = k0(pl.y0); y <= pl.y1; y += step) {
    if (y && grid) line([pl.x0, y], [pl.x1, y], theme.grid, 1)
    if (y) ticks.push([String(y).replace('-', '−'), V.add(P([0, y]), [-7, 3.5]), 'y'])
  }
  line([pl.x0, 0], [pl.x1, 0], theme.faint, 1.1)
  line([0, pl.y0], [0, pl.y1], theme.faint, 1.1)
  cv.trace([P([pl.x0, 0]), P([pl.x1, 0])], 'axis', 0.25)
  cv.trace([P([0, pl.y0]), P([0, pl.y1])], 'axis', 0.25)
  cv.ext.push(P([pl.x0, pl.y0]), P([pl.x1, pl.y1]))
  return ticks
}

/** Axes of the isometric view (negative stubs dashed) and a faint x₁x₂ grid; returns tick spots. */
export function drawIso(cv, pl, theme) {
  const { P, L } = pl
  const ticks = []
  for (let k = 1; k <= L; k++) {
    for (const [a, b] of [[[k, 0, 0], [k, L, 0]], [[0, k, 0], [L, k, 0]]]) { const A = P(a), B = P(b); cv.back.push(el('line', { x1: A[0], y1: A[1], x2: B[0], y2: B[1], stroke: theme.grid, 'stroke-width': 1 })) }
  }
  const names = ['x_{1}', 'x_{2}', 'x_{3}']
  for (let a = 0; a < 3; a++) {
    const e = [0, 0, 0]; e[a] = 1
    const tip = P(e.map((x) => x * (L + 0.6))), neg = P(e.map((x) => -x * 0.6)), o = P([0, 0, 0])
    cv.back.push(el('line', { x1: neg[0], y1: neg[1], x2: o[0], y2: o[1], stroke: theme.faint, 'stroke-width': 1.1, 'stroke-dasharray': '3 3' }))
    cv.back.push(el('line', { x1: o[0], y1: o[1], x2: tip[0], y2: tip[1], stroke: theme.faint, 'stroke-width': 1.1 }))
    cv.trace([o, tip], 'axis', 0.25)
    const d = V.unit(V.sub(tip, o))
    cv.front.push(labelSvg(names[a], tip[0] + d[0] * 9, tip[1] + d[1] * 9, theme, { size: 10.5, fill: theme.muted, middle: true }))
    cv.ext.push(V.add(tip, V.mul(d, 16)), neg)
    for (let k = 1; k <= L; k++) {
      const p = P(e.map((x) => x * k)), n = a === 2 ? [-1, 0] : V.perp(d)
      const side = a === 0 ? -1 : 1
      cv.back.push(el('line', { x1: p[0] - n[0] * 2.5, y1: p[1] - n[1] * 2.5, x2: p[0] + n[0] * 2.5, y2: p[1] + n[1] * 2.5, stroke: theme.faint, 'stroke-width': 1 }))
      ticks.push([String(k), V.add(p, V.mul(n, side * 8)), 'iso'])
    }
  }
  return ticks
}

/** Tick numbers where they cover no stroke and no label box. */
export function drawTicks(cv, ticks, boxes, theme) {
  const size = 8.5
  for (const [t, [x, y]] of ticks) {
    const w = measure(t, size) / 2 + 1
    const box = [x - w, y - size + 1, x + w, y + 2]
    if (cv.obs.some(([px, py, wt, tag]) => tag !== 'axis' && px > box[0] - 1 && px < box[2] + 1 && py > box[1] - 1 && py < box[3] + 1)) continue
    if (boxes.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) continue
    cv.back.push(labelSvg(t, x, y, theme, { size, fill: theme.muted }))
  }
}

/** A right-angle mark at q between data directions a and b, about 7 px a side. */
export function rightAngle(cv, pl, q, a, b, stroke) {
  const P = pl.P, len = 7 / pl.u
  const ua = unitN(a), ub = unitN(b)
  const p1 = q.map((x, k) => x + ua[k] * len), p3 = q.map((x, k) => x + ub[k] * len), p2 = q.map((x, k) => x + (ua[k] + ub[k]) * len)
  const pts = [P(p1), P(p2), P(p3)]
  cv.mid.push(el('path', { d: pathD(pts), fill: 'none', stroke, 'stroke-width': 1.1 }))
  cv.trace(pts, 'mark', 0.5)
}
const unitN = (v) => { const l = Math.hypot(...v); return l ? v.map((x) => x / l) : v }

/**
 * A bracketed matrix of label strings. Options: size, bar (an augmented bar before that column),
 * colFill [color per column], box {"i,j": color} (pivots), rowTint {i: color}, notes [label per
 * row, set to the right], header [label per column], headFill [color per column], colTint {j}.
 * Returns {w, h, svg(x, y)} with (x, y) the top-left corner.
 */
export function matrixBlock(cells, theme, o = {}) {
  const size = o.size ?? 12, m = cells.length, n = cells[0].length
  const gap = size * 0.95, pad = 5, rh = size * 1.48, hh = o.header ? size * 1.15 : 0
  const colW = [...Array(n).keys()].map((j) => Math.max(size * 0.7, ...cells.map((r) => measure(r[j], size))))
  const xs = []
  let cx = pad + 3
  for (let j = 0; j < n; j++) {
    if (o.bar === j) cx += size * 0.5
    xs.push(cx + colW[j] / 2); cx += colW[j] + gap
  }
  const mw = cx - gap + pad + 3, mh = m * rh + 6
  const noteSize = o.noteSize ?? size * 0.88
  const notesW = o.notes ? Math.max(0, ...o.notes.map((t) => (t ? measure(t, noteSize) + 12 : 0))) : 0
  const w = mw + notesW, h = mh + hh
  const svg = (x, y) => {
    const parts = [], top = y + hh
    for (const [j, c] of Object.entries(o.colTint ?? {})) parts.push(el('rect', { x: x + xs[j] - colW[j] / 2 - 4, y: top + 2, width: colW[j] + 8, height: mh - 4, rx: 3, fill: c, 'fill-opacity': 0.13 }))
    for (const [i, c] of Object.entries(o.rowTint ?? {})) parts.push(el('rect', { x: x + 4, y: top + 3 + i * rh, width: mw - 8, height: rh, rx: 3, fill: c, 'fill-opacity': 0.14 }))
    for (const [key, c] of Object.entries(o.box ?? {})) {
      const [i, j] = key.split(',').map(Number)
      parts.push(el('rect', { x: x + xs[j] - colW[j] / 2 - 3.5, y: top + 3 + i * rh + 1.5, width: colW[j] + 7, height: rh - 3, rx: 4, fill: c, 'fill-opacity': 0.2, stroke: c, 'stroke-width': 1.2 }))
    }
    const br = (x0, dir) => parts.push(el('path', { d: `M${x0 + dir * 4.5} ${top + 1}L${x0} ${top + 1}L${x0} ${top + mh - 1}L${x0 + dir * 4.5} ${top + mh - 1}`, fill: 'none', stroke: theme.fg, 'stroke-width': 1.3 }))
    br(x + 1, 1); br(x + mw - 1, -1)
    if (o.bar !== undefined) { const bx = x + xs[o.bar] - colW[o.bar] / 2 - gap / 2 - size * 0.25; parts.push(el('line', { x1: bx, y1: top + 3, x2: bx, y2: top + mh - 3, stroke: theme.muted, 'stroke-width': 1 })) }
    if (o.header) o.header.forEach((t, j) => { if (t) parts.push(labelSvg(t, x + xs[j], y + hh - 3, theme, { size: size * 0.8, fill: o.headFill?.[j] ?? theme.muted })) })
    cells.forEach((r, i) => r.forEach((t, j) => parts.push(labelSvg(t, x + xs[j], top + 3 + i * rh + rh / 2, theme, { size, fill: o.colFill?.[j] ?? theme.fg, middle: true }))))
    if (o.notes) o.notes.forEach((t, i) => { if (t) parts.push(labelSvg(t, x + mw + 10, top + 3 + i * rh + rh / 2, theme, { size: noteSize, fill: o.noteFill?.[i] ?? theme.muted, anchor: 'start', middle: true })) })
    return parts.join('')
  }
  return { w, h, svg, mw, mh, hh }
}

/**
 * Readouts in rows: each row is a list of items, a label string, [label, fill, glue], or a block
 * {w, h, svg, glue}; items flow left to right, centered on the row's middle, and wrap at
 * `width`. An item with `glue` wraps together with the next one (x₃ and its vector).
 */
export const readItem = (it, size = 11.5) => {
  const o = typeof it === 'string' ? { label: it.trim() } : Array.isArray(it) ? { label: it[0].trim(), fill: it[1], glue: it[2] } : it
  return o.svg ? o : { ...o, w: measure(o.label, o.size ?? size), h: (o.size ?? size) + 5 }
}
export function flow(rows, x, y, width, theme, size = 11.5) {
  const parts = []
  let cy = y
  for (const row of rows) {
    if (!row || !row.length) continue
    const items = row.map((it) => readItem(it, size))
    const units = []
    for (const it of items) { const last = units[units.length - 1]; if (last && last[last.length - 1].glue) last.push(it); else units.push([it]) }
    const lines = [[]]
    let lw = 0
    for (const u of units) {
      const uw = u.reduce((s, it) => s + it.w + 7, -7)
      if (lw && lw + uw > width) { lines.push([]); lw = 12 }
      lines[lines.length - 1].push(...u); lw += uw + 7
    }
    lines.forEach((ln, k) => {
      const lh = Math.max(...ln.map((it) => it.h))
      let cx = x + (k ? 12 : 0)
      for (const it of ln) {
        if (it.svg) parts.push(it.svg(cx, cy + (lh - it.h) / 2))
        else parts.push(labelSvg(it.label, cx, cy + lh / 2, theme, { size: it.size ?? size, fill: it.fill ?? theme.fg, anchor: 'start', middle: true }))
        cx += it.w + 7
      }
      cy += lh + 4
    })
  }
  return { svg: parts.join(''), height: cy - y }
}
