// rays: thin lenses and mirrors on an optical axis, in OpenStax's conventions (University
// Physics Volume 3, 2.2 and 2.4): 1/d_o + 1/d_i = 1/f, m = −d_i/d_o = h_i/h_o, f positive for
// converging lenses and concave mirrors, d_i positive for real images. Each element images the
// one before's image (a virtual object when that image lies past it), and each stage's
// principal rays start from its own object, as drawn by hand. Real rays are solid; virtual
// extensions and construction lines are dashed. A mirror is the only element of its figure.

import { el } from '../../svg.js'
import { color } from '../../theme.js'
import { SpecError } from '../../diag.js'
import { clipSegment } from '../../geom.js'
import { V, arrow } from '../fbd/draw.js'
import { placeLabels, drawLabels, ringCands } from '../fbd/place.js'
import { length, angle, sig, LEN } from './units.js'
import { RAY, W, seg, chevron, angleArc } from './draw.js'

const UNITS = ['cm', 'mm', 'm']
const AXIS = 290 // px across the axis
const HALF = 76 // px from the axis to the tallest object, image, or ray hit
const BODY = color('blue')
const DEFAULT_RAYS = { lens: ['parallel', 'center', 'focal'], mirror: ['parallel', 'focal', 'center'], plane: ['parallel', 'vertex'] }
const RAY_NAMES = ['parallel', 'center', 'focal', 'vertex']

const typeName = (E) => E.type === 'lens' ? (E.f > 0 ? 'converging lens' : 'diverging lens') : E.plane ? 'plane mirror' : E.f > 0 ? 'concave mirror' : 'convex mirror'

function readElements(spec, env, unit, diag) {
  const list = spec.elements
  if (!Array.isArray(list) || !list.length) throw new SpecError('elements', 'elements lists the lenses and mirrors along the axis, like [{"type": "lens", "f": 10}]')
  const out = list.map((e, i) => {
    const p = `elements[${i}]`
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new SpecError(p, 'each element is an object, like {"type": "lens", "f": 10}')
    const type = e.type ?? 'lens'
    if (type !== 'lens' && type !== 'mirror') throw new SpecError(`${p}.type`, 'type is "lens" or "mirror"')
    let f
    if (type === 'lens') {
      if (e.f === undefined) throw new SpecError(`${p}.f`, 'a lens needs f: positive for a converging lens, negative for a diverging one')
      if (e.R !== undefined) diag.warn(`${p}.R`, 'R applies to mirrors; a lens takes f')
      f = length(e.f, env, `${p}.f`, unit)
    } else if (e.f !== undefined) {
      f = length(e.f, env, `${p}.f`, unit)
      if (e.R !== undefined) {
        const R = length(e.R, env, `${p}.R`, unit)
        if (Math.abs(R / 2 - f) > 1e-9 * Math.abs(f)) diag.warn(`${p}.R`, `R = ${sig(R, 4)} gives f = R/2 = ${sig(R / 2, 4)}, not ${sig(f, 4)}; give one of them`)
      }
    } else if (e.R !== undefined) f = length(e.R, env, `${p}.R`, unit) / 2
    else f = Infinity
    if (f === 0) throw new SpecError(`${p}.f`, "f can't be 0")
    if (e.at === undefined && i > 0) throw new SpecError(`${p}.at`, `give each element after the first its place on the axis, like "at": 40 (in ${unit}; the first element is at 0)`)
    const at = e.at === undefined ? 0 : length(e.at, env, `${p}.at`, unit)
    return { type, f, at, plane: !Number.isFinite(f), label: e.label, i }
  })
  for (let i = 1; i < out.length; i++) if (!(out[i].at > out[i - 1].at)) throw new SpecError(`elements[${i}].at`, 'elements go left to right: each "at" must be past the one before')
  if (out.length > 1 && out.some((e) => e.type === 'mirror')) throw new SpecError('elements', "a mirror must be the only element (lens and mirror systems, where the light passes back through the lens, aren't drawn yet)")
  return out
}

