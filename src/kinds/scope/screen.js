// Drawing shared by the three screens: the graticule, traces decimated to the pixel columns,
// edge markers, and readouts that flow in rows under the screen.

import { el, pathD } from '../../svg.js'
import { labelSvg, measure } from '../../label.js'

export const RS = 11 // readout font size

/** A screen of cols × rows divisions at (x, y), dx × dy px each. */
export function screen(x, y, cols, rows, dx, dy = dx) {
  const w = cols * dx, h = rows * dy
  return {
    x, y, w, h, cols, rows, dx, dy,
    X: (div) => x + div * dx, // divisions from the left edge
    Y: (div) => y + h / 2 - div * dy, // divisions up from the center line
  }
}

/** Frame, division lines, and the center cross with fifth-division ticks. */
export function graticule(S, theme, { center = true } = {}) {
  const parts = []
  const line = (x1, y1, x2, y2, stroke, w = 1) => parts.push(el('line', { x1, y1, x2, y2, stroke, 'stroke-width': w }))
  for (let i = 1; i < S.cols; i++) line(S.X(i), S.y, S.X(i), S.y + S.h, theme.grid)
  for (let j = 1; j < S.rows; j++) line(S.x, S.y + j * S.dy, S.x + S.w, S.y + j * S.dy, theme.grid)
  if (center) {
    const cx = S.cols % 2 ? null : S.X(S.cols / 2), cy = S.rows % 2 ? null : S.Y(0)
    if (cx !== null) {
      line(cx, S.y, cx, S.y + S.h, theme.faint)
      for (let k = 1; k < S.rows * 5; k++) if (k % 5) line(cx - 2.5, S.y + (k * S.dy) / 5, cx + 2.5, S.y + (k * S.dy) / 5, theme.faint)
    }
    if (cy !== null) {
      line(S.x, cy, S.x + S.w, cy, theme.faint)
      for (let k = 1; k < S.cols * 5; k++) if (k % 5) line(S.x + (k * S.dx) / 5, cy - 2.5, S.x + (k * S.dx) / 5, cy + 2.5, theme.faint)
    }
  }
  parts.push(el('rect', { x: S.x, y: S.y, width: S.w, height: S.h, fill: 'none', stroke: theme.muted, 'stroke-width': 1.2 }))
  return parts.join('')
}

/**
 * A trace path through screen points [x, y] in px, clamped to the screen. Dense records are
 * reduced to the min and max of each half-pixel column, which draws a dense carrier as a band.
 */
export function tracePath(S, pts) {
  const top = S.y, bot = S.y + S.h
  const cl = (y) => Math.max(top, Math.min(bot, y))
  if (pts.length <= S.w * 2) return pathD(pts.map(([x, y]) => [x, cl(y)]))
  const out = []
  let col = null, lo = 0, hi = 0, first = 0, last = 0
  const flush = () => {
    if (col === null) return
    const x = col / 2
    if (first <= last) out.push([x, cl(lo)], [x, cl(hi)])
    else out.push([x, cl(hi)], [x, cl(lo)])
  }
  for (const [x, y] of pts) {
    const c = Math.round(x * 2)
    if (c !== col) { flush(); col = c; lo = hi = first = y }
    if (y < lo) lo = y
    if (y > hi) hi = y
    last = y
  }
  flush()
  return pathD(out)
}

/** A tag on the left edge pointing right at y (the channel's 0 V), with its number. */
export function zeroTag(S, y, fill, text, theme) {
  const yy = Math.max(S.y + 5, Math.min(S.y + S.h - 5, y)), x = S.x - 2
  const off = y < S.y || y > S.y + S.h
  const d = `M${x - 13} ${yy - 5}L${x - 4} ${yy - 5}L${x} ${yy}L${x - 4} ${yy + 5}L${x - 13} ${yy + 5}Z`
  return el('path', { d, fill, 'fill-opacity': off ? 0.55 : 1 }) +
    labelSvg(`\\text{${text}}`, x - 8, yy, theme, { size: 8.5, fill: theme.bg ?? '#ffffff', middle: true, weight: 600 })
}

/** A small triangle outside the screen: the trigger level (right edge) or time (top edge). */
export function edgeMark(S, where, at, fill) {
  if (where === 'right') {
    const y = Math.max(S.y, Math.min(S.y + S.h, at)), x = S.x + S.w + 2
    return el('path', { d: `M${x} ${y}L${x + 7} ${y - 4.5}L${x + 7} ${y + 4.5}Z`, fill })
  }
  const x = Math.max(S.x, Math.min(S.x + S.w, at)), y = S.y - 2
  if (at < S.x) return el('path', { d: `M${S.x} ${y - 4}L${S.x + 7} ${y - 8}L${S.x + 7} ${y}Z`, fill })
  if (at > S.x + S.w) return el('path', { d: `M${S.x + S.w} ${y - 4}L${S.x + S.w - 7} ${y - 8}L${S.x + S.w - 7} ${y}Z`, fill })
  return el('path', { d: `M${x} ${y}L${x - 4.5} ${y - 7}L${x + 4.5} ${y - 7}Z`, fill })
}

/**
 * Readout rows: each row is a list of items [label, fill, gap after (default 9 px)]; items flow
 * left to right and wrap at `width`. Returns { svg, height }.
 */
export function readouts(rows, x, y, width, theme, size = RS) {
  const parts = [], lh = size + 4, gap = 9
  let cy = y
  for (const items of rows) {
    if (!items.length) continue
    let cx = x
    cy += lh
    let glued = false
    for (const [k, [label, fill, g = gap]] of items.entries()) {
      const w = measure(label, size)
      // An item with a small gap after it is glued to the next (CH4 and its 1 V/div): they wrap together.
      let span = w
      for (let j = k; j < items.length - 1 && (items[j][2] ?? gap) < gap; j++) span += (items[j][2] ?? gap) + measure(items[j + 1][0], size)
      if (!glued && cx > x && cx + span > x + width) { cx = x + 10; cy += lh }
      glued = g < gap
      parts.push(labelSvg(label, cx, cy - 3, theme, { anchor: 'start', size, fill }))
      cx += w + g
    }
  }
  return { svg: parts.join(''), height: cy - y }
}

/** Plain readout text: upright, so "ΔT" and "f" don't turn italic. */
export const T = (s) => `\\text{${s}}`
