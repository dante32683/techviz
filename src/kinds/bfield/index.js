// bfield: magnetism for E&M problems. Sources (long wires through the page, wires in the page,
// loops face-on or edge-on, solenoids cut along their axis, thick wires, uniform B and E regions)
// sit at problem coordinates (length units, y up, z out of the page); the renderer computes B by
// superposition and draws it as arrows, ⊙/⊗ marks, or traced field lines. On top go Ampère paths
// (enclosed current, ∮B·dl, and the induced E when flux changes), charged-particle paths (Boris
// push: circles, arcs that leave a region, helices in side view, crossed fields), induction loops
// and sliding bars (flux, emf, the Lenz direction of the induced current), torque on loops, and
// forces between wires. The summary states every computed fact for checking.

import { el, pathD } from '../../svg.js'
import { color } from '../../theme.js'
import { SpecError } from '../../diag.js'
import { clipPolyline, clipSegment } from '../../geom.js'
import { V, Canvas, arrow, circlePoly, arcPoints, dirOf, fieldMark } from '../fbd/draw.js'
import { extent, ringCands, arrowCands, placeLabels, drawLabels, drawField } from '../fbd/place.js'
import { LENGTH, fitView, screen, arrowGrid, sheet } from '../field/shared.js'
import { readSources, fields, trace, flux, overlap, quantity, rate, dir3, val, fmt, W, V3, angleOf, pair, MU0, SPECIES } from './physics.js'

const MARGIN = 14
const ARROW = 34 // v and force arrows, px

/** 3 significant figures, in e-notation outside 0.001 to 99 999. */
export function num(x) {
  if (!x || !Number.isFinite(x)) return x === 0 ? '0' : String(x)
  let e = Math.floor(Math.log10(Math.abs(x)))
  if (e >= -3 && e < 5) return fmt(x)
  let m = +(x / 10 ** e).toPrecision(3)
  if (Math.abs(m) >= 10) { m /= 10; e++ }
  return `${m}e${e}`
}
/** A magnitude with an SI prefix for a label: 20 μT, 24 kV/m, 3×10^{6} m/s. */
function pre(x, unit) {
  const a = Math.abs(x)
  if (unit === 'm/s' || !a) {
    if (a && (a >= 1e5 || a < 1e-2)) { const e = Math.floor(Math.log10(a)), m = +(a / 10 ** e).toPrecision(3); return `${m}\\times 10^{${e}} \\text{${unit}}` }
    return `${fmt(a)} \\text{${unit}}`
  }
  // Plain from 0.01 to 9999 (0.5 T, 12 A); a prefix outside it (20 μT, 24 kV/m).
  const e = a >= 0.01 && a < 1e4 ? 0 : Math.max(-9, Math.min(6, Math.floor(Math.log10(a) / 3) * 3))
  return `${fmt(a / 10 ** e)} \\text{${{ '-9': 'n', '-6': 'μ', '-3': 'm', 0: '', 3: 'k', 6: 'M' }[e]}${unit}}`
}
const sub = (sym, name) => `${sym}_{${name}}`
const xy = (p) => `(${fmt(p[0])}, ${fmt(p[1])})`

