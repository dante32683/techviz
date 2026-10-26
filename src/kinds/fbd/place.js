// Label placement for fbd: each label tries a list of candidate centers (beyond
// an arrow's tip, beside it, around a body) and takes the one whose box covers
// the fewest recorded strokes and no earlier label. Then field markers fill the
// space left over.

import { el } from '../../svg.js'
import { labelSvg, measure } from '../../label.js'
import { V, fieldMark, arrow } from './draw.js'

const overlaps = (a, b, px, py) => a[0] < b[2] + px && b[0] < a[2] + px && a[1] < b[3] + py && b[1] < a[3] + py

/** Half the extent of a w × h box along unit vector d. */
export const extent = (d, w, h) => (Math.abs(d[0]) * w) / 2 + (Math.abs(d[1]) * h) / 2

/** Candidate centers for an arrow's label: past the tip, beside the tip, beside the shaft. */
export function arrowCands(tail, tip) {
  const d = V.unit(V.sub(tip, tail)), n = V.perp(d), L = V.len(V.sub(tip, tail))
  const back = Math.min(12, L * 0.3)
  const out = [(w, h) => V.add(tip, V.mul(d, 5 + extent(d, w, h)))]
  for (const s of [n, V.mul(n, -1)]) out.push((w, h) => V.add(V.sub(tip, V.mul(d, back)), V.mul(s, 8 + extent(s, w, h))))
  for (const s of [n, V.mul(n, -1)]) out.push((w, h) => V.add(V.add(tip, V.mul(d, 2 + extent(d, w, h) * 0.6)), V.mul(s, 4 + extent(s, w, h) * 0.8)))
  for (const s of [n, V.mul(n, -1)]) out.push((w, h) => V.add(V.mul(V.add(tail, tip), 0.5), V.mul(s, 8 + extent(s, w, h))))
  out.push((w, h) => V.add(tip, V.mul(d, 16 + extent(d, w, h))))
  for (const s of [n, V.mul(n, -1)]) out.push((w, h) => V.add(V.add(tail, V.mul(d, L * 0.3)), V.mul(s, 8 + extent(s, w, h))))
  return out
}

/** Candidates around a point at the given radius, starting from direction `first` (screen unit). */
export function ringCands(c, r, first = [0, -1]) {
  const out = []
  const a0 = Math.atan2(first[1], first[0])
  for (const k of [0, 1, -1, 2, -2, 3, -3, 4]) {
    const d = [Math.cos(a0 + (k * Math.PI) / 4), Math.sin(a0 + (k * Math.PI) / 4)]
    out.push((w, h) => V.add(c, V.mul(d, r + extent(d, w, h))))
  }
  return out
}

/**
 * Place labels in order. Each item: { label, size, fill, cands, own?, ignore? }; `own` is the tag
 * of the stroke it labels (other force strokes close by count against a spot, so the label reads
 * as its own arrow's), `avoid` is a Set of tags whose strokes within 20 px count against a spot (a
 * part label kept off other parts), `ignore` lists tags it may sit on (a body label inside its body).
 */
export function placeLabels(items, cv) {
  const taken = [], out = []
  for (const q of items) {
    const w = measure(q.label, q.size) + 2, h = q.size + 4
    let best = null
    q.cands.forEach((cand, i) => {
      const [cx, cy] = typeof cand === 'function' ? cand(w, h) : cand
      const box = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]
      // s ranks the spots (strokes within 3 px count, later candidates cost a little more);
      // inner sums only what lies under the label itself, which decides its backing box.
      let s = i * 0.08, hard = 0, inner = 0
      for (const o of taken) if (overlaps(box, o, 5, 3)) { s += 1000; hard++; if (overlaps(box, o, 0, 0)) inner += 1000 }
      for (const [px, py, wt, tag] of cv.obs) {
        if (q.ignore && q.ignore.includes(tag)) continue
        if (px > box[0] - 3 && px < box[2] + 3 && py > box[1] - 3 && py < box[3] + 3) {
          s += wt
          if (px > box[0] && px < box[2] && py > box[1] && py < box[3]) { inner += wt; if (wt >= 1) hard++ }
        }
        else if (q.own && tag !== q.own && typeof tag === 'string' && tag.startsWith('f:') &&
          px > box[0] - 9 && px < box[2] + 9 && py > box[1] - 9 && py < box[3] + 9) s += 0.2
        else if (q.avoid && q.avoid.has(tag) && px > box[0] - 20 && px < box[2] + 20 && py > box[1] - 20 && py < box[3] + 20) s += 1.5
      }
      if (!best || s < best.s - 1e-9) best = { s, box, hard, inner }
    })
    if (!best) continue
    taken.push(best.box)
    cv.ext.push([best.box[0], best.box[1]], [best.box[2], best.box[3]])
    out.push({ ...q, box: best.box, score: best.s, hard: best.hard, inner: best.inner })
  }
  return out
}

/** Draw placed labels; one that still crosses a stroke gets a backing box in the background color. */
export function drawLabels(placed, cv, theme) {
  for (const q of placed) {
    const [x1, y1, x2, y2] = q.box
    if (q.inner >= 1) cv.front.push(el('rect', { x: x1 - 1, y: y1, width: x2 - x1 + 2, height: y2 - y1, rx: 3, fill: theme.halo, 'fill-opacity': 0.9, class: 'tv-label-bg' }))
    cv.front.push(labelSvg(q.label, (x1 + x2) / 2, y2 - 4.5, theme, { size: q.size, fill: q.fill }))
  }
}

/**
 * A uniform field over `region` [x0, y0, x1, y1]: ⊗/⊙ marks, or short arrows along `sd`
 * (screen unit), skipping any spot near a stroke or a label. Returns the count drawn.
 */
export function drawField(cv, region, field, placed, cornerBox, theme) {
  const [x0, y0, x1, y1] = region
  const S = 40
  const nx = Math.max(1, Math.floor((x1 - x0) / S)), ny = Math.max(1, Math.floor((y1 - y0) / S))
  const ox = x0 + (x1 - x0 - (nx - 1) * S) / 2, oy = y0 + (y1 - y0 - (ny - 1) * S) / 2
  const boxes = [...placed.map((q) => q.box), cornerBox].filter(Boolean)
  const stroke = theme.faint
  let n = 0
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const c = [ox + i * S, oy + j * S]
    const half = field.sd ? 13 : 9
    const box = [c[0] - half, c[1] - half, c[0] + half, c[1] + half]
    if (boxes.some((b) => overlaps(box, b, 3, 3))) continue
    if (cv.obs.some(([px, py]) => px > box[0] - 3 && px < box[2] + 3 && py > box[1] - 3 && py < box[3] + 3)) continue
    if (field.sd) {
      const a = V.sub(c, V.mul(field.sd, 11)), b = V.add(c, V.mul(field.sd, 11))
      const before = cv.obs.length
      arrow(cv, a, b, stroke, { width: 1.1, head: 6, layer: 'back' })
      cv.obs.length = before
    } else fieldMark(cv, c, field.into, stroke)
    n++
  }
  return n
}
