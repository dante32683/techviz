// linalg: linear algebra pictures with exact arithmetic (rationals stay fractions). Modes:
// transform (the grid, the unit square or an F, and e₁, e₂ before and after a 2×2 map, det as
// the signed area, compositions one map per step, named rotations, reflections, shears, scalings,
// and projections); vectors (head-to-tail sums, multiples, a combination that reaches a target,
// spans, projections with the orthogonal part, dot products and angles, in ℝ² or isometric ℝ³);
// eigen (eigenvector lines that stay put while other vectors turn, each stretch by λ, complex
// pairs as a rotation-scaling); rref (an augmented matrix reduced one labeled row operation per
// step, pivots boxed, to RREF, free variables, and the solution set in parametric vector form);
// and lsq (a least-squares line or parabola from the normal equations with residuals, or x̂ for
// Ax = b). The summary has det, the inverse, eigenpairs, rank, nullity, bases for Col A and
// Nul A, and the RREF; `expect` names any wrong value.

import { el, pathD } from '../../svg.js'
import { labelSvg, measure } from '../../label.js'
import { color } from '../../theme.js'
import { SpecError, Diag } from '../../diag.js'
import { ticks as niceTicks, fmt as tickFmt } from '../../geom.js'
import { Canvas, V, arrow } from '../fbd/draw.js'
import { placeLabels, arrowCands, ringCands } from '../fbd/place.js'
import * as N from './num.js'
import * as M from './matrix.js'
import { readMatrix, readVector, readMap, readVectors, parseOp } from './read.js'
import { fitWindow, plane, iso, clipLine, drawPlane, drawIso, drawTicks, rightAngle, matrixBlock, flow, readItem } from './draw.js'
import { analyze, factText, modText } from './facts.js'
import { checkExpect } from './expect.js'

const { fmt, toF, vecText, matText, coef } = N
const MARGIN = 14
const FIELDS = ['mode', 'A', 'b', 'compose', 'shape', 'grid', 'vectors', 'sum', 'combo', 'span', 'project', 'angle', 'data', 'degree', 'ops', 'all', 'expect', 'range', 'highlight']
const MODES = ['transform', 'vectors', 'eigen', 'rref', 'lsq']
const T = (s) => `\\text{${s}}`
const NAMES = 'ABCDEFGH'

const paramDefaults = (spec) => Object.fromEntries(Object.entries(spec.params ?? {}).map(([k, p]) => [k, typeof p === 'number' ? p : p?.value]))

function modeOf(spec) {
  if (spec.mode !== undefined) {
    if (!MODES.includes(spec.mode)) throw new SpecError('mode', `mode is one of ${MODES.join(', ')}`)
    return spec.mode
  }
  if (spec.data) return 'lsq'
  if (spec.compose) return 'transform'
  if (spec.vectors && spec.A === undefined) return 'vectors'
  if (spec.b !== undefined || spec.ops) return 'rref'
  if (Array.isArray(spec.A) && (spec.A.length !== 2 || spec.A[0]?.length !== 2)) return 'rref'
  return 'transform'
}

// ---- transform ----------------------------------------------------------------------------

function readStages(spec, env) {
  const list = spec.compose ?? (spec.A !== undefined ? [spec.A] : null)
  if (!Array.isArray(list) || !list.length) throw new SpecError(spec.compose ? 'compose' : 'A', 'give "A": [[1, 1], [0, 1]] or a named map like {"rotate": 90}; "compose": [map, map, ...] applies several in order')
  return list.map((m, k) => {
    const path = spec.compose ? `compose[${k}]` : 'A'
    const r = readMap(m, env, path, spec.compose ? NAMES[k] : 'A')
    if (r.M.length !== 2 || r.M[0].length !== 2) throw new SpecError(path, 'transform mode draws 2×2 maps; "mode": "rref" reduces any matrix')
    return r
  })
}
const prodName = (maps, k) => maps.slice(0, k).map((m) => m.name).reverse().join('')

const SQUARE = [[0, 0], [1, 0], [1, 1], [0, 1]]
const F_SHAPE = [[0.2, 0.2], [0.5, 0.2], [0.5, 0.9], [1.1, 0.9], [1.1, 1.2], [0.5, 1.2], [0.5, 1.5], [1.4, 1.5], [1.4, 1.8], [0.2, 1.8]]
function readShape(v, env) {
  if (v === undefined || v === 'square') return { poly: SQUARE, square: true }
  if (v === 'F') return { poly: F_SHAPE }
  if (v === 'none') return null
  if (Array.isArray(v) && v.length >= 3) return { poly: v.map((p, k) => readVector(p, env, `shape[${k}]`, 2).map(toF)) }
  throw new SpecError('shape', 'shape is "square" (default), "F", "none", or a polygon [[x, y], ...]')
}
const apply = (Mx, p) => [toF(Mx[0][0]) * p[0] + toF(Mx[0][1]) * p[1], toF(Mx[1][0]) * p[0] + toF(Mx[1][1]) * p[1]]

// The image of the grid: x = k goes to k·c₁ + t·c₂, y = k to t·c₁ + k·c₂ (a singular map
// collapses it onto the line its columns span).
function imageGrid(cv, pl, Tm, stroke) {
  const c1 = apply(Tm, [1, 0]), c2 = apply(Tm, [0, 1]), D = c1[0] * c2[1] - c1[1] * c2[0]
  const lines = []
  if (Math.abs(D) > 1e-9) {
    const inv = (p) => [(c2[1] * p[0] - c2[0] * p[1]) / D, (-c1[1] * p[0] + c1[0] * p[1]) / D]
    const cs = [[pl.x0, pl.y0], [pl.x1, pl.y0], [pl.x1, pl.y1], [pl.x0, pl.y1]].map(inv)
    for (const [axis, dir, other] of [[0, c2, c1], [1, c1, c2]]) {
      const lo = Math.min(...cs.map((p) => p[axis])), hi = Math.max(...cs.map((p) => p[axis]))
      const st = pl.step * Math.max(1, Math.ceil((hi - lo) / pl.step / 60))
      for (let k = Math.ceil(lo / st) * st; k <= hi; k += st) lines.push({ p: [k * other[0], k * other[1]], d: dir, axis: Math.abs(k) < 1e-9 })
    }
  } else {
    const d = Math.hypot(...c1) > 1e-9 ? c1 : Math.hypot(...c2) > 1e-9 ? c2 : null
    if (d) lines.push({ p: [0, 0], d, wide: true })
  }
  for (const L of lines) {
    const seg = clipLine(pl, L.p, L.d)
    if (!seg) continue
    const [a, b] = seg.map(pl.P)
    cv.back.push(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke, 'stroke-width': L.wide ? 4 : L.axis ? 1.6 : 1, 'stroke-opacity': L.wide ? 0.45 : L.axis ? 0.8 : 0.42 }))
  }
}