export default {
  kind: 'bfield',
  fields: ['sources', 'points', 'view', 'unit', 'B', 'paths', 'particles', 'induction', 'forces', 'highlight'],
  collections: ['sources', 'paths', 'particles', 'induction'],
  render(spec, { theme, diag, env }) {
    const unit = spec.unit ?? 'm'
    let lu = LENGTH[unit]
    if (lu === undefined) { diag.warn('unit', `unit is a length unit (${Object.keys(LENGTH).join(', ')}); "${unit}" is treated as meters`); lu = 1 }
    if (!Array.isArray(spec.sources) || !spec.sources.length) {
      throw new SpecError('sources', 'sources lists the currents and fields: {"type": "wire" | "segment" | "loop" | "solenoid" | "cylinder" | "region", ...}, like {"type": "wire", "at": [0, 0], "I": "2 A"}')
    }
    const sources = readSources(spec, env, lu)
    const F = fields(sources, lu)
    const M = (p) => [p[0] * lu, p[1] * lu] // length units to meters
    const Bat = (p) => F.B(M(p))
    const Bcur = (p) => F.B(M(p), (s) => s.type !== 'region')
    const regions = sources.filter((s) => s.type === 'region')
    const currents = sources.filter((s) => s.type !== 'region')
    const highlight = new Set(spec.highlight ?? [])
    const fs = theme.size
    const name = (s) => s.id ?? String(s.i + 1)
    const L = (x) => `${fmt(x)} ${unit}` // a length in the spec's unit
    const FB = color('coral'), FE = color('purple'), MU = color('purple'), IND = theme.highlight, PATH = color('teal')

    // Points.
    const points = new Map()
    if (spec.points !== undefined) {
      if (!spec.points || typeof spec.points !== 'object' || Array.isArray(spec.points)) throw new SpecError('points', 'points is an object of name: [x, y] (or {"at": [x, y], "B": true}), like {"P": [0, 2]}')
      for (const [n, p] of Object.entries(spec.points)) {
        const o = Array.isArray(p) ? { at: p } : p
        if (!o || typeof o !== 'object') throw new SpecError(`points.${n}`, 'a point is [x, y] or {"at": [x, y], "B": true}')
        points.set(n, { name: n, at: pair(o.at, env, `points.${n}.at`), showB: !!o.B, label: o.label ?? n, path: `points.${n}` })
      }
    }

    // Anchors for the automatic view.
    const anchors = []
    const box = (c, hx, hy = hx) => anchors.push([c[0] - hx, c[1] - hy], [c[0] + hx, c[1] + hy])
    for (const s of sources) {
      if (s.type === 'wire' || s.type === 'cylinder') box(s.at, s.r)
      else if (s.type === 'segment') anchors.push(s.a, s.b)
      else if (s.type === 'loop') {
        if (s.edge) anchors.push(...s.ends)
        else if (s.shape === 'circle') box(s.at, s.r)
        else box(s.at, s.w / 2, s.h / 2)
      } else if (s.type === 'solenoid') for (const r of s.rows) anchors.push(r.a, r.b)
      else if (s.box) anchors.push([s.box[0], s.box[1]], [s.box[2], s.box[3]])
      else if (s.circle) box(s.circle.at, s.circle.r)
    }
    for (const p of points.values()) anchors.push(p.at)

    // Ampère / Faraday paths.
    const paths = (spec.paths ?? []).map((pa, i) => {
      const path = `paths[${i}]`
      if (!pa || typeof pa !== 'object') throw new SpecError(path, 'a path is {"at": [x, y], "r": radius} or {"box": [[x0, y0], [x1, y1]]}')
      const sign = { ccw: 1, cw: -1 }[pa.dir ?? 'ccw']
      if (!sign) throw new SpecError(`${path}.dir`, 'dir is ccw (default) or cw, as seen from +z')
      let shape
      if (pa.box !== undefined) {
        const a = pair(pa.box[0], env, `${path}.box[0]`), b = pair(pa.box[1], env, `${path}.box[1]`)
        shape = { rect: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] }
        anchors.push(a, b)
      } else {
        const c = pair(pa.at ?? [0, 0], env, `${path}.at`), r = val(pa.r, env, `${path}.r`)
        if (!(r > 0)) throw new SpecError(`${path}.r`, 'r must be a positive length')
        shape = { circle: [c, r] }
        box(c, r)
      }
      return { i, path, id: pa.id, sign, shape, label: pa.label }
    })

    // Induction loops and sliding bars.
    const loops = (spec.induction ?? []).map((c, i) => readInduction(c, i))
    function readInduction(c, i) {
      const path = `induction[${i}]`
      if (!c || typeof c !== 'object') throw new SpecError(path, 'an induction loop is {"shape": "rect" | "circle" | "rails", ...}')
      const shape = c.shape ?? (c.r !== undefined ? 'circle' : 'rect')
      const o = { i, path, id: c.id, shape, label: c.label, N: c.N === undefined ? 1 : val(c.N, env, `${path}.N`), at: pair(c.at ?? [0, 0], env, `${path}.at`) }
      if (c.R !== undefined) o.R = quantity(c.R, 'R', env, `${path}.R`)
      if (c.v !== undefined || c.dir !== undefined || shape === 'rails') {
        const d = dir3(c.dir ?? 'right', env, `${path}.dir`, { page: false })
        o.u = [d[0], d[1]]
        o.speed = c.v === undefined ? { value: 1, qual: true } : { value: quantity(c.v, 'v', env, `${path}.v`), qual: false }
      }
      if (c.omega !== undefined) { o.omega = quantity(c.omega, 'omega', env, `${path}.omega`); o.theta = val(c.theta ?? 0, env, `${path}.theta`) }
      else o.theta = 0
      if (c.dAdt !== undefined) o.dAdt = rate(c.dAdt, 'dAdt', env, `${path}.dAdt`)
      if (shape === 'rails') {
        o.l = val(c.l, env, `${path}.l`)
        if (!(o.l > 0)) throw new SpecError(`${path}.l`, 'l is the bar length (the rail spacing), a positive length')
        if (Math.abs(o.u[0]) > 1e-9 && Math.abs(o.u[1]) > 1e-9) throw new SpecError(`${path}.dir`, 'the bar slides up, down, left, or right')
        o.u = o.u.map(Math.round)
        o.back = c.back === undefined ? 1.6 * o.l : val(c.back, env, `${path}.back`)
        if (!(o.back > 0)) throw new SpecError(`${path}.back`, 'back is the distance from the bar back to the resistor, a positive length')
        o.n = W.perp(o.u)
        o.shapeAt = (d) => {
          const a = W.add(W.sub(o.at, W.mul(o.u, o.back)), W.mul(o.n, o.l / 2)), b = W.add(W.add(o.at, W.mul(o.u, d)), W.mul(o.n, -o.l / 2))
          return { rect: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] }
        }
        const s0 = o.shapeAt(0).rect
        anchors.push([s0[0], s0[1]], [s0[2], s0[3]], W.add(o.at, W.mul(o.u, o.l * 0.9)))
      } else if (shape === 'circle') {
        o.r = val(c.r, env, `${path}.r`)
        if (!(o.r > 0)) throw new SpecError(`${path}.r`, 'r must be a positive length')
        o.shapeAt = (d) => ({ circle: [o.u ? W.add(o.at, W.mul(o.u, d)) : o.at, o.r] })
        box(o.at, o.r)
      } else if (shape === 'rect') {
        o.w = val(c.w, env, `${path}.w`); o.h = val(c.h, env, `${path}.h`)
        if (!(o.w > 0 && o.h > 0)) throw new SpecError(path, 'a rect loop needs w and h, positive lengths')
        o.shapeAt = (d) => { const q = o.u ? W.add(o.at, W.mul(o.u, d)) : o.at; return { rect: [q[0] - o.w / 2, q[1] - o.h / 2, q[0] + o.w / 2, q[1] + o.h / 2] } }
        box(o.at, o.w / 2, o.h / 2)
      } else throw new SpecError(`${path}.shape`, 'shape is rect (w, h), circle (r), or rails (l, a sliding bar)')
      return o
    }

    // Particles: traced before the view so their paths can widen it.
    const parts = (spec.particles ?? []).map((p, i) => readParticle(p, i))
    for (const p of parts) anchors.push(p.at)
    if (!anchors.length) anchors.push([0, 0])
    function readParticle(p, i) {
      const path = `particles[${i}]`
      if (!p || typeof p !== 'object') throw new SpecError(path, 'a particle is {"type": "proton", "at": [x, y], "v": "3e6 m/s", "dir": "right"}')
      let q, m, lab
      if (p.type !== undefined) {
        const sp = SPECIES[p.type]
        if (!sp) throw new SpecError(`${path}.type`, `type is ${Object.keys(SPECIES).join(', ')}; or give q and m`)
        q = sp.q; m = sp.m; lab = sp.label
      }
      if (p.q !== undefined) q = quantity(p.q, 'q', env, `${path}.q`)
      if (p.m !== undefined) m = quantity(p.m, 'm', env, `${path}.m`)
      if (q === undefined || m === undefined) throw new SpecError(path, `a particle needs type (${Object.keys(SPECIES).join(', ')}) or q and m`)
      if (!(m > 0) || !q) throw new SpecError(path, 'a particle needs m > 0 and q ≠ 0')
      let v
      if (Array.isArray(p.v)) v = [0, 1, 2].map((k) => (p.v[k] === undefined ? 0 : quantity(p.v[k], 'v', env, `${path}.v[${k}]`)))
      else {
        if (p.v === undefined) throw new SpecError(`${path}.v`, 'v is the speed with dir ("3e6 m/s"), or [vx, vy] / [vx, vy, vz] in m/s')
        v = V3.mul(dir3(p.dir ?? 'right', env, `${path}.dir`), quantity(p.v, 'v', env, `${path}.v`))
      }
      if (!(V3.len(v) > 0)) throw new SpecError(`${path}.v`, 'v must not be zero')
      return { i, path, id: p.id, q, m, v, at: pair(p.at ?? [0, 0], env, `${path}.at`), label: p.label ?? lab ?? (q > 0 ? 'q' : '−q'), arrows: p.arrows, turns: p.turns === undefined ? 2 : val(p.turns, env, `${path}.turns`), color: p.color }
    }
    {
      // The integration box: the anchors, widened to hold each particle's orbit at its start.
      const reach = [...anchors]
      for (const p of parts) {
        const Bs = Math.max(V3.len(F.B([p.at[0] * lu, p.at[1] * lu, 0])), ...regions.map((r) => V3.len(r.Bv)))
        if (Bs > 0) { const r = (p.m * V3.len(p.v)) / (Math.abs(p.q) * Bs) / lu; reach.push([p.at[0] - 2 * r, p.at[1] - 2 * r], [p.at[0] + 2 * r, p.at[1] + 2 * r]) }
      }
      const xs = reach.map((a) => a[0]), ys = reach.map((a) => a[1])
      const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1
      let bounds
      if (spec.view) { const v = fitView(spec, env, anchors); bounds = [v.vx[0], v.vx[1], v.vy[0], v.vy[1]] }
      else bounds = [Math.min(...xs) - 2 * size, Math.max(...xs) + 2 * size, Math.min(...ys) - 2 * size, Math.max(...ys) + 2 * size]
      for (const p of parts) {
        const p0 = [p.at[0] * lu, p.at[1] * lu, 0], speed = V3.len(p.v)
        const Bs = Math.max(V3.len(F.B(p0)), ...regions.map((r) => V3.len(r.Bv)))
        const sizeM = size * lu, travel = (3 * sizeM) / speed
        let dt = sizeM / (speed * 600), maxT = travel
        if (Bs > 0) { const Tc = (2 * Math.PI * p.m) / (Math.abs(p.q) * Bs); dt = Math.min(dt, Tc / 720); maxT = travel + p.turns * Tc }
        p.res = trace(p0, p.v, p.q, p.m, F, { dt, maxT, bounds: bounds.map((b) => b * lu), tail: 0.3 * sizeM })
        p.pts = p.res.pts.map((x) => [x[0] / lu, x[1] / lu])
        const step = Math.max(1, Math.floor(p.pts.length / 200))
        for (let k = 0; k < p.pts.length; k += step) anchors.push(p.pts[k])
        anchors.push(p.pts[p.pts.length - 1])
      }
    }

    // Bounded regions frame the figure themselves; wires and loops alone need room around them.
    const view = screen(...Object.values(fitView(spec, env, anchors, regions.some((r) => r.box || r.circle) ? 0.12 : 1 / 3, 1)))
    const { vx, vy, S, Wpx, Hpx, P, sd, worldRect, inView, visible } = view
    const cv = new Canvas()
    cv.ext.push([0, 0], [Wpx, Hpx])
    const labels = []
    const lab = (label, cands, o = {}) => { if (label !== false && label !== undefined && label !== null) labels.push({ label, size: fs, fill: theme.fg, cands, ...o }) }
    const scr = (d) => V.unit([d[0], -d[1]]) // a world (x, y) direction on screen
    const viewCenter = [Wpx / 2, Hpx / 2]
    const away = (a, b) => { const n = V.perp(V.unit(V.sub(b, a))); return V.dot(V.sub(viewCenter, V.mid(a, b)), n) > 0 ? V.mul(n, -1) : n }
    const alongCands = (a, b, n) => [0.5, 0.3, 0.7, 0.15, 0.85].flatMap((f) => [n, V.mul(n, -1)].map((s) => (w, h) => V.add(V.add(a, V.mul(V.sub(b, a), f)), V.mul(s, 10 + extent(s, w, h)))))
    const head = (c, d, fill, size = 9) => { // a filled arrowhead at c pointing along screen unit d
      const n = V.perp(d), tri = [V.add(c, V.mul(d, size * 0.6)), V.add(V.sub(c, V.mul(d, size * 0.4)), V.mul(n, size * 0.4)), V.sub(V.sub(c, V.mul(d, size * 0.4)), V.mul(n, size * 0.4))]
      cv.front.push(el('path', { d: pathD(tri, true), fill }))
    }
    const mark = (c, out, stroke, r, tag, layer = 'mid') => { // ⊙/⊗ that labels keep off
      fieldMark(cv, c, !out, stroke, { r, width: r > 6 ? 1.6 : 1.3, layer, fill: r > 6 ? stroke : undefined })
      cv.trace(circlePoly(c, r + 1, 14), tag, 1, true)
      cv.fill(circlePoly(c, r, 12), tag, 1)
    }
    const facts = []

    // Regions: the edge, plates for E, and their labels (the fill comes after the labels).
    for (const s of regions) {
      const tag = `r:${s.i}`, stroke = s.color ? color(s.color) : theme.muted
      let corners
      if (s.box) {
        const a = P([s.box[0], s.box[3]]), b = P([s.box[2], s.box[1]])
        cv.back.push(el('rect', { x: a[0], y: a[1], width: b[0] - a[0], height: b[1] - a[1], fill: 'none', stroke, 'stroke-width': 1.2 }))
        cv.trace([a, [b[0], a[1]], b, [a[0], b[1]]], tag, 0.6, true)
        corners = [a, b]
      } else if (s.circle) {
        const c = P(s.circle.at), r = s.circle.r * S
        cv.back.push(el('circle', { cx: c[0], cy: c[1], r, fill: 'none', stroke, 'stroke-width': 1.2, 'stroke-dasharray': '6 4' }))
        cv.trace(circlePoly(c, r, 64), tag, 0.6, true)
      }
      if (s.Emag !== undefined) {
        // Plates on the two sides E crosses: + where E starts, − where it ends.
        const e = s.Edir, [x0, y0, x1, y1] = s.box
        const ends = e[1] ? [[[x0, y0], [x1, y0]], [[x0, y1], [x1, y1]]] : [[[x0, y0], [x0, y1]], [[x1, y0], [x1, y1]]]
        const plus = (e[0] + e[1]) > 0 ? 0 : 1, sE = scr(e)
        ends.forEach((ln, k) => {
          const isPlus = k === plus, [a, b] = ln.map(P)
          sheet(cv, a, b, isPlus ? 1 : -1, isPlus ? theme.positive : theme.negative, `${tag}p`, { width: 3, n: isPlus ? sE : V.mul(sE, -1) })
        })
        s.plates = ends.map((ln) => ln.map(P)); s.plus = plus; s.sE = sE
      }
      s.labelText = []
      // Outside a box: above or below it, flush with either end, then beside it.
      const outside = corners ? [[corners[0][0], corners[0][1], 1, -1], [corners[1][0], corners[0][1], -1, -1], [corners[0][0], corners[1][1], 1, 1], [corners[1][0], corners[1][1], -1, 1]]
        .map(([x, y, sx, sy]) => (w, h) => [x + (sx * w) / 2, y + sy * (h / 2 + 5)])
        .concat([0.25, 0.75, 0.5].flatMap((f) => [-1, 1].map((sx) => (w, h) => [(sx < 0 ? corners[0][0] : corners[1][0]) + sx * (w / 2 + 6), corners[0][1] + f * (corners[1][1] - corners[0][1])]))) : []
      if (s.Bmag !== undefined && s.label !== false) {
        s.labelText.push(s.label ?? `B = ${pre(s.Bmag, 'T')}`)
        if (s.dBdt) s.labelText.push(s.dBdt.qual ? `B ${s.dBdt.value > 0 ? 'increasing' : 'decreasing'}` : `dB/dt = ${pre(s.dBdt.value, 'T/s')}`)
      }
      if (s.Emag !== undefined && s.Elabel !== false) s.labelText.push(`E = ${pre(s.Emag, 'V/m')}`)
      const inner = corners ? [[corners[0][0] + 4, corners[0][1] + 4, 1, 1], [corners[1][0] - 4, corners[0][1] + 4, -1, 1], [corners[0][0] + 4, corners[1][1] - 4, 1, -1], [corners[1][0] - 4, corners[1][1] - 4, -1, -1]] : null
      const innerC = inner && inner.map(([x, y, sx, sy]) => (w, h) => [x + (sx * w) / 2 + sx * 2, y + (sy * h) / 2 + sy * 2])
      const cands = inner ? (s.Emag !== undefined ? [...outside, ...innerC] : [...innerC, ...outside])
        : s.circle ? ringCands(P(s.circle.at), s.circle.r * S + 4, [0.7, -0.7])
          : [[4, 4, 1, 1], [Wpx - 4, 4, -1, 1], [4, Hpx - 4, 1, -1], [Wpx - 4, Hpx - 4, -1, -1]].map(([x, y, sx, sy]) => (w, h) => [x + (sx * w) / 2, y + (sy * h) / 2])
      s.labelText.forEach((t, k) => lab(t, [...cands.slice(k), ...cands.slice(0, k)], { order: 3, region: s }))
    }

    // Current sources.
    const srcDesc = []
    for (const s of currents) {
      const tag = `s:${s.i}`, hl = s.id !== undefined && highlight.has(s.id)
      const stroke = s.color ? color(s.color) : theme.fg, w = hl ? 3.5 : 2.2
      const Ilabel = s.label ?? pre(s.I, 'A')
      if (s.type === 'wire' || s.type === 'cylinder') {
        const c = P(s.at), out = s.sign * s.I > 0
        if (!inView(s.at)) diag.warn(`${s.path}.at`, 'this wire is outside the view; widen view or move it')
        if (s.type === 'cylinder') {
          const r = s.r * S
          cv.mid.push(el('circle', { cx: c[0], cy: c[1], r, fill: stroke, 'fill-opacity': 0.12, stroke, 'stroke-width': hl ? 2.5 : 1.5 }))
          cv.trace(circlePoly(c, r, 40), tag, 1, true)
          mark(c, out, stroke, 6, tag)
          lab(Ilabel, ringCands(c, r + 4, [0.7, -0.7]), { fill: stroke, own: tag })
        } else {
          mark(c, out, stroke, hl ? 10.5 : 9, tag)
          lab(Ilabel, ringCands(c, 13, [0.7, -0.7]), { fill: stroke, own: tag })
        }
        srcDesc.push(`${s.type === 'wire' ? 'wire' : `cylinder a = ${L(s.r)}`} ${num(Math.abs(s.I))} A ${out ? 'out' : 'in'} at ${xy(s.at)}`)
      } else if (s.type === 'segment') {
        const seg = s.infinite ? visible(s.a, s.u) : clipSegment(s.a, s.b, worldRect)?.map(P)
        if (!seg) { diag.warn(s.path, 'this wire is outside the view'); continue }
        const [a, b] = seg, d = V.unit(V.sub(b, a)), dI = s.I >= 0 ? d : V.mul(d, -1)
        cv.mid.push(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke, 'stroke-width': w, 'stroke-linecap': 'round' }))
        cv.trace([a, b], tag)
        head(V.mid(a, b), dI, stroke, 12)
        lab(Ilabel, alongCands(a, b, away(a, b)), { fill: stroke, own: tag })
        srcDesc.push(s.infinite ? `long wire ${num(Math.abs(s.I))} A toward ${fmt(angleOf(s.I >= 0 ? s.u : W.mul(s.u, -1)))}° through ${xy(s.a)}`
          : `segment ${num(Math.abs(s.I))} A from ${xy(s.I >= 0 ? s.a : s.b)} to ${xy(s.I >= 0 ? s.b : s.a)} (${L(s.L)})`)
      } else if (s.type === 'loop' && s.edge) {
        const [pa, pb] = s.ends.map(P)
        cv.mid.push(el('line', { x1: pa[0], y1: pa[1], x2: pb[0], y2: pb[1], stroke, 'stroke-width': 2 }))
        cv.trace([pa, pb], tag)
        mark(pa, s.I > 0, stroke, 7.5, tag); mark(pb, s.I < 0, stroke, 7.5, tag)
        const c = P(s.at), n = scr(s.n), len = Math.max(30, Math.min(48, 0.7 * V.len(V.sub(pa, c))))
        const tip = V.add(c, V.mul(n, s.I >= 0 ? len : -len))
        arrow(cv, c, tip, MU, { width: 2, tag: `${tag}mu`, head: 9 })
        lab('\\mu', arrowCands(c, tip), { fill: MU, own: `${tag}mu`, order: 1 })
        lab(Ilabel, [...ringCands(pa, 12, [0.7, -0.7])], { fill: stroke, own: tag })
        const mu = s.N * Math.abs(s.I) * s.A * lu * lu
        srcDesc.push(`loop (edge-on) ${s.shape === 'circle' ? `r = ${L(s.r)}` : `${L(s.w)} × ${L(s.h)}`}${s.N !== 1 ? `, N = ${fmt(s.N)}` : ''}, ${num(Math.abs(s.I))} A: μ = NIA = ${num(mu)} A·m² at ${fmt(angleOf(s.I >= 0 ? s.n : W.mul(s.n, -1)))}°`)
      } else if (s.type === 'loop') {
        const c = P(s.at), ccw = s.sign * s.I > 0
        let heads
        if (s.shape === 'circle') {
          const r = s.r * S
          cv.mid.push(el('circle', { cx: c[0], cy: c[1], r, fill: 'none', stroke, 'stroke-width': w }))
          cv.trace(circlePoly(c, r, 48), tag, 1, true)
          heads = [[V.add(c, [0, -r]), [ccw ? -1 : 1, 0]], [V.add(c, [0, r]), [ccw ? 1 : -1, 0]]]
          lab(Ilabel, ringCands(c, r + 6, [0.7, -0.7]), { fill: stroke, own: tag })
        } else {
          const hw = (s.w * S) / 2, hh = (s.h * S) / 2, cs = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map((q) => V.add(c, q))
          cv.mid.push(el('path', { d: pathD(cs, true), fill: 'none', stroke, 'stroke-width': w }))
          cv.trace(cs, tag, 1, true)
          heads = [[V.add(c, [0, -hh]), [ccw ? -1 : 1, 0]], [V.add(c, [0, hh]), [ccw ? 1 : -1, 0]]]
          lab(Ilabel, alongCands(cs[0], cs[1], [0, -1]), { fill: stroke, own: tag })
        }
        for (const [p, d] of heads) head(p, d, stroke, 11)
        const Bc = V3.mul(s.Bunit(M(s.at)), s.I)[2]
        srcDesc.push(`loop ${s.shape === 'circle' ? `r = ${L(s.r)}` : `${L(s.w)} × ${L(s.h)}`}${s.N !== 1 ? `, N = ${fmt(s.N)}` : ''}, ${num(Math.abs(s.I))} A ${ccw ? 'ccw' : 'cw'} at ${xy(s.at)}: B at the center ${s.shape === 'circle' ? '= μ₀NI/2R ' : ''}= ${num(Math.abs(Bc))} T ${Bc > 0 ? 'out' : 'in'}`)
      } else {
        // Solenoid cut along its axis: the body, and a row of ⊙ on one side, ⊗ on the other.
        const hl2 = V.mul(scr(s.n2), (s.length * S) / 2), c = P(s.at), t = scr(s.t)
        const body = [V.add(V.sub(c, hl2), V.mul(t, s.r * S)), V.add(V.add(c, hl2), V.mul(t, s.r * S)), V.sub(V.add(c, hl2), V.mul(t, s.r * S)), V.sub(V.sub(c, hl2), V.mul(t, s.r * S))]
        cv.back.push(el('path', { d: pathD(body, true), fill: stroke, 'fill-opacity': 0.06, stroke: theme.muted, 'stroke-width': 1 }))
        const k = Math.max(2, Math.min(Math.round(s.N), Math.floor((s.length * S) / 14)))
        s.rows.forEach((row, j) => {
          const a = P(row.a), b = P(row.b)
          for (let q = 0; q < k; q++) mark(V.add(a, V.mul(V.sub(b, a), (q + 0.5) / k)), (row.I * s.I) > 0, stroke, 5, tag)
          if (j === 0) lab(Ilabel, alongCands(a, b, t).filter((_, z) => z % 2 === 0), { fill: stroke, own: tag })
        })
        const n = s.N / (s.length * lu), ideal = MU0 * n * Math.abs(s.I), Lm = s.length * lu, R = s.r * lu
        srcDesc.push(`solenoid N = ${fmt(s.N)}, length ${L(s.length)}, r = ${L(s.r)}, ${num(Math.abs(s.I))} A: n = ${num(n)} turns/m, B = μ₀nI = ${num(ideal)} T toward ${fmt(angleOf(s.I >= 0 ? s.n2 : W.mul(s.n2, -1)))}° inside (finite length, center: ${num((ideal * Lm) / Math.sqrt(Lm * Lm + 4 * R * R))} T; field computed from ${s.M} loops), L = μ₀N²A/ℓ = ${num((MU0 * s.N * s.N * Math.PI * R * R) / Lm)} H, U = ½LI² = ${num((0.5 * MU0 * s.N * s.N * Math.PI * R * R * s.I * s.I) / Lm)} J`)
      }
    }
    for (const s of regions) {
      const where = s.box ? `box ${xy([s.box[0], s.box[1]])}–${xy([s.box[2], s.box[3]])}` : s.circle ? `circle r = ${L(s.circle.r)} at ${xy(s.circle.at)}` : 'everywhere'
      const parts2 = []
      if (s.Bmag !== undefined) parts2.push(`B = ${num(Math.abs(s.Bmag))} T ${bdir(s.Bv)}${s.dBdt ? (s.dBdt.qual ? `, ${s.dBdt.value > 0 ? 'increasing' : 'decreasing'}` : `, dB/dt = ${num(s.dBdt.value)} T/s`) : ''}`)
      if (s.Emag !== undefined) parts2.push(`E = ${num(Math.abs(s.Emag))} V/m toward ${fmt(angleOf(V3.mul(s.Edir, Math.sign(s.Emag))))}°`)
      srcDesc.push(`region (${where}) ${parts2.join(', ')}`)
    }

    /** Words for a B (or any 3D) vector's direction. */
    function bdir(b) {
      const m = V3.len(b), z = b[2], inp = Math.hypot(b[0], b[1])
      if (!m) return ''
      if (inp <= 1e-3 * m) return z > 0 ? 'out of the page (+z)' : 'into the page (−z)'
      if (Math.abs(z) <= 1e-3 * m) return `at ${fmt(angleOf(b))}°`
      return `at ${fmt(angleOf(b))}° in the page and ${z > 0 ? 'out' : 'in'} (components ${num(b[0])}, ${num(b[1])}, ${num(b[2])} T)`
    }
    const throughs = () => currents.flatMap((s) => s.through.map((t) => ({ ...t, s, I: t.I * s.I })))

    // Paths: dashed, with a direction arrow; Ampère's law and the induced E in the summary.
    for (const pa of paths) {
      const tag = `pa:${pa.i}`
      let pts, headAt
      if (pa.shape.circle) {
        const [c, r] = pa.shape.circle
        pts = circlePoly(P(c), r * S, 72)
        headAt = [V.add(P(c), [0, -r * S]), [pa.sign > 0 ? -1 : 1, 0]]
      } else {
        const [x0, y0, x1, y1] = pa.shape.rect
        pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(P)
        headAt = [V.mid(pts[2], pts[3]), [pa.sign > 0 ? -1 : 1, 0]]
      }
      cv.back.push(el('path', { d: pathD(pts, true), fill: 'none', stroke: PATH, 'stroke-width': 1.5, 'stroke-dasharray': '6 4' }))
      cv.trace(pts, tag, 0.6, true)
      head(headAt[0], headAt[1], PATH, 10)
      if (pa.label) lab(pa.label, ringCands(headAt[0], 10, [0, -1]), { fill: PATH, own: tag })
      // I_enc: currents through the page inside (out counts + for a ccw path), cylinders by area.
      let Ienc = 0
      const inside = (p) => (pa.shape.circle ? W.len(W.sub(p, pa.shape.circle[0])) < pa.shape.circle[1] : p[0] > pa.shape.rect[0] && p[0] < pa.shape.rect[2] && p[1] > pa.shape.rect[1] && p[1] < pa.shape.rect[3])
      for (const t of throughs()) {
        if (t.r) Ienc += (t.I * overlap(pa.shape, { circle: { at: t.at, r: t.r } })) / (Math.PI * t.r * t.r)
        else if (inside(t.at)) Ienc += t.I
      }
      for (const s of currents) for (const row of s.rows) {
        // The length of the winding row inside the path, exactly.
        let inLen = 0
        if (pa.shape.rect) { const r = pa.shape.rect, seg = clipSegment(row.a, row.b, [r[0], r[2], r[1], r[3]]); if (seg) inLen = W.len(W.sub(seg[1], seg[0])) }
        else {
          const [c, r] = pa.shape.circle, d = W.sub(row.b, row.a), f = W.sub(row.a, c), A = W.dot(d, d), B2 = W.dot(f, d), C = W.dot(f, f) - r * r, disc = B2 * B2 - A * C
          if (disc > 0) { const t0 = Math.max(0, (-B2 - Math.sqrt(disc)) / A), t1 = Math.min(1, (-B2 + Math.sqrt(disc)) / A); if (t1 > t0) inLen = (t1 - t0) * Math.sqrt(A) }
        }
        Ienc += row.I * inLen * s.I
      }
      Ienc *= pa.sign
      // ∮B·dl of the currents' field (regions are idealized and left out), by the midpoint rule.
      const ring = pa.shape.circle ? circlePoly(pa.shape.circle[0], pa.shape.circle[1], 720).map((p) => [p[0], 2 * pa.shape.circle[0][1] - p[1]])
        : (() => { const [x0, y0, x1, y1] = pa.shape.rect, o = []; const side = (a, b) => { for (let k = 0; k < 180; k++) o.push(W.add(a, W.mul(W.sub(b, a), k / 180))) }; side([x0, y0], [x1, y0]); side([x1, y0], [x1, y1]); side([x1, y1], [x0, y1]); side([x0, y1], [x0, y0]); return o })()
      let circ = 0, perim = 0
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k], b = ring[(k + 1) % ring.length], dl = W.mul(W.sub(b, a), lu), Bm = Bcur(V.mid(a, b))
        circ += (Bm[0] * dl[0] + Bm[1] * dl[1]) * pa.sign; perim += W.len(dl)
      }
      const sh = pa.shape.circle ? `circle r = ${L(pa.shape.circle[1])} at ${xy(pa.shape.circle[0])}` : `box ${xy(pa.shape.rect)}–${xy(pa.shape.rect.slice(2))}`
      let fact = `path ${pa.id ?? pa.i + 1} (${sh}, ${pa.sign > 0 ? 'ccw' : 'cw'})`
      if (currents.length) fact += `: I_enc = ${num(Ienc)} A, μ₀I_enc = ${num(MU0 * Ienc)} T·m, ∮B·dl = ${num(circ)} T·m, average B along it = ${num(circ / perim)} T`
      const fl = flux(pa.shape, [0, 0, 1], sources, lu)
      let dPhi = 0, qual = false, any = false
      for (const s of sources) { const r = s.type === 'region' ? s.dBdt : s.dIdt; if (r) { dPhi += r.value * fl.per.get(s); qual ||= r.qual; any = true } }
      if (any) {
        const sense = dPhi > 0 ? 'cw' : 'ccw'
        const sep = currents.length ? ', ' : ': '
        if (Math.abs(dPhi) < 1e-15) fact += `${sep}flux through it is steady: no induced E`
        else if (qual) fact += `${sep}flux ${dPhi > 0 ? 'rising' : 'falling'} out of the page: induced E circulates ${sense} (seen from +z)`
        else fact += `${sep}Φ = ${num(fl.total)} Wb, dΦ/dt = ${num(dPhi)} Wb/s, ∮E·dl = −dΦ/dt${pa.shape.circle ? `, induced E = |dΦ/dt|/2πr = ${num(Math.abs(dPhi) / (2 * Math.PI * pa.shape.circle[1] * lu))} V/m` : ''} ${sense} (seen from +z)`
      }
      facts.push(fact)
    }

    // Induction loops: flux, its rate of change, emf, and the Lenz direction.
    const indFacts = []
    for (const o of loops) {
      const tag = `in:${o.i}`, hl = o.id !== undefined && highlight.has(o.id)
      const nrm = [Math.sin((o.theta * Math.PI) / 180), 0, Math.cos((o.theta * Math.PI) / 180)]
      const shape0 = o.shapeAt(0), base = flux(shape0, nrm, sources, lu)
      const size = o.shape === 'rails' ? o.l : o.shape === 'circle' ? o.r : Math.max(o.w, o.h)
      let dPhi = 0, qual = false, why = []
      for (const s of sources) {
        const r = s.type === 'region' ? s.dBdt : s.dIdt
        if (!r) continue
        const d = r.value * base.per.get(s)
        if (d) { dPhi += d; qual ||= r.qual; why.push(s.type === 'region' ? 'B changing' : 'I changing') }
      }
      if (o.speed) {
        const h = 1e-3 * size, fp = flux(o.shapeAt(h), nrm, sources, lu).total, fm = flux(o.shapeAt(-h), nrm, sources, lu).total
        const d = ((fp - fm) / (2 * h)) * (o.speed.value / lu)
        if (Math.abs(d) > 1e-12 * Math.abs(base.total) + 1e-30) { dPhi += d; qual ||= o.speed.qual; why.push(o.shape === 'rails' ? 'bar sliding' : 'loop moving') }
      }
      let peak = null
      if (o.omega) {
        // Φ(θ) = A(B_x sin θ + B_z cos θ) in a uniform field, so the emf peaks at N ω √(Φ² + Φ'²).
        const t = (o.theta * Math.PI) / 180, d1 = flux(shape0, [Math.cos(t), 0, -Math.sin(t)], sources, lu).total
        dPhi += d1 * o.omega; why.push('loop turning')
        peak = o.N * Math.abs(o.omega) * Math.hypot(base.total, d1)
      }
      if (o.dAdt) {
        const A = (shape0.rect ? (shape0.rect[2] - shape0.rect[0]) * (shape0.rect[3] - shape0.rect[1]) : Math.PI * shape0.circle[1] ** 2) * lu * lu
        dPhi += (o.dAdt.value * base.total) / A; qual ||= o.dAdt.qual; why.push(`area ${o.dAdt.value > 0 ? 'growing' : 'shrinking'}`)
      }
      const scale = Math.abs(base.total) + Math.max(...regions.map((r) => Math.abs(r.Bmag ?? 0)), 1e-12) * 1e-9
      const none = Math.abs(dPhi) <= 1e-9 * scale
      // Circulation seen along the normal: ccw when the flux along the normal falls.
      const ccw = dPhi < 0, from = Math.abs(nrm[2]) > 1e-9 ? (nrm[2] > 0 ? '+z' : '−z') : '+x'
      const emf = o.N * Math.abs(dPhi), I = o.R ? emf / o.R : null
      o.ccw = nrm[2] < 0 ? !ccw : ccw
      // Drawing.
      const stroke = theme.fg, wid = (o.N > 1 ? 3.5 : 2.5) + (hl ? 1.2 : 0)
      let center, outline, curHeads = [], vFrom
      if (o.shape === 'rails') {
        const b0 = W.add(o.at, W.mul(o.n, o.l / 2)), b1 = W.sub(o.at, W.mul(o.n, o.l / 2))
        const r0 = W.sub(b0, W.mul(o.u, o.back)), r1 = W.sub(b1, W.mul(o.u, o.back))
        const ext = W.mul(o.u, 0.7 * o.l)
        for (const [a, b] of [[r0, W.add(b0, ext)], [r1, W.add(b1, ext)]]) {
          const [pa, pb] = [P(a), P(b)]
          cv.mid.push(el('line', { x1: pa[0], y1: pa[1], x2: pb[0], y2: pb[1], stroke: theme.muted, 'stroke-width': 2 }))
          cv.trace([pa, pb], `${tag}r`)
        }
        // The resistor: a zigzag across the middle of the end between the rails.
        const pr0 = P(r0), pr1 = P(r1), t = V.unit(V.sub(pr1, pr0)), nn = V.perp(t), Lr = V.len(V.sub(pr1, pr0))
        const zl = Math.min(36, Lr * 0.5), m0 = V.add(pr0, V.mul(t, (Lr - zl) / 2)), zz = [pr0, m0]
        for (let k = 0; k < 6; k++) zz.push(V.add(V.add(m0, V.mul(t, (zl * (k + 0.5)) / 6)), V.mul(nn, k % 2 ? -5 : 5)))
        zz.push(V.add(m0, V.mul(t, zl)), pr1)
        cv.mid.push(el('path', { d: pathD(zz), fill: 'none', stroke, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }))
        cv.trace(zz, `${tag}R`)
        if (o.R !== undefined) lab(pre(o.R, 'Ω'), [V.mul(V.unit(V.sub(P(r0), P(b0))), 1), V.mul(V.unit(V.sub(P(b0), P(r0))), 1)].flatMap((d) => [(w, h) => V.add(V.mid(pr0, pr1), V.mul(scr(W.mul(o.u, -1)), 9 + extent(scr(o.u), w, h))), (w, h) => V.add(V.mid(pr0, pr1), V.mul(scr(o.u), 9 + extent(scr(o.u), w, h)))]), { own: `${tag}R` })
        const pb0 = P(b0), pb1 = P(b1), bt = V.unit(V.sub(pb1, pb0))
        const q0 = V.sub(pb0, V.mul(bt, 5)), q1 = V.add(pb1, V.mul(bt, 5))
        cv.mid.push(el('line', { x1: q0[0], y1: q0[1], x2: q1[0], y2: q1[1], stroke, 'stroke-width': 5 + (hl ? 1.5 : 0), 'stroke-linecap': 'round' }))
        cv.trace([q0, q1], `${tag}bar`)
        center = P(W.sub(o.at, W.mul(o.u, o.back / 2)))
        vFrom = P(o.at)
        if (!none) {
          // Current along the bar: ccw (seen from +z) runs along ẑ × u on the bar's side.
          const dI = W.mul(o.n, ccw ? 1 : -1), sI = scr(dI)
          // Heads on the bar and on the rail the current returns along (from the bar's + end).
          const hb = V.add(P(o.at), V.mul(sI, 0.3 * V.len(V.sub(pb1, pb0))))
          const back = P(W.add(W.sub(o.at, W.mul(o.u, o.back / 2)), W.mul(dI, o.l / 2)))
          curHeads.push([hb, sI]); curHeads.push([back, scr(W.mul(o.u, -1))])
          // Polarity: current leaves the bar (the source) at its + end.
          const plusEnd = P(W.add(o.at, W.mul(dI, o.l / 2))), minusEnd = P(W.sub(o.at, W.mul(dI, o.l / 2)))
          const out = sI
          lab('+', [(w, h) => V.add(plusEnd, V.mul(out, 8 + extent(out, w, h))), (w, h) => V.add(plusEnd, V.add(V.mul(scr(o.u), 9 + extent(scr(o.u), w, h)), V.mul(out, 4)))], { fill: theme.positive, order: 1 })
          lab('−', [(w, h) => V.add(minusEnd, V.mul(out, -(8 + extent(out, w, h)))), (w, h) => V.add(minusEnd, V.add(V.mul(scr(o.u), 9 + extent(scr(o.u), w, h)), V.mul(out, -4)))], { fill: theme.negative, order: 1 })
          // The magnetic force on the bar: I ℓ × B at the bar's center.
          const Bb = Bat(o.at), Fv = V3.mul(V3.cross([dI[0], dI[1], 0], Bb), (I ?? 1) * o.l * lu)
          o.Fbar = Fv
          if (Math.hypot(Fv[0], Fv[1]) > 0) {
            const fd = scr(Fv), tail = V.add(P(o.at), V.mul(fd, 4)), tip = V.add(P(o.at), V.mul(fd, ARROW))
            arrow(cv, tail, tip, FB, { width: 2.2, tag: `${tag}F`, head: 10 })
            lab(sub('F', 'B'), arrowCands(tail, tip), { fill: FB, own: `${tag}F`, order: 1 })
          }
        }
      } else {
        const c = o.shapeAt(0)
        const cos = Math.abs(Math.cos((o.theta * Math.PI) / 180))
        if (c.circle) {
          center = P(c.circle[0])
          const rx = c.circle[1] * S * cos, ry = c.circle[1] * S
          cv.mid.push(el('ellipse', { cx: center[0], cy: center[1], rx, ry, fill: 'none', stroke, 'stroke-width': wid }))
          outline = Array.from({ length: 48 }, (_, k) => V.add(center, [rx * Math.cos((k * Math.PI) / 24), ry * Math.sin((k * Math.PI) / 24)]))
          curHeads = [[V.add(center, [0, -ry]), [o.ccw ? -1 : 1, 0]], [V.add(center, [0, ry]), [o.ccw ? 1 : -1, 0]]]
        } else {
          const [x0, y0, x1, y1] = c.rect, cx = (x0 + x1) / 2, hw = ((x1 - x0) / 2) * cos
          outline = [[cx - hw, y0], [cx + hw, y0], [cx + hw, y1], [cx - hw, y1]].map(P)
          center = P([cx, (y0 + y1) / 2])
          cv.mid.push(el('path', { d: pathD(outline, true), fill: 'none', stroke, 'stroke-width': wid, 'stroke-linejoin': 'round' }))
          curHeads = [[V.mid(outline[2], outline[3]), [o.ccw ? -1 : 1, 0]], [V.mid(outline[0], outline[1]), [o.ccw ? 1 : -1, 0]]]
        }
        cv.trace(outline, tag, 1, true)
        if (none) curHeads = []
        if (o.u) {
          // v from the leading edge of the loop.
          const d = scr(o.u), ext = c.circle ? c.circle[1] * S : extent(d, Math.abs(outline[1][0] - outline[0][0]), Math.abs(outline[2][1] - outline[1][1]))
          vFrom = V.add(center, V.mul(d, ext + 2))
        }
        if (o.omega) {
          const top = V.add(center, [0, -(c.circle ? c.circle[1] : (c.rect[3] - c.rect[1]) / 2) * S - 16]), bot = V.add(center, [0, (c.circle ? c.circle[1] : (c.rect[3] - c.rect[1]) / 2) * S + 16])
          cv.back.push(el('line', { x1: top[0], y1: top[1], x2: bot[0], y2: bot[1], stroke: theme.muted, 'stroke-width': 1, 'stroke-dasharray': '4 3' }))
          cv.trace([top, bot], `${tag}ax`, 0.6)
          lab('\\omega', ringCands(top, 6, [0, -1]), { own: `${tag}ax` })
        }
        if (o.N > 1 || o.label) lab(o.label ?? `N = ${fmt(o.N)}`, ringCands(center, (c.circle ? c.circle[1] : Math.max(c.rect[2] - c.rect[0], c.rect[3] - c.rect[1]) / 2) * S + 6, [-0.7, 0.7]), { own: tag })
      }
      for (const [p, d] of curHeads) { head(p, d, IND, 12); cv.trace([p], `${tag}I`) }
      if (curHeads.length) lab(o.shape === 'rails' ? 'I' : sub('I', 'ind'), ringCands(curHeads[0][0], 9, V.perp(curHeads[0][1])), { fill: IND, own: `${tag}I`, order: 1 })
      if (!none) {
        // The induced B at the center opposes the change: out of the page for ccw.
        mark(center, o.ccw, IND, 7, `${tag}b`, 'front')
        lab(sub('B', 'ind'), ringCands(center, 11, [0.7, 0.7]), { fill: IND, own: `${tag}b`, order: 1 })
      }
      if (o.u && vFrom) {
        const d = scr(o.u), tail = V.add(vFrom, V.mul(d, 4)), tip = V.add(vFrom, V.mul(d, ARROW))
        arrow(cv, tail, tip, theme.fg, { width: 2.2, tag: `${tag}v`, head: 10 })
        lab('v', arrowCands(tail, tip), { own: `${tag}v`, order: 1 })
      }
      // Facts.
      const nm = o.id ?? o.i + 1
      const desc = o.shape === 'rails' ? `bar ${L(o.l)} on rails, sliding toward ${fmt(angleOf(o.u))}°${o.speed.qual ? '' : ` at ${num(o.speed.value)} m/s`}`
        : `${o.shape === 'circle' ? `circular loop r = ${L(o.r)}` : `loop ${L(o.w)} × ${L(o.h)}`}${o.N !== 1 ? `, N = ${fmt(o.N)}` : ''}${o.omega ? `, turning at ω = ${num(o.omega)} rad/s, normal ${fmt(o.theta)}° from +z` : ''}${o.u ? `, moving toward ${fmt(angleOf(o.u))}°${o.speed.qual ? '' : ` at ${num(o.speed.value)} m/s`}` : ''}`
      const f = [`${nm}: ${desc}: Φ = ${num(base.total)} Wb per turn${o.N !== 1 ? ` (NΦ = ${num(o.N * base.total)} Wb)` : ''}`]
      if (peak !== null) f.push(`emf = NBAω sin ωt, peak NBAω = ${num(peak)} V${o.R ? ` (peak I = ${num(peak / o.R)} A)` : ''}`)
      if (none) f.push(peak !== null ? 'right now the flux is at its extreme: emf 0' : 'flux steady: no emf, no induced current')
      else {
        if (!qual) f.push(`dΦ/dt = ${num(dPhi)} Wb/s (${why.join(', ')}), |emf| = ${o.N !== 1 ? 'N' : ''}|dΦ/dt| = ${num(emf)} V${I !== null ? `, I = emf/R = ${num(I)} A` : ''}`)
        else f.push(`flux along the normal ${dPhi > 0 ? 'increasing' : 'decreasing'} (${why.join(', ')})`)
        f.push(`I_ind ${o.ccw ? 'counterclockwise' : 'clockwise'} as viewed from ${from === '−z' ? '+z' : from}, so B_ind at the center points ${o.ccw ? 'out of the page (+z)' : 'into the page (−z)'}`)
        if (o.shape === 'rails' && o.Fbar) {
          const Fm = Math.hypot(o.Fbar[0], o.Fbar[1]), opp = W.dot([o.Fbar[0], o.Fbar[1]], o.u) < 0
          const ends = `${dirWord(W.mul(o.n, ccw ? 1 : -1))} end of the bar is +`
          if (!qual && I !== null) f.push(`F_B on the bar = IℓB = ${num(Fm)} N toward ${fmt(angleOf(o.Fbar))}° (${opp ? 'opposes v' : 'along v'}), P = I²R = ${num(I * I * o.R)} W = Fv = ${num(Fm * o.speed.value)} W; ${ends}`)
          else f.push(`F_B on the bar toward ${fmt(angleOf(o.Fbar))}° (${opp ? 'opposes v' : 'along v'}); ${ends}`)
        }
      }
      indFacts.push(f.join(', '))
    }
    function dirWord(d) { return Math.abs(d[1]) > Math.abs(d[0]) ? (d[1] > 0 ? 'top' : 'bottom') : (d[0] > 0 ? 'right' : 'left') }

    // Particles: the path, a direction head, and v and F arrows where asked.
    const partFacts = []
    for (const p of parts) {
      const tag = `pt:${p.i}`, col = p.color ? color(p.color) : p.q > 0 ? theme.positive : theme.negative
      const pieces = clipPolyline(p.pts, worldRect).map((ln) => ln.map(P))
      for (const ln of pieces) {
        cv.mid.push(el('path', { d: pathD(ln), fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-linejoin': 'round' }))
        cv.trace(ln, tag, 0.8)
      }
      const s0 = P(p.at)
      cv.front.push(el('circle', { cx: s0[0], cy: s0[1], r: 3.5, fill: col }))
      lab(p.label, ringCands(s0, 7, [-0.7, -0.7]), { fill: col, own: tag, order: 1 })
      // Facts for each stage of the path: a run inside the same set of regions (with no regions,
      // from where B first acts), at most four.
      const res = p.res, n = res.pts.length
      const f = [`${p.id ?? p.i + 1}: q = ${num(p.q)} C, m = ${num(p.m)} kg, v = ${num(V3.len(p.v))} m/s ${bdir(p.v)}`]
      const stages = []
      if (regions.length) {
        let last = null
        res.pts.forEach((x, k) => {
          const inR = regions.filter((r) => r.inside([x[0] / lu, x[1] / lu])), key = inR.map((r) => r.i).join(',')
          if (key !== last && inR.length) stages.push({ k, name: inR.map((r) => r.id ?? `region ${r.i + 1}`).join(' + ') })
          last = key
        })
      } else {
        const kB = res.pts.findIndex((x) => V3.len(F.B(x)) > 0)
        if (kB >= 0) stages.push({ k: kB })
      }
      for (const st of stages.slice(0, 4)) {
        const x = res.pts[st.k], v = res.vel[st.k], B = F.B(x), Bm = V3.len(B), Ev = F.E(x)
        const head2 = `${st.name ? `in ${st.name}` : 'in'} ${Bm ? `B = ${num(Bm)} T` : ''}${Bm && V3.len(Ev) ? ' and ' : ''}${V3.len(Ev) ? `E = ${num(V3.len(Ev))} V/m` : ''}`
        if (!Bm) {
          if (V3.len(Ev)) f.push(`${head2}: a = qE/m = ${num((Math.abs(p.q) * V3.len(Ev)) / p.m)} m/s² toward ${fmt(angleOf(V3.mul(Ev, Math.sign(p.q))))}°`)
          continue
        }
        const bh = V3.mul(B, 1 / Bm), vpar = V3.dot(v, bh), vperp = V3.len(V3.sub(v, V3.mul(bh, vpar)))
        const T = (2 * Math.PI * p.m) / (Math.abs(p.q) * Bm), r = (p.m * vperp) / (Math.abs(p.q) * Bm)
        if (V3.len(Ev)) {
          const fe = V3.mul(Ev, p.q), fb = V3.mul(V3.cross(v, B), p.q), net = V3.add(fe, fb)
          const big = Math.max(V3.len(fe), V3.len(fb))
          f.push(`${head2}: E/B = ${num(V3.len(Ev) / Bm)} m/s vs v = ${num(V3.len(v))} m/s, ${V3.len(net) <= 1e-3 * big ? 'qE balances qv×B: passes undeflected' : `F_E = ${num(V3.len(fe))} N, F_B = ${num(V3.len(fb))} N: the ${V3.len(fb) > V3.len(fe) ? 'magnetic' : 'electric'} force wins`}`)
          continue
        }
        // It circles about v × F: ccw seen from the tip of that axis.
        const spin = V3.dot(V3.cross(v, V3.cross(v, V3.mul(B, p.q))), bh) > 0 ? 'ccw' : 'cw'
        const seen = Math.abs(bh[2]) > 0.999 ? `${(spin === 'ccw') === (bh[2] > 0) ? 'ccw' : 'cw'} (seen from +z)` : `${spin} seen from the tip of B`
        f.push(`${head2}: r = mv⊥/|q|B = ${num(r / lu)} ${unit}, T = 2πm/|q|B = ${num(T)} s, f = ${num(1 / T)} Hz, ω = ${num((2 * Math.PI) / T)} rad/s, circles ${seen}`)
        if (Math.abs(vpar) > 1e-6 * V3.len(v)) {
          f.push(`helix: v∥ = ${num(vpar)} m/s along B, v⊥ = ${num(vperp)} m/s, pitch = v∥T = ${num((Math.abs(vpar) * T) / lu)} ${unit}`)
          p.helix ??= { k: st.k, T, bh }
        }
      }
      if (res.closed) f.push('closes a full circle')
      if (res.entry > 0) f.push(`enters the field at ${xy(p.pts[res.entry])}`)
      if (res.exit > 0) {
        const v1 = res.vel[res.exit]
        let turned = 0
        for (let k = Math.max(1, res.entry + 1); k <= res.exit; k++) {
          const a = res.vel[k - 1], b = res.vel[k]
          turned += Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])
        }
        f.push(`leaves it at ${xy(p.pts[res.exit])} heading ${fmt(angleOf(v1))}° (turned ${fmt(Math.abs((turned * 180) / Math.PI))}° ${turned > 0 ? 'ccw' : 'cw'})`)
      }
      if (!res.closed && res.exit < 0 && p.helix) f.push(`drawn for ${fmt((res.ts[n - 1] - res.ts[p.helix.k]) / p.helix.T)} turns`)
      partFacts.push(f.join(', '))
      // v and F arrows.
      const want = p.arrows ?? [res.entry > 0 ? 'entry' : 'start']
      if (!Array.isArray(want)) throw new SpecError(`${p.path}.arrows`, 'arrows is a list of start, entry, exit, end, or fractions 0 to 1 of the path')
      want.forEach((wnt, j) => {
        let k
        if (wnt === 'start') k = 0
        else if (wnt === 'entry') k = Math.max(0, res.entry)
        else if (wnt === 'exit') k = res.exit > 0 ? res.exit : n - 1
        else if (wnt === 'end') k = n - 1
        else if (typeof wnt === 'number' && wnt >= 0 && wnt <= 1) k = Math.round(wnt * (n - 1))
        else throw new SpecError(`${p.path}.arrows[${j}]`, 'each is start, entry, exit, end, or a fraction 0 to 1 of the path')
        const x = res.pts[k], v = res.vel[k], c = P([x[0] / lu, x[1] / lu])
        const fb = V3.cross(v, V3.mul(F.B(x), p.q)), fe = V3.mul(F.E(x), p.q)
        const big = Math.max(V3.len(fb), V3.len(fe))
        const vec = (vv, len, stroke, label, t) => {
          const inp = Math.hypot(vv[0], vv[1]), m = V3.len(vv)
          if (!m) return
          if (inp < 0.3 * m) {
            const spot = V.add(c, [16, -16])
            mark(spot, vv[2] > 0, stroke, 6, t, 'front')
            lab(label, ringCands(spot, 9, [1, 0]), { fill: stroke, own: t, order: 1 })
            return
          }
          const d = scr(vv), tail = V.add(c, V.mul(d, 3)), tip = V.add(c, V.mul(d, len))
          arrow(cv, tail, tip, stroke, { width: 2.2, tag: t, head: 10 })
          lab(label, arrowCands(tail, tip), { fill: stroke, own: t, order: 1 })
        }
        vec(v, ARROW, theme.fg, 'v', `${tag}v${j}`)
        if (V3.len(fb)) vec(fb, Math.max(16, (ARROW - 4) * (V3.len(fb) / big)), FB, sub('F', 'B'), `${tag}b${j}`)
        if (V3.len(fe)) vec(fe, Math.max(16, (ARROW - 4) * (V3.len(fe) / big)), FE, sub('F', 'E'), `${tag}e${j}`)
      })
      // Arrowheads along the path (a closed circle gets one), away from the v and F arrows.
      const allPx = p.pts.map(P), total = allPx.reduce((acc, q, k) => acc + (k ? V.len(V.sub(q, allPx[k - 1])) : 0), 0)
      const busy = cv.obs.filter(([, , , t]) => typeof t === 'string' && t.startsWith(tag) && t !== tag)
      let heads = 0
      for (const f of res.closed ? [0.62, 0.7, 0.55] : [0.45, 0.85, 0.7, 0.3]) {
        let acc = 0, k = 1
        for (; k < allPx.length; k++) { acc += V.len(V.sub(allPx[k], allPx[k - 1])); if (acc >= f * total) break }
        if (k >= allPx.length || !inView(p.pts[k]) || busy.some(([x, y]) => V.len(V.sub([x, y], allPx[k])) < 14)) continue
        head(allPx[k], V.unit(V.sub(allPx[k], allPx[k - 1])), col, 10)
        if (++heads >= (res.closed ? 1 : 2)) break
      }
      // A helix seen side-on: dimension the pitch along B, beside the path.
      if (p.helix && Math.hypot(p.helix.bh[0], p.helix.bh[1]) > 0.9) {
        const { k, T, bh } = p.helix, k2 = res.ts.findIndex((t) => t >= res.ts[k] + T)
        if (k2 > 0) {
          const b2 = [bh[0], bh[1]], nn = W.perp(b2)
          const pa = p.pts[k], pb = p.pts[k2]
          const cx = p.pts.slice(k, k2).reduce((acc, q) => Math.max(acc, W.dot(W.sub(q, pa), nn)), 0)
          const off = cx + 14 / S
          const a = P(W.add(pa, W.mul(nn, off))), b = P(W.add(W.add(pa, W.mul(b2, W.dot(W.sub(pb, pa), b2))), W.mul(nn, off)))
          dimension(a, b, scr(nn), `p = ${L((Math.abs(W.dot(W.sub(pb, pa), b2))))}`, P(pa), P(pb))
        }
      }
    }
    function dimension(a, b, o, label, ea, eb) {
      const c = theme.muted
      for (const [p, q] of [[ea, a], [eb, b]]) {
        const s0 = V.add(p, V.mul(o, 3)), s1 = V.add(q, V.mul(o, 4))
        cv.back.push(el('line', { x1: s0[0], y1: s0[1], x2: s1[0], y2: s1[1], stroke: c, 'stroke-width': 0.8 }))
        cv.trace([s0, s1], 'dim', 0.6)
      }
      const m = V.mid(a, b)
      arrow(cv, m, a, c, { width: 1, head: 7, tag: 'dim' }); arrow(cv, m, b, c, { width: 1, head: 7, tag: 'dim' })
      lab(label, [0.5, 0.35, 0.65].flatMap((f) => [o, V.mul(o, -1)].map((s) => (w, h) => V.add(V.add(a, V.mul(V.sub(b, a), f)), V.mul(s, 3 + extent(s, w, h))))), { order: 1 })
    }

    // E arrows between plates, at a clear spot along them.
    for (const s of regions) {
      if (!s.plates) continue
      const [pl, mi] = s.plus === 0 ? s.plates : [s.plates[1], s.plates[0]]
      const gap = V.len(V.sub(V.mid(mi[0], mi[1]), V.mid(pl[0], pl[1]))), len = Math.max(16, Math.min(30, 0.42 * gap))
      let best = null
      for (const f of [0.12, 0.88, 0.3, 0.7, 0.5]) {
        const a = V.add(V.add(pl[0], V.mul(V.sub(pl[1], pl[0]), f)), V.mul(s.sE, 12)), b = V.add(a, V.mul(s.sE, len))
        const hits = cv.obs.filter(([x, y]) => Math.min(a[0], b[0]) - 6 < x && x < Math.max(a[0], b[0]) + 6 && Math.min(a[1], b[1]) - 6 < y && y < Math.max(a[1], b[1]) + 6).length
        if (!best || hits < best.hits) best = { a, b, hits }
      }
      if (best.hits) continue // the plates' + and − already say which way E points
      arrow(cv, best.a, best.b, FE, { width: 1.8, tag: `r:${s.i}E`, head: 8 })
      lab('E', arrowCands(best.a, best.b), { fill: FE, own: `r:${s.i}E`, order: 2 })
    }

    // Torque on loops in an outside field, and forces on wires.
    const torqueFacts = [], forceFacts = []
    for (const s of currents.filter((q) => q.type === 'loop')) {
      const Bext = F.B(M(s.at), (q) => q !== s), Bm = V3.len(Bext)
      if (!(Bm > 0)) continue
      const muv = s.edge ? [s.n[0], s.n[1], 0] : [0, 0, s.sign]
      const mu = V3.mul(muv, s.N * s.I * s.A * lu * lu), tau = V3.cross(mu, Bext), th = (Math.acos(Math.max(-1, Math.min(1, V3.dot(mu, Bext) / (V3.len(mu) * Bm)))) * 180) / Math.PI
      const tm = V3.len(tau)
      torqueFacts.push(`loop ${name(s)}: μ = NIA = ${num(V3.len(mu))} A·m², B = ${num(Bm)} T, angle(μ, B) = ${fmt(th)}°, τ = μB sin θ = ${num(tm)} N·m${tm > 0 && s.edge ? `, turning ${tau[2] > 0 ? 'ccw' : 'cw'} (μ toward B)` : tm > 0 ? ` about ${fmt(angleOf(tau))}°` : ''}`)
      if (!s.edge || !(tm > 0)) continue
      // Draw θ between μ and B, the torque's turning sense, and the forces on a rect loop's sides.
      const c = P(s.at), dm = scr(V3.mul(mu, 1 / V3.len(mu))), db = scr(Bext), R = 22
      if (Math.hypot(Bext[0], Bext[1]) > 0.5 * Bm) {
        const z = V.add(c, V.mul(db, R + 18))
        cv.back.push(el('line', { x1: c[0], y1: c[1], x2: z[0], y2: z[1], stroke: theme.muted, 'stroke-width': 1, 'stroke-dasharray': '3 3' }))
        cv.trace([c, z], 'ray', 0.5)
        const a1 = angleOf(Bext), a2 = angleOf(mu)
        let sw = ((a2 - a1) % 360 + 540) % 360 - 180
        const arc = arcPoints(c, R, a1, a1 + sw)
        cv.front.push(el('path', { d: pathD(arc), fill: 'none', stroke: theme.fg, 'stroke-width': 1.2 }))
        cv.trace(arc, `tq:${s.i}`, 0.8)
        const md = dirOf(a1 + sw / 2)
        const tc = [0, -12, 12].flatMap((da) => [R + 3, R + 12, R + 22].map((rr) => { const d = dirOf(a1 + sw / 2 + da); return (w, h) => V.add(c, V.mul(d, rr + extent(d, w, h))) }))
        lab('\\theta', tc, { own: `tq:${s.i}`, order: 0 })
      }
      if (s.shape === 'rect') {
        s.ends.forEach((e, k) => {
          const Iz = k === 0 ? 1 : -1, Fv = V3.cross([0, 0, Iz * Math.sign(s.I)], Bext)
          if (Math.hypot(Fv[0], Fv[1]) < 1e-9) return
          const d = scr(Fv), pe = P(e), tail = V.add(pe, V.mul(d, 10)), tip = V.add(pe, V.mul(d, ARROW))
          arrow(cv, tail, tip, FB, { width: 2, tag: `tq:${s.i}F${k}`, head: 9 })
          lab('F', arrowCands(tail, tip), { fill: FB, own: `tq:${s.i}F${k}`, order: 1 })
        })
      }
    }
    // Pairs of parallel currents: F/L = μ₀I₁I₂/2πd.
    const longs = currents.filter((s) => s.type === 'wire' || s.type === 'cylinder' || (s.type === 'segment' && s.infinite))
    for (let i = 0; i < longs.length; i++) for (let j = i + 1; j < longs.length; j++) {
      const a = longs[i], b = longs[j]
      const through = (s) => s.type !== 'segment'
      let d, same
      if (through(a) && through(b)) { d = W.len(W.sub(a.at, b.at)); same = a.sign * a.I * b.sign * b.I > 0 }
      else if (!through(a) && !through(b) && Math.abs(a.u[0] * b.u[1] - a.u[1] * b.u[0]) < 1e-9) { d = Math.abs(W.dot(W.sub(b.a, a.a), W.perp(a.u))); same = W.dot(a.u, b.u) * a.I * b.I > 0 }
      else continue
      if (!(d > 0)) continue
      forceFacts.push(`wires ${name(a)}–${name(b)}: d = ${L(d)}, F/L = μ₀I₁I₂/2πd = ${num((MU0 * Math.abs(a.I * b.I)) / (2 * Math.PI * d * lu))} N/m, ${same ? 'attract' : 'repel'}`)
    }
    if (spec.forces) {
      for (const s of longs.concat(currents.filter((q) => q.type === 'segment' && !q.infinite))) {
        const others = (q) => q !== s
        let Fv, at, perLen = true
        if (s.type === 'segment') {
          const seg = s.infinite ? clipSegment(W.sub(s.a, W.mul(s.u, view.far)), W.add(s.a, W.mul(s.u, view.far)), worldRect) : [s.a, s.b]
          if (!seg) continue
          at = V.mid(seg[0], seg[1])
          if (s.infinite) Fv = V3.mul(V3.cross([s.u[0], s.u[1], 0], F.B(M(at), others)), s.I)
          else {
            perLen = false; Fv = [0, 0, 0]
            for (let k = 0; k < 200; k++) Fv = V3.add(Fv, V3.mul(V3.cross([s.u[0], s.u[1], 0], F.B(M(W.add(s.a, W.mul(s.u, (s.L * (k + 0.5)) / 200))), others)), (s.I * s.L * lu) / 200))
          }
        } else { at = s.at; Fv = V3.mul(V3.cross([0, 0, s.sign], F.B(M(at), others)), s.I) }
        const fm = Math.hypot(Fv[0], Fv[1])
        if (!(fm > 0)) continue
        const d = scr(Fv), c = P(at), tail = V.add(c, V.mul(d, s.type === 'segment' ? 3 : 12)), tip = V.add(c, V.mul(d, s.type === 'segment' ? ARROW : ARROW + 10))
        arrow(cv, tail, tip, FB, { width: 2.2, tag: `f:${s.i}`, head: 10 })
        lab(longs.length + currents.length > 2 ? sub('F', name(s)) : 'F', arrowCands(tail, tip), { fill: FB, own: `f:${s.i}`, order: 1 })
        forceFacts.push(`${perLen ? 'F/L' : 'F'} on ${name(s)} = ${num(fm)} ${perLen ? 'N/m' : 'N'} toward ${fmt(angleOf(Fv))}°`)
      }
    }

    // Points, with B where asked.
    const pointFacts = []
    for (const p of points.values()) {
      const c = P(p.at), B = Bat(p.at), Bm = V3.len(B)
      if (!inView(p.at)) diag.warn(p.path, `point ${p.name} is outside the view; widen view`)
      const onWire = currents.some((s) => s.through.some((t) => !t.r && W.len(W.sub(t.at, p.at)) * S < 1))
      if (onWire) diag.warn(p.path, `point ${p.name} sits on a wire, where B is undefined; move it off`)
      const tag = `p:${p.name}`
      if (p.showB && Bm > 0 && Math.abs(B[2]) > Math.hypot(B[0], B[1])) {
        mark(c, B[2] > 0, theme.fg, 6.5, tag, 'front')
        lab(p.label === false ? false : sub('B', p.label), ringCands(c, 10, [-0.7, -0.7]), { ignore: [tag], order: 0 })
      } else {
        cv.front.push(el('circle', { cx: c[0], cy: c[1], r: 3.2, fill: theme.fg }))
        cv.trace(circlePoly(c, 4, 10), tag, 1, true)
        lab(p.label, ringCands(c, 8, [-0.7, -0.7]), { ignore: [tag], order: 0 })
        if (p.showB && Bm > 0) {
          const d = scr(B), tail = V.add(c, V.mul(d, 4)), tip = V.add(c, V.mul(d, ARROW + 2))
          arrow(cv, tail, tip, theme.fg, { width: 2, tag: `${tag}B` })
          lab(sub('B', p.label), arrowCands(tail, tip), { own: `${tag}B`, order: 0 })
        }
      }
      let fact = `${p.name} ${xy(p.at)}: |B| = ${num(Bm)} T${Bm ? ` ${bdir(B)}` : ''}`
      if (p.showB && sources.length > 1) fact += ` [${sources.map((s) => { const b = F.B(M(p.at), (q) => q === s); return `${name(s)}: ${num(V3.len(b))} T${V3.len(b) ? ` ${bdir(b)}` : ''}` }).join('; ')}]`
      pointFacts.push(fact)
    }

    // Field lines of the currents (before the labels, so labels keep off them).
    const mode = spec.B ?? (currents.length && !regions.some((r) => r.Bmag !== undefined) ? 'arrows' : 'none')
    if (!['arrows', 'lines', 'none'].includes(mode)) throw new SpecError('B', 'B is "arrows" (a grid of arrows and ⊙/⊗ marks), "lines" (field lines around the currents), or "none"')
    let lineCount = 0
    if (mode === 'lines') lineCount = drawLines()

    labels.sort((x, y) => (x.order ?? 2) - (y.order ?? 2))
    const placed = placeLabels(labels, cv)
    drawLabels(placed, cv, theme)
    const crowded = placed.filter((q) => q.hard).map((q) => q.label)
    if (crowded.length) diag.warn('view', `no clear spot for ${crowded.join(', ')}; the label sits on a backing box. Widen view or move things apart`)

    // Region fills, then the field grid, in the space left.
    for (const s of regions) {
      if (s.Bmag === undefined) continue
      const rect = s.box ? [...P([s.box[0], s.box[3]]), ...P([s.box[2], s.box[1]])] : s.circle ? [...P([s.circle.at[0] - s.circle.r, s.circle.at[1] + s.circle.r]), ...P([s.circle.at[0] + s.circle.r, s.circle.at[1] - s.circle.r])] : [0, 0, Wpx, Hpx]
      const inp = Math.hypot(s.Bv[0], s.Bv[1]) > Math.abs(s.Bv[2])
      const c0 = s.circle && P(s.circle.at), rr = s.circle && s.circle.r * S
      const into = s.Bv[2] < 0, sdir = inp ? scr(s.Bv) : null
      const n = drawField(cv, [rect[0] + 2, rect[1] + 2, rect[2] - 2, rect[3] - 2], { sd: sdir, into, inside: s.circle ? (q) => V.len(V.sub(q, c0)) < rr - 8 : undefined }, placed, null, theme)
      if (n) continue
      // Too crowded for the grid: one mark at a clear spot inside, nearest the region's label.
      const tl = placed.find((q) => q.region === s)
      const mid = tl ? [(tl.box[0] + tl.box[2]) / 2, (tl.box[1] + tl.box[3]) / 2] : [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2], half = sdir ? 12 : 5.5
      const near = cv.obs.filter(([px, py]) => px > rect[0] - 4 && px < rect[2] + 4 && py > rect[1] - 4 && py < rect[3] + 4)
      // Keep clear of the induced-B marks, so the applied field's ⊙ isn't read as one of them.
      const induced = cv.obs.filter(([, , , t]) => typeof t === 'string' && /^in:\d+b$/.test(t))
      let best = null
      for (let x = rect[0] + half + 3; x <= rect[2] - half - 3; x += 2) for (let y = rect[1] + half + 3; y <= rect[3] - half - 3; y += 2) {
        const c = [x, y], bx = [x - half, y - half, x + half, y + half]
        if (s.circle && V.len(V.sub(c, c0)) > rr - half) continue
        if (placed.some(({ box: b }) => b[0] < bx[2] + 1 && bx[0] < b[2] + 1 && b[1] < bx[3] + 1 && bx[1] < b[3] + 1)) continue
        if (near.some(([px, py]) => px > bx[0] - 1 && px < bx[2] + 1 && py > bx[1] - 1 && py < bx[3] + 1)) continue
        if (induced.some(([px, py]) => V.len(V.sub([px, py], c)) < 26)) continue
        const d = V.len(V.sub(c, mid))
        if (!best || d < best.d) best = { c, d }
      }
      if (!best) continue
      if (sdir) arrow(cv, V.sub(best.c, V.mul(sdir, 10)), V.add(best.c, V.mul(sdir, 10)), theme.muted, { width: 1.1, head: 6, layer: 'back' })
      else fieldMark(cv, best.c, into, theme.muted, { r: 4 })
    }
    let arrowCount = 0
    if (mode !== 'none') arrowCount = arrowGrid(cv, view, (w) => { const b = Bcur(w); return currents.some((s) => s.through.some((t) => !t.r && V.len(V.sub(P(t.at), P(w))) < 12)) ? null : b }, placed.map((q) => q.box), theme, { pass: /^(fl|pa:|r:)/, marksOnly: mode === 'lines', floor: 1e-30 })

    // Canvas.
    const xs = cv.ext.map((p) => p[0]), ys = cv.ext.map((p) => p[1])
    const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys)
    const body = el('g', { transform: `translate(${(MARGIN - x0).toFixed(1)},${(MARGIN - y0).toFixed(1)})` }, [...cv.back, ...cv.mid, ...cv.front])

    const out = [`bfield: ${srcDesc.join('; ')}`]
    if (pointFacts.length) out.push(`points ${pointFacts.join('; ')}`)
    if (forceFacts.length) out.push(forceFacts.join('; '))
    if (torqueFacts.length) out.push(`torque: ${torqueFacts.join('; ')}`)
    if (facts.length) out.push(facts.join('; '))
    if (partFacts.length) out.push(`particles ${partFacts.join('; ')}`)
    if (indFacts.length) out.push(`induction ${indFacts.join('; ')}`)
    out.push(mode === 'lines' ? `${lineCount} field lines` : mode === 'arrows' ? `${arrowCount} field arrows` : 'no field grid')
    return { body, width: x1 - x0 + 2 * MARGIN, height: y1 - y0 + 2 * MARGIN, summary: out.join('; '), alt: 'magnetic field diagram' }

    /** Field lines of the currents' in-page B, traced from seeds near each current until they close. */
    function drawLines() {
      const step = 2 / S, near = (p) => throughs().some((t) => V.len(V.sub(P(t.at), P(p))) < (t.r ? Math.max(t.r * S, 9) : 9))
      const dirAt = (p) => { const b = Bcur(p), m = Math.hypot(b[0], b[1]); return m > 0 && Number.isFinite(m) ? [b[0] / m, b[1] / m] : null }
      const run = (seed, sg) => {
        const pts = [seed]
        let p = seed, closed = false
        for (let k = 0; k < 2500; k++) {
          const k1 = dirAt(p); if (!k1) break
          const k2 = dirAt(W.add(p, W.mul(k1, (sg * step) / 2))); if (!k2) break
          const k3 = dirAt(W.add(p, W.mul(k2, (sg * step) / 2))); if (!k3) break
          const k4 = dirAt(W.add(p, W.mul(k3, sg * step))); if (!k4) break
          const q = W.add(p, W.mul(W.add(W.add(k1, W.mul(k2, 2)), W.add(W.mul(k3, 2), k4)), (sg * step) / 6))
          if (!inView(q)) { const seg = clipSegment(p, q, worldRect); if (seg) pts.push(seg[1]); break }
          if (near(q)) break
          pts.push(q); p = q
          if (k > 12 && W.len(W.sub(q, seed)) < 1.5 * step) { closed = true; break }
        }
        return { pts, closed }
      }
      const seeds = []
      const ths = throughs()
      for (const t of ths) {
        if (t.s.type === 'loop' || t.s.type === 'solenoid') continue
        const others = ths.filter((o) => o !== t)
        const cen = others.length ? others.reduce((acc, o) => W.add(acc, W.mul(o.at, 1 / others.length)), [0, 0]) : W.add(t.at, [-1, 0])
        const away = W.unit(W.sub(t.at, cen))
        const r0 = (t.r ? t.r * S : 0)
        for (const d of [18, 34, 54, 80, 112, 150]) seeds.push(W.add(t.at, W.mul(away, (r0 + d) / S)))
      }
      for (const s of currents) {
        if (s.type === 'loop' && s.edge) for (const f of [0.5, 0.28, 0.72, 0.1, 0.9]) seeds.push(W.add(s.ends[1], W.mul(W.sub(s.ends[0], s.ends[1]), f)))
        if (s.type === 'solenoid') for (const f of [0.5, 0.3, 0.7, 0.12, 0.88]) seeds.push(W.add(W.sub(s.at, W.mul(s.t, s.r)), W.mul(s.t, 2 * s.r * f)))
      }
      const drawn = []
      let count = 0
      for (const seed of seeds) {
        if (!inView(seed) || near(seed)) continue
        if (drawn.some((ln) => ln.some((q) => V.len(V.sub(q, P(seed))) < 5))) continue
        let { pts, closed } = run(seed, 1)
        if (!closed) { const back = run(seed, -1); pts = [...back.pts.reverse(), ...pts.slice(1)] }
        if (pts.length < 4) continue
        const line = pts.map(P)
        drawn.push(line)
        cv.back.push(el('path', { d: pathD(line, closed), fill: 'none', stroke: theme.muted, 'stroke-width': 1.1 }))
        cv.trace(line, 'fl', 0.25)
        // One arrowhead, a third of the way along, pointing along B.
        const k = Math.max(1, Math.floor(line.length / 3)), d = V.unit(V.sub(line[k], line[k - 1])), nn = V.perp(d), c = line[k]
        const tri = [V.add(c, V.mul(d, 4)), V.add(V.sub(c, V.mul(d, 3)), V.mul(nn, 3)), V.sub(V.sub(c, V.mul(d, 3)), V.mul(nn, 3))]
        cv.back.push(el('path', { d: pathD(tri, true), fill: theme.muted }))
        count++
      }
      return count
    }
  },
}
