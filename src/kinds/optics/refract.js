// Refraction modes: Snell's law across layered media with partial and total internal reflection
// and a slab's lateral shift (refraction), a prism's deviation and dispersion (prism), apparent
// depth under a flat surface (depth), and a ray guided by TIR down a light pipe (fiber). One
// vector form of Snell's law traces every ray. Screen px, y down; the diagram's angles are true
// except in depth, which stretches x so near-normal rays show their bend.

import { el, pathD } from '../../svg.js'
import { color } from '../../theme.js'
import { SpecError } from '../../diag.js'
import { degOf, shortSweep } from '../fbd/draw.js'
import { placeLabels, drawLabels, extent, arrowCands } from '../fbd/place.js'
import { RAY, W, seg, chevron, angleArc, normal, medium, V, dirOf } from './draw.js'
import { length, angle, index, sig, deg, LEN } from './units.js'

const D2R = Math.PI / 180
const sinD = (x) => Math.sin(x * D2R), cosD = (x) => Math.cos(x * D2R), tanD = (x) => Math.tan(x * D2R)
const asinD = (x) => Math.asin(Math.max(-1, Math.min(1, x))) / D2R
const cross = (a, b) => a[0] * b[1] - a[1] * b[0]
const f4 = (x) => sig(x, 4)
const dg4 = (x) => `${sig(x, 4)}°`
const angVal = (v, label, more = {}) => ({ v, kind: 'angle', label, show: dg4, ...more })
const DOT = '1.5 3'

/**
 * Snell's law in vector form: unit direction d meets a surface with unit normal nrm (either
 * side) going from index n1 into n2. Returns { refl, out } or, past the critical angle, { refl, tir }.
 */
export function snell(d, nrm, n1, n2) {
  let N = nrm, c = -V.dot(nrm, d)
  if (c < 0) { N = V.mul(nrm, -1); c = -c }
  const refl = V.add(d, V.mul(N, 2 * c))
  const r = n1 / n2, k = 1 - r * r * (1 - c * c)
  if (k < 0) return { tir: true, refl }
  return { tir: false, refl, out: V.unit(V.add(V.mul(d, r), V.mul(N, r * c - Math.sqrt(k)))) }
}

/** Where the ray p + t·d (t > 0) crosses segment a–b: { t, s (0 at a, 1 at b), p } or null. */
function hitSeg(p, d, a, b) {
  const e = V.sub(b, a), den = cross(d, e)
  if (Math.abs(den) < 1e-12) return null
  const w = V.sub(a, p), t = cross(w, e) / den, s = cross(w, d) / den
  return t > 1e-6 && s >= -1e-9 && s <= 1 + 1e-9 ? { t, s, p: V.add(p, V.mul(d, t)) } : null
}

/** Where line p + t·d meets line q + s·e. */
function meet(p, d, q, e) {
  const den = cross(d, e)
  return Math.abs(den) < 1e-12 ? null : V.add(p, V.mul(d, cross(V.sub(q, p), e) / den))
}

/** An angle arc at c between screen directions u1 and u2, with label spots near it and further out. */
function arcBetween(cv, c, r, u1, u2, stroke, layer = 'mid') {
  const a1 = degOf(u1), a2 = a1 + shortSweep(a1, degOf(u2))
  if (Math.abs(a2 - a1) < 0.5 || r < 6) return null
  const near = angleArc(cv, c, r, a1, a2, stroke, { layer })
  // Beside each side of the angle (the ray first), on its far side from the other: a narrow
  // angle has no room for a label between its sides.
  const b2 = besideCands(c, u2, u1, r), b1 = besideCands(c, u1, u2, r)
  b2.forEach((q, i) => near.push(q, b1[i]))
  const mid = (a1 + a2) / 2, half = Math.max(Math.abs(a2 - a1) / 2, 12)
  const far = []
  for (const g of [12, 24]) for (const k of [0, 0.6, -0.6, 1.2, -1.2]) {
    const u = dirOf(mid + k * half)
    far.push((w, h) => V.add(c, V.mul(u, r + 4 + g + extent(u, w, h))))
  }
  return [...near, ...far]
}

/** Label spots beside the line from c along ua, on the side away from ub. */
function besideCands(c, ua, ub, r) {
  let s = V.perp(ua)
  if (V.dot(s, ub) > 0) s = V.mul(s, -1)
  return [1, 1.5, 0.6, 2.1].map((k) => (w, h) => V.add(V.add(c, V.mul(ua, r * k)), V.mul(s, 5 + extent(s, w, h))))
}

/** Mark placed labels' boxes as strokes, so a later placeLabels call keeps clear of them. */
function block(cv, placed) {
  for (const q of placed) {
    const [x0, y0, x1, y1] = q.box
    cv.fill([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], 'label', 50)
  }
}

/** A ray segment with a direction chevron. */
function ray(cv, a, b, stroke, opts = {}) {
  seg(cv, a, b, stroke, opts)
  if (!opts.dashed && opts.arrow !== false) chevron(cv, a, b, stroke, { at: opts.at ?? 0.5, size: opts.width && opts.width < W.ray ? 5 : 6 })
}

/** A dotted construction line (an extension, the critical direction). */
const dotted = (cv, a, b, theme, tag = 'ext') => seg(cv, a, b, theme.muted, { width: 1.3, dashed: true, dash: DOT, layer: 'back', tag, weight: 0.6 })

/** A horizontal or slanted boundary line, traced so labels keep off it. */
function boundary(cv, a, b, stroke, width = 1.2) {
  cv.back.push(el('line', { x1: +a[0].toFixed(2), y1: +a[1].toFixed(2), x2: +b[0].toFixed(2), y2: +b[1].toFixed(2), stroke, 'stroke-width': width }))
  cv.trace([a, b], 'surface', 1)
}

/** A dimension line a–b with end ticks across it. */
function dimension(cv, a, b, theme) {
  const u = V.unit(V.sub(b, a)), t = V.mul(V.perp(u), 4)
  cv.mid.push(el('path', { d: pathD([a, b]) + pathD([V.add(a, t), V.sub(a, t)]) + pathD([V.add(b, t), V.sub(b, t)]), stroke: theme.fg, 'stroke-width': 1, fill: 'none' }))
  cv.trace([a, b], 'dim', 1)
  cv.trace([V.add(a, t), V.sub(a, t)], 'dim', 1); cv.trace([V.add(b, t), V.sub(b, t)], 'dim', 1)
}