function transformMode(spec, { theme, env }, out) {
  const maps = readStages(spec, env)
  const cum = [M.identity(2)]
  for (const m of maps) cum.push(M.matMul(m.M, cum[cum.length - 1]))
  const stage = Number.isInteger(spec.__stage) ? Math.max(0, Math.min(spec.__stage, maps.length)) : maps.length
  const Tm = cum[stage], name = prodName(maps, stage)
  const shape = readShape(spec.shape, env)
  const extra = spec.vectors ? readVectors(spec.vectors, env) : null
  if (extra && extra.dim !== 2) throw new SpecError('vectors', 'transform mode draws vectors in ℝ²')
  // One window for every stage, so stepping doesn't rescale the picture.
  const pts = []
  for (const C of cum) {
    pts.push(apply(C, [1, 0]), apply(C, [0, 1]))
    for (const p of shape?.poly ?? []) pts.push(apply(C, p))
    for (const o of extra?.list ?? []) pts.push(apply(C, o.v.map(toF)))
  }
  const pl = plane(fitWindow(pts, { range: spec.range }))
  const { cv, lab } = out, P = pl.P, O = P([0, 0])
  out.ticks = drawPlane(cv, pl, theme, { grid: spec.grid !== false })
  const d = M.det(Tm), dF = toF(d), sg = N.sign(d)
  const E1 = color('coral'), E2 = color('blue'), GRID = color('purple')
  const FILL = sg > 0 ? color('teal') : sg < 0 ? color('pink') : theme.muted
  if (stage > 0 && spec.grid !== false) imageGrid(cv, pl, Tm, GRID)
  // A singular map sends a whole line to 0: draw Nul A.
  const kernel = stage > 0 && sg === 0 ? M.spaces(Tm).nul : []
  if (kernel.length === 1) {
    const seg = clipLine(pl, [0, 0], kernel[0].map(toF))
    if (seg) {
      const [a, b] = seg.map(P)
      cv.back.push(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: theme.muted, 'stroke-width': 1.3, 'stroke-dasharray': '6 4' }))
      cv.trace([a, b], 'nul', 0.4)
      const n = V.unit(V.perp(V.sub(b, a)))
      lab(`${T('Nul')} ${name || 'A'}`, theme.muted, [b, a].flatMap((end) => [0.08, 0.2].flatMap((t) => { const p = V.add(end, V.mul(V.sub(O, end), t)); return [V.add(p, V.mul(n, 11)), V.sub(p, V.mul(n, 11))] })), { size: 10.5 })
    }
  }

  if (shape) {
    const poly = (C) => shape.poly.map((p) => P(apply(C, p)))
    const ghost = (C, stroke) => { const g = poly(C); cv.mid.push(el('path', { d: pathD(g, true), fill: 'none', stroke, 'stroke-width': 1.2, 'stroke-dasharray': '4 3' })); cv.trace(g, 'ghost', 0.6, true) }
    if (stage > 0) ghost(cum[0], theme.faint)
    if (stage > 1) ghost(cum[stage - 1], theme.muted)
    const cur = poly(Tm)
    cv.mid.push(el('path', { d: pathD(cur, true), fill: FILL, 'fill-opacity': 0.22, stroke: FILL, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }))
    cv.trace(cur, 'shape', 1, true)
    if (Math.abs(dF) > 1e-9) cv.fill(cur, 'inside', 0.3)
  }
  // Orientation: a quarter-turn arc from e₁ toward e₂, mapped; it runs clockwise when det < 0.
  if (Math.abs(dF) > 1e-9 && (!shape || shape.square)) {
    const arc = Array.from({ length: 21 }, (_, k) => { const t = ((12 + (66 * k) / 20) * Math.PI) / 180; return P(apply(Tm, [0.36 * Math.cos(t), 0.36 * Math.sin(t)])) })
    cv.mid.push(el('path', { d: pathD(arc), fill: 'none', stroke: theme.muted, 'stroke-width': 1.2 }))
    const tip = arc[20], dd = V.unit(V.sub(tip, arc[17])), nn = V.perp(dd)
    cv.mid.push(el('path', { d: pathD([tip, V.add(V.sub(tip, V.mul(dd, 6)), V.mul(nn, 3)), V.sub(V.sub(tip, V.mul(dd, 6)), V.mul(nn, 3))], true), fill: theme.muted }))
    cv.trace(arc, 'arc', 0.5)
  }
  // e₁ and e₂ (dashed where they were) and their images, the columns of the matrix.
  ;[[1, 0], [0, 1]].forEach((e, k) => {
    // A product's letters stay apart (SR e₁), or they'd read as one upright word.
    const c = apply(Tm, e), col = k ? E2 : E1, nm = `${name}${name.length > 1 ? '\\,' : ''}e_{${k + 1}}`, same = Math.hypot(c[0] - e[0], c[1] - e[1]) < 1e-9
    if (stage > 0 && !same) {
      arrow(cv, O, P(e), theme.faint, { width: 1.3, dashed: true, head: 7, tag: `g${k}`, layer: 'mid' })
      lab(`e_{${k + 1}}`, theme.muted, arrowCands(O, P(e)), { size: 10.5 })
    }
    if (Math.hypot(...c) < 1e-9) {
      cv.front.push(el('circle', { cx: O[0], cy: O[1], r: 3.5, fill: col }))
      lab(`${nm} = 0`, col, ringCands(O, 5, k ? [-1, -1] : [1, 1]), { size: 11 })
    } else {
      arrow(cv, O, P(c), col, { width: 2.4, head: 10, tag: `e${k}` })
      lab(stage > 0 && same ? `${nm} = e_{${k + 1}}` : nm, col, arrowCands(O, P(c)))
    }
  })
  for (const o of extra?.list ?? []) {
    const x = o.v.map(toF), y = apply(Tm, x), col = color(o.color ?? o.i + 2)
    if (stage > 0) arrow(cv, O, P(x), theme.faint, { width: 1.3, dashed: true, head: 7, tag: `x${o.i}`, layer: 'mid' })
    arrow(cv, O, P(y), col, { width: 2, head: 9, tag: `v${o.i}` })
    lab(stage > 0 ? `${name}${o.label}` : o.label, col, arrowCands(O, P(y)), { size: 11.5 })
  }
  if (shape?.square && Math.abs(dF) > 1e-9) {
    const t = `\\det = ${fmt(d)}`, w = measure(t, 10.5)
    if (Math.abs(dF) * pl.u * pl.u > (w + 12) * 26) lab(t, theme.fg, [P(apply(Tm, [0.5, 0.5]))], { size: 10.5, ignore: ['inside', 'shape'], fixed: true })
  }

  // Readouts: each map with its columns colored like the arrows, and the product so far.
  const block = (Mx, fills) => matrixBlock(Mx.map((r) => r.map(fmt)), theme, { size: 11, colFill: fills })
  const howArea = sg === 0 ? T('collapses the plane') : sg < 0 ? T('flips orientation') : N.isOne(N.abs(d)) ? T('keeps areas') : T(`scales areas by ${fmt(N.abs(d))}`)
  if (maps.length === 1) {
    const m = maps[0]
    out.rows.push([`${m.name} = `, block(m.M, stage ? [E1, E2] : undefined), `\\det ${m.name} = ${fmt(M.det(m.M))}`])
    out.rows.push(stage ? [...(m.desc ? [[T(`${m.desc}:`), theme.muted]] : []), [howArea, theme.muted]] : [[T('before the map'), theme.muted]])
  } else {
    maps.forEach((m, k) => out.rows.push([[`${m.name} = `, k < stage ? theme.fg : theme.muted], block(m.M, k < stage ? undefined : [theme.muted, theme.muted]), [T(m.desc || ' '), theme.muted]]))
    if (stage > 1) out.rows.push([`${name} = `, block(Tm, [E1, E2]), `\\det = ${fmt(d)}`, [howArea, theme.muted]])
    else if (stage === 1) out.rows.push([[`\\det ${name} = ${fmt(d)}`, theme.fg], [howArea, theme.muted]])
  }

  const full = cum[maps.length], fullName = prodName(maps, maps.length)
  out.facts.push(maps.map((m) => `${m.name} = ${matText(m.M)}${m.desc ? ` (${m.desc})` : ''}`).join('; '))
  if (maps.length > 1) out.facts.push(`applied in order ${maps.map((m) => m.name).join(', then ')}, so the whole map is ${fullName} = ${matText(full)}`)
  if (stage < maps.length) out.facts.push(`showing step ${stage} of ${maps.length}: ${name || 'I'} = ${matText(Tm)}`)
  const fd = M.det(full)
  out.facts.push(`${fullName}e1 = ${vecText(M.col(full, 0))}, ${fullName}e2 = ${vecText(M.col(full, 1))}`, `areas × |det| = ${fmt(N.abs(fd))}, orientation ${N.sign(fd) > 0 ? 'kept' : N.sign(fd) < 0 ? 'flipped' : 'lost (the plane collapses)'}`)
  const F = analyze(full)
  out.facts.push(...factText(F, fullName).slice(1))
  return { F, name: fullName, T: full, Tname: fullName }
}

// ---- vectors ------------------------------------------------------------------------------

