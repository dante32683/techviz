// circuit part types: geometry tables and IEC 60617 symbol drawing.
// Geometry is in grid units (U px each); symbols are drawn in px in a local
// frame: u along the part's direction, w across it (w > 0 is clockwise of the
// direction on screen, so for a part drawn right, w > 0 is down).

import { el, pts } from '../../svg.js'
import { labelSvg } from '../../label.js'

export const U = 26

// Two-terminal parts. body: symbol length along the part (px); hw: half its
// width across (px), used for label clearance (hw2: on the -w side, if
// different); pol: how the netlist names the
// pins ('v': X+ at end and X- at start; 'i': X.start and X.end, the arrow points
// start to end; 'd': X.a anode at start and X.k cathode at end; none: just X).
export const TWO = {
  R: { body: 34, hw: 6 }, C: { body: 8, hw: 12 }, Cp: { body: 11, hw: 12, pol: 'v' }, L: { body: 36, hw: 6 },
  V: { body: 30, hw: 15, pol: 'v' }, I: { body: 30, hw: 15, pol: 'i' }, AC: { body: 30, hw: 15 },
  battery: { body: 8, hw: 13, pol: 'v' }, switch: { body: 26, hw: 9 },
  diode: { body: 12, hw: 7, pol: 'd' }, led: { body: 12, hw: 7, hw2: 20, pol: 'd' }, zener: { body: 12, hw: 9, pol: 'd' },
  lamp: { body: 26, hw: 13 }, voltmeter: { body: 28, hw: 14 }, ammeter: { body: 28, hw: 14 },
  fuse: { body: 32, hw: 5 }, pot: { body: 34, hw: 6 },
  vcvs: { body: 32, hw: 16, pol: 'v' }, ccvs: { body: 32, hw: 16, pol: 'v' },
  vccs: { body: 32, hw: 16, pol: 'i' }, cccs: { body: 32, hw: 16, pol: 'i' },
}

// Multi-terminal parts: pins in grid units in the local frame (u, w), the pin
// placed at the cursor by default, and the pin the cursor moves to afterwards.
export const MULTI = {
  opamp: { pins: { 'in-': [0, -1], 'in+': [0, 1], out: [4, 0] }, pin: 'in-', next: 'out' },
  npn: { pins: { b: [0, 0], c: [2, -2], e: [2, 2] }, pin: 'b', next: 'c' },
  pnp: { pins: { b: [0, 0], e: [2, -2], c: [2, 2] }, pin: 'b', next: 'c' },
  nmos: { pins: { g: [0, 0], d: [2, -2], s: [2, 2] }, pin: 'g', next: 'd' },
  pmos: { pins: { g: [0, 0], s: [2, -2], d: [2, 2] }, pin: 'g', next: 'd' },
}

export const POINT = ['ground', 'dot', 'terminal', 'label']
export const TYPES = [...Object.keys(TWO), ...Object.keys(MULTI), ...POINT, 'wire']

// ---- small drawing helpers (px) ----
const add = (a, b) => [a[0] + b[0], a[1] + b[1]]
const mul = (a, k) => [a[0] * k, a[1] * k]
const norm = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l] }

export const line = (a, b, extra = {}) => el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], ...extra })
export const polyline = (list, extra = {}) => el('polyline', { points: pts(list), ...extra })
export const polygon = (list, extra = {}) => el('polygon', { points: pts(list), ...extra })
export const circle = (c, r, extra = {}) => el('circle', { cx: c[0], cy: c[1], r, ...extra })

/** A filled arrowhead with its tip at `tip`, pointing along `dir`. */
export function arrowHead(tip, dir, fill, len = 8, half = 3.4) {
  const d = norm(dir), n = [-d[1], d[0]]
  const base = add(tip, mul(d, -len))
  return polygon([tip, add(base, mul(n, half)), add(base, mul(n, -half))], { fill, stroke: 'none' })
}

/** Upright + and − signs (always screen-aligned, like printed signs). */
export const plusSign = (c, color, s = 3.6) =>
  line([c[0] - s, c[1]], [c[0] + s, c[1]], { stroke: color, 'stroke-width': 1.6 }) + line([c[0], c[1] - s], [c[0], c[1] + s], { stroke: color, 'stroke-width': 1.6 })
export const minusSign = (c, color, s = 3.6) => line([c[0] - s, c[1]], [c[0] + s, c[1]], { stroke: color, 'stroke-width': 1.6 })

/** Local frame for a part starting at px point A along unit vector d. */
export function frame(A, d, flip = false) {
  const n = flip ? [d[1], -d[0]] : [-d[1], d[0]]
  return { A, d, n, T: (u, w) => [A[0] + u * d[0] + w * n[0], A[1] + u * d[1] + w * n[1]] }
}

/**
 * Draw a two-terminal symbol, leads included. f: frame; Lp: length in px.
 * o: { col, theme, closed, ansi, markSide, trim0, trim1 } (trim: px cut from
 * each lead end, for terminal rings; markSide: ±1, the side for a
 * battery or polarized-capacitor + mark, away from the labels).
 * Returns { svg, extra: [[a, b, r]] } (extra obstacles in px beyond the body).
 */
