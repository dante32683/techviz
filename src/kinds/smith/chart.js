// The chart itself: the unit circle, constant-r circles and constant-x arcs (and their mirror, the
// admittance grid), their value labels, and the optional outer scales (wavelengths toward the
// generator or load, and the angle of Γ). Γ maps to the screen with P(Γ) = center + R·(re, −im).

import { el, pathD } from '../../svg.js'
import { labelSvg, measure } from '../../label.js'
import { gammaOf } from './rf.js'

export const GRID_VALUES = [0.2, 0.5, 1, 2, 5]
const GS = 9 // grid label size

/** Γ points around the constant-r circle (or constant-g with `mirror`). */
export function rCircle(r, mirror = false, n = 96) {
  const c = r / (1 + r), rad = 1 / (1 + r), s = mirror ? -1 : 1
  return Array.from({ length: n + 1 }, (_, k) => { const a = (2 * Math.PI * k) / n; return [s * (c + rad * Math.cos(a)), s * rad * Math.sin(a)] })
}
/** Γ points along the constant-x arc inside the chart, from the rim to the open (or its mirror). */
export function xArc(x, mirror = false, n = 64) {
  const s = mirror ? -1 : 1
  return Array.from({ length: n + 1 }, (_, k) => { const g = gammaOf([Math.tan((Math.PI / 2) * (k / n) * 0.999999), x]); return [s * g[0], s * g[1]] })
}

/** A label set along a ring at angle `th` (radians, Γ-plane), turned to read along the ring, upright. */
export function ringLabel(text, F, th, radius, theme, { size = GS, fill = theme.muted } = {}) {
  const x = F.cx + radius * Math.cos(th), y = F.cy - radius * Math.sin(th)
  const d = (th * 180) / Math.PI
  const rot = Math.sin(th) >= -1e-9 ? 90 - d : -90 - d
  return { svg: `<g transform="translate(${x.toFixed(2)},${y.toFixed(2)}) rotate(${rot.toFixed(2)})">${labelSvg(text, 0, 0, theme, { size, fill, middle: true })}</g>`, at: [x, y], w: measure(text, size), h: size }
}

/**
 * The grid: rim, real axis, r circles and x arcs at GRID_VALUES, labeled (r on the real axis, x
 * just outside the rim). `admittance` adds the g and b grid in a tint. Returns svg parts (back
 * layer), label svg, and the label boxes so placed labels keep clear of them.
 */