/** Label spots inside a band [x0, x1] × [y0, y1]: right, left, then center, at mid height and near each edge. */
function bandCands(x0, x1, y0, y1) {
  const out = []
  const ys = [(h) => (y0 + y1) / 2, (h) => y0 + h / 2 + 5, (h) => y1 - h / 2 - 5]
  const xs = [(w) => x1 - w / 2 - 6, (w) => x0 + w / 2 + 6, (w) => (x0 + x1) / 2, (w) => x1 - w / 2 - 50, (w) => x0 + w / 2 + 50]
  for (const fy of ys) for (const fx of xs) out.push((w, h) => [fx(w), fy(h)])
  return out
}

/** Draw placed labels; a crowded one (on a backing box) is a note, as layout is automatic. */
function finish(placed, cv, theme, diag) {
  drawLabels(placed, cv, theme)
  const crowded = placed.filter((q) => q.hard)
  if (crowded.length) diag.note('', `crowded: ${crowded.map((q) => q.label).join(', ')} sit on backing boxes; values: false can help`)
  return placed
}

function unitOf(spec) {
  const u = spec.unit ?? 'cm'
  if (!(u in LEN)) throw new SpecError('unit', `unit is a length unit: ${Object.keys(LEN).join(', ')} (default cm)`)
  return u
}

function needAngle(spec, what) {
  if (spec.angle === undefined) throw new SpecError('angle', `angle is ${what} in degrees, like 40`)
  return spec.angle
}

function readAngle(v, env, path, what) {
  const a = angle(v, env, path)
  if (!(a >= 0 && a < 90)) throw new SpecError(path, `${what} is from 0 up to 90 degrees, like 40 (${sig(a, 4)} given)`)
  return a
}

const mediumLabel = (m) => (m.label ? `${m.label}, n = ${sig(m.n, 3)}` : `n = ${sig(m.n, 3)}`)

// ---------------------------------------------------------------------------------------------
// refraction: horizontal layers top to bottom; the ray starts in the first and travels down.