export function drawTwo(t, f, Lp, o) {
  const { T } = f
  const g = TWO[t]
  const mid = Lp / 2, b0 = mid - g.body / 2, b1 = mid + g.body / 2
  const { col, theme } = o
  const out = []
  const extra = []
  const lead = (u0, u1) => { if (u1 - u0 > 0.01) out.push(line(T(u0, 0), T(u1, 0))) }
  const s0 = o.trim0 ?? 0, s1 = Lp - (o.trim1 ?? 0)
  const leads = (i0 = b0, i1 = b1) => { lead(s0, i0); lead(i1, s1) }
  const ring = (r) => out.push(circle(T(mid, 0), r))
  const c = T(mid, 0)
  switch (t) {
    case 'R': case 'pot': {
      leads()
      const hw = g.hw
      if (o.ansi) {
        const k = 6, step = g.body / k
        const zz = [T(b0, 0)]
        for (let j = 0; j < k; j++) zz.push(T(b0 + (j + 0.5) * step, j % 2 ? hw : -hw))
        zz.push(T(b1, 0))
        out.push(polyline(zz))
      } else out.push(polygon([T(b0, -hw), T(b1, -hw), T(b1, hw), T(b0, hw)]))
      if (t === 'pot') {
        const s = o.wiper
        const W = T(mid, s * U), tip = T(mid, s * (hw + 1.5))
        out.push(line(W, T(mid, s * (hw + 8))), arrowHead(tip, [tip[0] - W[0], tip[1] - W[1]], col))
        extra.push([W, tip, 1])
      }
      break
    }
    case 'fuse':
      lead(s0, s1)
      out.push(polygon([T(b0, -g.hw), T(b1, -g.hw), T(b1, g.hw), T(b0, g.hw)]))
      break
    case 'C':
      leads()
      out.push(line(T(b0, -12), T(b0, 12)), line(T(b1, -12), T(b1, 12)))
      break
    case 'Cp': {
      // Straight + plate at the end; the curved − plate's middle faces it, its tips curl back.
      leads(b0 + 4.5, b1)
      out.push(line(T(b1, -12), T(b1, 12)))
      out.push(el('path', { d: `M${pts([T(b0, -12)])}Q${pts([T(b0 + 9, 0)])} ${pts([T(b0, 12)])}` }))
      out.push(plusSign(T(b1 + 6, o.markSide * 12), theme.positive, 3))
      break
    }
    case 'L': {
      leads()
      const k = 4, r = g.body / k / 2
      let d = `M${pts([T(b0, 0)])}`
      for (let j = 1; j <= k; j++) d += `A${r} ${r} 0 0 ${o.flip ? 0 : 1} ${pts([T(b0 + 2 * r * j, 0)])}`
      out.push(el('path', { d }))
      break
    }
    case 'V': case 'I': case 'AC': {
      const r = g.body / 2
      leads(); ring(r)
      if (t === 'V') { out.push(plusSign(T(mid + 7, 0), theme.positive), minusSign(T(mid - 7, 0), theme.negative)) }
      if (t === 'I') { out.push(line(T(mid - 9, 0), T(mid + 4, 0)), arrowHead(T(mid + 10, 0), f.d, col, 7, 3.4)) }
      if (t === 'AC') {
        const wave = []
        for (let k = 0; k <= 24; k++) { const x = -8 + (16 * k) / 24; wave.push([c[0] + x, c[1] - 4.5 * Math.sin((Math.PI * x) / 8)]) }
        out.push(polyline(wave))
      }
      break
    }
    case 'vcvs': case 'ccvs': case 'vccs': case 'cccs': {
      const h = g.body / 2
      leads()
      out.push(polygon([T(b0, 0), T(mid, -h), T(b1, 0), T(mid, h)]))
      if (g.pol === 'v') out.push(plusSign(T(mid + 7, 0), theme.positive, 3.2), minusSign(T(mid - 7, 0), theme.negative, 3.2))
      else out.push(line(T(mid - 8, 0), T(mid + 3, 0)), arrowHead(T(mid + 9, 0), f.d, col, 6.5, 3.2))
      break
    }
    case 'battery':
      leads()
      out.push(line(T(b1, -13), T(b1, 13)), line(T(b0, -6.5), T(b0, 6.5), { 'stroke-width': 3.2 }))
      out.push(plusSign(T(b1 + 7, o.markSide * 12), theme.positive, 3))
      break
    case 'switch': {
      leads()
      const tip = o.closed ? T(b1, 0) : T(b0 + g.body * Math.cos(0.5), -g.body * Math.sin(0.5))
      out.push(line(T(b0, 0), tip))
      out.push(circle(T(b0, 0), 2.3, { fill: col, stroke: 'none' }), circle(T(b1, 0), 2.3, { fill: col, stroke: 'none' }))
      break
    }
    case 'diode': case 'led': case 'zener': {
      leads()
      out.push(polygon([T(b0, -7), T(b0, 7), T(b1, 0)], { fill: col }))
      if (t === 'zener') out.push(polyline([T(b1 - 3.5, -9), T(b1, -7), T(b1, 7), T(b1 + 3.5, 9)]))
      else out.push(line(T(b1, -7), T(b1, 7)))
      if (t === 'led') {
        const dir = norm(add(mul(f.d, 0.55), mul(f.n, -1)))
        for (const du of [-2.5, 3.5]) {
          const s = T(mid + du, -8.5), e = add(s, mul(dir, 9))
          out.push(line(s, add(s, mul(dir, 5))), arrowHead(e, dir, col, 5, 2.4))
        }
      }
      break
    }
    case 'lamp': {
      const r = g.body / 2, k = r * 0.7071
      leads(); ring(r)
      out.push(line(T(mid - k, -k), T(mid + k, k)), line(T(mid - k, k), T(mid + k, -k)))
      break
    }
    case 'voltmeter': case 'ammeter':
      leads(); ring(g.body / 2)
      out.push(el('g', { stroke: 'none' }, labelSvg(t === 'voltmeter' ? '\\text{V}' : '\\text{A}', c[0], c[1], theme, { fill: col, middle: true, size: 14 })))
      break
  }
  return { svg: out.join(''), extra, b0, b1 }
}

