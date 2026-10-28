// Phasor and impedance diagrams: vectors from the origin or head to tail (a chain), the
// resultant, a reference phasor along +x, the angle arc, optional axes, and the v(t) and i(t)
// waves each phasor's vertical projection traces. Points come in diagram units (V, A, Ω, or S)
// with y up; the canvas is screen px with y down.

import { el, pathD } from '../../svg.js'
import { V, arrow, arcPoints } from '../fbd/draw.js'
import { arrowCands, placeLabels, drawLabels, extent } from '../fbd/place.js'

const cross = (a, b) => a[0] * b[1] - a[1] * b[0]

/**
 * opts: { legs: [{z, label, color, width, tag}], total: {z, label, color}, ref: {label, color} | null,
 * chain, net: {label} | null (dashed leg from the real part of total to its tip), arc: {from, to, label},
 * axes: {x, y} | null, wave: {v, i} | null, size }
 */
export function drawVectors(cv, theme, o) {
  const fs = theme.size
  // With waves beside it, each wave's amplitude is its phasor's length, so the diagram is smaller.
  const D = o.size ?? (o.wave ? 110 : 200)
  // Chain points (or tips from the origin) in units, then one scale for all of them.
  const tips = []
  let acc = [0, 0]
  for (const g of o.legs) {
    const d = [g.z.re, g.z.im]
    if (o.chain) { tips.push([acc, [acc[0] + d[0], acc[1] + d[1]]]); acc = [acc[0] + d[0], acc[1] + d[1]] } else tips.push([[0, 0], d])
  }
  const T = [o.total.z.re, o.total.z.im]
  const all = [[0, 0], T, ...tips.flat()]
  const span = Math.max(...[0, 1].map((k) => Math.max(...all.map((p) => p[k])) - Math.min(...all.map((p) => p[k]))), 1e-300)
  const S = D / span
  const P = (p) => [p[0] * S, -p[1] * S]
  const O = [0, 0], tip = P(T)
  const totalLen = V.len(tip)
  cv.ext.push(O)

  // Axes: faint lines through the origin, or labeled complex-plane axes.
  const xs = all.map((p) => p[0] * S), ys = all.map((p) => -p[1] * S)
  const pad = 22
  // Complex-plane axes run further right, so "Re Z" clears a label beside the real leg.
  const ax = [Math.min(0, ...xs) - pad, Math.max(...xs) + (o.axes ? 64 : pad)], ay = [Math.min(0, ...ys) - pad, Math.max(...ys) + pad]
  if (o.axes) {
    arrow(cv, [ax[0], 0], [ax[1] + 8, 0], theme.muted, { width: 1.1, head: 8, tag: 'axis', layer: 'back' })
    arrow(cv, [0, ay[1]], [0, ay[0] - 8], theme.muted, { width: 1.1, head: 8, tag: 'axis', layer: 'back' })
  } else {
    cv.back.push(el('line', { x1: ax[0], y1: 0, x2: 0, y2: 0, stroke: theme.faint, 'stroke-width': 1, 'stroke-dasharray': '3 3' }))
    cv.trace([[ax[0], 0], [0, 0]], 'axis', 0.3)
  }

  // Head to tail, a leg that doubles back on the one before (V_L then V_C) would hide it, so the
  // two move 5 px apart sideways (the second away from the resultant): both keep their true
  // direction, and the cancelling overlap reads as two arrows side by side.
  let pts = tips.map(([a, b]) => [P(a), P(b)])
  if (o.chain) {
    const off = pts.map(() => [0, 0])
    for (let k = 1; k < pts.length; k++) {
      const a = V.sub(pts[k - 1][1], pts[k - 1][0]), b = V.sub(pts[k][1], pts[k][0])
      if (V.len(a) < 1 || V.len(b) < 1 || Math.abs(cross(V.unit(a), V.unit(b))) > 0.03 || V.dot(a, b) > 0) continue
      let n = V.perp(V.unit(a))
      const side = (p) => Math.abs(cross(V.unit(tip), p))
      if (side(V.add(pts[k][0], n)) < side(V.sub(pts[k][0], n))) n = V.mul(n, -1)
      off[k - 1] = V.sub(off[k - 1], V.mul(n, 5)); off[k] = V.add(off[k], V.mul(n, 5))
    }
    pts = pts.map(([a, b], k) => [V.add(a, off[k]), V.add(b, off[k])])
  }

  const items = []
  // The angle arc from `from` to `to` (math degrees, the reference at 0).
  if (o.arc && Math.abs(o.arc.to - o.arc.from) > 0.3) {
    const r = Math.max(20, Math.min(42, totalLen * 0.32))
    const arc = arcPoints(O, r, o.arc.from, o.arc.to, 30)
    cv.mid.push(el('path', { d: pathD(arc), fill: 'none', stroke: theme.fg, 'stroke-width': 1.2 }))
    cv.trace(arc, 'arc')
    // Spots just outside the arc: on its bisector, then past the end that meets the resultant,
    // then before the start (across the reference axis).
    const mid = (o.arc.from + o.arc.to) / 2, dir = Math.sign(o.arc.to - o.arc.from)
    const angs = [mid, mid + 14, mid - 14, o.arc.to + dir * 16, o.arc.to + dir * 32, o.arc.from - dir * 18, o.arc.from - dir * 36]
    const cands = angs.map((ang) => {
      const u = [Math.cos((ang * Math.PI) / 180), -Math.sin((ang * Math.PI) / 180)]
      return (w, h) => V.add(O, V.mul(u, r + 5 + extent(u, w, h)))
    })
    // Beside the resultant where the arc meets it, on the side away from the arc.
    const ut = V.unit(tip), um = [Math.cos((mid * Math.PI) / 180), -Math.sin((mid * Math.PI) / 180)]
    let nOut = V.perp(ut)
    if (V.dot(nOut, um) > 0) nOut = V.mul(nOut, -1)
    for (const k of [0.8, 1.3]) cands.splice(3, 0, (w, h) => V.add(V.mul(ut, r * k), V.mul(nOut, 6 + extent(nOut, w, h))))
    items.push({ label: o.arc.label, size: fs, fill: theme.fg, cands })
  }

  // The reference phasor (another unit) marks the +x direction: a thin arrow past everything
  // drawn, so the in-phase leg on top of it (V_R) stays visible.
  let refTip = null
  if (o.ref) {
    refTip = [Math.max(...xs, 0) + 30, 0]
    arrow(cv, O, refTip, o.ref.color, { width: 1.6, head: 10, tag: 'ref', layer: 'back' })
    // With waves to the right, the label sits above or below the tip, ending at it.
    const hang = [-1, 1].map((s) => (w, h) => [refTip[0] - w / 2 + 4, s * (h / 2 + 6)])
    items.unshift({ label: o.ref.label, size: fs, fill: o.ref.color, cands: o.wave ? [...hang, ...arrowCands(O, refTip)] : [...arrowCands(O, refTip), ...hang], own: 'f:ref' })
  }

  // Short legs have the fewest good label spots, so they choose first.
  const legItems = []
  o.legs.forEach((g, k) => {
    const [a, b] = pts[k]
    arrow(cv, a, b, g.color, { width: g.width ?? 2, head: 9, tag: `f:${k}` })
    if (g.label && V.len(V.sub(b, a)) >= 1) legItems.push({ label: g.label, size: fs, fill: g.color, cands: legCands(a, b), own: `f:${k}`, len: V.len(V.sub(b, a)) })
  })
  items.push(...legItems.sort((p, q) => p.len - q.len))
  if (o.net && Math.abs(tip[1]) > 2) {
    const foot = [tip[0], 0]
    cv.mid.push(el('line', { x1: foot[0], y1: foot[1], x2: tip[0], y2: tip[1], stroke: theme.muted, 'stroke-width': 1.3, 'stroke-dasharray': '5 4' }))
    cv.trace([foot, tip], 'f:net')
    if (o.net.label) items.push({ label: o.net.label, size: fs, fill: theme.muted, cands: arrowCands(foot, tip).slice(1), own: 'f:net' })
  }
  arrow(cv, O, tip, o.total.color, { width: 2.8, head: 11, tag: 'f:total' })
  items.unshift({ label: o.total.label, size: fs, fill: o.total.color, cands: arrowCands(O, tip), own: 'f:total' })

  let waveItems = []
  if (o.wave) waveItems = drawWaves(cv, theme, o.wave, { tip, refLen: 0.5 * Math.max(totalLen, ...pts.map(([a, b]) => V.len(V.sub(b, a)))), right: Math.max(...xs, refTip ? refTip[0] : 0, 0) + 68 })
  if (o.axes) {
    items.unshift({ label: o.axes.x, size: fs, fill: theme.muted, cands: [(w) => [ax[1] + 12 + w / 2, 0], (w, h) => [ax[1] + 8 - w / 2, h / 2 + 6]] })
    items.unshift({ label: o.axes.y, size: fs, fill: theme.muted, cands: [(w, h) => [0, ay[0] - 12 - h / 2], (w) => [w / 2 + 8, ay[0] - 2]] })
  }
  const placed = placeLabels([...items, ...waveItems], cv)
  drawLabels(placed, cv, theme)
  return placed.filter((q) => q.hard > 0)
}