export function refractionMode(spec, { theme, diag, env }, cv) {
  const unit = unitOf(spec), show = spec.values !== false
  const fs = theme.size
  if (!Array.isArray(spec.media) || spec.media.length < 2) {
    throw new SpecError('media', 'media is 2 or more layers in the order the light meets them, top to bottom, like [{"n": 1.00, "label": "air"}, {"n": 1.50, "label": "glass", "t": 2}, {"n": 1.00, "label": "air"}]')
  }
  const N = spec.media.length
  const media = spec.media.map((m, k) => {
    const path = `media[${k}]`
    if (!m || typeof m !== 'object' || m.n === undefined) throw new SpecError(path, 'each medium is {"n": 1.50, "label": "glass"}; middle ones also need a thickness t')
    const n = index(m.n, env, `${path}.n`, diag)
    const mid = k > 0 && k < N - 1
    let t = null
    if (mid) {
      if (m.t === undefined) throw new SpecError(`${path}.t`, `a middle layer needs its thickness t, like "t": 2 (in ${unit}) or "2 mm"`)
      t = length(m.t, env, `${path}.t`, unit)
      if (!(t > 0)) throw new SpecError(`${path}.t`, 'the thickness t must be positive')
    } else if (m.t !== undefined) diag.warn(`${path}.t`, `the ${k ? 'last' : 'first'} medium is a half-space; its t is ignored`)
    if (m.label !== undefined && typeof m.label !== 'string') throw new SpecError(`${path}.label`, 'label is a short name, like "glass"')
    return { n, t, label: m.label }
  })
  const th1 = readAngle(needAngle(spec, 'θ1, the angle of incidence from the normal'), env, 'angle', 'angle (θ1, from the normal)')

  // Angles: n sin θ is the same in every layer until one can't carry it (TIR).
  const inv = media[0].n * sinD(th1)
  const th = [th1]
  let tirAt = -1
  for (let k = 1; k < N; k++) {
    if (inv > media[k].n * (1 + 1e-12)) { tirAt = k - 1; break }
    th.push(asinD(inv / media[k].n))
    if (k < N - 1 && th[k] > 85) throw new SpecError('angle', `the ray runs nearly along layer ${k + 1} (θ${k + 1} = ${dg4(th[k])}); use a smaller angle`)
  }
  const reached = th.length // media the ray enters
  const decr = media.findIndex((m, k) => k < N - 1 && media[k + 1].n < m.n)
  const cAt = tirAt >= 0 ? tirAt : decr
  const thc = cAt >= 0 ? asinD(media[cAt + 1].n / media[cAt].n) : null

  // Scale: middle layers about 62 px each (120 px in all at most) in true proportion, the ray's
  // sideways run in them at most 100 px; the rays in the half-spaces get 50 to 90 px, keeping the
  // whole run near 200 px across and 250 px down.
  let T = 0, run = 0
  for (let k = 1; k < N - 1; k++) {
    T += media[k].t
    if (k < reached) run += media[k].t * tanD(th[k]) * (k === tirAt ? 2 : 1)
  }
  const s = N > 2 ? Math.min(Math.min(62 * (N - 2), 120) / T, run > 0 ? 100 / run : Infinity) : 1
  const across = sinD(th1) + (tirAt < 0 ? sinD(th[N - 1]) : tirAt === 0 ? sinD(th1) : 0.5)
  const down = cosD(th1) + (tirAt < 0 ? cosD(th[N - 1]) : 0)
  const L = Math.max(50, Math.min(90, (200 - run * s) / Math.max(across, 1e-9), (250 - T * s) / Math.max(down, 1e-9)))
  const Y = [0]
  for (let k = 1; k < N - 1; k++) Y.push(Y[k - 1] + media[k].t * s)
  const layerH = (k) => (k === 0 || k === N - 1 ? Infinity : media[k].t * s)

  // Trace the ray.
  const d0 = [sinD(th1), cosD(th1)]
  const start = V.mul(d0, -L)
  const segs = [{ a: start, b: [0, 0] }]
  const hits = []
  let p = [0, 0], d = d0, refl = null, back = null, endLast = null
  for (let j = 0; j < N - 1; j++) {
    const r = snell(d, [0, -1], media[j].n, media[j + 1].n)
    hits.push({ p, din: d, r })
    if (r.tir) {
      // Reflected at full strength; it stops once it leaves this layer (or after a short run).
      if (j === 0) refl = { a: p, b: V.add(p, V.mul(r.refl, L)) }
      else {
        const q = V.add(p, V.mul(r.refl, (Y[j - 1] - p[1]) / r.refl[1]))
        refl = { a: p, b: q }
        const up = snell(r.refl, [0, 1], media[j].n, media[j - 1].n)
        if (!up.tir) back = { a: q, b: V.add(q, V.mul(up.out, j - 1 === 0 ? 40 : Math.min(40, layerH(j - 1) / Math.abs(up.out[1])))) }
      }
      break
    }
    d = r.out
    if (j + 1 === N - 1) { endLast = V.add(p, V.mul(d, L)); segs.push({ a: p, b: endLast }) } else {
      const q = V.add(p, V.mul(d, (Y[j + 1] - p[1]) / d[1]))
      segs.push({ a: p, b: q }); p = q
    }
  }

  // The bands start wide enough for labels beside the ray and grow to hold the labels placed.
  // The surfaces are traced well past them, so labels keep off them wherever they land.
  const pts = [start, [0, 0], ...segs.map((g) => g.b), ...(refl ? [refl.b] : []), ...(back ? [back.b] : [])]
  let bx0 = Math.min(...pts.map((q) => q[0])) - 40, bx1 = Math.max(...pts.map((q) => q[0])) + 40
  if (bx1 - bx0 < 280) { const c = (bx0 + bx1) / 2; bx0 = c - 140; bx1 = c + 140 }
  let top = Math.min(-50, ...pts.map((q) => q[1])) - 14
  const yl = Y[N - 2]
  let bottom = (endLast ? Math.max(yl + 50, endLast[1]) : yl + 38) + 14
  for (const y of Y) { cv.trace([[bx0 - 200, y], [bx1 + 200, y]], 'surface', 1); cv.ext.length -= 2 }

  const items = []
  const thName = (k) => `\\theta_{${k}}`
  const lab = (name, v) => (show ? `${name} = ${deg(v)}` : name)
  hits.forEach((h, j) => {
    const up = Math.min(42, layerH(j)), down = Math.min(42, layerH(j + 1))
    normal(cv, h.p, [0, 1], [up, down], theme)
    if (j === 0 && th1 >= 0.5) {
      const c = arcBetween(cv, h.p, Math.min(30, up * 0.75), [0, -1], V.mul(h.din, -1), theme.fg)
      if (c) items.push({ label: lab(thName(1), th1), size: fs, fill: theme.fg, cands: c })
    }
    if (h.r.tir) {
      // The critical direction, dotted on the reflected side: the reflected ray lies beyond it.
      const uc = [sinD(thc), -cosD(thc)]
      const len = Math.min(L * 0.8, j === 0 ? Infinity : layerH(j) / cosD(thc))
      dotted(cv, h.p, V.add(h.p, V.mul(uc, len)), theme, 'crit')
      const rc = Math.min(26, up * 0.65)
      const c = arcBetween(cv, h.p, rc, [0, -1], uc, theme.fg)
      // Just the name in the narrow wedge, so it can't read as the reflected ray's angle; the
      // caption gives the value.
      // The wedge widens away from the surface, so spots further out along its bisector come first.
      const bis = V.unit(V.add([0, -1], uc))
      const deep = [1.7, 2.1, 2.5].map((k) => V.add(h.p, V.mul(bis, Math.min(rc * k, len * 0.85))))
      if (c) items.push({ label: '\\theta_{c}', size: fs, fill: theme.fg, cands: [...c.slice(0, 2), ...deep, ...c.slice(2, 5), ...besideCands(h.p, h.r.refl, [0, -1], rc * 1.6), ...c.slice(5)] })
    } else if (th[j + 1] >= 0.5) {
      const c = arcBetween(cv, h.p, Math.min(30, down * 0.75), [0, 1], h.r.out, theme.fg)
      if (c) items.push({ label: lab(thName(j + 2), th[j + 1]), size: fs, fill: theme.fg, cands: c })
    }
  })

  // Rays: the main path, the partial reflection at the first surface, or the TIR reflection.
  for (const g of segs) ray(cv, g.a, g.b, RAY.main)
  if (refl) ray(cv, refl.a, refl.b, RAY.main)
  if (back) ray(cv, back.a, back.b, RAY.main)
  // Near normal incidence the partial reflection would run back along the incident ray, so it's left out.
  const partial = spec.reflect !== false && !hits[0].r.tir && th1 >= 5
  if (partial) ray(cv, [0, 0], V.mul(hits[0].r.refl, L * 0.7), RAY.main, { width: 1.1, opacity: 0.5 })

  // Lateral shift: the exit ray is parallel to the incident one when the outer media match.
  let shift = null
  if (N > 2 && tirAt < 0 && Math.abs(media[N - 1].n - media[0].n) < 1e-9) {
    let dx = T * tanD(th1)
    for (let k = 1; k < N - 1; k++) dx -= media[k].t * tanD(th[k])
    shift = { d: dx * cosD(th1), dx }
    const pe = segs[segs.length - 1].a
    dotted(cv, [0, 0], V.mul(d0, V.dot(endLast, d0)), theme)
    const Q = V.add(pe, V.mul(d0, L * 0.7)), F = V.mul(d0, V.dot(Q, d0))
    if (V.len(V.sub(Q, F)) >= 3) {
      dimension(cv, F, Q, theme)
      const u = V.unit(V.sub(Q, F))
      const cands = []
      // Past the dotted extension first: that side has nothing else on it.
      for (const along of [0, 12, 24, 36, -12]) cands.push((w, h) => V.add(V.add(F, V.mul(d0, along)), V.mul(u, -6 - extent(u, w, h))))
      for (const along of [0, 12, -12, 24]) cands.push((w, h) => V.add(V.add(Q, V.mul(d0, along)), V.mul(u, 6 + extent(u, w, h))))
      items.push({ label: show ? `d = ${sig(shift.d, 3)} ${unit}` : 'd', size: fs, fill: theme.fg, cands })
    }
  }

  const placed = placeLabels(items, cv)
  for (const { box } of placed) {
    bx0 = Math.min(bx0, box[0] - 8); bx1 = Math.max(bx1, box[2] + 8)
    top = Math.min(top, box[1] - 6); bottom = Math.max(bottom, box[3] + 6)
  }
  block(cv, placed)
  const bands = media.map((m, k) => [k === 0 ? top : Y[k - 1], k === N - 1 ? bottom : Y[k]])
  const nBack = cv.back.length
  media.forEach((m, k) => medium(cv, [[bx0, bands[k][0]], [bx1, bands[k][0]], [bx1, bands[k][1]], [bx0, bands[k][1]]], m.n))
  for (const y of Y) cv.back.push(el('line', { x1: bx0, y1: +y.toFixed(2), x2: bx1, y2: +y.toFixed(2), stroke: theme.muted, 'stroke-width': 1.2 }))
  cv.back.unshift(...cv.back.splice(nBack))
  const placedM = placeLabels(media.map((m, k) => ({ label: mediumLabel(m), size: fs - 1, fill: theme.muted, cands: bandCands(bx0, bx1, bands[k][0], bands[k][1]) })), cv)
  finish([...placed, ...placedM], cv, theme, diag)

  // Facts and checkable values.
  const facts = [media.map((m, k) => `${m.label ? `${m.label} ` : ''}n${k + 1} ${f4(m.n)}${m.t !== null ? ` (t ${f4(m.t)} ${unit})` : ''}`).join(' → '), `θ1 ${dg4(th1)}`]
  const vals = {}
  if (reached > 1) {
    facts.push(`n sin θ = ${f4(inv)} in every layer (Snell's law): ${th.slice(1).map((a, k) => `θ${k + 2} ${dg4(a)}`).join(', ')}`)
    th.slice(1).forEach((a, k) => { vals[`theta${k + 2}`] = angVal(a, `θ${k + 2}`) })
  }
  if (thc !== null) {
    facts.push(`θc ${dg4(thc)} = sin⁻¹(n${cAt + 2}/n${cAt + 1}) at surface ${cAt + 1}`)
    vals.thetac = angVal(thc, 'θ_c')
  }
  const caption = []
  if (tirAt >= 0) {
    facts.push(`total internal reflection at surface ${tirAt + 1}: θ${tirAt + 1} ${dg4(th[tirAt])} > θc (n${tirAt + 1} sin θ${tirAt + 1} = ${f4(inv)} > n${tirAt + 2} = ${f4(media[tirAt + 1].n)}); the reflected ray leaves at ${dg4(th[tirAt])}`)
    caption.push(`\\theta_{c} = ${deg(thc)}: total internal reflection`)
  } else if (partial) facts.push('partial reflection drawn at surface 1')
  if (shift) {
    const one = N === 3
    facts.push(`lateral shift d ${f4(shift.d)} ${unit}${one ? ' = t sin(θ1 − θ2)/cos θ2' : ' (perpendicular distance between the incident and exit rays)'}`)
    vals.shift = { v: shift.d, kind: 'len', base: unit, label: 'd', show: (v) => `${f4(v)} ${unit}`, alts: [{ v: shift.dx, why: 'is the sideways offset along the surface; d is measured perpendicular to the rays' }] }
    caption.push(one ? `d = t\\sin(\\theta_{1} − \\theta_{2})/\\cos\\theta_{2} = ${sig(shift.d, 3)} ${unit}` : `lateral shift d = ${sig(shift.d, 3)} ${unit}`)
  }
  return { facts, vals, caption }
}