/** Draw a multi-terminal part. T(u, w) maps local px to screen px. Returns svg and a px bbox list. */
export function drawMulti(t, T0, o) {
  const { col, theme } = o
  const out = []
  // Sizes below are px at 24 px per grid unit, scaled to U so pins stay on the grid.
  const k = U / 24
  const T = (u, w) => T0(u * k, w * k)
  const P = (u, w) => T(u * 24, w * 24)
  if (t === 'opamp') {
    const tri = [T(14, -42), T(14, 42), T(84, 0)]
    out.push(line(P(0, -1), T(14, -24)), line(P(0, 1), T(14, 24)), line(T(84, 0), P(4, 0)))
    out.push(polygon(tri))
    out.push(minusSign(T(23, -24), theme.negative), plusSign(T(23, 24), theme.positive))
    return { svg: out.join(''), box: tri }
  }
  if (t === 'npn' || t === 'pnp') {
    const top = t === 'npn' ? 'c' : 'e'
    out.push(line(P(0, 0), T(26, 0)), line(T(26, -14), T(26, 14), { 'stroke-width': 3 }))
    out.push(polyline([T(26, -6), T(48, -21), P(2, -2)]), polyline([T(26, 6), T(48, 21), P(2, 2)]))
    out.push(circle(T(37, 0), 24))
    // Emitter arrow: npn points out of the base on the bottom lead; pnp points in on the top lead.
    if (top === 'c') { const a = T(26, 6), b = T(48, 21); out.push(arrowHead(T(44, 18.3), [b[0] - a[0], b[1] - a[1]], col, 7, 3.2)) }
    else { const a = T(48, -21), b = T(26, -6); out.push(arrowHead(T(32, -10.1), [b[0] - a[0], b[1] - a[1]], col, 7, 3.2)) }
    return { svg: out.join(''), box: [T(13, -24), T(61, -24), T(61, 24), T(13, 24), P(2, -2), P(2, 2), P(0, 0)] }
  }
  // MOSFET, simple textbook form: gate plate, channel, drain and source stubs, arrow on the source.
  const srcTop = t === 'pmos'
  out.push(line(P(0, 0), T(21, 0)), line(T(21, -15), T(21, 15)), line(T(27, -19), T(27, 19), { 'stroke-width': 2.4 }))
  out.push(polyline([T(27, -13), T(48, -13), P(2, -2)]), polyline([T(27, 13), T(48, 13), P(2, 2)]))
  const sw = srcTop ? -13 : 13
  if (t === 'nmos') out.push(arrowHead(T(43, sw), [T(1, 0)[0] - T(0, 0)[0], T(1, 0)[1] - T(0, 0)[1]], col, 7, 3.2))
  else out.push(arrowHead(T(31, sw), [T(0, 0)[0] - T(1, 0)[0], T(0, 0)[1] - T(1, 0)[1]], col, 7, 3.2))
  return { svg: out.join(''), box: [T(21, -19), T(48, -19), T(48, 19), T(21, 19), P(2, -2), P(2, 2), P(0, 0)] }
}

/** Ground: a lead along d, then three bars (IEC 60617 earth). Returns svg and its px points. */
export function drawGround(p, d) {
  const n = [-d[1], d[0]]
  const at = (k, h) => add(add(p, mul(d, k)), mul(n, h))
  const svg = line(p, at(10, 0)) + line(at(10, -10), at(10, 10)) + line(at(14, -6.5), at(14, 6.5)) + line(at(18, -3), at(18, 3))
  return { svg, box: [p, at(10, -10), at(10, 10), at(18, -10), at(18, 10)] }
}
