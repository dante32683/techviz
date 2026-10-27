// field: electric fields and potentials for E&M problems. Sources (point charges, infinite
// lines, finite segments, infinite planes seen edge-on, parallel plates) sit at problem
// coordinates (length units, y up); the renderer computes E and V from them, draws field
// arrows or field lines and dashed equipotentials, and adds labeled points, displacements
// split along and across E (the d∥ / ΔV = 0 construction), angle marks, and dimensions. The
// summary gives E at every point and the potential differences between them, for checking.

import { el, pathD } from '../../svg.js'
import { color } from '../../theme.js'
import { SpecError } from '../../diag.js'
import { contours, clipSegment } from '../../geom.js'
import { V, Canvas, arrow, circlePoly, arcPoints, shortSweep, dirOf } from '../fbd/draw.js'
import { extent, ringCands, placeLabels, drawLabels } from '../fbd/place.js'
import { readSources, fieldAt, distTo, sideOf, si, val, fmt, pair, W, angleOf, EPS0 } from './physics.js'

const MARGIN = 14
const SIDE = 280 // the view's longer side in px
const GRID = 28 // field-arrow spacing in px
const LENGTH = { m: 1, cm: 1e-2, mm: 1e-3, km: 1e3, um: 1e-6, μm: 1e-6, nm: 1e-9 }

/** Text for a TeX label of a point name: V_{A}. */
const sub = (sym, name) => `${sym}_{${name}}`

