// truss: planar pin-jointed trusses for statics. Joints sit at problem coordinates (length
// units, y up), members join them, pins and rollers support them, and point loads act at
// joints. The truss is solved by the method of joints as one linear system, so the summary
// lists the reactions and every member force (tension or compression) for checking answer
// keys. Options draw the forces on the members, dimension lines, and a method-of-sections cut.

import { el, pathD } from '../../svg.js'
import { color } from '../../theme.js'
import { SpecError } from '../../diag.js'
import { V, Canvas, arrow, hatched, circlePoly } from '../fbd/draw.js'
import { extent, arrowCands, ringCands, placeLabels, drawLabels } from '../fbd/place.js'
import { build, solve, fmt, findSection, memberNamed } from './solve.js'

const MARGIN = 14
const U = 56 // support symbol scale, as in fbd

/** Screen-space angle in degrees between two unit vectors. */
const angle = (a, b) => (Math.acos(Math.max(-1, Math.min(1, V.dot(a, b)))) * 180) / Math.PI

export default {
  kind: 'truss',
  fields: ['joints', 'members', 'supports', 'loads', 'unit', 'length', 'dims', 'forces', 'names', 'section', 'highlight'],
  collections: ['members', 'supports', 'loads'],
  render(spec, { theme, diag, env }) {
    const model = build(spec, env, diag)
    const { members, supports, loads } = model
    const sol = solve(model)
    const solved = sol.status === 'determinate'
    const unit = spec.unit ? ` ${spec.unit}` : ''
    const lenUnit = spec.length ? ` ${spec.length}` : ''
    const big = Math.max(0, ...loads.map((l) => l.mag))
    const tiny = 1e-7 * Math.max(big, 1e-12)
    const counts = `m + r = ${sol.m + sol.r}, 2j = ${2 * sol.j}`
    if (sol.status === 'indeterminate') diag.warn('members', `${counts}: statically indeterminate (${sol.m + sol.r - 2 * sol.j} redundant), so the method of joints can't solve it; drawn without forces. Remove a member or a support reaction`)
    if (sol.status === 'unstable') diag.warn('members', `${counts}: unstable (a mechanism); add ${2 * sol.j - sol.m - sol.r} member(s) or support reaction(s)`)
    if (sol.status === 'singular') diag.warn('members', 'm + r = 2j, but the joint equations are singular: the truss is geometrically unstable (a panel without a diagonal, or reactions that are all parallel or all meet at one point); drawn without forces')
    const showForces = !!spec.forces && solved
    const highlight = new Set(spec.highlight ?? [])

    // Section: the members it names, and one straight line through exactly those.
    let cut = null, line = null
    if (spec.section !== undefined) {
      if (!Array.isArray(spec.section) || !spec.section.length) throw new SpecError('section', 'section lists the members one cut crosses, like ["BC", "BD", "AD"]')
      cut = spec.section.map((s, i) => {
        const mb = typeof s === 'string' ? memberNamed(members, s) : null
        if (!mb) throw new SpecError(`section[${i}]`, `no member "${s}"; members: ${members.map((m) => m.name).join(', ')}`)
        return mb
      })
      line = findSection(model, cut)
      if (!line) diag.warn('section', `no straight line crosses exactly ${cut.map((m) => m.name).join(', ')} (and clear of every joint); list the members one straight cut passes through`)
    }

    // Scale: the span about 380 px wide (height at most 280), every member at least 56 px.
    const js = [...model.joints.values()]
    const w = Math.max(...js.map((j) => j.x)) - Math.min(...js.map((j) => j.x))
    const h = Math.max(...js.map((j) => j.y)) - Math.min(...js.map((j) => j.y))
    let S = Math.min(w > 0 ? 380 / w : Infinity, h > 0 ? 280 / h : Infinity)
    if (!Number.isFinite(S)) S = 60
    const minL = Math.min(...members.map((m) => m.L))
    if (minL * S < 56) S = 56 / minL
    const P = (j) => [j.x * S, -j.y * S]
    const toScreen = (d) => [d[0], -d[1]]
    const cen = V.mul(js.reduce((s, j) => V.add(s, P(j)), [0, 0]), 1 / js.length)

    const cv = new Canvas()
    const fs = theme.size
    const tint = color('gray')
    // Strokes leaving each joint (screen unit vectors), for load and label directions.
    const spokes = new Map(js.map((j) => [j, []]))

    // Members: tension blue (theme.negative), compression red (theme.positive), zero-force dashed.
    const look = (mb) => {
      if (!showForces) return { stroke: theme.fg, width: 2.5 }
      if (Math.abs(mb.F) <= tiny) return { stroke: theme.muted, width: 2, dash: '5 4' }
      return { stroke: mb.F > 0 ? theme.negative : theme.positive, width: 3 }
    }
    members.forEach((mb, i) => {
      const a = P(mb.a), b = P(mb.b), lk = look(mb)
      const hl = highlight.has(mb.name) || (mb.id !== undefined && highlight.has(mb.id))
      cv.mid.push(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: lk.stroke, 'stroke-width': lk.width + (hl ? 1.5 : 0), 'stroke-dasharray': lk.dash, 'stroke-linecap': 'round' }))
      cv.trace([a, b], `m:${i}`)
      mb.look = lk
      spokes.get(mb.a).push(V.unit(V.sub(b, a)))
      spokes.get(mb.b).push(V.unit(V.sub(a, b)))
    })

    // Support symbols, as fbd draws them: u points from the support into the joint.
    for (const s of supports) {
      const p = P(s.j), u = toScreen(s.n), n = V.perp(u), stroke = theme.fg
      spokes.get(s.j).push(V.mul(u, -1))
      const hh = (s.type === 'pin' ? 0.42 : 0.3) * U, base = V.sub(p, V.mul(u, hh))
      const tri = [p, V.add(base, V.mul(n, 0.26 * U)), V.sub(base, V.mul(n, 0.26 * U))]
      cv.mid.push(el('path', { d: pathD(tri, true), fill: tint, 'fill-opacity': 0.2, stroke, 'stroke-width': 1.4, 'stroke-linejoin': 'round' }))
      cv.trace(tri, 'support', 1, true)
      let ground = base
      if (s.type === 'roller') {
        for (const k of [-1, 1]) {
          const c = V.add(V.sub(base, V.mul(u, 4.5)), V.mul(n, k * 0.13 * U))
          cv.mid.push(el('circle', { cx: c[0], cy: c[1], r: 4, fill: 'none', stroke, 'stroke-width': 1.2 }))
          cv.trace(circlePoly(c, 4, 8), 'support', 1, true)
        }
        ground = V.sub(base, V.mul(u, 9))
      }
      hatched(cv, V.add(ground, V.mul(n, 0.45 * U)), V.sub(ground, V.mul(n, 0.45 * U)), V.mul(u, -1), stroke)
    }

    // Loads: an arrow pushing onto the joint, or pulling away from it when the push side runs
    // along a member (a load hanging from a bottom-chord joint).
    const first = []
    loads.forEach((l, i) => {
      const p = P(l.j), d = toScreen(l.d)
      const clear = (v) => Math.min(180, ...spokes.get(l.j).map((s) => angle(v, s)))
      const push = clear(V.mul(d, -1)) + 10 >= clear(d)
      const L = 34 + (big > 0 ? (30 * l.mag) / big : 30)
      let tail, tip, near, far
      if (push) { tip = V.sub(p, V.mul(d, 5)); tail = V.sub(tip, V.mul(d, L)); near = tip; far = tail }
      else { tail = V.add(p, V.mul(d, 5)); tip = V.add(tail, V.mul(d, L)); near = tail; far = tip }
      spokes.get(l.j).push(push ? V.mul(d, -1) : d)
      arrow(cv, tail, tip, theme.fg, { width: 2.2, tag: `f:load${i}` })
      const label = l.label ?? `${fmt(l.mag)}${unit}`
      first.push({ label, size: fs, fill: theme.fg, cands: arrowCands(near, far), own: `f:load${i}` })
    })

    // The section cut: a dash-dot line just past the members it crosses.
    if (line) {
      const d = toScreen(line.d), hits = line.hits.map((q) => [q[0] * S, -q[1] * S])
      const o = hits[0], ss = hits.map((q) => V.dot(V.sub(q, o), d))
      const a = V.add(o, V.mul(d, Math.min(...ss) - 24)), b = V.add(o, V.mul(d, Math.max(...ss) + 24))
      cv.front.push(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: theme.fg, 'stroke-width': 1.3, 'stroke-dasharray': '9 4 2 4' }))
      cv.trace([a, b], 'section', 0.6)
    }

    // Joints: a dot each.
    for (const j of js) {
      const p = P(j)
      cv.front.push(el('circle', { cx: p[0], cy: p[1], r: 3.2, fill: theme.fg }))
      cv.trace(circlePoly(p, 4, 10), `j:${j.name}`, 1, true)
    }

    // Load labels first, so the dimension lines go below them; they then count as obstacles.
    const placedFirst = placeLabels(first, cv)
    for (const q of placedFirst) {
      const [x1, y1, x2, y2] = q.box
      cv.fill([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], 'label', 1)
    }

    const rest = []
    if (spec.dims) drawDims(cv, rest, js, P, S, model.size, theme, lenUnit)

    // Joint names, in the widest gap between the strokes at each joint.
    for (const j of js) {
      const dirs = spokes.get(j).map((s) => Math.atan2(s[1], s[0])).sort((a, b) => a - b)
      let mid = Math.atan2(V.sub(P(j), cen)[1], V.sub(P(j), cen)[0])
      if (dirs.length) {
        let gap = -1
        dirs.forEach((a, k) => {
          const b = k + 1 < dirs.length ? dirs[k + 1] : dirs[0] + 2 * Math.PI
          if (b - a > gap + 1e-9) { gap = b - a; mid = (a + b) / 2 }
        })
      }
      rest.push({ label: j.name, size: fs, fill: theme.fg, cands: ringCands(P(j), 10, [Math.cos(mid), Math.sin(mid)]), ignore: [`j:${j.name}`] })
    }

    // Member labels: the force (and the name, if asked) beside the midpoint, outside first.
    members.forEach((mb, i) => {
      const parts = []
      if (spec.names) parts.push(mb.name)
      if (showForces) parts.push(Math.abs(mb.F) <= tiny ? '0' : `${fmt(Math.abs(mb.F))} ${mb.F > 0 ? 'T' : 'C'}`)
      if (!parts.length) return
      const a = P(mb.a), b = P(mb.b), n = V.perp(V.unit(V.sub(b, a)))
      const out = V.dot(V.sub(V.mid(a, b), cen), n) >= 0 ? n : V.mul(n, -1)
      const cands = []
      for (const g of [4, 11]) for (const f of [0.5, 0.38, 0.62, 0.27, 0.73]) for (const s of [out, V.mul(out, -1)]) {
        cands.push((w, h) => V.add(V.add(a, V.mul(V.sub(b, a), f)), V.mul(s, g + 2 + extent(s, w, h))))
      }
      rest.push({ label: parts.join(': '), size: fs - 1, fill: showForces ? mb.look.stroke : theme.muted, cands, own: `m:${i}` })
    })
    rest.sort((x, y) => (x.order ?? 1) - (y.order ?? 1))

    const placed = [...placedFirst, ...placeLabels(rest, cv)]
    drawLabels(placed, cv, theme)
    const crowded = placed.filter((q) => q.hard).map((q) => q.label)
    if (crowded.length) diag.warn('joints', `no clear spot for ${crowded.join(', ')}; the label sits on a backing box. Space the joints out`)

    // Canvas.
    const xs = cv.ext.map((p) => p[0]), ys = cv.ext.map((p) => p[1])
    const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys)
    const body = el('g', { transform: `translate(${(MARGIN - x0).toFixed(1)},${(MARGIN - y0).toFixed(1)})` }, [...cv.back, ...cv.mid, ...cv.front])

    // Summary.
    const status = solved ? 'm + r = 2j, determinate'
      : sol.status === 'singular' ? 'm + r = 2j but geometrically unstable; not solved'
      : `m + r = ${sol.m + sol.r} ${sol.status === 'unstable' ? '<' : '>'} 2j = ${2 * sol.j}, ${sol.status === 'unstable' ? 'unstable' : 'statically indeterminate'}; not solved`
    const parts = [`truss: ${sol.j} joints, ${sol.m} members, ${sol.r} reactions (${status})`]
    if (loads.length) {
      const Fx = loads.reduce((s, l) => s + l.mag * l.d[0], 0), Fy = loads.reduce((s, l) => s + l.mag * l.d[1], 0)
      parts.push(`loads ΣF = (${fmt(Fx, tiny)}, ${fmt(Fy, tiny)})${unit}`)
    }
    const force = (mb) => (Math.abs(mb.F) <= tiny ? `${mb.name} 0 (zero-force)` : `${mb.name} ${fmt(Math.abs(mb.F))}${unit} ${mb.F > 0 ? 'T' : 'C'}`)
    if (solved) {
      const val = (r) => (Math.abs(r.value) <= tiny ? '0' : `${fmt(r.value)}${unit}`)
      parts.push(`reactions ${sol.reactions.map((r) => `${r.name}${r.angle !== undefined ? ` (along ${fmt(r.angle)}°)` : ''} = ${val(r)}`).join(', ')}`)
      parts.push(`members ${members.map(force).join(', ')}`)
    }
    if (cut) {
      parts.push(`section through ${cut.map((m) => m.name).join(', ')}${line ? '' : ' (no straight cut found)'}`)
      if (solved) diag.note('section', `cut members: ${cut.map(force).join(', ')}`)
    }
    return { body, width: x1 - x0 + 2 * MARGIN, height: y1 - y0 + 2 * MARGIN, summary: parts.join('; '), alt: 'truss diagram' }
  },
}