function vectorsMode(spec, { theme, env }, out) {
  const { list, byId, dim } = readVectors(spec.vectors, env)
  const get = (id, path) => { const o = byId.get(id); if (!o) throw new SpecError(path, `no vector "${id}" (${[...byId.keys()].join(', ')})`); return o }
  const label = (o) => o.label
  // Combinations: given weights, a target to reach (solved exactly), or a plain sum.
  const combos = []
  const readCombo = (c, path) => {
    if (!c || !Array.isArray(c.of) || !c.of.length) throw new SpecError(path, 'a combo is {"of": ["u", "v"], "c": [2, -1]} or {"of": ["u", "v"], "target": "b"}')
    const of = c.of.map((id, k) => get(id, `${path}.of[${k}]`))
    let w, target = null, consistent = true, unique = true, tlabel
    if (c.target !== undefined) {
      const t = typeof c.target === 'string' ? get(c.target, `${path}.target`) : null
      target = t ? t.v : readVector(c.target, env, `${path}.target`, dim)
      tlabel = t ? t.label : 'b'
      const { R, pivots } = M.reduce(of[0].v.map((_, i) => [...of.map((o) => o.v[i]), target[i]]))
      const s = M.solution(R, of.length, pivots)
      consistent = s.consistent; unique = !s.free.length; w = s.p
    } else w = c.c ? readVector(c.c, env, `${path}.c`, of.length) : of.map(() => N.ONE)
    const result = of.reduce((s, o, k) => M.vadd(s, M.vscale(w[k], o.v)), M.zeros(dim))
    const text = of.map((o, k) => coef(w[k], label(o), k === 0)).join('')
    combos.push({ of, c: w, target, consistent, unique, result, text, label: c.label ?? tlabel ?? text, given: !target })
  }
  if (spec.sum) readCombo({ of: spec.sum }, 'sum')
  for (const [k, c] of [].concat(spec.combo ?? []).entries()) readCombo(c, Array.isArray(spec.combo) ? `combo[${k}]` : 'combo')
  // Projection of y onto u, or onto W = Span{u₁, u₂} (by the normal equations).
  let proj = null
  if (spec.project) {
    const p = spec.project
    if (!p || typeof p.of !== 'string' || p.onto === undefined) throw new SpecError('project', 'project is {"of": "y", "onto": "u"} or {"of": "y", "onto": ["u1", "u2"]}')
    const y = get(p.of, 'project.of'), U = [].concat(p.onto).map((id, k) => get(id, `project.onto${Array.isArray(p.onto) ? `[${k}]` : ''}`))
    if (U.some((o) => M.isZeroVec(o.v))) throw new SpecError('project.onto', 'project onto a nonzero vector')
    if (M.isZeroVec(y.v)) throw new SpecError('project.of', `${y.id} is the zero vector, whose projection is 0; project a nonzero vector`)
    let yhat
    if (U.length === 1) yhat = M.vscale(N.div(M.dot(y.v, U[0].v), M.dot(U[0].v, U[0].v)), U[0].v)
    else yhat = M.leastSquares(M.transpose(U.map((o) => o.v)), y.v).bhat
    proj = { y, U, yhat, z: M.vsub(y.v, yhat), orthogonal: U.every((a, i) => U.every((b, j) => i >= j || N.isZero(M.dot(a.v, b.v)))) }
    if (U.length === 1) Object.assign(proj, angleOf(y, U[0]))
  }
  const ang = spec.angle ? (() => {
    if (!Array.isArray(spec.angle) || spec.angle.length !== 2) throw new SpecError('angle', 'angle is two vector ids, like ["u", "v"]')
    const [a, b] = spec.angle.map((id, k) => get(id, `angle[${k}]`))
    const z = [a, b].findIndex((o) => M.isZeroVec(o.v))
    if (z >= 0) throw new SpecError(`angle[${z}]`, `${[a, b][z].id} is the zero vector, which makes no angle; pick two nonzero vectors`)
    return angleOf(a, b)
  })() : null
  let span = null
  if (spec.span) {
    const S = [].concat(spec.span).map((id, k) => get(id, `span[${k}]`))
    span = { S, rank: M.spaces(M.transpose(S.map((o) => o.v))).rank }
  }

  // The view: ℝ² at 1:1, or ℝ³ isometric.
  const f = (v) => v.map(toF)
  const allPts = [...list.map((o) => f(o.v)), ...combos.flatMap((c) => { let cur = M.zeros(dim); return c.of.map((o, k) => (cur = M.vadd(cur, M.vscale(c.c[k], o.v))).map(toF)) }), ...combos.filter((c) => c.target).map((c) => f(c.target))]
  if (proj) allPts.push(f(proj.yhat))
  let pl
  if (dim === 2) pl = plane(fitWindow(allPts, { range: spec.range }))
  else {
    const L = Math.min(8, Math.max(2, Math.ceil(Math.max(...allPts.flat().map(Math.abs)))))
    pl = iso(L)
  }
  const { cv, lab } = out, P = (v) => pl.P(v.length === dim ? v.map(toF) : v), O = P(M.zeros(dim))
  out.ticks = dim === 2 ? drawPlane(cv, pl, theme) : drawIso(cv, pl, theme)
  const hl = new Set(spec.highlight ?? [])
  const vcol = (o) => color(o.color ?? o.i)
  const SPAN = color('purple'), YHAT = color('green'), Z = color('amber')

  if (span) {
    const S = span.S.filter((o) => !M.isZeroVec(o.v))
    const name = `\\text{Span}\\{${span.S.map(label).join(', ')}\\}`
    if (span.rank === 1 || (span.rank === 2 && dim === 3)) {
      if (span.rank === 1) {
        const d = f(S[0].v)
        const seg = dim === 2 ? clipLine(pl, [0, 0], d) : (() => { const k = (pl.L + 0.5) / Math.max(...d.map(Math.abs)); return [d.map((x) => -x * k), d.map((x) => x * k)] })()
        if (seg) {
          const [a, b] = seg.map((p) => pl.P(p))
          cv.back.push(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: SPAN, 'stroke-width': 7, 'stroke-opacity': 0.18, 'stroke-linecap': 'round' }))
          cv.back.push(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: SPAN, 'stroke-width': 1.2, 'stroke-opacity': 0.8 }))
          cv.trace([a, b], 'span', 0.4)
          lab(name, SPAN, [0.88, 0.12, 0.75, 0.25].flatMap((t) => { const p = V.add(a, V.mul(V.sub(b, a), t)), n = V.unit(V.perp(V.sub(b, a))); return [V.add(p, V.mul(n, 12)), V.sub(p, V.mul(n, 12))] }), { size: 10.5 })
        }
      } else {
        const [u, v] = [f(S[0].v), f(S.find((o, k) => k > 0 && M.spaces(M.transpose([S[0].v, o.v])).rank === 2).v)]
        const k = 1.25
        const corner = (s, t) => pl.P(u.map((x, i) => s * k * x + t * k * v[i]))
        const poly = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
        cv.back.push(el('path', { d: pathD(poly, true), fill: SPAN, 'fill-opacity': 0.13, stroke: SPAN, 'stroke-opacity': 0.6, 'stroke-width': 1 }))
        cv.ext.push(...poly)
        lab(name, SPAN, [V.add(poly[2], [0, -8]), V.add(poly[1], [0, 10]), V.add(poly[3], [0, -8])], { size: 10.5 })
      }
    } else if (span.rank >= dim) {
      out.rows.push([[`${name} = ℝ^{${dim}}`, SPAN]])
      if (dim === 2) cv.back.unshift(el('rect', { x: pl.P([pl.x0, pl.y1])[0], y: pl.P([pl.x0, pl.y1])[1], width: (pl.x1 - pl.x0) * pl.u, height: (pl.y1 - pl.y0) * pl.u, fill: SPAN, 'fill-opacity': 0.08 }))
    }
    out.facts.push(`Span{${span.S.map((o) => o.id).join(', ')}}: ${span.rank === 0 ? 'just 0' : span.rank === 1 ? 'a line through 0' : span.rank === 2 && dim === 3 ? 'a plane through 0' : `all of R${dim}`} (rank ${span.rank}, ${span.rank === span.S.length ? 'linearly independent' : 'linearly dependent'})`)
  }

  // Projection: the line through u (or the plane W), ŷ, z = y − ŷ from ŷ to y, the right angle.
  if (proj) {
    if (proj.U.length === 1 && dim === 2 && !span) {
      const seg = clipLine(pl, [0, 0], f(proj.U[0].v))
      if (seg) { const [a, b] = seg.map((p) => pl.P(p)); cv.back.push(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: theme.muted, 'stroke-width': 1, 'stroke-dasharray': '5 4' })); cv.trace([a, b], 'line', 0.3) }
    } else if (proj.U.length === 2 && dim === 3) {
      const [u, v] = proj.U.map((o) => f(o.v))
      const w = M.leastSquares(M.transpose(proj.U.map((o) => o.v)), proj.y.v).xhat.map(toF)
      const k = Math.max(1.3, Math.abs(w[0]) * 1.3, Math.abs(w[1]) * 1.3)
      const corner = (s, t) => pl.P(u.map((x, i) => s * k * x + t * k * v[i]))
      const poly = [corner(-0.35, -0.35), corner(1, -0.35), corner(1, 1), corner(-0.35, 1)]
      cv.back.push(el('path', { d: pathD(poly, true), fill: SPAN, 'fill-opacity': 0.12, stroke: SPAN, 'stroke-opacity': 0.5, 'stroke-width': 1 }))
      cv.ext.push(...poly)
      lab('W', SPAN, [V.add(poly[2], [8, -6]), V.add(poly[1], [10, 6]), V.add(poly[3], [-10, -6])], { size: 11 })
    }
    const yh = P(proj.yhat), yt = P(proj.y.v)
    if (!M.isZeroVec(proj.yhat)) arrow(cv, O, yh, YHAT, { width: 2.8, head: 10, tag: 'yhat' })
    if (!M.isZeroVec(proj.z)) {
      arrow(cv, yh, yt, Z, { width: 1.8, head: 8, dashed: true, tag: 'z' })
      const back = M.isZeroVec(proj.yhat) ? f(proj.U[0].v) : f(proj.yhat).map((x) => -x)
      rightAngle(cv, pl, f(proj.yhat), back, f(proj.z), theme.muted)
      lab('z', Z, arrowCands(yh, V.mid(yh, yt)).slice(1, 5), { size: 11.5 })
    }
    lab('\\hat{y}', YHAT, arrowCands(O, yh))
  }

  // Combinations head to tail: each weighted vector from the tip of the last, then the result.
  for (const [ci, c] of combos.entries()) {
    let cur = M.zeros(dim)
    c.of.forEach((o, k) => {
      const nxt = M.vadd(cur, M.vscale(c.c[k], o.v))
      const coincide = k === 0 && N.isOne(c.c[k])
      if (!N.isZero(c.c[k]) && !coincide) {
        const a = P(cur), b = P(nxt)
        arrow(cv, a, b, vcol(o), { width: 1.8, head: 8, dashed: k > 0, tag: `c${ci}${k}`, layer: 'mid' })
        lab(coef(c.c[k], label(o)), vcol(o), arrowCands(a, b).slice(3).concat(arrowCands(a, b).slice(0, 3)), { size: 11 })
      }
      cur = nxt
    })
    if (c.consistent) {
      arrow(cv, O, P(c.result), theme.fg, { width: 2.4, head: 10, tag: `r${ci}` })
      if (c.given) lab(c.text, theme.fg, arrowCands(O, P(c.result)))
    }
  }

  // The vectors themselves, from the origin, with drop lines to the x₁x₂-plane in ℝ³.
  for (const o of list) {
    if (M.isZeroVec(o.v)) continue
    const tip = P(o.v)
    if (dim === 3 && !N.isZero(o.v[2])) {
      const foot = pl.P([toF(o.v[0]), toF(o.v[1]), 0])
      cv.back.push(el('path', { d: pathD([tip, foot, pl.P([toF(o.v[0]), 0, 0])]) + pathD([foot, pl.P([0, toF(o.v[1]), 0])]), fill: 'none', stroke: theme.faint, 'stroke-width': 1, 'stroke-dasharray': '2 3' }))
    }
    arrow(cv, O, tip, vcol(o), { width: hl.has(o.id) ? 3.2 : 2.2, head: 10, tag: `v${o.i}` })
    lab(label(o), vcol(o), arrowCands(O, tip), { pri: -1 })
  }

  if (ang) {
    const a = ang.a, b = ang.b
    const r = Math.min(26, 0.45 * Math.min(V.len(V.sub(P(a.v), O)), V.len(V.sub(P(b.v), O))))
    const da = V.unit(V.sub(P(a.v), O)), db = V.unit(V.sub(P(b.v), O))
    const pts = Array.from({ length: 17 }, (_, k) => { const t = k / 16, v = V.unit(V.add(V.mul(da, 1 - t), V.mul(db, t))); return V.add(O, V.mul(v, r)) })
    if (ang.theta < 179.5) {
      cv.mid.push(el('path', { d: pathD(pts), fill: 'none', stroke: theme.fg, 'stroke-width': 1.2 }))
      cv.trace(pts, 'angle', 0.6)
      const mid = V.unit(V.add(da, db))
      lab('θ', theme.fg, [V.add(O, V.mul(mid, r + 9)), V.add(O, V.mul(mid, r + 15))], { size: 11.5 })
    }
  }

  // Readouts: the vectors as columns, then each combination, projection, and angle.
  const colBlock = (v, fill) => matrixBlock(v.map((x) => [fmt(x)]), theme, { size: 10.5, colFill: [fill ?? theme.fg] })
  out.rows.push(list.flatMap((o) => [[`${label(o)} = `, vcol(o)], colBlock(o.v)]))
  for (const c of combos) {
    if (c.target && !c.consistent) out.rows.push([[`${c.label} \\notin ${T('Span')}\\{${c.of.map(label).join(', ')}\\}`, color('red')], [T('(inconsistent)'), theme.muted]])
    else if (c.target) out.rows.push([`${c.text} = ${c.label}`, [c.of.map((o, k) => `c_{${k + 1}} = ${fmt(c.c[k])}`).join(', '), theme.muted], ...(c.unique ? [] : [[T('(one of many)'), theme.muted]])])
    else out.rows.push([`${c.text} = `, colBlock(c.result)])
    out.facts.push(c.target ? (c.consistent ? `${c.text} = ${c.label} ${vecText(c.target)}: weights ${c.of.map((o, k) => `${o.id} ${fmt(c.c[k])}`).join(', ')}${c.unique ? ' (unique)' : ' (one of infinitely many; free weights 0)'}` : `${c.label} ${vecText(c.target)} is not in Span{${c.of.map((o) => o.id).join(', ')}}: no weights reach it`) : `${c.text} = ${vecText(c.result)}`)
  }
  if (proj) {
    const yl = label(proj.y), on = proj.U.map(label)
    if (proj.U.length === 1) {
      out.rows.push([`${yl}·${on[0]} = ${fmt(proj.dot)}`, `${on[0]}·${on[0]} = ${fmt(M.dot(proj.U[0].v, proj.U[0].v))}`, [`θ = ${fmt(proj.theta)}°`, theme.muted]])
      out.rows.push([[`\\hat{y} = ${coef(N.div(proj.dot, M.dot(proj.U[0].v, proj.U[0].v)), on[0])} = `, YHAT], colBlock(proj.yhat, YHAT), [`z = ${yl} − \\hat{y} = `, Z], colBlock(proj.z, Z)])
    } else out.rows.push([[`\\hat{y} = `, YHAT], colBlock(proj.yhat, YHAT), [`z = ${yl} − \\hat{y} = `, Z], colBlock(proj.z, Z)])
    const onto = proj.U.length === 1 ? proj.U[0].id : `W = Span{${proj.U.map((o) => o.id).join(', ')}}${proj.orthogonal ? ' (orthogonal basis)' : ''}`
    out.facts.push(`projection of ${proj.y.id} onto ${onto}: ŷ = ${vecText(proj.yhat)}, z = y − ŷ = ${vecText(proj.z)} (z·${proj.U.map((o) => o.id).join(' = z·')} = 0)${proj.U.length === 1 ? `; ${angleFacts(proj)}` : ''}; distance from y to ${proj.U.length === 1 ? 'the line' : 'W'} ‖z‖ = ${modText(M.dot(proj.z, proj.z))}`)
  }
  if (ang) {
    out.rows.push([`${ang.dotName} = ${fmt(ang.dot)}`, `∥${label(ang.a)}∥ = ${normText(ang.a.v)}`, `∥${label(ang.b)}∥ = ${normText(ang.b.v)}`, [`θ = ${fmt(ang.theta)}°`, theme.fg]])
    out.facts.push(angleFacts(ang))
  }
  out.facts.push(...list.map((o) => `${o.id} = ${vecText(o.v)}`))
  return { F: null, name: 'A', combos, proj, angle: ang }
}