export default {
  kind: 'field',
  fields: ['sources', 'points', 'view', 'unit', 'E', 'equipotentials', 'displacements', 'dims', 'angles', 'ref', 'highlight'],
  collections: ['sources', 'displacements', 'dims', 'angles'],
  render(spec, { theme, diag, env }) {
    const unit = spec.unit ?? 'm'
    const lu = LENGTH[unit]
    if (lu === undefined) diag.warn('unit', `unit is a length unit (${Object.keys(LENGTH).join(', ')}); "${unit}" is treated as meters`)
    const { drawn, simple } = readSources(spec, env, lu ?? 1)
    const F = (p) => fieldAt(simple, W.mul(p, lu ?? 1)) // p in length units; E in V/m, V in volts
    const highlight = new Set(spec.highlight ?? [])
    const fs = theme.size

    // Points.
    const points = new Map()
    if (spec.points !== undefined) {
      if (!spec.points || typeof spec.points !== 'object' || Array.isArray(spec.points)) throw new SpecError('points', 'points is an object of name: [x, y] (or {"at": [x, y], "E": true}), like {"A": [1, 0], "B": [1, 4.5]}')
      for (const [name, p] of Object.entries(spec.points)) {
        const path = `points.${name}`
        const o = Array.isArray(p) ? { at: p } : p
        if (!o || typeof o !== 'object') throw new SpecError(path, 'a point is [x, y] or {"at": [x, y], "E": true, "label": "A"}')
        const at = pair(o.at, env, `${path}.at`)
        points.set(name, { name, at, showE: !!o.E, label: o.label ?? name, path })
      }
    }
    const known = () => `points: ${[...points.keys()].join(', ') || 'none'}`
    const point = (n, path) => {
      const p = points.get(n)
      if (!p) throw new SpecError(path, `no point "${n}"; ${known()}`)
      return p
    }
    const sourceById = new Map(drawn.filter((s) => s.id !== undefined).map((s) => [s.id, s]))

    // The view: given, or the anchors' box padded by a third and kept within 3:2.
    let vx, vy
    if (spec.view !== undefined) {
      const v = spec.view
      if (!v || !Array.isArray(v.x) || !Array.isArray(v.y) || v.x.length !== 2 || v.y.length !== 2) throw new SpecError('view', 'view is {"x": [xmin, xmax], "y": [ymin, ymax]} in length units')
      vx = v.x.map((t, k) => val(t, env, `view.x[${k}]`)); vy = v.y.map((t, k) => val(t, env, `view.y[${k}]`))
      if (!(vx[1] > vx[0]) || !(vy[1] > vy[0])) throw new SpecError('view', 'view ranges run from min to max')
    } else {
      const anchors = [...[...points.values()].map((p) => p.at)]
      for (const s of drawn) {
        if (s.type === 'segment') anchors.push(s.a, s.b)
        else if (s.type === 'plates') anchors.push(...s.plates.map((p) => p.at))
        else anchors.push(s.at)
      }
      const xs = anchors.map((p) => p[0]), ys = anchors.map((p) => p[1])
      let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
      const size = Math.max(x1 - x0, y1 - y0) || 1, pad = size / 3
      x0 -= pad; x1 += pad; y0 -= pad; y1 += pad
      const w = x1 - x0, h = y1 - y0
      if (w < h / 1.5) { const g = (h / 1.5 - w) / 2; x0 -= g; x1 += g }
      if (h < w / 1.5) { const g = (w / 1.5 - h) / 2; y0 -= g; y1 += g }
      vx = [x0, x1]; vy = [y0, y1]
    }
    const S = SIDE / Math.max(vx[1] - vx[0], vy[1] - vy[0])
    const Wpx = (vx[1] - vx[0]) * S, Hpx = (vy[1] - vy[0]) * S
    const P = (p) => [(p[0] - vx[0]) * S, (vy[1] - p[1]) * S]
    const sd = (d) => V.unit([d[0], -d[1]]) // a world direction on screen
    const worldRect = [vx[0], vx[1], vy[0], vy[1]]
    const inView = (p) => p[0] >= vx[0] - 1e-9 && p[0] <= vx[1] + 1e-9 && p[1] >= vy[0] - 1e-9 && p[1] <= vy[1] + 1e-9
    const far = 4 * Math.max(vx[1] - vx[0], vy[1] - vy[0]) + 4 * Math.max(...[...vx, ...vy].map(Math.abs))
    /** The visible part of the infinite line through `at` along `u`, in screen px, or null. */
    const visible = (at, u) => {
      const seg = clipSegment(W.sub(at, W.mul(u, far)), W.add(at, W.mul(u, far)), worldRect)
      return seg && seg.map(P)
    }

    const cv = new Canvas()
    cv.ext.push([0, 0], [Wpx, Hpx])
    const labels = [] // placed after every stroke
    const col = (s, amt) => (s.color ? color(s.color) : amt >= 0 ? theme.positive : theme.negative)

    // Sources.
    const glyph = (c, sign, stroke, size = 3.5) => {
      const d = `M${c[0] - size} ${c[1]}L${c[0] + size} ${c[1]}` + (sign > 0 ? `M${c[0]} ${c[1] - size}L${c[0]} ${c[1] + size}` : '')
      cv.mid.push(el('path', { d, stroke, 'stroke-width': 1.5, 'stroke-linecap': 'round' }))
    }
    /** A charged straight line on screen from a to b: a thick line with +/− marks on side `n`. */
    const sheet = (a, b, amt, stroke, tag, { width = 3, n, marks = true }) => {
      cv.mid.push(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke, 'stroke-width': width, 'stroke-linecap': 'butt' }))
      cv.trace([a, b], tag)
      if (!marks) return
      const L = V.len(V.sub(b, a)), t = V.unit(V.sub(b, a)), side = n ?? V.perp(t)
      for (let k = 14; k < L - 6; k += 24) {
        const c = V.add(V.add(a, V.mul(t, k)), V.mul(side, width / 2 + 6))
        glyph(c, Math.sign(amt), stroke)
        cv.trace(circlePoly(c, 4, 6), tag, 1, true)
      }
    }
    const alongCands = (a, b, n) => {
      const out = []
      for (const f of [0.12, 0.88, 0.25, 0.75, 0.5]) for (const s of [n, V.mul(n, -1)]) {
        out.push((w, h) => V.add(V.add(a, V.mul(V.sub(b, a), f)), V.mul(s, 13 + extent(s, w, h))))
      }
      return out
    }
    const viewCenter = [Wpx / 2, Hpx / 2]
    const away = (a, b) => { // the screen normal of a-b pointing away from the view's center
      const n = V.perp(V.unit(V.sub(b, a)))
      return V.dot(V.sub(viewCenter, V.mid(a, b)), n) > 0 ? V.mul(n, -1) : n
    }
    const sourceDesc = []
    drawn.forEach((s, i) => {
      const tag = `s:${i}`, hl = s.id !== undefined && highlight.has(s.id)
      const stroke = col(s, s.amt), w = hl ? 4.5 : 3
      if (s.type === 'point' || (s.type === 'line' && !s.u)) {
        const c = P(s.at), r = s.type === 'point' ? 9 : 7
        if (!inView(s.at)) diag.warn(`${s.path}.at`, 'this source is outside the view; widen view or move it')
        cv.mid.push(el('circle', { cx: c[0], cy: c[1], r, fill: stroke, 'fill-opacity': 0.22, stroke, 'stroke-width': hl ? 2.5 : 1.5 }))
        glyph(c, Math.sign(s.amt), stroke, r * 0.45)
        cv.trace(circlePoly(c, r + 1, 16), tag, 1, true)
        cv.fill(circlePoly(c, r, 12), tag, 1)
        if (s.label !== false) labels.push({ label: s.label ?? si(s.amt, s.unit), size: fs, fill: stroke, cands: ringCands(c, r + 4, [0.7, -0.7]), own: tag })
        sourceDesc.push(`${s.type === 'point' ? 'point' : 'line (end-on)'} ${si(s.amt, s.unit, false)} at (${fmt(s.at[0])}, ${fmt(s.at[1])})`)
      } else if (s.type === 'segment') {
        const seg = clipSegment(s.a, s.b, worldRect)
        if (!seg) { diag.warn(s.path, 'this segment is outside the view'); return }
        const [a, b] = seg.map(P)
        sheet(a, b, s.amt, stroke, tag, { width: w, n: away(a, b) })
        if (s.label !== false) labels.push({ label: s.label ?? si(s.amt, s.unit), size: fs, fill: stroke, cands: alongCands(a, b, away(a, b)), own: tag })
        sourceDesc.push(`segment ${si(s.amt, s.unit, false)} from (${fmt(s.a[0])}, ${fmt(s.a[1])}) to (${fmt(s.b[0])}, ${fmt(s.b[1])})`)
      } else if (s.type === 'plates') {
        const e = sd(s.e)
        const names = Array.isArray(s.label) ? s.label : [s.label ?? si(Math.abs(s.amt), s.unit), s.label === undefined ? si(-Math.abs(s.amt), s.unit) : undefined]
        s.plates.forEach((p, k) => {
          const seg = visible(p.at, s.u)
          if (!seg) { diag.warn(s.path, 'a plate is outside the view; widen view'); return }
          const [a, b] = seg
          // Marks on the inner face: the + plate's toward E, the − plate's against it.
          sheet(a, b, p.amt, col(s, p.amt), tag, { width: w + 1, n: k === 0 ? e : V.mul(e, -1) })
          const outward = k === 0 ? V.mul(e, -1) : e
          if (names[k] && s.label !== false) labels.push({ label: names[k], size: fs, fill: col(s, p.amt), cands: alongCands(a, b, outward).filter((_, j) => j % 2 === 0), own: tag })
        })
        sourceDesc.push(`plates ±${si(Math.abs(s.amt), s.unit, false).slice(1)}, gap ${fmt(s.gap)} ${unit} (E = σ/ε₀ = ${fmt(Math.abs(s.amt) / EPS0)} V/m between, 0 outside)`)
      } else {
        const seg = visible(s.at, s.u)
        const kind = s.type === 'plane' ? 'plane' : 'line'
        if (!seg) { diag.warn(s.path, `this ${kind} is outside the view; widen view or move its at`); return }
        const [a, b] = seg
        sheet(a, b, s.amt, stroke, tag, { width: s.type === 'plane' ? w : w - 1, n: away(a, b) })
        if (s.label !== false) labels.push({ label: s.label ?? si(s.amt, s.unit), size: fs, fill: stroke, cands: alongCands(a, b, away(a, b)), own: tag })
        sourceDesc.push(s.type === 'plane'
          ? `plane ${si(s.amt, s.unit, false)} at ${fmt(s.deg)}° (E = σ/2ε₀ = ${fmt(Math.abs(s.amt) / (2 * EPS0))} V/m)`
          : `line ${si(s.amt, s.unit, false)} in the page at ${fmt(s.deg)}°`)
      }
    })

    // Field at each point; a point on a source has no E.
    const onSource = (p) => simple.find((s) => distTo(s, W.mul(p, lu ?? 1)) < 1e-9 * (lu ?? 1) * Math.max(1, ...[...vx, ...vy].map(Math.abs)))
    for (const p of points.values()) {
      if (onSource(p.at)) { diag.warn(p.path, `point ${p.name} sits on a source, where E and V are undefined; move it off`); p.bad = true; continue }
      const f = F(p.at)
      p.E = f.E; p.V = f.V; p.Emag = W.len(f.E)
      if (!inView(p.at)) diag.warn(p.path, `point ${p.name} is outside the view; widen view`)
    }

    // Potential reference: a point, or each source's own zero when it is a natural one.
    let ref = null, refText = null
    if (spec.ref !== undefined) {
      const rp = point(spec.ref, 'ref')
      if (!rp.bad) { ref = rp.V; refText = `V = 0 at ${rp.name}` }
    } else if (drawn.every((s) => s.type === 'point' || s.type === 'segment')) { ref = 0; refText = 'V = 0 at infinity' }
    else if (drawn.length === 1 && drawn[0].type === 'plane') { ref = 0; refText = 'V = 0 on the plane' }
    else if (drawn.length === 1 && drawn[0].type === 'plates') { ref = 0; refText = 'V = 0 midway between the plates' }

    // Equipotentials.
    const eqColor = color('teal')
    const eqSpec = spec.equipotentials === true ? { count: 6 } : spec.equipotentials
    const levels = []
    if (eqSpec) {
      if (typeof eqSpec !== 'object' || Array.isArray(eqSpec)) throw new SpecError('equipotentials', 'equipotentials is true or {"through": ["A", "B"], "values": [V...], "count": 6, "labels": true}')
      const scaleV = Math.max(1e-12, ...[...points.values()].filter((p) => !p.bad).map((p) => Math.abs(p.V)))
      for (const [k, n] of (eqSpec.through ?? []).entries()) {
        const p = point(n, `equipotentials.through[${k}]`)
        if (p.bad) continue
        const same = levels.find((l) => l.names && Math.abs(l.v - p.V) <= 1e-9 * scaleV)
        if (same) same.names.push(p.name)
        else levels.push({ v: p.V, names: [p.name] })
      }
      if (eqSpec.values !== undefined) {
        if (ref === null) diag.warn('equipotentials.values', 'values need a zero of potential: set "ref" to a point name (V = 0 there)')
        else for (const [k, x] of eqSpec.values.entries()) levels.push({ v: val(x, env, `equipotentials.values[${k}]`) + ref, value: true })
      }
      if (eqSpec.count) {
        const vs = []
        for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) {
          const p = [vx[0] + ((vx[1] - vx[0]) * i) / 40, vy[0] + ((vy[1] - vy[0]) * j) / 40]
          if (masked(p)) continue
          const v = F(p).V
          if (Number.isFinite(v)) vs.push(v)
        }
        vs.sort((a, b) => a - b)
        const lo = vs[Math.floor(vs.length * 0.06)], hi = vs[Math.floor(vs.length * 0.94)]
        if (hi > lo) for (let k = 0; k < eqSpec.count; k++) levels.push({ v: lo + ((hi - lo) * (k + 0.5)) / eqSpec.count, value: true })
      }
    }
    // Contours skip a small disk around each point charge (V is singular there).
    function masked(p) {
      for (const s of drawn) if ((s.type === 'point' || (s.type === 'line' && !s.u)) && V.len(V.sub(P(p), P(s.at))) < 11) return true
      return false
    }
    const Vgrid = (x, y) => (masked([x, y]) ? NaN : F([x, y]).V)
    levels.forEach((l, k) => {
      const lines = contours(Vgrid, [vx[0], vx[1], vy[0], vy[1]], l.v, 140).map((ln) => ln.map(P)).filter((ln) => ln.length > 1)
      l.lines = lines
      for (const ln of lines) {
        cv.back.push(el('path', { d: pathD(ln), fill: 'none', stroke: eqColor, 'stroke-width': 1.4, 'stroke-dasharray': '6 4' }))
        cv.trace(ln, `eq:${k}`, 0.35)
      }
      const text = l.names ? l.names.map((n) => sub('V', n)).join(' = ')
        : eqSpec.labels ? `${fmt(l.v - (ref ?? 0))} V` : null
      if (!text || eqSpec.labels === false || !lines.length) return
      // Beside the longest line, near either end.
      const ln = lines.reduce((a, b) => (b.length > a.length ? b : a))
      const cands = []
      for (const f of [0.06, 0.94, 0.15, 0.85, 0.3, 0.7]) {
        const q = ln[Math.min(ln.length - 2, Math.max(0, Math.round(f * (ln.length - 1))))], r = ln[Math.min(ln.length - 1, Math.max(1, Math.round(f * (ln.length - 1)) + 1))]
        const n = V.perp(V.unit(V.sub(r, q)))
        for (const s of [n, V.mul(n, -1)]) cands.push((w, h) => V.add(q, V.mul(s, 5 + extent(s, w, h))))
      }
      labels.push({ label: text, size: fs - 1, fill: eqColor, cands, own: `eq:${k}` })
    })

    // Field lines (before labels, so labels keep off them a little).
    const mode = spec.E ?? 'arrows'
    if (!['arrows', 'lines', 'none'].includes(mode)) throw new SpecError('E', 'E is "arrows" (a grid of small arrows, default), "lines" (field lines), or "none"')
    const Eref = Math.max(1e-30, ...[...points.values()].filter((p) => !p.bad).map((p) => p.Emag), ...gridMags())
    function gridMags() {
      const out = []
      for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) {
        const p = [vx[0] + ((vx[1] - vx[0]) * i) / 8, vy[0] + ((vy[1] - vy[0]) * j) / 8]
        const m = W.len(F(p).E)
        if (Number.isFinite(m)) out.push(m)
      }
      out.sort((a, b) => a - b)
      return out.length ? [out[Math.floor(out.length / 2)]] : []
    }
    let lineCount = 0
    if (mode === 'lines') lineCount = drawFieldLines()

    // Displacements, with the split along and across E.
    const legs = [] // world segments drawn from a point along E (for angle rays)
    const dispFacts = []
    const pairDiffs = []
    ;(spec.displacements ?? []).forEach((d, i) => {
      const path = `displacements[${i}]`
      const A = point(d.from, `${path}.from`), B = point(d.to, `${path}.to`)
      const tag = `d:${i}`, hl = d.id !== undefined && highlight.has(d.id)
      const a = P(A.at), b = P(B.at), dv = W.sub(B.at, A.at), L = W.len(dv)
      if (!(L > 0)) throw new SpecError(path, 'from and to are the same point')
      const tip = V.sub(b, V.mul(V.unit(V.sub(b, a)), 4))
      arrow(cv, a, tip, theme.fg, { width: hl ? 3 : 2, tag, head: 10 })
      let corner = null
      const fact = [`${A.name}→${B.name}: ${fmt(L)} ${unit} at ${fmt(angleOf(dv))}°`]
      if (d.split !== false && !A.bad && A.Emag > 0) {
        const e = W.unit(A.E), dpar = W.dot(dv, e), C = W.add(A.at, W.mul(e, dpar)), dperp = W.len(W.sub(B.at, C))
        const c = P(C), lab = Array.isArray(d.labels) ? d.labels : []
        const fg = theme.fg
        if (Math.abs(dpar) * S > 6) {
          arrow(cv, a, V.sub(c, V.mul(V.unit(V.sub(c, a)), 1)), fg, { width: 1.5, dashed: true, tag: `${tag}p`, head: 8 })
          legs.push({ from: A.name, dir: W.mul(e, Math.sign(dpar)) })
        }
        if (dperp * S > 6) arrow(cv, c, V.sub(b, V.mul(V.unit(V.sub(b, c)), 4)), fg, { width: 1.5, dashed: true, tag: `${tag}q`, head: 8 })
        if (Math.abs(dpar) * S > 10 && dperp * S > 10) {
          const u1 = V.unit(V.sub(a, c)), u2 = V.unit(V.sub(b, c)), k = 7
          const sq = [V.add(c, V.mul(u1, k)), V.add(V.add(c, V.mul(u1, k)), V.mul(u2, k)), V.add(c, V.mul(u2, k))]
          cv.front.push(el('path', { d: pathD(sq), fill: 'none', stroke: fg, 'stroke-width': 1 }))
          cv.trace(sq, `${tag}r`, 0.6)
        }
        corner = c
        const third = (p, q, r) => { const n = V.perp(V.unit(V.sub(q, p))); return V.dot(V.sub(r, V.mid(p, q)), n) > 0 ? V.mul(n, -1) : n }
        const mids = (p, q, out) => [0.5, 0.35, 0.65].flatMap((f) => [out, V.mul(out, -1)].map((s) => (w, h) => V.add(V.add(p, V.mul(V.sub(q, p), f)), V.mul(s, 6 + extent(s, w, h)))))
        const parLabel = lab[0] ?? `d_{\\parallel} = ${fmt(Math.abs(dpar))} ${unit}`
        const perpLabel = lab[1] ?? '\\Delta V = 0'
        if (parLabel !== false && Math.abs(dpar) * S > 6) labels.push({ label: parLabel, size: fs, fill: fg, cands: mids(a, c, third(a, c, b)), own: `${tag}p`, order: 0 })
        if (perpLabel !== false && dperp * S > 6) labels.push({ label: perpLabel, size: fs, fill: fg, cands: mids(c, b, third(c, b, a)), own: `${tag}q`, order: 0 })
        fact.push(`d_∥ = ${fmt(dpar)} ${unit} along E, d_⊥ = ${fmt(dperp)} ${unit}`)
        const uniform = !B.bad && W.len(W.sub(A.E, B.E)) <= 1e-6 * A.Emag
        if (uniform) fact.push(`−E d_∥ = ${fmt(-A.Emag * dpar * (lu ?? 1))} V`)
        else diag.note(path, `the split uses E at ${A.name}; E differs at ${B.name}, so −E d_∥ is not ΔV here`)
      }
      if (d.label !== false) {
        const n = V.perp(V.unit(V.sub(b, a)))
        const out = corner && V.dot(V.sub(corner, V.mid(a, b)), n) > 0 ? V.mul(n, -1) : corner ? n : away(a, b)
        const cands = [0.5, 0.4, 0.6, 0.3, 0.7].flatMap((f) => [out, V.mul(out, -1)].map((s) => (w, h) => V.add(V.add(a, V.mul(V.sub(b, a), f)), V.mul(s, 6 + extent(s, w, h)))))
        labels.push({ label: d.label ?? `${fmt(L)} ${unit}`, size: fs, fill: theme.fg, cands, own: tag, order: 0 })
      }
      dispFacts.push(fact.join(', '))
      pairDiffs.push([A, B])
    })

    // E arrows at points that ask for one.
    for (const p of points.values()) {
      if (!p.showE || p.bad || !(p.Emag > 0)) continue
      const a = P(p.at), d = sd(p.E), b = V.add(a, V.mul(d, 36)), tag = `e:${p.name}`
      arrow(cv, V.add(a, V.mul(d, 4)), b, theme.fg, { width: 2, tag })
      legs.push({ from: p.name, dir: W.unit(p.E) })
      labels.push({ label: sub('E', p.name), size: fs, fill: theme.fg, cands: [(w, h) => V.add(b, V.mul(d, 4 + extent(d, w, h))), ...[V.perp(d), V.mul(V.perp(d), -1)].map((s) => (w, h) => V.add(V.sub(b, V.mul(d, 8)), V.mul(s, 6 + extent(s, w, h))))], own: tag, order: 0 })
    }

    // Dimensions: between two points, or from a point to a source (the perpendicular foot).
    const dimFacts = []
    ;(spec.dims ?? []).forEach((dm, i) => {
      const path = `dims[${i}]`
      const end = (n, p) => {
        if (points.has(n)) return points.get(n).at
        const s = sourceById.get(n)
        if (!s) throw new SpecError(`${path}.${p}`, `"${n}" is no point or source id; ${known()}`)
        return s
      }
      let pa = end(dm.from, 'from'), pb
      if (dm.to === undefined) {
        // A plates id alone: the gap, at the plates' right ends (the lines stand off outward).
        if (pa.type !== 'plates') throw new SpecError(`${path}.to`, 'to is a point name or source id (only a plates id may stand alone: its gap)')
        const segs = pa.plates.map((pl) => visible(pl.at, pa.u))
        if (segs.some((s) => !s)) { diag.warn(path, 'the plates are outside the view'); return }
        const pick = (s) => (s[0][0] > s[1][0] ? s[0] : s[1])
        const q = [vx[0] + pick(segs[0])[0] / S, vy[1] - pick(segs[0])[1] / S]
        const n = W.perp(pa.u)
        pb = W.sub(q, W.mul(n, W.dot(W.sub(q, pa.plates[1].at), n)))
        pa = W.sub(q, W.mul(n, W.dot(W.sub(q, pa.plates[0].at), n)))
      } else pb = end(dm.to, 'to')
      const foot = (s, q) => {
        if (s.type === 'point' || (s.type === 'line' && !s.u)) return s.at
        if (s.type === 'plates') {
          const ps = s.plates.map((pl) => W.sub(q, W.mul(W.perp(s.u), W.dot(W.sub(q, pl.at), W.perp(s.u)))))
          return ps.reduce((x, y) => (W.len(W.sub(q, y)) < W.len(W.sub(q, x)) ? y : x))
        }
        const at = s.at ?? s.a, n = W.perp(s.u)
        return W.sub(q, W.mul(n, W.dot(W.sub(q, at), n)))
      }
      if (!Array.isArray(pa)) { if (!Array.isArray(pb)) throw new SpecError(path, 'a dimension needs a point at one end at least'); pa = foot(pa, pb) }
      if (!Array.isArray(pb)) pb = foot(pb, pa)
      const dist = W.len(W.sub(pb, pa))
      if (!(dist * S > 4)) { diag.warn(path, 'the two ends are at the same spot'); return }
      const a = P(pa), b = P(pb), t = V.unit(V.sub(b, a))
      const o = dm.side === 'left' ? V.mul(V.perp(t), -1) : dm.side === 'right' ? V.perp(t) : away(a, b)
      const off = 14, c = theme.muted
      const a2 = V.add(a, V.mul(o, off)), b2 = V.add(b, V.mul(o, off)), m = V.mid(a2, b2)
      for (const [p, q] of [[a, a2], [b, b2]]) {
        const s0 = V.add(p, V.mul(o, 3)), s1 = V.add(q, V.mul(o, 4))
        cv.back.push(el('line', { x1: s0[0], y1: s0[1], x2: s1[0], y2: s1[1], stroke: c, 'stroke-width': 0.8 }))
        cv.trace([s0, s1], 'dim', 0.6)
      }
      arrow(cv, m, a2, c, { width: 1, head: 7, tag: 'dim' }); arrow(cv, m, b2, c, { width: 1, head: 7, tag: 'dim' })
      const cands = [0.5, 0.35, 0.65].flatMap((f) => [o, V.mul(o, -1)].map((s) => (w, h) => V.add(V.add(a2, V.mul(V.sub(b2, a2), f)), V.mul(s, 3 + extent(s, w, h)))))
      labels.push({ label: dm.label ?? `${fmt(dist)} ${unit}`, size: fs, fill: theme.fg, cands, order: 1 })
      dimFacts.push(`${dm.from}${dm.to === undefined ? ' gap' : `–${dm.to}`} ${fmt(dist)} ${unit}`)
    })

    // Angle marks between two directions at a point.
    ;(spec.angles ?? []).forEach((an, i) => {
      const path = `angles[${i}]`
      const pairOf = (r) => {
        if (typeof r !== 'string') return null
        for (let k = 1; k < r.length; k++) if (points.has(r.slice(0, k)) && points.has(r.slice(k))) return [points.get(r.slice(0, k)), points.get(r.slice(k))]
        return null
      }
      // The vertex: `at`, else the first point of a point pair, else a source's at.
      let at = null
      if (an.at !== undefined) at = points.has(an.at) ? points.get(an.at) : sourceById.get(an.at) ? { at: sourceById.get(an.at).at ?? sourceById.get(an.at).a } : null
      if (an.at !== undefined && !at) throw new SpecError(`${path}.at`, `no point or source "${an.at}"; ${known()}`)
      if (!at) for (const r of [an.from, an.to]) { const pr = pairOf(r); if (pr) { at = pr[0]; break } }
      if (!at) for (const r of [an.from, an.to]) if (sourceById.has(r)) { const s = sourceById.get(r); at = { at: s.at ?? s.a }; break }
      if (!at) throw new SpecError(`${path}.at`, 'say where the angle sits: at is a point name')
      const words = { horizontal: [0, false], right: [0, true], left: [180, true], vertical: [90, false], up: [90, true], down: [270, true] }
      const resolve = (r, key) => {
        if (r === 'E') {
          const E = at.E ?? F(at.at).E
          if (!(W.len(E) > 0)) throw new SpecError(`${path}.${key}`, 'E is zero there, so it has no direction')
          return { deg: angleOf(E), directed: true, ray: !legs.some((l) => l.from === at.name && W.dot(l.dir, W.unit(E)) > 0.999) }
        }
        if (typeof r === 'string' && words[r]) return { deg: words[r][0], directed: words[r][1], ray: true }
        const pr = pairOf(r)
        if (pr) {
          const shown = (spec.displacements ?? []).some((d) => d.from === pr[0].name && d.to === pr[1].name) && pr[0] === at
          return { deg: angleOf(W.sub(pr[1].at, pr[0].at)), directed: true, ray: !shown }
        }
        if (sourceById.has(r)) {
          const s = sourceById.get(r)
          if (s.deg === undefined) throw new SpecError(`${path}.${key}`, `source "${r}" has no direction (a point charge)`)
          const near = simple.some((q) => q.owner === s && distTo(q, W.mul(at.at, lu ?? 1)) * S / (lu ?? 1) < 2)
          return { deg: s.deg, directed: false, ray: !near }
        }
        if (typeof r === 'number' || (typeof r === 'string' && r.trim())) {
          try { return { deg: val(r, env, `${path}.${key}`), directed: true, ray: true } } catch { /* fall through */ }
        }
        throw new SpecError(`${path}.${key}`, `${key} is "E", a point pair like "AB", a source id, horizontal, vertical, up, down, left, right, or degrees`)
      }
      const r1 = resolve(an.from ?? 'horizontal', 'from'), r2 = resolve(an.to, 'to')
      // An undirected line (horizontal, a plane) takes whichever way makes the smaller angle.
      const flip = (fixed, loose) => { if (Math.abs(shortSweep(fixed.deg, loose.deg)) > 90) loose.deg += 180 }
      if (!r2.directed) flip(r1, r2); else if (!r1.directed) flip(r2, r1)
      const sweep = shortSweep(r1.deg, r2.deg)
      const c = P(at.at), R = 24
      for (const r of [r1, r2]) if (r.ray) {
        const z = V.add(c, V.mul(dirOf(r.deg), R + 14))
        cv.back.push(el('line', { x1: c[0], y1: c[1], x2: z[0], y2: z[1], stroke: theme.muted, 'stroke-width': 1, 'stroke-dasharray': '3 3' }))
        cv.trace([c, z], 'ray', 0.5)
      }
      const arc = arcPoints(c, R, r1.deg, r1.deg + sweep)
      cv.front.push(el('path', { d: pathD(arc), fill: 'none', stroke: theme.fg, 'stroke-width': 1.2 }))
      cv.trace(arc, `a:${i}`, 0.8)
      const md = dirOf(r1.deg + sweep / 2)
      labels.push({ label: an.label ?? `${fmt(Math.abs(sweep))}°`, size: fs, fill: theme.fg, cands: [R + 4, R + 14, R + 26].map((rr) => (w, h) => V.add(c, V.mul(md, rr + extent(md, w, h)))), own: `a:${i}`, order: 1 })
    })

    // Points: a dot and the name.
    for (const p of points.values()) {
      const c = P(p.at)
      cv.front.push(el('circle', { cx: c[0], cy: c[1], r: 3.2, fill: theme.fg }))
      cv.trace(circlePoly(c, 4, 10), `p:${p.name}`, 1, true)
      if (p.label !== false) labels.push({ label: p.label, size: fs, fill: theme.fg, cands: ringCands(c, 8, [-0.7, -0.7]), ignore: [`p:${p.name}`], order: 0 })
    }

    labels.sort((x, y) => (x.order ?? 2) - (y.order ?? 2))
    const placed = placeLabels(labels, cv)
    drawLabels(placed, cv, theme)
    const crowded = placed.filter((q) => q.hard).map((q) => q.label)
    if (crowded.length) diag.warn('points', `no clear spot for ${crowded.join(', ')}; the label sits on a backing box. Widen view or move points apart`)

    let arrowCount = 0
    if (mode === 'arrows') arrowCount = drawArrowGrid(placed.map((q) => q.box))

    // Canvas.
    const xs = cv.ext.map((p) => p[0]), ys = cv.ext.map((p) => p[1])
    const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys)
    const body = el('g', { transform: `translate(${(MARGIN - x0).toFixed(1)},${(MARGIN - y0).toFixed(1)})` }, [...cv.back, ...cv.mid, ...cv.front])

    // Summary.
    const parts = [`field: ${sourceDesc.join('; ')}`]
    const good = [...points.values()].filter((p) => !p.bad)
    if (good.length) {
      parts.push(`points ${good.map((p) => `${p.name} (${fmt(p.at[0])}, ${fmt(p.at[1])}) |E| = ${fmt(p.Emag)} V/m${p.Emag > 0 ? ` at ${fmt(angleOf(p.E))}°` : ''}${ref !== null ? `, V = ${fmt(p.V - ref)} V` : ''}`).join('; ')}`)
      if (refText) parts.push(refText)
    }
    const diffs = [], seen = new Set()
    const addDiff = (A, B) => {
      const k = `${A.name}>${B.name}`
      if (A.bad || B.bad || seen.has(k)) return
      seen.add(k)
      diffs.push(`${sub('V', B.name)} − ${sub('V', A.name)} = ${fmt(B.V - A.V)} V`)
    }
    for (let k = 1; k < good.length; k++) addDiff(good[k - 1], good[k])
    for (const [A, B] of pairDiffs) addDiff(A, B)
    if (diffs.length) parts.push(diffs.join(', '))
    if (dispFacts.length) parts.push(dispFacts.join('; '))
    if (dimFacts.length) parts.push(`dims ${dimFacts.join(', ')}`)
    const shown = mode === 'arrows' ? `${arrowCount} field arrows` : mode === 'lines' ? `${lineCount} field lines` : 'no field arrows'
    parts.push(`${shown}, ${levels.length} equipotentials`)
    return { body, width: x1 - x0 + 2 * MARGIN, height: y1 - y0 + 2 * MARGIN, summary: parts.join('; '), alt: 'electric field diagram' }

    /** A uniform grid of short arrows along E, skipping spots near strokes and labels. */
    function drawArrowGrid(boxes) {
      const nx = Math.max(1, Math.floor(Wpx / GRID)), ny = Math.max(1, Math.floor(Hpx / GRID))
      const ox = (Wpx - (nx - 1) * GRID) / 2, oy = (Hpx - (ny - 1) * GRID) / 2
      const cells = []
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const c = [ox + i * GRID, oy + j * GRID], w = [vx[0] + c[0] / S, vy[1] - c[1] / S]
        const E = F(w).E, m = W.len(E)
        if (!Number.isFinite(m) || m <= 1e-9 * Eref) continue
        cells.push({ c, E, m })
      }
      const ms = cells.map((q) => Math.log(q.m)).sort((a, b) => a - b)
      const lo = ms[Math.floor(ms.length * 0.1)] ?? 0, hi = ms[Math.floor(ms.length * 0.9)] ?? 0
      let n = 0
      for (const { c, E, m } of cells) {
        const half = 10, box = [c[0] - half, c[1] - half, c[0] + half, c[1] + half]
        if (boxes.some((b) => b[0] < box[2] + 3 && box[0] < b[2] + 3 && b[1] < box[3] + 3 && box[1] < b[3] + 3)) continue
        if (cv.obs.some(([px, py, , tag]) => !/^(eq|fl)/.test(tag) && px > box[0] - 2 && px < box[2] + 2 && py > box[1] - 2 && py < box[3] + 2)) continue
        const d = sd(E), a = V.sub(c, V.mul(d, 8)), b = V.add(c, V.mul(d, 8))
        const tmp = new Canvas()
        arrow(tmp, a, b, theme.muted, { width: 1.2, head: 6, layer: 'back' })
        const op = hi > lo ? 0.35 + 0.65 * Math.min(1, Math.max(0, (Math.log(m) - lo) / (hi - lo))) : 1
        cv.back.push(op < 1 ? el('g', { opacity: op.toFixed(2) }, tmp.back) : tmp.back.join(''))
        n++
      }
      return n
    }

    /** Field lines from the positive sources (and from negative ones where none arrive). */
    function drawFieldLines() {
      const step = 2 / S
      const dirAt = (p, sg) => { const E = F(p).E, m = W.len(E); return m > 1e-9 * Eref && Number.isFinite(m) ? [(sg * E[0]) / m, (sg * E[1]) / m] : null }
      const lineHit = (p, q) => { // the source a step p→q runs into, if any
        for (const s of simple) {
          if (s.type === 'point' || (s.type === 'line' && !s.u)) { if (V.len(V.sub(P(q), P(W.mul(s.at, 1 / (lu ?? 1))))) < 9) return s; continue }
          const pm = W.mul(p, lu ?? 1), qm = W.mul(q, lu ?? 1)
          const a = sideOf(s, pm), b = sideOf(s, qm)
          if (a * b > 0) continue
          if (s.type === 'segment') { const t = W.dot(W.sub(qm, s.a), s.u); if (t < 0 || t > s.L) continue }
          return s
        }
        return null
      }
      const trace = (seed, sg, from) => {
        const pts = [seed]
        let p = seed, end = null
        for (let k = 0; k < 1600; k++) {
          const k1 = dirAt(p, sg); if (!k1) break
          const k2 = dirAt(W.add(p, W.mul(k1, step / 2)), sg); if (!k2) break
          const k3 = dirAt(W.add(p, W.mul(k2, step / 2)), sg); if (!k3) break
          const k4 = dirAt(W.add(p, W.mul(k3, step)), sg); if (!k4) break
          const q = W.add(p, W.mul(W.add(W.add(k1, W.mul(k2, 2)), W.add(W.mul(k3, 2), k4)), step / 6))
          if (!inView(q)) { const seg = clipSegment(p, q, worldRect); if (seg) pts.push(seg[1]); break }
          const hit = k > 2 ? lineHit(p, q) : null
          if (hit && hit.owner !== from) { end = hit; pts.push(q); break }
          pts.push(q); p = q
        }
        return { pts, end }
      }
      const seeds = [] // [world point, sign, source]
      const charges = drawn.filter((s) => s.type === 'point' || (s.type === 'line' && !s.u))
      for (const t of ['point', 'line']) {
        const group = charges.filter((s) => s.type === t)
        const big = Math.max(...group.map((s) => Math.abs(s.amt)))
        for (const s of group) {
          const n = Math.max(4, Math.round((12 * Math.abs(s.amt)) / big))
          for (let k = 0; k < n; k++) seeds.push([W.add(s.at, W.mul(dirOf(0), 0)), null, s, k, n])
        }
      }
      const out = []
      for (const sd0 of seeds) {
        const [, , s, k, n] = sd0
        const ang = (360 * (k + 0.5)) / n, u = [Math.cos((ang * Math.PI) / 180), Math.sin((ang * Math.PI) / 180)]
        out.push({ seed: W.add(s.at, W.mul(u, 11 / S)), sg: Math.sign(s.amt), s })
      }
      for (const s of drawn) {
        if (s.type === 'point' || (s.type === 'line' && !s.u)) continue
        const lines = s.type === 'plates' ? [{ at: s.plates[0].at, sides: [W.perp(s.u)].map((n) => (W.dot(n, s.e) > 0 ? n : W.mul(n, -1))), sg: 1 }]
          : [{ at: s.at ?? s.a, sides: [W.perp(s.u), W.mul(W.perp(s.u), -1)], sg: Math.sign(s.amt) }]
        for (const ln of lines) {
          const seg = s.type === 'segment' ? clipSegment(s.a, s.b, worldRect) : clipSegment(W.sub(ln.at, W.mul(s.u, far)), W.add(ln.at, W.mul(s.u, far)), worldRect)
          if (!seg) continue
          const L = W.len(W.sub(seg[1], seg[0])) * S
          for (let t = 16; t < L - 8; t += 32) for (const n of ln.sides) {
            out.push({ seed: W.add(W.add(seg[0], W.mul(W.unit(W.sub(seg[1], seg[0])), t / S)), W.mul(n, 3 / S)), sg: ln.sg, s })
          }
        }
      }
      let count = 0
      for (const { seed, sg, s } of out) {
        if (!inView(seed) || !sg) continue
        const { pts, end } = trace(seed, sg, s)
        // A line traced back from a negative source that reaches a positive one is already drawn.
        if (sg < 0 && end && end.amt > 0) continue
        if (pts.length < 3) continue
        const line = (sg < 0 ? [...pts].reverse() : pts).map(P)
        cv.back.push(el('path', { d: pathD(line), fill: 'none', stroke: theme.muted, 'stroke-width': 1.1 }))
        cv.trace(line, 'fl', 0.25)
        // One arrowhead halfway along.
        let total = 0
        for (let k = 1; k < line.length; k++) total += V.len(V.sub(line[k], line[k - 1]))
        let acc = 0
        for (let k = 1; k < line.length; k++) {
          const seglen = V.len(V.sub(line[k], line[k - 1]))
          if (acc + seglen >= total / 2) {
            const d = V.unit(V.sub(line[k], line[k - 1])), c = line[k], nn = V.perp(d)
            const tri = [V.add(c, V.mul(d, 4)), V.add(V.sub(c, V.mul(d, 3)), V.mul(nn, 3)), V.sub(V.sub(c, V.mul(d, 3)), V.mul(nn, 3))]
            cv.back.push(el('path', { d: pathD(tri, true), fill: theme.muted }))
            break
          }
          acc += seglen
        }
        count++
      }
      return count
    }
  },
}