/**
 * Dimension lines: the distinct joint x positions along the bottom and the distinct y positions
 * at the left, each gap labeled in length units, with extension lines from whatever is drawn
 * lowest (or leftmost) at that position.
 */
function drawDims(cv, labels, js, P, S, size, theme, lenUnit) {
  const c = theme.muted, fs = theme.size, tol = 1e-6 * size
  const distinct = (vals) => vals.sort((a, b) => a - b).filter((v, k, arr) => !k || v - arr[k - 1] > tol)
  const xsU = distinct(js.map((j) => j.x)), ysU = distinct(js.map((j) => j.y))
  const text = (d) => `${fmt(d)}${lenUnit}`
  const ext = [...cv.ext]

  const segment = (p0, p1, out) => {
    const mid = V.mid(p0, p1)
    if (V.len(V.sub(p1, p0)) > 22) { arrow(cv, mid, p0, c, { width: 1, head: 7, tag: 'dim' }); arrow(cv, mid, p1, c, { width: 1, head: 7, tag: 'dim' }) }
    else { cv.front.push(el('line', { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1], stroke: c, 'stroke-width': 1 })); cv.trace([p0, p1], 'dim') }
    return [0.5, 0.35, 0.65].flatMap((f) => [out, V.mul(out, -1)].map((s) => (w, h) => V.add(V.add(p0, V.mul(V.sub(p1, p0), f)), V.mul(s, 3 + extent(s, w, h)))))
  }
  const extLine = (a, z) => {
    cv.back.push(el('line', { x1: a[0], y1: a[1], x2: z[0], y2: z[1], stroke: c, 'stroke-width': 0.8 }))
    cv.trace([a, z], 'dim', 0.6)
  }

  if (xsU.length > 1) {
    const y = Math.max(...ext.map((p) => p[1])) + fs + 14
    for (const x of xsU) {
      const X = x * S
      const col = cv.obs.filter(([px, , , tag]) => Math.abs(px - X) < 6 && tag !== 'dim').map((o) => o[1])
      extLine([X, Math.max(...col) + 4], [X, y + 5])
    }
    for (let k = 1; k < xsU.length; k++) {
      const cands = segment([xsU[k - 1] * S, y], [xsU[k] * S, y], [0, -1])
      labels.push({ label: text(xsU[k] - xsU[k - 1]), size: fs, fill: theme.fg, cands, order: 2 })
    }
  }
  if (ysU.length > 1) {
    const x = Math.min(...ext.map((p) => p[0])) - 16
    for (const yv of ysU) {
      const Y = -yv * S
      const row = cv.obs.filter(([, py, , tag]) => Math.abs(py - Y) < 6 && tag !== 'dim').map((o) => o[0])
      extLine([Math.min(...row) - 4, Y], [x - 5, Y])
    }
    for (let k = 1; k < ysU.length; k++) {
      const cands = segment([x, -ysU[k - 1] * S], [x, -ysU[k] * S], [-1, 0])
      labels.push({ label: text(ysU[k] - ysU[k - 1]), size: fs, fill: theme.fg, cands, order: 2 })
    }
  }
}