const normText = (v) => { const s = N.sqrtQ(M.dot(v, v)); return s ? N.surdText(s.c, s.r) : fmt(Math.sqrt(toF(M.dot(v, v)))) }
function angleOf(a, b) {
  const dot = M.dot(a.v, b.v), aa = M.dot(a.v, a.v), bb = M.dot(b.v, b.v)
  const theta = (Math.acos(Math.max(-1, Math.min(1, toF(dot) / Math.sqrt(toF(aa) * toF(bb))))) * 180) / Math.PI
  // cos θ = dot/√(aa·bb) = (dot/(c·r))·√r when √(aa·bb) = c√r.
  const s = N.sqrtQ(N.mul(aa, bb))
  const cos = s ? N.surdText(N.div(dot, N.mul(s.c, N.Q(s.r))), s.r) : fmt(toF(dot) / Math.sqrt(toF(aa) * toF(bb)))
  return { a, b, dot, theta, cos, dotName: `${a.label}·${b.label}` }
}
const angleFacts = (g) => `${g.a.id}·${g.b.id} = ${fmt(g.dot)}, ‖${g.a.id}‖ = ${normText(g.a.v)}, ‖${g.b.id}‖ = ${normText(g.b.v)}, cos θ = ${g.cos}, θ = ${fmt(g.theta)}°${N.isZero(g.dot) ? ' (orthogonal)' : ''}`