/** Each stage's object and image from the thin-lens (or mirror) equation. */
export function solve(els, obj) {
  const stages = []
  let xP = els[0].at - obj.d, yP = obj.h
  for (const [k, E] of els.entries()) {
    const mirror = E.type === 'mirror'
    const dO = E.at - xP
    if (!Number.isFinite(dO)) {
      // A distant object: parallel rays at slope s0 (down to the right for an object above the
      // axis) focus on the focal plane, at h_i = s0·f.
      const s0 = k ? stages[k - 1].sNext : -Math.tan((obj.angle * Math.PI) / 180), fin = !E.plane
      const dI = fin ? E.f : Infinity
      stages.push({ E, k, xP, yP, dO, dI, m: NaN, xQ: fin ? (mirror ? E.at - dI : E.at + dI) : NaN, yQ: s0 * E.f, fin, mirror, inf: true, s0 })
      if (!fin && k < els.length - 1) throw new SpecError('object.d', 'a plane mirror leaves a distant object at infinity')
      xP = stages[k].xQ; yP = stages[k].yQ
      continue
    }
    if (Math.abs(dO) < 1e-9) {
      throw new SpecError(k ? `elements[${k}].at` : 'object.d', k ? `the image from element ${k} falls on element ${k + 1}, so its object distance is 0; move element ${k + 1}` : 'the object sits on the element; give d > 0')
    }
    let dI
    if (E.plane) dI = -dO
    else if (Math.abs(dO - E.f) < 1e-9 * Math.abs(E.f)) dI = Infinity
    else dI = 1 / (1 / E.f - 1 / dO)
    const fin = Number.isFinite(dI)
    const m = fin ? -dI / dO : NaN
    const xQ = fin ? (mirror ? E.at - dI : E.at + dI) : NaN
    // An object at the focal point sends the rays out parallel, along the ray through the center:
    // the next element sees a distant object at that slope.
    stages.push({ E, k, xP, yP, dO, dI, m, xQ, yQ: m * yP, fin, mirror, sNext: fin ? undefined : -yP / dO })
    xP = fin ? stages[k].xQ : -Infinity; yP = stages[k].yQ
  }
  return stages
}

/**
 * A principal ray of a stage: its incoming slope s, the axis point it's aimed through (xA, or
 * null), its height yH at the element, and the outgoing slope (unfolded: a mirror acts as a lens
 * whose far side is folded back). Null when the ray isn't defined (the object on that point).
 */
export function principal(st, name) {
  const { E, xP, yP } = st
  if (st.inf) {
    // Rays from a distant object: all at slope s0. The center (or vertex) ray meets the element
    // on the axis, the focal ray crosses F first, and the "parallel" one is a third ray of the
    // bundle, mirrored about the axis from the focal ray. A mirror's C ray crosses C.
    const s = st.s0, mirror = E.type === 'mirror'
    let yH, xA = null
    if ((name === 'center' && !mirror) || (name === 'vertex' && mirror)) { yH = 0; xA = E.at }
    else if (name === 'focal' && !E.plane) { yH = s * E.f; xA = E.at - E.f }
    else if (name === 'center' && mirror && !E.plane) { yH = 2 * s * E.f; xA = E.at - 2 * E.f }
    else if (name === 'parallel') yH = E.plane ? -s : -s * E.f
    else return null
    return { name, s, xA, yH, sOut: E.plane ? s : s - yH / E.f }
  }
  const through = (xA) => (Math.abs(xA - xP) < 1e-9 * Math.max(1, Math.abs(xA)) ? null : { s: -yP / (xA - xP), xA })
  let r
  if (name === 'parallel') r = { s: 0, xA: null }
  else if (name === 'focal') r = E.plane ? null : through(E.at - E.f)
  else if (name === 'center') r = E.type === 'mirror' ? (E.plane ? null : through(E.at - 2 * E.f)) : through(E.at)
  else if (name === 'vertex') r = E.type === 'mirror' ? through(E.at) : null
  if (!r) return null
  const yH = yP + r.s * (E.at - xP)
  return { name, ...r, yH, sOut: E.plane ? r.s : r.s - yH / E.f }
}

