// Drawing helpers shared by the optics modes: ray segments (solid or dashed, with a direction
// chevron), angle arcs with label spots, dashed normals, media bands tinted by index, and the
// ray colors. Everything records its strokes on the fbd Canvas so labels keep clear of them.
// Screen px, y down; math angles are degrees counterclockwise from +x with y up.

import { el, pathD } from '../../svg.js'
import { color } from '../../theme.js'
import { V, arcPoints, dirOf } from '../fbd/draw.js'
import { extent } from '../fbd/place.js'

/** Ray colors by role, distinct from each other and from the blue optics bodies. */
export const RAY = { parallel: color('coral'), center: color('green'), focal: color('purple'), vertex: color('teal'), main: color('coral'), second: color('purple'), third: color('teal') }

/** Ray line widths: a real ray, and the dashed virtual extensions and construction lines. */
export const W = { ray: 1.8, virtual: 1.3 }
export const DASH = '5 3'

/** A straight segment, traced for label avoidance. */
export function seg(cv, a, b, stroke, { width = W.ray, dashed = false, dash = DASH, layer = 'mid', tag = 'ray', weight = 1, opacity } = {}) {
  if (!a || !b || V.len(V.sub(b, a)) < 0.5) return
  cv[layer].push(el('line', { x1: +a[0].toFixed(2), y1: +a[1].toFixed(2), x2: +b[0].toFixed(2), y2: +b[1].toFixed(2), stroke, 'stroke-width': width,
    'stroke-dasharray': dashed ? dash : undefined, 'stroke-linecap': dashed ? undefined : 'round', 'stroke-opacity': opacity }))
  cv.trace([a, b], tag, weight)
}

/** A small filled arrowhead on segment a→b at fraction `at`, pointing along it. */
export function chevron(cv, a, b, stroke, { at = 0.5, size = 6, layer = 'mid' } = {}) {
  const L = V.len(V.sub(b, a))
  if (L < size * 3) return
  const d = V.unit(V.sub(b, a)), n = V.perp(d)
  const tip = V.add(a, V.mul(d, L * at + size / 2)), base = V.sub(tip, V.mul(d, size))
  cv[layer].push(el('path', { d: pathD([tip, V.add(base, V.mul(n, size * 0.45)), V.sub(base, V.mul(n, size * 0.45))], true), fill: stroke }))
}

/**
 * An angle arc at `c` of radius r from math angle a1 to a2 (degrees, either way round). Returns
 * label candidates just outside it on its bisector and a little to each side, for placeLabels.
 */
export function angleArc(cv, c, r, a1, a2, stroke, { width = 1.1, layer = 'mid', tag = 'arc' } = {}) {
  const pts = arcPoints(c, r, a1, a2, Math.max(8, Math.ceil(Math.abs(a2 - a1) / 4)))
  cv[layer].push(el('path', { d: pathD(pts), fill: 'none', stroke, 'stroke-width': width }))
  cv.trace(pts, tag, 0.6)
  const mid = (a1 + a2) / 2, span = Math.abs(a2 - a1)
  return [0, 0.3, -0.3, 0.6, -0.6].map((k) => {
    const u = dirOf(mid + k * Math.max(span / 2, 12))
    return (w, h) => V.add(c, V.mul(u, r + 4 + extent(u, w, h)))
  })
}

/** A dashed normal through p along screen direction u, `len` px each way (or [back, forward]). */
export function normal(cv, p, u, len, theme) {
  const [l0, l1] = Array.isArray(len) ? len : [len, len]
  const d = V.unit(u)
  seg(cv, V.sub(p, V.mul(d, l0)), V.add(p, V.mul(d, l1)), theme.muted, { width: 1, dashed: true, dash: '4 3', layer: 'back', tag: 'normal', weight: 0.5 })
}

/** Fill opacity for a medium of index n: none for air, deeper for denser media. */
export const tintFor = (n) => Math.max(0, Math.min(0.3, 0.36 * (n - 1)))

/** A medium as a tinted polygon (screen points), behind everything else. */
export function medium(cv, poly, n, { fill = color('blue'), stroke } = {}) {
  const op = tintFor(n)
  if (op > 0.005) cv.back.push(el('path', { d: pathD(poly, true), fill, 'fill-opacity': +op.toFixed(3), stroke: stroke ?? 'none' }))
  cv.ext.push(...poly)
}

/** The palette color for a wavelength in meters (violet to red), for fringes and dispersion. */
export function waveColor(lambda) {
  const nm = lambda * 1e9
  return color(nm < 450 ? 'purple' : nm < 490 ? 'blue' : nm < 520 ? 'teal' : nm < 570 ? 'green' : nm < 600 ? 'amber' : nm < 630 ? 'coral' : 'red')
}

export { V, dirOf }