// ---- eigen --------------------------------------------------------------------------------

function eigenMode(spec, { theme, env }, out) {
  if (spec.A === undefined) throw new SpecError('A', 'eigen mode needs "A", a square matrix')
  const A = readMap(spec.A, env, 'A').M
  if (A.length !== A[0].length) throw new SpecError('A', `eigenvalues need a square matrix; this one is ${A.length}×${A[0].length}`)
  const F = analyze(A)
  out.facts.push(...factText(F, 'A'))
  const COLS = [color('coral'), color('teal'), color('amber')]
  const colBlock = (v, fill) => matrixBlock(v.map((x) => [fmt(x)]), theme, { size: 10.5, colFill: [fill] })
  const real = F.eig.filter((e) => e.kind === 'q' || e.kind === 'f' || e.kind === 'surd')
  const cxe = F.eig.find((e) => e.kind === 'cx' || e.kind === 'fc')
  out.rows.push(['A = ', matrixBlock(A.map((r) => r.map(fmt)), theme, { size: 11 }), `\\det(A − λI) = ${M.polyText(F.lay, 'λ', true)}`])
  // Eigenpairs: λ with its eigenspace basis as columns.
  let k = 0
  for (const e of real) {
    const lams = e.kind === 'surd' ? M.eigFloats(e) : [e.kind === 'q' ? e.v : e.v]
    lams.forEach((lam, j) => {
      const vs = e.vectors[j] ?? []
      const col = COLS[k % 3], lt = e.kind === 'surd' ? `λ_{${k + 1}} ≈ ${fmt(lam)}` : `λ_{${k + 1}} = ${fmt(lam)}`
      out.rows.push([[lt, col], ...(e.mult > 1 ? [[T(`(×${e.mult})`), theme.muted]] : []), ...vs.flatMap((v, q) => [[q ? ',' : vs.length > 1 ? T('basis') : `v_{${k + 1}} = `, theme.fg], colBlock(v, col)]),
        ...(e.kind === 'q' && vs.length < e.mult ? [[T('defective'), theme.muted]] : [])])
      k++
    })
  }
  if (cxe) out.rows.push([[`λ = ${M.eigText(cxe)}`, COLS[0]], ...(F.rot ? [[`r = |λ| = ${modText(F.rot.r2).replace(/ ≈.*/, '')}`, theme.fg], [`φ = ${fmt(F.rot.phi)}°`, theme.fg]] : [])])
  if (A.length !== 2) return { F, name: 'A' }

  // The picture: eigenvector lines, the unit circle and its image, sample vectors and their images.
  const stage = Number.isInteger(spec.__stage) ? spec.__stage : 1
  const dirs = []
  for (const e of real) {
    const lams = e.kind === 'surd' ? M.eigFloats(e) : [toF(e.v)]
    lams.forEach((lam, j) => { for (const b of e.vectors[j] ?? []) dirs.push({ lam, v: b.map(toF), exact: e.kind === 'q' }) })
  }
  const everyVector = dirs.length === 2 && Math.abs(dirs[0].lam - dirs[1].lam) < 1e-12
  const ap = (p) => apply(A, p)
  let R = 1.2
  for (let a = 0; a < 360; a += 3) R = Math.max(R, Math.hypot(...ap([Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)])))
  for (const d of dirs) R = Math.max(R, Math.abs(d.lam))
  const r = Math.ceil(R + 0.15)
  const pl = plane({ x0: -r, x1: r, y0: -r, y1: r }, { maxW: 240, maxH: 240, maxU: 60 })
  const { cv, lab } = out, P = pl.P, O = P([0, 0])
  out.ticks = drawPlane(cv, pl, theme)
  const circle = (f) => Array.from({ length: 73 }, (_, q) => { const t = (q * 5 * Math.PI) / 180; return P(f([Math.cos(t), Math.sin(t)])) })
  cv.mid.push(el('path', { d: pathD(circle((p) => p), true), fill: 'none', stroke: theme.faint, 'stroke-width': 1, 'stroke-dasharray': '3 3' }))
  const IMG = color('purple'), AX = color('blue')
  if (stage > 0) cv.mid.push(el('path', { d: pathD(circle(ap), true), fill: IMG, 'fill-opacity': 0.07, stroke: IMG, 'stroke-width': 1.3, 'stroke-opacity': 0.8 }))
  const unit = (v) => { const l = Math.hypot(...v); let u = [v[0] / l, v[1] / l]; if (u[1] < -1e-9 || (Math.abs(u[1]) < 1e-9 && u[0] < 0)) u = [-u[0], -u[1]]; return u }
  const lines = everyVector ? [] : dirs.map((d, q) => ({ ...d, u: unit(d.v), col: COLS[q % 3], q }))
  for (const L of lines) {
    const seg = clipLine(pl, [0, 0], L.u)
    const [a, b] = seg.map(P)
    cv.back.push(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: L.col, 'stroke-width': 1.3, 'stroke-dasharray': '6 4', 'stroke-opacity': 0.9 }))
    cv.trace([a, b], `line${L.q}`, 0.5)
    const n = V.unit(V.perp(V.sub(b, a)))
    lab(`λ_{${L.q + 1}} ${L.exact ? '=' : '≈'} ${fmt(L.lam)}`, L.col, [b, a].flatMap((end) => [0.06, 0.16].flatMap((t) => { const p = V.add(end, V.mul(V.sub(O, end), t)); return [V.add(p, V.mul(n, 11)), V.sub(p, V.mul(n, 11))] })), { size: 10.5 })
  }
  // Samples on the unit circle away from the eigenvector lines.
  const angles = [0, 45, 90, 135].filter((a) => lines.every((L) => { const d = Math.abs(((((Math.atan2(L.u[1], L.u[0]) * 180) / Math.PI - a) % 180) + 180) % 180); return Math.min(d, 180 - d) > 12 }))
  for (const a of angles) {
    const x = [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)]
    if (stage === 0) arrow(cv, O, P(x), theme.muted, { width: 1.5, head: 7, tag: `x${a}` })
    else {
      arrow(cv, O, P(x), theme.faint, { width: 1.1, head: 6, dashed: true, tag: `x${a}`, layer: 'mid' })
      const y = ap(x)
      if (Math.hypot(...y) > 1e-9) arrow(cv, O, P(y), AX, { width: 1.5, head: 7, tag: `y${a}` })
    }
  }
  for (const L of lines) {
    const tip = P(L.u), img = P(L.u.map((x) => x * L.lam))
    if (stage === 0) { arrow(cv, O, tip, L.col, { width: 2.4, head: 10, tag: `v${L.q}` }); lab(`v_{${L.q + 1}}`, L.col, arrowCands(O, tip)); continue }
    arrow(cv, O, tip, theme.muted, { width: 1.3, head: 7, dashed: true, tag: `v${L.q}`, layer: 'mid' })
    if (Math.abs(L.lam) < 1e-9) { cv.front.push(el('circle', { cx: O[0], cy: O[1], r: 3.5, fill: L.col })); lab(`Av_{${L.q + 1}} = 0`, L.col, ringCands(O, 5, [1, 1])); continue }
    arrow(cv, O, img, L.col, { width: 2.6, head: 10, tag: `w${L.q}` })
    lab(`Av_{${L.q + 1}}`, L.col, arrowCands(O, img))
  }
  if (everyVector) out.rows.push([[T(`every vector is an eigenvector (A = ${fmt(dirs[0].lam)}I)`), theme.muted]])
  else if (cxe) out.rows.push([[T(F.rot && N.isZero(N.sub(A[0][0], A[1][1])) && N.isZero(N.add(A[0][1], A[1][0])) ? 'every vector turns by φ and scales by r' : 'no real eigenvectors: every vector turns'), theme.muted]])
  return { F, name: 'A' }
}