export function raysMode(spec, ctx, cv) {
  const { theme, diag, env } = ctx
  const unit = spec.unit ?? 'cm'
  if (!UNITS.includes(unit)) throw new SpecError('unit', `unit is ${UNITS.join(', ')} (default cm)`)
  const els = readElements(spec, env, unit, diag)
  const o = spec.object
  if (!o || typeof o !== 'object' || o.d === undefined) throw new SpecError('object', `object is {"d": 30, "h": 2}: d_o from the first element and the height, in ${unit}`)
  const far = typeof o.d === 'string' && /^\s*(inf|infinity|∞)\s*$/i.test(o.d)
  let obj
  if (far) {
    if (o.h !== undefined) diag.warn('object.h', 'a distant object takes "angle" (the angle its rays make with the axis), not h')
    obj = { d: Infinity, h: NaN, angle: o.angle === undefined ? 2 : angle(o.angle, env, 'object.angle') }
    if (!(obj.angle > 0 && obj.angle < 45)) throw new SpecError('object.angle', 'angle is the tilt of the distant object\'s rays, in degrees, between 0 and 45')
  } else {
    if (o.angle !== undefined) diag.warn('object.angle', 'angle applies to a distant object ("d": "inf")')
    obj = { d: length(o.d, env, 'object.d', unit), h: o.h === undefined ? 1 : length(o.h, env, 'object.h', unit) }
    if (!(obj.d > 0)) throw new SpecError('object.d', 'd is the object distance from the first element, positive (a real object to its left), or "inf" for a distant one')
    if (!obj.h) throw new SpecError('object.h', 'h must not be 0')
  }
  const withVal = spec.values !== false
  const stages = solve(els, obj)
  const n = stages.length, last = stages[n - 1]
  const multi = n > 1
  const L = (x) => `${sig(x, 3)} ${unit}`
  const L4 = (x) => `${sig(x, 4)} ${unit}`

  // Which rays: the spec's list, or each element type's usual three (two for a plane mirror).
  let want = null
  if (spec.rays !== undefined) {
    if (!Array.isArray(spec.rays) || !spec.rays.every((r) => RAY_NAMES.includes(r))) throw new SpecError('rays', `rays lists principal rays: ${RAY_NAMES.join(', ')}`)
    want = spec.rays
  }
  const notes = []
  // A stage whose object is the real image just before it gets its own principal rays, as
  // drawn by hand. Any other (a virtual object past the lens, or a virtual image back behind the
  // lens before) takes the rays of the stage before and refracts them on through: those are the
  // real light, and principal rays from that object would start far off the figure.
  const own = (st) => st.k === 0 || (!st.inf && st.xP > els[st.k - 1].at && st.xP < st.E.at)
  const traced = []
  for (const st of stages) {
    if (own(st)) {
      const names = (want ?? DEFAULT_RAYS[st.E.plane ? 'plane' : st.E.type]).filter((r) => (st.E.type === 'mirror' ? true : r !== 'vertex'))
      traced.push(names.map((r) => principal(st, r)).filter(Boolean))
    } else {
      traced.push(traced[st.k - 1].map((r) => {
        const s = r.sOut, yH = r.yH + s * (st.E.at - els[st.k - 1].at)
        return { name: r.name, s, xA: null, yH, sOut: s - yH / st.E.f, through: true }
      }))
      notes.push(`${elName(els, st.k)}'s object is ${st.inf ? 'at infinity (the rays arrive parallel)' : st.dO < 0 ? `virtual (I${st.k} lies ${L4(-st.dO)} past it)` : `I${st.k}, a virtual image back behind ${elName(els, st.k - 1)}`}, so the rays from ${elName(els, st.k - 1)} are traced on through ${elName(els, st.k)}`)
    }
  }

  // The view: every object, element, image, and focal point (and a mirror's C), with a margin.
  const xs = [...(far ? [els[0].at - 1.3 * (Number.isFinite(els[0].f) ? Math.abs(els[0].f) : 10)] : [stages[0].xP]), ...els.map((E) => E.at)]
  for (const st of stages) {
    if (st.fin) xs.push(st.xQ)
    if (!st.E.plane) xs.push(st.E.at - st.E.f, ...(st.mirror ? [st.E.at - 2 * st.E.f] : [st.E.at + st.E.f]))
  }
  let xL = Math.min(...xs), xR = Math.max(...xs)
  const span = xR - xL
  xL -= span * 0.07; xR += span * 0.07
  // Heights: the objects and images set the scale; a ray that would hit an element far above
  // them (an object just outside F) is left out rather than squash the figure.
  const hMax = Math.max(...stages.flatMap((st) => [Math.abs(st.yP), st.fin ? Math.abs(st.yQ) : 0]).filter(Number.isFinite))
  // A mirror's ray through C swaps for the vertex ray (OpenStax's fourth) when it runs off.
  traced.forEach((rs, k) => {
    for (let i = rs.length - 1; i >= 0; i--) {
      if (Math.abs(rs[i].yH) <= 3 * hMax) continue
      const swap = stages[k].mirror && !want && !rs.some((r) => r.name === 'vertex') ? principal(stages[k], 'vertex') : null
      notes.push(`the ${rs[i].name} ray${multi ? ` of ${elName(els, k)}` : ''} is left out: it meets the ${stages[k].mirror ? 'mirror' : 'lens'} at ${L(rs[i].yH)}, far from the axis${swap ? '; the vertex ray is drawn instead' : ''}`)
      if (swap) rs[i] = swap
      else rs.splice(i, 1)
    }
    // A ray traced on from the stage before goes when that stage's ray went.
    if (k) for (let i = rs.length - 1; i >= 0; i--) if (rs[i].through && !traced[k - 1].some((r) => r.name === rs[i].name)) rs.splice(i, 1)
  })
  const yLim = Math.max(hMax, ...traced.flat().map((r) => Math.abs(r.yH))) * 1.1
  const sx = AXIS / (xR - xL), sy = HALF / yLim
  const P = (x, y) => [(x - xL) * sx, -y * sy]
  const box = [0, AXIS, -HALF * 1.35, HALF * 1.35]

  // The axis.
  cv.back.push(el('line', { x1: 0, y1: 0, x2: AXIS, y2: 0, stroke: theme.muted, 'stroke-width': 1 }))
  cv.trace([[0, 0], [AXIS, 0]], 'axis', 0.4)

  // Rays, stage by stage: a segment of the incoming line y = yP + s(x − xP), or of the outgoing
  // one, clipped to the view.
  const draw = (fn, xa, xb, stroke, dashed, arrowAt) => {
    if (!(Math.abs(xb - xa) > 1e-12)) return
    const c = clipSegment(P(xa, fn(xa)), P(xb, fn(xb)), box)
    if (!c) return
    seg(cv, c[0], c[1], stroke, { width: dashed ? W.virtual : W.ray, dashed, opacity: dashed ? 0.9 : undefined })
    if (!dashed && arrowAt) chevron(cv, c[0], c[1], stroke, { size: 6 })
  }
  for (const st of stages) {
    const { E, k, xP, yP } = st
    const prevX = k ? els[k - 1].at : -Infinity, nextX = k < n - 1 ? els[k + 1].at : Infinity
    const final = k === n - 1
    for (const r of traced[k]) {
      const stroke = RAY[r.name]
      const yIn = (x) => r.yH + r.s * (x - E.at)
      const yOut = st.mirror ? (x) => r.yH + r.sOut * (E.at - x) : (x) => r.yH + r.sOut * (x - E.at)
      // Incoming: real light only between the element before and this one. Rays traced on from
      // the stage before are already drawn up to here.
      if (r.through) { /* drawn by the stage before */ } else if (xP < E.at) {
        const start = Math.max(xP, prevX, xL)
        draw(yIn, start, E.at, stroke, false, true)
        if (xP < prevX) draw(yIn, xP, prevX, stroke, true)
        if (r.xA !== null && r.xA < start) draw(yIn, r.xA, start, stroke, true)
      } else draw(yIn, E.at - 0.5 * (E.at - prevX), E.at, stroke, false, true) // a virtual object
      // Construction: a ray aimed at a point past the element (F of a diverging lens, a convex
      // mirror's F or C) continues there dashed.
      if (r.xA !== null && r.xA > E.at + 1e-9 && xP < E.at && !r.through) draw(yIn, E.at, r.xA, stroke, true)
      // Outgoing.
      if (st.mirror) {
        draw(yOut, E.at, xL, stroke, false, true)
        const back = Math.max(st.fin && st.xQ > E.at ? st.xQ : E.at, r.name === 'parallel' && E.f < 0 ? E.at - E.f : E.at)
        if (back > E.at) draw(yOut, E.at, back, stroke, true)
        continue
      }
      // Lenses: the parallel ray of a diverging lens leaves as if from its F, so it gets that
      // dashed back extension as well as the one to a virtual image.
      const backTo = Math.min(st.fin && st.xQ < E.at ? st.xQ : E.at, r.name === 'parallel' && !r.through && E.f < 0 ? E.at + E.f : E.at)
      if (backTo < E.at) draw(yOut, backTo, E.at, stroke, true)
      const onward = !final && !own(stages[k + 1])
      if (final) draw(yOut, E.at, xR, stroke, false, true)
      else if (onward) { draw(yOut, E.at, nextX, stroke, false, true); if (st.fin && st.xQ > nextX) draw(yOut, nextX, st.xQ, stroke, true) }
      else if (st.fin && st.xQ > E.at && st.xQ < nextX) draw(yOut, E.at, st.xQ + Math.min(0.25 * (nextX - st.xQ), 0.04 * span), stroke, false, true)
      else if (st.fin && st.xQ >= nextX) { draw(yOut, E.at, nextX, stroke, false, true); draw(yOut, nextX, st.xQ, stroke, true) }
      else draw(yOut, E.at, E.at + 0.35 * (nextX - E.at), stroke, false, true)
    }
  }

  const labels = []
  const small = theme.size - 1
  // Elements: lens outlines (or mirror arcs with hatching on the back), tall enough for every ray.
  for (const st of stages) {
    const { E } = st
    const x = P(E.at, 0)[0]
    const H = Math.max(HALF * 0.72, ...traced[st.k].map((r) => Math.abs(r.yH) * sy + 8))
    drawElement(cv, E, x, H, theme)
    const name = E.label ?? `L_{${st.k + 1}}`
    const fText = E.plane ? null : `${multi ? `f_{${st.k + 1}}` : 'f'} = ${L(E.f)}`
    const text = E.label ?? (multi ? (withVal && fText ? `${name}: ${fText}` : name) : withVal ? fText : null)
    if (text) labels.push({ label: text, size: small, fill: theme.muted, cands: [[x, -H - 10], [x, H + 10], [x + 30, -H - 10], [x - 30, -H - 10]] })
  }
  // Focal points (and a mirror's center of curvature): dots on the axis, named below it.
  const marks = []
  for (const st of stages) {
    const { E } = st
    if (E.plane) continue
    const sub = multi ? `_{${st.k + 1}}` : ''
    const pts = st.mirror ? [[E.at - E.f, `F${sub}`], [E.at - 2 * E.f, `C${sub}`]] : [[E.at - E.f, `F${sub}`], [E.at + E.f, `F${sub}`]]
    for (const [xa, name] of pts) marks.push({ at: P(xa, 0), name })
  }
  for (const m of marks) {
    cv.front.push(el('circle', { cx: +m.at[0].toFixed(2), cy: 0, r: 2.6, fill: theme.fg }))
    cv.trace([m.at], 'mark', 1)
  }
  for (const m of marks) labels.push({ label: m.name, size: small, fill: theme.fg, cands: [...ringCands(m.at, 5, [0, 1]), ...ringCands(m.at, 15, [0, 1])] })

  // The object and each image: arrows from the axis, solid when real and dashed when virtual.
  const tipCands = (tip, up) => ringCands(tip, 4, up ? [0, -1] : [0, 1])
  if (far) {
    // A distant object: its rays' angle θ where the first of them crosses the axis.
    const r = traced[0].find((q) => q.xA !== null && q.xA <= els[0].at + 1e-9)
    if (r) {
      const c = P(r.xA, 0), toward = (Math.atan2(-stages[0].s0 * sy, -sx) * 180) / Math.PI
      // The wedge is narrow, so spots above the ray's end come after the arc's own.
      const cands = [...angleArc(cv, c, 24, 180, toward, theme.fg), ...[toward - 22, toward - 40, 200].map((a) => (w, h) => {
        const u = [Math.cos((a * Math.PI) / 180), -Math.sin((a * Math.PI) / 180)]
        return [c[0] + u[0] * (30 + w / 2), c[1] + u[1] * (30 + h / 2)]
      })]
      labels.push({ label: withVal ? `\\theta = ${sig(obj.angle, 3)}°` : '\\theta', size: small, fill: theme.fg, cands })
    }
  } else {
    const o0 = P(stages[0].xP, stages[0].yP)
    arrow(cv, [o0[0], 0], o0, theme.fg, { width: 2.2, head: 9, tag: 'object' })
    labels.push({ label: 'O', size: theme.size, fill: theme.fg, cands: [...tipCands(o0, obj.h > 0)] })
  }
  for (const st of stages) {
    if (!st.fin) continue
    const tip = P(st.xQ, st.yQ), real = st.dI > 0
    const final = st.k === n - 1
    const stroke = final ? theme.fg : theme.muted
    arrow(cv, [tip[0], 0], tip, stroke, { width: final ? 2.2 : 1.8, head: 9, dashed: !real, tag: 'image' })
    labels.push({ label: multi ? `I_{${st.k + 1}}` : 'I', size: theme.size, fill: stroke, cands: tipCands(tip, st.yQ > 0) })
  }
  const placed = placeLabels(labels, cv)
  drawLabels(placed, cv, theme)
  const crowded = placed.filter((q) => q.hard > 0).map((q) => q.label)
  if (crowded.length) diag.note('', `crowded: ${crowded.join(', ')} sit on backing boxes`)

  // Facts.
  // Upright or inverted against the original object (above the axis, or a distant one whose
  // rays come down from above).
  const up = (st) => (far ? st.yQ > 0 : st.yQ * obj.h > 0)
  const nature = (st) => `${st.dI > 0 ? 'real' : 'virtual'}, ${(st.inf ? up(st) : st.m > 0) ? 'upright' : 'inverted'}`
  const anyInf = stages.some((st) => st.inf)
  const facts = [`unit ${unit}; ${els.map((E, i) => `${multi ? `${elName(els, i)} ` : ''}${typeName(E)}${E.plane ? '' : ` f ${L4(E.f)}`}${multi ? ` at ${L4(E.at)}` : ''}`).join(', ')}; ${far ? `a distant object, its rays at ${sig(obj.angle, 4)}° to the axis` : `object d_o ${L4(obj.d)}, h_o ${L4(obj.h)}`}`]
  const vals = {}
  const put = (key, v, label, extra = {}) => { vals[key] = { v, kind: extra.kind ?? '', base: unit, label, show: (x) => (extra.kind === 'len' ? L4(x) : sig(x, 4)), ...extra } }
  for (const st of stages) {
    const i = st.k + 1, tag = multi ? `I${i}` : 'image'
    const where = multi ? ` from ${elName(els, st.k)}` : ''
    if (!st.fin) { facts.push(`${tag}: d_o ${L4(st.dO)}${where}, at the focal point: d_i = ∞, the rays leave parallel`); continue }
    if (st.inf) facts.push(`${tag}: d_o ∞, d_i ${L4(st.dI)} (= f, the focal plane)${where}, h_i = f tan θ = ${L4(st.yQ)}, ${nature(st)}`)
    else facts.push(`${tag}: d_o ${L4(st.dO)}${st.dO < 0 ? ' (a virtual object, past the lens)' : ''}${where}, d_i ${L4(st.dI)}, m ${sig(st.m, 4)}, h_i ${L4(st.yQ)}, ${nature(st)}`)
    if (multi) {
      put(`di${i}`, st.dI, `d_{i${i}}`, { kind: 'len', sign: 'has the wrong sign: d_i is positive for a real image and negative for a virtual one' })
      if (!st.inf) put(`m${i}`, st.m, `m_{${i}}`, { sign: 'has the wrong sign: m < 0 is an inverted image' })
      if (i > 1) put(`do${i}`, st.dO, `d_{o${i}}`, { kind: 'len', sign: 'has the wrong sign: d_o is negative for a virtual object (the image before lies past this lens)' })
    }
  }
  const caption = []
  // One caption line per image of a system: its d_o (after the first), d_i, and m.
  const stageCaps = () => stages.map((st) => `I_{${st.k + 1}}: ${st.k && !st.inf ? `d_{o} = ${L(st.dO)}, ` : ''}${st.fin ? `d_{i} = ${L(st.dI)}` : '\\text{at infinity}'}${st.fin && !st.inf ? `, m = ${sig(st.m, 3)}` : ''}`)
  const diVal = (label) => put('di', last.dI, label, {
    kind: 'len', sign: 'has the wrong sign: d_i is positive for a real image and negative for a virtual one',
    alts: multi ? [{ v: last.xQ - els[0].at, why: `is measured from ${elName(els, 0)}; d_i is from the last element` }] : [],
  })
  if (last.fin && anyInf) {
    // No lateral magnification for a distant object: the image height is what's checkable.
    const words = [last.dI > 0 ? 'real' : 'virtual', up(last) ? 'upright' : 'inverted']
    if (multi) facts.push(`final image: d_i ${L4(last.dI)} from ${elName(els, n - 1)}, h_i ${L4(last.yQ)}, ${words.join(', ')}`)
    diVal(multi ? `d_{i${n}}` : 'd_i')
    put('hi', last.yQ, 'h_i', { kind: 'len', sign: 'has the wrong sign: h_i < 0 is an inverted image' })
    vals.image = { words, label: 'image' }
    if (withVal) {
      if (multi) caption.push(...stageCaps())
      caption.push(`${multi ? '' : `d_{i} = f = ${L(last.dI)}, h_{i} = ${L(last.yQ)}: `}${words.join(', ')}`)
    }
  } else if (last.fin) {
    const M = stages.reduce((p, st) => p * st.m, 1)
    const hi = M * obj.h
    const size = Math.abs(Math.abs(M) - 1) < 1e-9 ? 'same size' : Math.abs(M) > 1 ? 'enlarged' : 'reduced'
    const words = [last.dI > 0 ? 'real' : 'virtual', M > 0 ? 'upright' : 'inverted', size]
    if (multi) facts.push(`final image: d_i ${L4(last.dI)} from ${elName(els, n - 1)} (${L4(last.xQ - els[0].at)} past ${elName(els, 0)}), M = ${stages.map((st) => `m${st.k + 1}`).join('·')} = ${sig(M, 4)}, h_i ${L4(hi)}, ${words.join(', ')}`)
    else facts[facts.length - 1] += `, ${words[2]}`
    diVal(multi ? `d_{i${n}}` : 'd_i')
    put('m', M, multi ? 'M' : 'm', { sign: 'has the wrong sign: m < 0 is an inverted image', alts: multi ? [{ v: last.m, why: `is m_${n} alone; the total is the product M = ${stages.map((st) => `m${st.k + 1}`).join('·')}` }] : [] })
    put('hi', hi, 'h_i', { kind: 'len', sign: 'has the wrong sign: h_i < 0 is an inverted image' })
    vals.image = { words, label: 'image' }
    if (withVal) {
      if (multi) caption.push(...stageCaps())
      caption.push(`${multi ? `M = ${sig(M, 3)}` : `d_{i} = ${L(last.dI)}, m = ${sig(M, 3)}`}: ${words.slice(0, 2).join(', ')}`)
    }
  } else {
    // The image at infinity: the eye sees the rays' angle θ′. A telescope's angular magnification
    // is θ′/θ (OpenStax 2.8: −f_obj/f_eye); a magnifier's, against the object at a 25 cm near
    // point, is 25 cm/f (OpenStax 2.7).
    const sOut = traced[n - 1][0]?.sOut
    let Mang = null, how = ''
    if (far && sOut !== undefined && !last.mirror) { Mang = sOut / stages[0].s0; how = 'θ′/θ' }
    else if (!multi && !last.mirror && last.E.f > 0) { Mang = 25 / ((last.E.f * LEN[unit]) / LEN.cm); how = '25 cm/f (near point 25 cm)' }
    facts.push(`final image at infinity, the rays leave parallel${Mang !== null ? `; angular magnification M = ${how} = ${sig(Mang, 4)}` : ''}`)
    if (Mang !== null) put('angular', Mang, 'M', { sign: 'has the wrong sign: M < 0 is an inverted view' })
    if (withVal && multi) caption.push(...stageCaps().slice(0, -1))
    if (withVal) caption.push(`\\text{image at infinity}${Mang !== null ? `: M = ${far ? "\\theta'/\\theta" : '25 cm/f'} = ${sig(Mang, 3)}` : ': the rays leave parallel'}`)
  }
  facts.push(`rays: ${[...new Set(traced.flat().map((r) => r.name))].join(', ')}`)
  facts.push(...notes)
  return { facts, vals, caption }
}