export function drawGrid(F, theme, { admittance = false, ytint, busy = [] }) {
  const back = [], labels = [], boxes = []
  const line = (pts, stroke, w = 1, extra = {}) => back.push(el('path', { d: pathD(pts.map(F.P)), fill: 'none', stroke, 'stroke-width': w, ...extra }))
  const gridStroke = theme.faint, gridOp = theme.name === 'dark' ? 0.55 : 0.45
  if (admittance) {
    for (const r of GRID_VALUES) line(rCircle(r, true), ytint, r === 1 ? 1.1 : 0.8, { 'stroke-opacity': r === 1 ? 0.55 : 0.28 })
    for (const x of GRID_VALUES) for (const s of [1, -1]) line(xArc(s * x, true), ytint, 0.8, { 'stroke-opacity': 0.28 })
  }
  for (const r of GRID_VALUES) line(rCircle(r), gridStroke, r === 1 ? 1.1 : 0.8, { 'stroke-opacity': r === 1 ? Math.min(1, gridOp + 0.25) : gridOp })
  for (const x of GRID_VALUES) for (const s of [1, -1]) line(xArc(s * x), gridStroke, 0.8, { 'stroke-opacity': gridOp })
  line([[-1, 0], [1, 0]], gridStroke, 0.9, { 'stroke-opacity': Math.min(1, gridOp + 0.15) })
  back.push(el('circle', { cx: F.cx, cy: F.cy, r: F.R, fill: 'none', stroke: theme.muted, 'stroke-width': 1.3 }))
  // r values on the real axis, each centered on its circle's crossing, on a backing box.
  for (const r of GRID_VALUES) {
    const [x, y] = F.P([(r - 1) / (r + 1), 0])
    const t = String(r), w = measure(t, GS)
    const box = [x - w / 2 - 1.5, y - GS - 1, x + w / 2 + 1.5, y - 1]
    if (busy.some((p) => p[0] > box[0] - 5 && p[0] < box[2] + 5 && p[1] > box[1] - 5 && p[1] < box[3] + 5)) continue
    labels.push(el('rect', { x: box[0], y: box[1], width: box[2] - box[0], height: box[3] - box[1], fill: theme.halo, 'fill-opacity': 0.92 }))
    labels.push(labelSvg(t, x, y - 2.5, theme, { size: GS, fill: theme.muted }))
    boxes.push(box)
  }
  // x values just outside the rim, read along it: j0.5 above, −j0.5 below.
  for (const x of GRID_VALUES) for (const s of [1, -1]) {
    const th = s * (Math.PI - 2 * Math.atan(x))
    const lab = ringLabel(`${s < 0 ? '−' : ''}j${x}`, F, th, F.R + 7, theme)
    labels.push(lab.svg)
    const half = Math.max(lab.w, lab.h) / 2 + 1
    boxes.push([lab.at[0] - half, lab.at[1] - half, lab.at[0] + half, lab.at[1] + half])
  }
  return { back, labels, boxes, outer: F.R + 12 }
}

const SCALES = {
  // Wavelengths toward the generator: 0 at the short, clockwise, a full turn per 0.5 λ.
  wtg: { n: 50, major: 5, ang: (k) => Math.PI - (4 * Math.PI * k) / 100, text: (k) => (k % 50 === 0 ? '0' : (k / 100).toFixed(2).replace(/^0/, '')) },
  wtl: { n: 50, major: 5, ang: (k) => Math.PI + (4 * Math.PI * k) / 100, text: (k) => (k % 50 === 0 ? '0' : (k / 100).toFixed(2).replace(/^0/, '')) },
  // The angle of Γ in degrees, counterclockwise from the open.
  angle: { n: 36, major: 3, ang: (k) => (k * Math.PI) / 18, text: (k) => { const d = k * 10 > 180 ? k * 10 - 360 : k * 10; return `${d < 0 ? '−' : ''}${Math.abs(d)}°` } },
}
export const SCALE_NAMES = Object.keys(SCALES)
const SCALE_TITLES = { wtg: 'λ → gen', wtl: 'λ → load', angle: '∠Γ' }

/** Outer rings, inside out, starting at radius r0. Returns svg parts and the outer radius. */
export function drawScales(F, theme, names, r0) {
  const parts = []
  let r = r0
  for (const name of names) {
    const S = SCALES[name]
    parts.push(el('circle', { cx: F.cx, cy: F.cy, r, fill: 'none', stroke: theme.faint, 'stroke-width': 0.9 }))
    for (let k = 0; k < S.n; k++) {
      const a = S.ang(k), major = k % S.major === 0
      const len = major ? 4 : 2
      const c = Math.cos(a), s = -Math.sin(a)
      parts.push(el('line', { x1: F.cx + r * c, y1: F.cy + r * s, x2: F.cx + (r + len) * c, y2: F.cy + (r + len) * s, stroke: theme.faint, 'stroke-width': 0.8 }))
      // The ring's title takes its zero's spot (the short for wavelengths, the open for the angle).
      if (major && k) parts.push(ringLabel(S.text(k), F, a, r + 10, theme, { size: 8 }).svg)
    }
    parts.push(ringLabel(`\\text{${SCALE_TITLES[name]}}`, F, S.ang(0), r + 10, theme, { size: 8, fill: theme.fg }).svg)
    r += 17
  }
  return { parts, outer: r - 3 }
}