// ---------------------------------------------------------------------------------------------
// prism: apex up, the ray from the lower left through both faces; dispersion with named indices.

const NAMED = { violet: 'purple', orange: 'coral', yellow: 'amber', indigo: 'purple' }

export function prismMode(spec, { theme, diag, env }, cv) {
  const show = spec.values !== false, fs = theme.size
  const A = spec.apex === undefined ? 60 : angle(spec.apex, env, 'apex')
  if (!(A > 0 && A < 150)) throw new SpecError('apex', `apex is the prism angle A in degrees, above 0 and below 150 (default 60); ${sig(A, 4)} given`)
  const n0 = spec.outside === undefined ? 1 : index(spec.outside, env, 'outside', diag)
  if (spec.n === undefined) throw new SpecError('n', 'n is the prism\'s index, like 1.50, or named indices for dispersion, like {"red": 1.513, "violet": 1.532}')
  let cols
  if (spec.n && typeof spec.n === 'object' && !Array.isArray(spec.n)) {
    const ents = Object.entries(spec.n)
    if (!ents.length) throw new SpecError('n', 'name at least one index, like {"red": 1.513, "violet": 1.532}')
    cols = ents.map(([name, v], i) => ({ name, n: index(v, env, `n.${name}`, diag), stroke: color(NAMED[name] ?? name, i) }))
  } else cols = [{ name: null, n: index(spec.n, env, 'n', diag), stroke: RAY.main }]
  cols.forEach((c) => { if (c.n <= n0) diag.warn(c.name ? `n.${c.name}` : 'n', `n = ${sig(c.n, 4)} isn't above the surroundings' ${sig(n0, 4)}, so the ray bends away from the base; check n and outside`) })
  const half = A / 2, n1 = cols[0].n
  const mdArg = (n1 / n0) * sinD(half)
  let th1
  if (spec.angle === undefined) {
    if (mdArg > 1) throw new SpecError('n', `no ray gets through at minimum deviation: (n/n0) sin(A/2) = ${f4(mdArg)} > 1; give an angle, or a smaller apex`)
    th1 = asinD(mdArg)
  } else th1 = readAngle(spec.angle, env, 'angle', 'angle (θ1, from the first face\'s normal)')

  for (const c of cols) {
    c.th2 = asinD((n0 / c.n) * sinD(th1))
    c.th3 = A - c.th2
    const x = (c.n / n0) * sinD(c.th3)
    c.tir = Math.abs(x) > 1
    c.th4 = c.tir ? NaN : asinD(x)
    c.dev = th1 + c.th4 - A
    const m = (c.n / n0) * sinD(half)
    c.dmin = m <= 1 ? 2 * asinD(m) - A : NaN
    c.thc = c.n > n0 ? asinD(n0 / c.n) : NaN
  }

  // The prism: side Lp, apex at the origin, base below.
  const Lp = Math.min(135, 95 / sinD(half))
  const apex = [0, 0], BL = [-Lp * sinD(half), Lp * cosD(half)], BR = [Lp * sinD(half), Lp * cosD(half)]
  const nL = [-cosD(half), -sinD(half)], nR = [cosD(half), -sinD(half)]
  const d1 = V.mul(dirOf(180 - half + th1), -1)
  for (const c of cols) c.d2 = snell(d1, nL, n0, c.n).out
  // Where the ray enters: the spot that centers its path on the faces.
  let best = null
  for (let f = 0.05; f <= 0.9001; f += 0.025) {
    const H1 = V.add(apex, V.mul(V.sub(BL, apex), f))
    const h = hitSeg(H1, cols[0].d2, apex, BR)
    if (!h || h.s < 0.08 || h.s > 0.95) continue
    const score = Math.abs((f + h.s) / 2 - 0.55) + 0.2 * Math.abs(f - h.s)
    if (!best || score < best.score) best = { score, H1 }
  }
  if (!best) throw new SpecError('angle', `the ray inside can't reach the second face (θ3 = A − θ2 = ${dg4(cols[0].th3)}); use a larger angle or a smaller apex`)
  const H1 = best.H1
  for (const c of cols) {
    const h = hitSeg(H1, c.d2, apex, BR)
    c.base = !h
    c.H2 = h ? h.p : hitSeg(H1, c.d2, BL, BR)?.p ?? V.add(H1, V.mul(c.d2, 40))
  }

  medium(cv, [apex, BL, BR], n1)
  cv.mid.push(el('path', { d: pathD([apex, BL, BR], true), fill: 'none', stroke: color('blue'), 'stroke-width': 1.4, 'stroke-linejoin': 'round' }))
  cv.trace([apex, BL, BR], 'surface', 1, true)

  const c0 = cols[0], items = [], opt = [], late = []
  const lab = (name, v) => (show ? `${name} = ${deg(v)}` : name)
  normal(cv, H1, nL, [22, 34], theme)
  const Lin = 85
  const start = V.sub(H1, V.mul(d1, Lin))
  ray(cv, start, H1, cols.length > 1 ? theme.fg : RAY.main)
  const a1 = arcBetween(cv, H1, 24, nL, V.mul(d1, -1), theme.fg)
  if (a1) items.push({ label: lab('\\theta_{1}', th1), size: fs, fill: theme.fg, cands: a1 })
  const aA = arcBetween(cv, apex, 16, V.unit(BL), V.unit(BR), theme.fg)
  if (aA) items.push({ label: show ? `A = ${deg(A)}` : 'A', size: fs, fill: theme.fg, cands: [(w, h) => [0, -6 - h / 2], ...aA] })

  // The exit length: long enough for the deviation arc to land on the exit ray.
  let X = null, R = 0, Lout = 85
  if (!c0.tir && !c0.base) {
    c0.d4 = snell(c0.d2, nR, c0.n, n0).out
    X = meet(H1, d1, c0.H2, c0.d4)
    if (X) {
      const across = hitSeg(H1, d1, apex, BR)
      R = Math.max(V.len(V.sub(c0.H2, X)), across ? V.len(V.sub(across.p, X)) : 0) + 28
      Lout = Math.max(Lout, R - V.len(V.sub(c0.H2, X)) + 30)
    }
  }
  const exitItems = []
  cols.forEach((c, i) => {
    seg(cv, H1, c.H2, c.stroke)
    chevron(cv, H1, c.H2, c.stroke, { size: 5 })
    if (c.base) return
    const r = snell(c.d2, nR, c.n, n0)
    if (r.tir) {
      // Reflected inside; it stops where it next meets the prism.
      const h = hitSeg(c.H2, r.refl, BL, BR) ?? hitSeg(c.H2, r.refl, apex, BL)
      if (h) ray(cv, c.H2, h.p, c.stroke)
      return
    }
    c.d4 = r.out
    const end = V.add(c.H2, V.mul(r.out, Lout))
    ray(cv, c.H2, end, c.stroke, { at: 0.7 })
    if (c.name) exitItems.push({ label: c.name, size: fs - 1, fill: c.stroke, H2: c.H2, end, dev: c.dev })
  })
  // Names past the exit rays' ends, stacked in order of deviation (more deviated further toward the base).
  exitItems.sort((p, q) => p.dev - q.dev).forEach((q, j, all) => {
    const d = V.unit(V.sub(q.end, q.H2)), s = V.perp(d), off = j - (all.length - 1) / 2
    q.cands = [(w, h) => V.add(V.add(q.end, V.mul(d, 4 + extent(d, w, h))), V.mul(s, off * (h + 5))), ...arrowCands(q.H2, q.end)]
  })
  // Normals, the outside angle θ4, and the inside angles if they fit.
  normal(cv, c0.H2, nR, [22, 34], theme)
  if (c0.d4) {
    const a4 = arcBetween(cv, c0.H2, 24, nR, c0.d4, theme.fg)
    if (a4) items.push({ label: lab('\\theta_{4}', c0.th4), size: fs, fill: theme.fg, cands: a4 })
  }
  if (X && Math.abs(c0.dev) >= 0.5) {
    const ext = V.add(X, V.mul(d1, R + 16))
    dotted(cv, H1, ext, theme)
    if (V.dot(V.sub(c0.H2, X), c0.d4) > 0) dotted(cv, X, c0.H2, theme)
    const ad = arcBetween(cv, X, R, d1, c0.d4, theme.fg)
    if (ad) items.push({ label: lab(cols.length > 1 ? `\\delta_{${c0.name}}` : '\\delta', c0.dev), size: fs, fill: theme.fg, cands: ad })
  }
  const arcR = Math.min(20, Lp * 0.15)
  cv.arc2 = []; cv.arc3 = []
  const a2 = arcBetween(cv, H1, arcR, V.mul(nL, -1), c0.d2, theme.fg, 'arc2')
  if (a2) opt.push({ label: '\\theta_{2}', size: fs - 1, fill: theme.fg, cands: a2.slice(0, 5), arc: cv.arc2 })
  if (!c0.base) {
    const a3 = arcBetween(cv, c0.H2, arcR, V.mul(nR, -1), V.mul(c0.d2, -1), theme.fg, 'arc3')
    if (a3) opt.push({ label: '\\theta_{3}', size: fs - 1, fill: theme.fg, cands: a3.slice(0, 5), arc: cv.arc3 })
  }
  if (cols.length === 1) {
    const yb = BL[1]
    late.push({ label: `n = ${sig(n1, 3)}`, size: fs - 1, fill: theme.muted, cands: [[0, yb - 14], [-BR[0] * 0.35, yb - 14], [BR[0] * 0.35, yb - 14], [0, yb - 30]] })
  }
  // θ2 and θ3 (names only) go inside after the rest, and only where they sit clear of every stroke.
  const placed = placeLabels([...items, ...exitItems, ...late], cv)
  block(cv, placed)
  const inside = placeLabels(opt, cv).filter((q) => q.score < 0.5)
  for (const q of inside) cv.mid.push(...q.arc)
  finish([...placed, ...inside], cv, theme, diag)

  // Facts and checkable values.
  const nTxt = cols.length > 1 ? cols.map((c) => `${c.name} ${f4(c.n)}`).join(', ') : f4(n1)
  const facts = [`A ${dg4(A)}, n ${nTxt} in n0 ${f4(n0)}`, `θ1 ${dg4(th1)}${spec.angle === undefined ? ' (minimum deviation, the default)' : ''}`]
  const vals = {}
  const one = (c) => {
    const pre = c.name && cols.length > 1 ? `${c.name}: ` : ''
    const parts = [`θ2 ${dg4(c.th2)}`, `θ3 ${dg4(c.th3)} = A − θ2`]
    if (c.base) parts.push('the ray inside reaches the base')
    else if (c.tir) parts.push(`TIR at the second face (θ3 > θc ${dg4(c.thc)}): the ray reflects inside`)
    else parts.push(`θ4 ${dg4(c.th4)}`, `δ ${dg4(c.dev)} = θ1 + θ4 − A`)
    return pre + parts.join(', ')
  }
  if (cols.length === 1) facts.push(`${one(c0)} (n0 sin θ1 = n sin θ2, n sin θ3 = n0 sin θ4)`)
  else { facts.push('n0 sin θ1 = n sin θ2, n sin θ3 = n0 sin θ4'); for (const c of cols) facts.push(one(c)) }
  if (Number.isFinite(c0.dmin)) facts.push(`δ_min ${dg4(c0.dmin)} = 2 sin⁻¹((n/n0) sin(A/2)) − A${cols.length > 1 ? ` for ${c0.name}` : ''}, at θ1 ${dg4(asinD(mdArg))}`)
  vals.theta2 = angVal(c0.th2, 'θ2'); vals.theta3 = angVal(c0.th3, 'θ3', { alts: [{ v: c0.th2, why: 'is θ2; θ3 = A − θ2' }] })
  if (!c0.tir && !c0.base) {
    vals.theta4 = angVal(c0.th4, 'θ4')
    vals.delta = angVal(c0.dev, 'δ', { alts: Math.abs(c0.dev - c0.dmin) > 0.1 ? [{ v: c0.dmin, why: `is δ_min; at θ1 = ${dg4(th1)} the deviation is larger` }] : [] })
  }
  if (Number.isFinite(c0.dmin)) vals.dmin = angVal(c0.dmin, 'δ_min')
  if (cols.length > 1) {
    const devs = cols.filter((c) => Number.isFinite(c.dev))
    for (const c of devs) vals[`delta_${c.name}`] = angVal(c.dev, `δ_${c.name}`)
    if (devs.length > 1) {
      const lo = devs.reduce((a, b) => (b.dev < a.dev ? b : a)), hi = devs.reduce((a, b) => (b.dev > a.dev ? b : a))
      const spread = hi.dev - lo.dev
      const px = spread * D2R * Lout
      facts.push(`spread δ_${hi.name} − δ_${lo.name} = ${dg4(spread)}${px < 4 ? ` (true angles: about ${sig(px, 2)} px apart at the drawn length, too small to see)` : ''}`)
      vals.spread = angVal(spread, 'spread')
    }
  }
  const caption = c0.tir ? [`\\theta_{3} = ${deg(c0.th3)} > \\theta_{c} = ${deg(c0.thc)}: total internal reflection`] : []
  return { facts, vals, caption }
}