const elName = (els, k) => (els[k].label ? els[k].label : els.length > 1 ? `L${k + 1}` : els[k].type)

/** A thin lens outline (biconvex or biconcave) or a mirror arc with hatching behind it. */
function drawElement(cv, E, x, H, theme) {
  const f2 = (v) => +v.toFixed(2)
  if (E.type === 'lens') {
    const b = 5
    const d = E.f > 0
      ? `M${f2(x)} ${f2(-H)}Q${f2(x + 2 * b)} 0 ${f2(x)} ${f2(H)}Q${f2(x - 2 * b)} 0 ${f2(x)} ${f2(-H)}Z`
      : `M${f2(x - b)} ${f2(-H)}L${f2(x + b)} ${f2(-H)}Q${f2(x + 3 - b)} 0 ${f2(x + b)} ${f2(H)}L${f2(x - b)} ${f2(H)}Q${f2(x - 3 + b)} 0 ${f2(x - b)} ${f2(-H)}Z`
    cv.back.push(el('path', { d, fill: BODY, 'fill-opacity': 0.2, stroke: BODY, 'stroke-width': 1.3 }))
    cv.ext.push([x - b, -H], [x + b, H])
    cv.trace([[x, -H], [x, -H * 0.85]], 'element', 0.5)
    cv.trace([[x, H], [x, H * 0.85]], 'element', 0.5)
    return
  }
  // The mirror's face as a quadratic curve through the vertex, its edges toward the object for
  // a concave mirror and away for a convex one; hatching on the back.
  const sag = E.plane ? 0 : E.f > 0 ? -6 : 6
  const at = (t) => [x + sag * t * t, t * H] // t from −1 to 1
  const pts = Array.from({ length: 25 }, (_, i) => at(-1 + i / 12))
  cv.mid.push(el('path', { d: `M${pts.map((p) => `${f2(p[0])} ${f2(p[1])}`).join('L')}`, fill: 'none', stroke: BODY, 'stroke-width': 2.2 }))
  const hatch = []
  for (let y = -H + 4; y <= H; y += 7) {
    const p = at(y / H)
    hatch.push(`M${f2(p[0] + 1)} ${f2(p[1])}L${f2(p[0] + 7)} ${f2(p[1] - 6)}`)
  }
  cv.mid.push(el('path', { d: hatch.join(''), stroke: theme.muted, 'stroke-width': 1 }))
  cv.ext.push([x - 7, -H - 6], [x + 14, H])
  cv.trace([at(-1), at(-0.85)], 'element', 0.5)
  cv.trace([at(1), at(0.85)], 'element', 0.5)
}