// ---- rref ---------------------------------------------------------------------------------

function reduceSpec(spec, env, diag) {
  if (spec.A === undefined) throw new SpecError('A', 'rref mode needs "A", the coefficient matrix (and "b" for Ax = b)')
  const A = readMatrix(spec.A, env, 'A')
  // "b": "I" row reduces [A | I], which ends at [I | A⁻¹] when A is invertible (Lay §2.2).
  const inv = spec.b === 'I'
  if (inv && A.length !== A[0].length) throw new SpecError('b', `"b": "I" finds A⁻¹, so A must be square; this one is ${A.length}×${A[0].length}`)
  const b = spec.b !== undefined && !inv ? readVector(spec.b, env, 'b', A.length) : null
  const I = M.identity(A.length)
  const Mx = b ? A.map((r, i) => [...r, b[i]]) : inv ? A.map((r, i) => [...r, ...I[i]]) : A
  const auto = M.reduce(Mx)
  if (!spec.ops) return { A, b, inv, Mx, auto, steps: auto.steps }
  if (!Array.isArray(spec.ops) || !spec.ops.length) throw new SpecError('ops', 'ops is a list of row operations, like ["R2 - 2R1", "R1 <-> R3", "(1/2)R2"]')
  let cur = Mx
  const steps = [{ ops: [], M: Mx, pivots: M.leading(Mx) ?? [], changed: [], phase: 'start' }]
  spec.ops.forEach((g, k) => {
    const group = Array.isArray(g) ? g : [g]
    const ops = group.map((s, j) => parseOp(s, Mx.length, env, Array.isArray(g) ? `ops[${k}][${j}]` : `ops[${k}]`))
    for (const op of ops) cur = M.applyOp(cur, op)
    steps.push({ ops, M: cur, pivots: M.leading(cur) ?? [], changed: [...new Set(ops.flatMap((o) => (o.type === 'swap' ? [o.i, o.j] : [o.i])))], phase: 'user' })
  })
  return { A, b, inv, Mx, auto, steps, user: true }
}
const stepLabel = (s, k, last) => (k === 0 ? `start: ${s.M[0].length > 0 ? 'the matrix' : ''}` : s.ops.map(M.opText).join(', ')) + (s.echelon && k ? ' (echelon form)' : '') + (k === last && k ? ' (RREF)' : '')

function rrefMode(spec, { theme, env, diag }, out) {
  const { A, b, inv, Mx, auto, steps, user } = reduceSpec(spec, env, diag)
  const m = A.length, n = A[0].length, last = steps.length - 1
  const sol = M.solution(inv ? auto.R.map((r) => r.slice(0, n)) : auto.R, n, auto.pivots.filter(([, c]) => !inv || c < n))
  const invertible = inv && auto.pivots.length === n && auto.pivots.every(([, c]) => c < n)
  const F = analyze(A)
  const stage = spec.all ? last : Number.isInteger(spec.__stage) ? Math.max(0, Math.min(spec.__stage, last)) : last
  const PIV = color('amber'), CH = color('blue'), FREE = color('purple'), BAD = color('red')
  const endsRref = M.isRref(steps[last].M)
  const badRow = sol.consistent ? -1 : auto.pivots.find(([, c]) => c === n)[0]
  const block = (s, k) => {
    const fin = k === last && endsRref
    const box = Object.fromEntries(s.pivots.filter(([, j]) => j < (b ? n + 1 : inv ? 2 * n : n)).map(([i, j]) => [`${i},${j}`, PIV]))
    const notes = Array(m).fill(''), noteFill = Array(m).fill(theme.fg)
    for (const op of s.ops) notes[op.i] = notes[op.i] ? `${notes[op.i]}, ${M.opTex(op)}` : M.opTex(op)
    const tag = fin ? T('RREF') : s.echelon && k ? T('echelon form') : ''
    if (tag) { const free = notes.findIndex((t, i) => !t && i >= Math.max(0, ...s.changed)); const at = free >= 0 ? free : notes.findIndex((t) => !t); if (at >= 0) { notes[at] = tag; noteFill[at] = theme.muted } }
    const rowTint = Object.fromEntries(s.changed.map((i) => [i, CH]))
    const o = { size: 12, bar: b || inv ? n : undefined, box, notes, noteFill, rowTint, noteSize: 11 }
    if (fin && !inv) {
      o.header = [...Array(n).keys()].map((j) => `x_{${j + 1}}`)
      if (b) o.header.push('')
      o.headFill = o.header.map((_, j) => (sol.free.includes(j) ? FREE : undefined))
      o.colTint = Object.fromEntries(sol.free.map((j) => [j, FREE]))
      if (badRow >= 0) o.rowTint = { ...o.rowTint, [badRow]: BAD }
    }
    return matrixBlock(s.M.map((r) => r.map(fmt)), theme, o)
  }
  const sim = { w: 16, h: 14, svg: (x, y) => labelSvg('∼', x + 6, y + 7, theme, { size: 15, fill: theme.muted, middle: true }) }
  const blank = { w: 16, h: 1, svg: () => '' }
  if (spec.all) steps.forEach((s, k) => out.rows.push([k ? sim : blank, block(s, k)]))
  else out.rows.push([block(steps[stage], stage)])

  // The answer under the final matrix: the solution set, or Nul A and Col A for a bare matrix.
  if (stage === last) {
    const colB = (v, fill) => matrixBlock(v.map((x) => [fmt(x)]), theme, { size: 11, colFill: [fill ?? theme.fg] })
    const freeText = sol.free.length ? [[`${sol.free.map((j) => `x_{${j + 1}}`).join(', ')} ${T('free')}`, FREE]] : []
    if (user && !endsRref) out.rows.push([[T('not yet in RREF'), BAD]])
    else if (inv) out.rows.push(invertible ? [['A^{−1} =', theme.fg], matrixBlock(auto.R.map((r) => r.slice(n).map(fmt)), theme, { size: 11, colFill: Array(n).fill(PIV) })] : [[T('A is not invertible: the left block does not reduce to I'), BAD]])
    else if (b && !sol.consistent) out.rows.push([[`${T(`row ${badRow + 1}:`)} 0 = ${fmt(auto.R[badRow][n])}`, BAD], [T('inconsistent, no solution'), theme.muted]])
    else if (b) {
      const terms = sol.basis.flatMap((v, q) => [[`${q || !M.isZeroVec(sol.p) ? '+ ' : ''}x_{${sol.free[q] + 1}}`, FREE, true], colB(v, FREE)])
      out.rows.push(['x = ', ...(M.isZeroVec(sol.p) && sol.basis.length ? [] : [colB(sol.p)]), ...terms])
      if (freeText.length) out.rows.push(freeText)
    } else {
      out.rows.push([[`${T('rank')} ${F.rank}`, theme.fg], [`${T('nullity')} ${F.nullity}`, theme.fg], ...freeText])
      out.rows.push([[`${T('Nul')} A:`, FREE, true], ...(sol.basis.length ? [['x =', theme.fg, true], ...sol.basis.flatMap((v, q) => [[`${q ? '+ ' : ''}x_{${sol.free[q] + 1}}`, FREE, true], colB(v, FREE)])] : [['\\{0\\}', theme.fg]])])
      out.rows.push([[`${T('Col')} A ${T('basis')}:`, PIV], ...F.col.flatMap((v, q) => [...(q ? [','] : []), colB(v, PIV)])])
    }
  }

  out.facts.push(`${b ? '[A | b]' : inv ? '[A | I]' : 'A'} = ${matText(Mx)}`)
  steps.forEach((s, k) => { if (k) out.facts.push(`${k}. ${s.ops.map(M.opText).join(', ')}: ${matText(s.M)}${s.echelon ? ' (echelon form)' : ''}`) })
  if (user && !endsRref) out.facts.push(`these steps end before RREF; the RREF is ${matText(auto.R)}`)
  if (stage < last && !spec.all) out.facts.push(`showing step ${stage} of ${last}`)
  out.facts.push(`RREF ${matText(auto.R)}`, `pivot positions ${auto.pivots.map(([i, j]) => `(${i + 1}, ${j + 1})`).join(', ')}`)
  if (inv) out.facts.push(invertible ? `[A | I] reduces to [I | A⁻¹], so A⁻¹ = ${matText(auto.R.map((r) => r.slice(n)))}` : `the left block reduces to ${matText(auto.R.map((r) => r.slice(0, n)))}, not I, so A is not invertible`)
  if (b) out.facts.push(!sol.consistent ? `inconsistent: row ${badRow + 1} reads 0 = ${fmt(auto.R[badRow][n])}, no solution` : sol.free.length ? `free ${sol.free.map((j) => `x${j + 1}`).join(', ')}; x = ${M.isZeroVec(sol.p) ? '' : vecText(sol.p)}${sol.basis.map((v, q) => `${q || !M.isZeroVec(sol.p) ? ' + ' : ''}x${sol.free[q] + 1}${vecText(v)}`).join('')} (infinitely many solutions)` : `unique solution x = ${vecText(sol.p)}`)
  out.facts.push(...factText(F, 'A'))
  return { F, name: 'A', sol, b, R: auto.R, aug: inv ? '[A | I]' : b ? '[A | b]' : null }
}