// ---------------------------------------------------------------------------------------------
// depth: an object under a flat surface and its virtual image, n1/d_o + n2/d_i = 0.

export function depthMode(spec, { theme, diag, env }, cv) {
  const unit = unitOf(spec), show = spec.values !== false, fs = theme.size
  const raw = spec.media ?? [{ n: 1.33, label: 'water' }]
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2) throw new SpecError('media', 'media is the object\'s medium, then the viewer\'s (default air), like [{"n": 1.33, "label": "water"}, {"n": 1.00, "label": "air"}]')
  const media = (raw.length === 1 ? [...raw, { n: 1, label: 'air' }] : raw).map((m, k) => {
    if (!m || typeof m !== 'object' || m.n === undefined) throw new SpecError(`media[${k}]`, 'each medium is {"n": 1.33, "label": "water"}')
    return { n: index(m.n, env, `media[${k}].n`, diag), label: m.label }
  })
  if (spec.depth === undefined) throw new SpecError('depth', `depth is the object's real depth below the surface, like 2 (in ${unit}) or "2.00 m"`)
  const dO = length(spec.depth, env, 'depth', unit)
  if (!(dO > 0)) throw new SpecError('depth', 'depth must be positive: the real depth below the surface')
  const [m1, m2] = media
  const di = -(m2.n / m1.n) * dO, app = Math.abs(di)

  // Draw near-normal rays (θ1 = 4°) with x stretched so the bend shows; the dashed extensions
  // still meet within a pixel of the paraxial image, as lines stay lines under the stretch.
  const ratio = m2.n / m1.n
  const D = 120 / Math.max(1, ratio), Di = D * ratio
  const t1 = 4, t2 = asinD((m1.n / m2.n) * sinD(t1))
  if ((m1.n / m2.n) * sinD(t1) > 1) throw new SpecError('media', 'the indices are too far apart for a near-normal ray to leave')
  const Xh = 40, k = Xh / (D * tanD(t1)), Lup = 70
  const meetY = (D * tanD(t1)) / tanD(t2)
  const halfW = 135
  const top = -Lup - 14, bottom = Math.max(D, Di) + 26
  medium(cv, [[-halfW, top], [halfW, top], [halfW, 0], [-halfW, 0]], m2.n)
  medium(cv, [[-halfW, 0], [halfW, 0], [halfW, bottom], [-halfW, bottom]], m1.n)
  boundary(cv, [-halfW, 0], [halfW, 0], theme.muted)
  normal(cv, [0, 0], [0, 1], [44, Math.max(D, Di) + 12], theme)
  const O = [0, D], I = [0, Di]
  for (const sg of [1, -1]) {
    const H = [sg * Xh, 0]
    const up = V.add(H, [sg * k * tanD(t2) * Lup, -Lup])
    ray(cv, O, H, RAY.main)
    ray(cv, H, up, RAY.main)
    seg(cv, H, [0, meetY], RAY.main, { width: W.virtual, dashed: true, tag: 'virtual', weight: 0.6 })
  }
  cv.front.push(el('circle', { cx: O[0], cy: +O[1].toFixed(2), r: 3.5, fill: theme.fg }))
  cv.front.push(el('circle', { cx: I[0], cy: +I[1].toFixed(2), r: 3.5, fill: 'none', stroke: theme.fg, 'stroke-width': 1.3 }))
  cv.trace([O], 'point', 1); cv.trace([I], 'point', 1)

  // Real depth on the left, apparent depth on the right, with faint leaders to the points.
  const xd = Xh + 22, items = []
  const dims = [[-xd, D, show ? `d_{o} = ${sig(dO, 3)} ${unit}` : 'd_{o}', -1], [xd, Di, show ? `|d_{i}| = ${sig(app, 3)} ${unit}` : '|d_{i}|', 1]]
  for (const [x, y, label, side] of dims) {
    cv.back.push(el('line', { x1: 0, y1: +y.toFixed(2), x2: x, y2: +y.toFixed(2), stroke: theme.faint, 'stroke-width': 0.8, 'stroke-dasharray': '2 3' }))
    cv.trace([[x * 0.2, y], [x, y]], 'leader', 0.3)
    dimension(cv, [x, 0], [x, y], theme)
    const cands = [0.5, 0.3, 0.7].flatMap((f) => [(w) => [x + side * (6 + w / 2), y * f], (w) => [x - side * (6 + w / 2), y * f]])
    items.push({ label, size: fs, fill: theme.fg, cands })
  }
  items.push({ label: mediumLabel(m2), size: fs - 1, fill: theme.muted, cands: bandCands(-halfW, halfW, top, 0) })
  items.push({ label: mediumLabel(m1), size: fs - 1, fill: theme.muted, cands: bandCands(-halfW, halfW, Math.max(D, Di) - 10, bottom).concat(bandCands(-halfW, halfW, 0, bottom)) })
  finish(placeLabels(items, cv), cv, theme, diag)

  const nm = (m, k) => `${m.label ? `${m.label} ` : ''}n${k} ${f4(m.n)}`
  const facts = [`object in ${nm(m1, 1)}, viewer in ${nm(m2, 2)}`, `d_o ${f4(dO)} ${unit}`,
    `n1/d_o + n2/d_i = 0 gives d_i = −(n2/n1) d_o = ${f4(di)} ${unit} (virtual, ${ratio < 1 ? 'above' : 'below'} the object)`,
    `apparent depth |d_i| ${f4(app)} ${unit}`, `rays drawn near the normal (θ1 4°) with x stretched ×${sig(k, 2)} so the bend shows`]
  const show4 = (v) => `${f4(v)} ${unit}`
  const vals = {
    depth: { v: app, kind: 'len', base: unit, label: '|d_i|', show: show4, alts: [{ v: dO / ratio, why: 'uses n1/n2; the apparent depth is d_o·n2/n1' }, { v: dO, why: 'is the real depth d_o' }] },
    di: { v: di, kind: 'len', base: unit, label: 'd_i', show: show4, sign: 'has the wrong sign: the image is virtual, so d_i is negative', alts: [{ v: -dO / ratio, why: 'uses n1/n2; d_i = −(n2/n1) d_o' }] },
  }
  return { facts, vals, caption: [] }
}

