// circuit label layout: obstacles (wires, symbol bodies, placed labels) and a
// chooser that picks the candidate box hitting the fewest of them.

import { measure, parseLabel } from '../../label.js'

const LINE = 16 // px between stacked label lines

/** Text block: one or more label lines, measured. */
export function block(lines, size) {
  const ls = lines.filter((l) => l !== undefined && l !== null && l !== '').map(String)
  const meta = ls.map((text) => {
    const runs = parseLabel(text)
    return { text, w: measure(runs, size) + 2, sub: runs.some((r) => r.shift === -1), sup: runs.some((r) => r.shift === 1) }
  })
  const W = Math.max(0, ...meta.map((m) => m.w))
  const top = meta[0]?.sup ? 8.5 : 6.5, bot = meta[meta.length - 1]?.sub ? 9.5 : 6.5
  const H = meta.length ? top + bot + LINE * (meta.length - 1) : 0
  return { lines: meta, W, H, top }
}

/** Box of a block whose center is c. */
export const boxAt = (b, c) => ({ x0: c[0] - b.W / 2, y0: c[1] - b.H / 2, x1: c[0] + b.W / 2, y1: c[1] + b.H / 2 })

const pad = (r, p) => ({ x0: r.x0 - p, y0: r.y0 - p, x1: r.x1 + p, y1: r.y1 + p })
export const rectsHit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/** Does the segment a-b, thickened by r, touch rect R? (Liang-Barsky on R grown by r.) */
export function segHitsRect(a, b, r, R) {
  const x0 = R.x0 - r, y0 = R.y0 - r, x1 = R.x1 + r, y1 = R.y1 + r
  const dx = b[0] - a[0], dy = b[1] - a[1]
  let t0 = 0, t1 = 1
  for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue }
    const t = q / p
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t } else { if (t < t0) return false; if (t < t1) t1 = t }
  }
  return t0 <= t1
}

export class Board {
  constructor() { this.segs = []; this.rects = []; this.labels = [] }
  seg(a, b, r = 1, owner) { this.segs.push({ a, b, r, owner }) }
  rect(R, owner) { this.rects.push({ R, owner }) }
  /** Count what a candidate box touches; labels weigh more than lines. */
  score(R, ignore) {
    const P = pad(R, 1.5)
    let s = 0
    for (const g of this.segs) if (g.owner !== ignore && segHitsRect(g.a, g.b, g.r, P)) s += 1
    for (const g of this.rects) if (g.owner !== ignore && rectsHit(g.R, P)) s += 1
    for (const g of this.labels) if (rectsHit(g.R, P)) s += 3
    return s
  }
  /** Pick the best of candidate boxes (in preference order) and reserve it. Returns { i, R, score }. */
  choose(cands, ignore) {
    let best = null
    cands.forEach((R, i) => { const s = this.score(R, ignore); if (!best || s < best.score) best = { i, R, score: s } })
    if (best) this.labels.push({ R: best.R })
    return best
  }
  bounds(extra = []) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    const grow = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    for (const g of this.segs) { grow(g.a[0] - g.r, g.a[1] - g.r); grow(g.a[0] + g.r, g.a[1] + g.r); grow(g.b[0] - g.r, g.b[1] - g.r); grow(g.b[0] + g.r, g.b[1] + g.r) }
    for (const g of [...this.rects, ...this.labels, ...extra.map((R) => ({ R }))]) { grow(g.R.x0, g.R.y0); grow(g.R.x1, g.R.y1) }
    return { x0, y0, x1, y1 }
  }
}

export { LINE }