// ---- lsq ----------------------------------------------------------------------------------

function lsqMode(spec, { theme, env, diag }, out) {
  const colB = (v, fill) => matrixBlock(v.map((x) => [fmt(x)]), theme, { size: 11, colFill: [fill ?? theme.fg] })
  const mat = (Mx) => matrixBlock(Mx.map((r) => r.map(fmt)), theme, { size: 11 })
  const errText = (ee) => { const s = N.sqrtQ(ee); return s ? (s.r === 1n ? fmt(s.c) : `${N.surdText(s.c, s.r)} ≈ ${fmt(N.surdF(s.c, s.r))}`) : fmt(Math.sqrt(toF(ee))) }
  if (!spec.data) {
    if (spec.A === undefined || spec.b === undefined) throw new SpecError('data', 'lsq mode needs "data": [[x, y], ...] for a fit, or "A" and "b" for the least-squares solution of Ax = b')
    const A = readMatrix(spec.A, env, 'A'), b = readVector(spec.b, env, 'b', A.length)
    const L = M.leastSquares(A, b)
    out.rows.push(['A^{T}A = ', mat(L.AtA), 'A^{T}b = ', colB(L.Atb)])
    out.rows.push(['\\hat{x} = ', colB(L.xhat, color('coral')), ...(L.free.length ? [[T('+ free directions'), theme.muted]] : []), 'A\\hat{x} = ', colB(L.bhat)])
    out.rows.push(['b − A\\hat{x} = ', colB(L.e, color('teal')), [`∥b − A\\hat{x}∥ = ${errText(L.ee)}`, theme.fg]])
    out.facts.push(`A = ${matText(A)}, b = ${vecText(b)}`, `normal equations AᵀA x = Aᵀb: AᵀA = ${matText(L.AtA)}, Aᵀb = ${vecText(L.Atb)}`,
      L.free.length ? `AᵀA is singular: infinitely many least-squares solutions, one is x̂ = ${vecText(L.xhat)}, plus ${L.basis.map(vecText).join(', ')} directions` : `x̂ = ${vecText(L.xhat)} (unique: A's columns are independent)`,
      `Ax̂ = ${vecText(L.bhat)}, b − Ax̂ = ${vecText(L.e)}, least-squares error ‖b − Ax̂‖ = ${errText(L.ee)}`)
    return { F: analyze(A), name: 'A', lsq: L }
  }
  if (!Array.isArray(spec.data) || spec.data.length < 2) throw new SpecError('data', 'data is a list of [x, y] points, at least two')
  const pts = spec.data.map((p, k) => readVector(p, env, `data[${k}]`, 2))
  const deg = spec.degree ?? 1
  if (![1, 2, 3].includes(deg)) throw new SpecError('degree', 'degree is 1 (a line), 2 (a parabola), or 3')
  const X = pts.map(([x]) => Array.from({ length: deg + 1 }, (_, j) => Array.from({ length: j }).reduce((s) => N.mul(s, x), N.ONE)))
  const y = pts.map((p) => p[1])
  const L = M.leastSquares(X, y)
  if (L.free.length) diag.warn('data', `the x values can't fix a degree-${deg} fit (too few distinct x); one fit is shown`)
  const beta = L.xhat, fx = (x) => beta.reduce((s, c, j) => s + toF(c) * x ** j, 0)

  // Axes: nice ticks over the data and the fit, reaching 0 when the data sit close to it.
  const xs = pts.map((p) => toF(p[0])), ys = pts.map((p) => toF(p[1]))
  const range = (vals) => { let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 1e-9) { lo -= 1; hi += 1 } if (lo > 0 && lo <= hi - lo) lo = 0; if (hi < 0 && -hi <= hi - lo) hi = 0; const pad = (hi - lo) * 0.08; return [lo - (lo === 0 ? 0 : pad), hi + pad] }
  const xr = range(xs)
  const curve = Array.from({ length: 61 }, (_, k) => xr[0] + ((xr[1] - xr[0]) * k) / 60)
  const yr = range([...ys, ...curve.map(fx)].filter(Number.isFinite).slice(0, ys.length + (deg === 1 ? 61 : 0)).concat(deg === 1 ? [] : ys.map((_, k) => fx(xs[k]))))
  const tx = niceTicks(...xr, 5), ty = niceTicks(...yr, 5)
  const x0 = Math.min(xr[0], tx[0]), x1 = Math.max(xr[1], tx[tx.length - 1]), y0 = Math.min(yr[0], ty[0]), y1 = Math.max(yr[1], ty[ty.length - 1])
  const W = 240, H = 170, SX = (x) => ((x - x0) / (x1 - x0)) * W, SY = (v) => H - ((v - y0) / (y1 - y0)) * H
  const { cv } = out
  for (const t of tx) { cv.back.push(el('line', { x1: SX(t), y1: 0, x2: SX(t), y2: H, stroke: theme.grid, 'stroke-width': 1 })); cv.back.push(labelSvg(tickFmt(t), SX(t), H + 13, theme, { size: 9.5, fill: theme.muted })) }
  for (const t of ty) { cv.back.push(el('line', { x1: 0, y1: SY(t), x2: W, y2: SY(t), stroke: theme.grid, 'stroke-width': 1 })); cv.back.push(labelSvg(tickFmt(t), -5, SY(t), theme, { size: 9.5, fill: theme.muted, anchor: 'end', middle: true })) }
  if (x0 < 0 && x1 > 0) cv.back.push(el('line', { x1: SX(0), y1: 0, x2: SX(0), y2: H, stroke: theme.faint, 'stroke-width': 1 }))
  if (y0 < 0 && y1 > 0) cv.back.push(el('line', { x1: 0, y1: SY(0), x2: W, y2: SY(0), stroke: theme.faint, 'stroke-width': 1 }))
  cv.back.push(el('rect', { x: 0, y: 0, width: W, height: H, fill: 'none', stroke: theme.muted, 'stroke-width': 1 }))
  cv.back.push(labelSvg('x', W + 8, H + 4, theme, { size: 11, fill: theme.muted }), labelSvg('y', -4, -6, theme, { size: 11, fill: theme.muted }))
  cv.ext.push([-28, -16], [W + 14, H + 18])
  const FIT = color('coral'), RES = color('teal')
  // The fit, cut where it leaves the frame.
  const segs = [[]]
  for (const x of curve) { const v = fx(x); if (v >= y0 && v <= y1) segs[segs.length - 1].push([SX(x), SY(v)]); else if (segs[segs.length - 1].length) segs.push([]) }
  for (const s of segs) if (s.length > 1) cv.mid.push(el('path', { d: pathD(s), fill: 'none', stroke: FIT, 'stroke-width': 2.2 }))
  pts.forEach((p, k) => {
    const px = SX(xs[k]), py = SY(ys[k]), qy = SY(Math.max(y0, Math.min(y1, fx(xs[k]))))
    if (Math.abs(py - qy) > 1) cv.mid.push(el('line', { x1: px, y1: py, x2: px, y2: qy, stroke: RES, 'stroke-width': 1.6, 'stroke-dasharray': '3 2' }))
    cv.front.push(el('circle', { cx: px, cy: py, r: 3.3, fill: theme.fg }))
  })
  const eq = 'y = ' + beta.map((c, j) => ({ c, s: j === 0 ? '' : j === 1 ? 'x' : `x^{${j}}` })).filter((t, j) => !N.isZero(t.c) || (j === 0 && beta.slice(1).every(N.isZero)))
    .map((t, q) => (t.s ? coef(t.c, t.s, q === 0) : (q === 0 ? fmt(t.c) : `${N.sign(t.c) < 0 ? ' − ' : ' + '}${fmt(N.abs(t.c))}`))).join('')
  out.rows.push([[eq, FIT]])
  out.rows.push(['X^{T}X = ', mat(L.AtA), 'X^{T}y = ', colB(L.Atb), '\\hat{β} = ', colB(beta, FIT)])
  out.rows.push([[`${T('residuals')} y − X\\hat{β}:`, RES], [L.e.map(fmt).join(', '), RES]])
  out.rows.push([[`∥y − X\\hat{β}∥ = ${errText(L.ee)}`, theme.fg]])
  out.facts.push(`${pts.length} points ${pts.map(vecText).join(' ')}`, `degree ${deg} fit by the normal equations XᵀXβ = Xᵀy: XᵀX = ${matText(L.AtA)}, Xᵀy = ${vecText(L.Atb)}`,
    `β̂ = ${vecText(beta)}: ${eq.replace(/\^\{(\d)\}/g, '^$1')}`, `residuals ${vecText(L.e)}, sum of squares ${fmt(L.ee)}, ‖y − Xβ̂‖ = ${errText(L.ee)}`)
  return { F: null, name: 'X', lsq: L }
}