// ---------------------------------------------------------------------------------------------
// fiber: a core band between cladding bands; the ray enters the left end and zigzags by TIR.

export function fiberMode(spec, { theme, diag, env }, cv) {
  const show = spec.values !== false, fs = theme.size
  if (spec.core === undefined) throw new SpecError('core', 'core is the core\'s index, like 1.50 (clad defaults to 1.00, a bare light pipe in air)')
  const nc = index(spec.core, env, 'core', diag)
  const ncl = spec.clad === undefined ? 1 : index(spec.clad, env, 'clad', diag)
  const n0 = spec.outside === undefined ? 1 : index(spec.outside, env, 'outside', diag)
  const th = readAngle(needAngle(spec, 'the entry angle from the fiber axis'), env, 'angle', 'angle (from the fiber axis)')
  if (ncl >= nc) diag.warn('clad', `TIR needs the cladding below the core: clad ${f4(ncl)} isn't below core ${f4(nc)}`)
  const sr = (n0 * sinD(th)) / nc
  if (sr > 1) throw new SpecError('angle', `no ray enters: n0 sin θ = ${f4(n0 * sinD(th))} > n_core; use a smaller angle`)
  const thr = asinD(sr), phi = 90 - thr
  const guided = ncl < nc
  const thc = guided ? asinD(ncl / nc) : NaN
  const NA = guided ? Math.sqrt(nc * nc - ncl * ncl) : 0
  const accept = NA >= n0 ? 90 : asinD(NA / n0)
  const tir = guided && phi > thc

  // Geometry: the core about 1.6 bounces long, 24 to 46 px tall.
  const Lf = 180, Hc = Math.max(32, Math.min(46, (Lf * tanD(thr)) / 1.6)), Hcl = 24
  const yc = Hc / 2, yo = yc + Hcl
  medium(cv, [[0, -yo], [Lf, -yo], [Lf, -yc], [0, -yc]], ncl)
  medium(cv, [[0, yc], [Lf, yc], [Lf, yo], [0, yo]], ncl)
  medium(cv, [[0, -yc], [Lf, -yc], [Lf, yc], [0, yc]], nc)
  for (const y of [-yc, yc]) boundary(cv, [0, y], [Lf, y], color('blue'), 1.3)
  for (const x of [0, Lf]) boundary(cv, [x, -yo], [x, yo], theme.muted, 1)
  // The ray enters where its first wall hit falls about 45% along, clear of the end face.
  const P0 = [0, Math.max(-0.8 * yc, Math.min(0.5 * yc, yc - 0.45 * Lf * tanD(thr)))]
  normal(cv, P0, [1, 0], [46, 20], theme)
  const din = [cosD(th), sinD(th)], Lin = 58
  const start = V.add(P0, V.mul(din, -Lin))
  ray(cv, start, P0, RAY.main)
  let p = P0, d = snell(din, [-1, 0], n0, nc).out
  let first = null, bounces = 0, escape = null
  for (let guard = 0; guard < 80; guard++) {
    const tw = d[1] > 1e-12 ? (yc - p[1]) / d[1] : d[1] < -1e-12 ? (-yc - p[1]) / d[1] : Infinity
    const te = (Lf - p[0]) / d[0]
    if (te <= tw) {
      const q = V.add(p, V.mul(d, te))
      ray(cv, p, q, RAY.main)
      const r = snell(d, [1, 0], nc, n0)
      if (!r.tir) ray(cv, q, V.add(q, V.mul(r.out, 40)), RAY.main)
      break
    }
    const q = V.add(p, V.mul(d, tw)), wn = [0, Math.sign(d[1])]
    ray(cv, p, q, RAY.main)
    const r = snell(d, wn, nc, ncl)
    if (!first) first = { q, din: d, wn }
    if (r.tir) { d = r.refl; p = q; bounces++; continue }
    // Escapes: refracted out through the cladding, a faint partial reflection for one bounce.
    const outLen = Math.min(60, ncl === n0 && Math.abs(ncl - 1) < 1e-9 ? 44 : Hcl / Math.abs(r.out[1]))
    ray(cv, q, V.add(q, V.mul(r.out, outLen)), RAY.main)
    const rr = r.refl, t2 = Math.min((2 * yc) / Math.abs(rr[1]), (Lf - q[0]) / rr[0])
    ray(cv, q, V.add(q, V.mul(rr, t2)), RAY.main, { width: 1.1, opacity: 0.5 })
    escape = asinD((nc / ncl) * sinD(phi))
    break
  }

  const items = []
  const lab = (name, v) => (show ? `${name} = ${deg(v)}` : name)
  const a0 = arcBetween(cv, P0, 26, [-1, 0], V.mul(din, -1), theme.fg)
  if (a0) items.push({ label: lab('\\theta', th), size: fs, fill: theme.fg, cands: a0 })
  if (first) {
    const inward = V.mul(first.wn, -1)
    normal(cv, first.q, first.wn, [Math.min(24, Hc * 0.55), 12], theme)
    const af = arcBetween(cv, first.q, Math.min(18, Hc * 0.4), inward, V.mul(first.din, -1), theme.fg)
    if (af) {
      // Also just across the wall, beside the hit, where the band is free of the ray.
      const sgn = first.wn[1]
      const across = [-1, 1, -2, 2].map((k) => (w, h) => [first.q[0] + k * (w / 2 + 6) - Math.sign(k) * (Math.abs(k) - 1) * (w / 2 - 6), first.q[1] + sgn * (h / 2 + 4)])
      const facing = [0, 24, -24, 48, -48].map((dx) => (w, h) => [first.q[0] + dx, -sgn * (yc - h / 2 - 3)])
      items.push({ label: lab('\\varphi', phi), size: fs, fill: theme.fg, cands: [...af.slice(0, 5), ...across, ...facing, ...af.slice(5, 13)] })
    }
  }
  const nl = (sub, n) => `n_{${sub}} = ${sig(n, 3)}`
  const along = (y0, y1) => [0.5, 0.25, 0.75, 0.1, 0.9].map((f) => (w, h) => [Math.max(w / 2 + 4, Math.min(Lf - w / 2 - 4, Lf * f)), (y0 + y1) / 2])
  // In the core, the zigzag leaves room against one wall wherever it touches the other.
  const coreCands = []
  for (let x = 0.5; x <= 0.95; x += 0.05) for (const f of [x, 1 - x]) for (const sg of [1, -1]) coreCands.push((w, h) => [Math.max(w / 2 + 4, Math.min(Lf - w / 2 - 4, Lf * f)), sg * (yc - h / 2 - 3)])
  items.push({ label: nl('core', nc), size: fs - 1, fill: theme.muted, cands: [...along(-yc, yc), ...coreCands] })
  items.push({ label: nl('clad', ncl), size: fs - 1, fill: theme.muted, cands: [...along(-yo, -yc), ...along(yc, yo)] })
  finish(placeLabels(items, cv), cv, theme, diag)

  const facts = [`core n ${f4(nc)}, clad n ${f4(ncl)}, outside n0 ${f4(n0)}`, `θ ${dg4(th)}`,
    `θr ${dg4(thr)} (n0 sin θ = n_core sin θr)`, `φ ${dg4(phi)} = 90° − θr`]
  const vals = { thetar: angVal(thr, 'θ_r'), phi: angVal(phi, 'φ', { alts: [{ v: thr, why: 'is θr, from the axis; φ is from the wall\'s normal' }] }), NA: { v: NA, kind: '', label: 'NA', show: f4 }, accept: angVal(accept, 'θ_max') }
  if (guided) {
    facts.push(`θc ${dg4(thc)} = sin⁻¹(n_clad/n_core)`, `NA ${f4(NA)} = √(n_core² − n_clad²)`, `acceptance θmax ${dg4(accept)}${NA >= n0 ? ' (NA ≥ n0: every angle)' : ' = sin⁻¹(NA/n0)'}`)
    vals.thetac = angVal(thc, 'θ_c')
  } else facts.push('no critical angle: the cladding isn\'t below the core, so nothing is guided (NA 0)')
  const caption = []
  if (tir) {
    facts.push(`φ > θc: TIR at every wall${first ? `, ${bounces} reflection${bounces === 1 ? '' : 's'} drawn` : ' (the ray runs along the axis)'}`)
    caption.push(`\\varphi = ${deg(phi)} > \\theta_{c} = ${deg(thc)}: TIR`)
  } else {
    facts.push(`${guided ? 'φ ≤ θc' : 'no TIR'}: the ray escapes at its first wall hit${escape !== null ? `, refracted out at ${dg4(escape)} from the wall's normal, with a partial reflection` : ''}`)
    caption.push(guided ? `\\varphi = ${deg(phi)} < \\theta_{c} = ${deg(thc)}: the ray escapes` : 'n_{clad} ≥ n_{core}: the ray escapes')
  }
  return { facts, vals, caption }
}