/** v(t) and i(t) over one cycle to the right: each starts at its phasor's vertical projection. */
function drawWaves(cv, theme, w, { tip, refLen, right }) {
  const refTip = w.ref ? [refLen, 0] : null
  const W = 100, x0 = right
  const items = []
  arrow(cv, [x0 - 4, 0], [x0 + W + 12, 0], theme.muted, { width: 1.1, head: 8, tag: 'axis', layer: 'back' })
  const amp = Math.max(V.len(tip), refTip ? refLen : 0, 30) + 8
  cv.back.push(el('line', { x1: x0, y1: -amp, x2: x0, y2: amp, stroke: theme.muted, 'stroke-width': 1.1 }))
  cv.trace([[x0, -amp], [x0, amp]], 'axis')
  items.push({ label: '\\omega t', size: theme.size, fill: theme.muted, cands: [[x0 + W + 14, 12], [x0 + W + 14, -12]] })
  const curve = (p, color, label, tag, dashed) => {
    const A = V.len(p), th = Math.atan2(-p[1], p[0])
    const pts = Array.from({ length: 73 }, (_, k) => { const t = (2 * Math.PI * k) / 72; return [x0 + (W * k) / 72, -A * Math.sin(th + t)] })
    cv.mid.push(el('path', { d: pathD(pts), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-dasharray': dashed ? '6 3' : undefined }))
    cv.trace(pts, tag)
    // The projection: a dotted line from the phasor's tip across to t = 0.
    if (Math.abs(p[1]) > 1) {
      cv.back.push(el('line', { x1: p[0], y1: p[1], x2: x0, y2: p[1], stroke: color, 'stroke-width': 1, 'stroke-dasharray': '2 3', 'stroke-opacity': 0.8 }))
      cv.back.push(el('circle', { cx: x0, cy: p[1], r: 2.6, fill: color }))
      cv.trace([p, [x0, p[1]]], 'proj', 0.3)
    }
    const peak = pts.reduce((m, q) => (q[1] < m[1] ? q : m), pts[0])
    items.push({ label, size: theme.size, fill: color, cands: [[peak[0], peak[1] - 11], [peak[0] + 14, peak[1] - 8], [peak[0] - 14, peak[1] - 8], [x0 + W + 10, pts[72][1]]], own: tag })
  }
  curve(tip, w.total.color, w.total.label, 'f:tw')
  if (refTip) curve(refTip, w.ref.color, w.ref.label, 'f:rw', true)
  return items
}

/** An arrow's label spots, plus spots that hang past the tip or behind the tail (for short legs). */
function legCands(a, b) {
  const d = V.unit(V.sub(b, a)), n = V.perp(d)
  const out = arrowCands(a, b)
  out.push((w, h) => V.sub(a, V.mul(d, 6 + extent(d, w, h))))
  for (const s of [n, V.mul(n, -1)]) {
    out.push((w, h) => V.add(V.add(b, V.mul(d, extent(d, w, h) - 8)), V.mul(s, 7 + extent(s, w, h))))
    out.push((w, h) => V.add(V.sub(a, V.mul(d, extent(d, w, h) - 10)), V.mul(s, 7 + extent(s, w, h))))
  }
  return out
}