// ---- layout -------------------------------------------------------------------------------

const MODE_FNS = { transform: transformMode, vectors: vectorsMode, eigen: eigenMode, rref: rrefMode, lsq: lsqMode }
const ALT = { transform: 'linear transformation of the plane', vectors: 'vectors in the plane', eigen: 'eigenvectors of a 2×2 matrix', rref: 'row reduction to reduced echelon form', lsq: 'least-squares fit' }

export default {
  kind: 'linalg',
  fields: FIELDS,
  collections: ['vectors'],
  // Steps the widget walks: one map at a time, before and after A, or one row operation at a time.
  steps(spec) {
    const env = paramDefaults(spec), mode = modeOf(spec)
    if (mode === 'transform') {
      const maps = readStages(spec, env)
      return [{ label: 'start: the identity', __stage: 0 }, ...maps.map((m, k) => ({ label: `${k + 1}. ${m.name}${m.desc ? `: ${m.desc}` : ''}${k ? `, so far ${prodName(maps, k + 1)}` : ''}`, __stage: k + 1 }))]
    }
    if (mode === 'eigen') {
      const A = readMap(spec.A, env, 'A').M
      return A.length === 2 && A[0].length === 2 ? [{ label: 'vectors x, and eigenvectors v on their lines', __stage: 0 }, { label: 'after A: each Av stays on its line, scaled by λ', __stage: 1 }] : []
    }
    if (mode === 'rref' && !spec.all) {
      const R = reduceSpec(spec, env, new Diag())
      return R.steps.map((s, k) => ({ label: stepLabel(s, k, R.steps.length - 1), __stage: k }))
    }
    return []
  },
  render(spec, ctx) {
    const mode = modeOf(spec)
    const cv = new Canvas(), waiting = []
    const out = { cv, rows: [], facts: [`linalg ${mode}`], ticks: [], lab: (label, fill, cands, o = {}) => waiting.push({ label, size: o.size ?? 12, fill, cands, ...o }) }
    const S = MODE_FNS[mode](spec, ctx, out)
    S.mode = mode
    const ex = checkExpect(spec.expect, S, ctx.env, ctx.diag)
    if (ex) out.facts.push(ex)

    // Labels where they cover the fewest strokes, each on a backing box; ticks fill in after.
    const { theme } = ctx
    const placed = placeLabels(waiting.sort((a, b) => (a.pri ?? 0) - (b.pri ?? 0)), cv)
    const parts = []
    for (const q of placed) {
      const [x1, y1, x2, y2] = q.box
      parts.push(el('rect', { x: x1, y: y1 + 1, width: x2 - x1, height: y2 - y1 - 2, rx: 2.5, fill: theme.halo, 'fill-opacity': 0.8, class: 'tv-label-bg' }))
      parts.push(labelSvg(q.label, (x1 + x2) / 2, y2 - 4.5, theme, { size: q.size, fill: q.fill }))
    }
    drawTicks(cv, out.ticks, placed.map((q) => q.box), theme)

    // Fit the drawing, then the readouts under it.
    const has = cv.ext.length > 0
    const xs = cv.ext.map((p) => p[0]), ys = cv.ext.map((p) => p[1])
    const minX = has ? Math.min(...xs) : 0, maxX = has ? Math.max(...xs) : 0, minY = has ? Math.min(...ys) : 0, maxY = has ? Math.max(...ys) : 0
    // Wide enough for the widest block or glued group, and for a row of text up to 330 px.
    const widest = Math.max(0, ...out.rows.map((r) => {
      let best = 0, run = 0, all = 0
      for (const it of r.map((x) => readItem(x))) { run += it.w + 7; all += it.w + 7; if (!it.glue) { best = Math.max(best, run - 7); run = 0 } }
      return Math.max(best, Math.min(all - 7, 330 - 2 * MARGIN))
    }))
    const width = Math.max(maxX - minX + 2 * MARGIN, widest + 2 * MARGIN, 270)
    const dx = (width - (maxX - minX)) / 2 - minX, dy = MARGIN - minY
    const top = has ? maxY + dy + 10 : MARGIN
    const fl = flow(out.rows, MARGIN, top, width - 2 * MARGIN, theme)
    const height = top + fl.height + MARGIN - (has && !fl.height ? 10 : 0)
    const body = el('g', { transform: `translate(${dx.toFixed(2)},${dy.toFixed(2)})` }, [...cv.back, ...cv.mid, ...cv.front, ...parts]) + fl.svg
    return { body, width, height, summary: out.facts.join('; '), alt: ALT[mode] }
  },
}
