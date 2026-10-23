// circuit: schematics drawn turtle-style (each part starts where the last one
// ended), IEC 60617 symbols, with a computed netlist for checking topology.

import { el } from '../svg.js'
import { labelSvg } from '../label.js'
import { color } from '../theme.js'
import { SpecError } from '../diag.js'
import { U, TWO, MULTI, POINT, TYPES, frame, drawTwo, drawMulti, drawGround, arrowHead, plusSign, minusSign, line, polyline, circle } from './circuit/parts.js'
import { Board, block, boxAt, LINE } from './circuit/layout.js'

const KEYS = new Set(['id', 't', 'dir', 'len', 'from', 'at', 'to', 'via', 'label', 'value', 'closed', 'flip', 'pin', 'side'])
const DIRS = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] }
const SIDES = { right: [1, 0], left: [-1, 0], above: [0, -1], below: [0, 1] }
const EPS = 1e-6

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1]]
const mul = (a, k) => [a[0] * k, a[1] * k]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1]
const cross = (a, b) => a[0] * b[1] - a[1] * b[0]
const len = (a) => Math.hypot(a[0], a[1])
const px = (p) => [p[0] * U, p[1] * U]
const snap = (v) => Math.round(v * 1e9) / 1e9
const key = (p) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`
const fmtPt = (p) => `[${+p[0].toFixed(3)}, ${+p[1].toFixed(3)}]`

function dirVec(dir, path) {
  if (typeof dir === 'number' && Number.isFinite(dir)) {
    const a = (dir * Math.PI) / 180
    return [snap(Math.cos(a)), snap(-Math.sin(a))]
  }
  if (DIRS[dir]) return DIRS[dir]
  throw new SpecError(path, `dir is up, down, left, right, or an angle in degrees (0 = right, 90 = up), not ${JSON.stringify(dir)}`)
}

// Point strictly inside segment a-b (grid units)?
function inside(p, a, b) {
  const ab = sub(b, a), ap = sub(p, a)
  const L = len(ab)
  if (L < EPS || Math.abs(cross(ab, ap)) / L > 1e-4) return false
  const t = dot(ap, ab) / (L * L)
  return t * L > 1e-4 && (1 - t) * L > 1e-4
}

function drawBlock(b, R, align, theme, fill) {
  const x = align === 'start' ? R.x0 + 1 : align === 'end' ? R.x1 - 1 : (R.x0 + R.x1) / 2
  return b.lines.map((m, k) => labelSvg(m.text, x, R.y0 + b.top + LINE * k, theme, { anchor: align, fill, middle: true })).join('')
}
// Clearance from a two-terminal part's axis to its side o (px).
const clearance = (q, o) => { const g = TWO[q.t], n = [-q.d[1], q.d[0]], s = dot(o, n); return q.t === 'pot' && s * q.wiper > 0 ? U : s < 0 && g.hw2 ? g.hw2 : g.hw }
const alignFor = (o) => (o[0] > 0.35 ? 'start' : o[0] < -0.35 ? 'end' : 'middle')
// Center of a block of size W x H pushed out from point m along unit o, starting at distance gap.
const pushOut = (m, o, gap, b) => add(m, mul(o, gap + Math.abs(o[0]) * b.W / 2 + Math.abs(o[1]) * b.H / 2))

export default {
  kind: 'circuit',
  fields: ['parts', 'nodes', 'currents', 'voltages', 'loops', 'standard', 'highlight'],
  collections: ['parts'],
  render(spec, { theme, diag }) {
    const list = spec.parts
    if (!Array.isArray(list) || !list.length) throw new SpecError('parts', 'give "parts": a list like [{"id":"V1","t":"V","dir":"up"}, {"id":"R1","t":"R","dir":"right"}]')
    const nodesSpec = spec.nodes ?? {}
    if (typeof nodesSpec !== 'object' || Array.isArray(nodesSpec)) throw new SpecError('nodes', 'nodes maps a name to an anchor: {"a": "R1.start"}')
    const ansi = spec.standard === 'ansi'
    if (spec.standard !== undefined && !['ansi', 'iec'].includes(spec.standard)) diag.warn('standard', 'standard is "iec" (default) or "ansi"')
    const hl = new Set(spec.highlight ?? [])
    const allIds = new Set(list.map((p) => p?.id).filter((v) => typeof v === 'string'))

    // ---- placement ----
    const placed = []
    const byId = new Map()
    let cur = [0, 0], curDir = [1, 0]

    const resolve = (ref, path, depth = 0) => {
      if (Array.isArray(ref)) {
        if (ref.length !== 2 || !ref.every((v) => typeof v === 'number' && Number.isFinite(v))) throw new SpecError(path, 'a point is [x, y] in grid units')
        return ref
      }
      if (typeof ref !== 'string') throw new SpecError(path, 'an anchor is a string like "R1.end" or a node name')
      const dotAt = ref.indexOf('.')
      if (dotAt < 0) {
        const q = byId.get(ref)
        if (q?.cls === 'point') return q.anchors.start
        if (typeof nodesSpec[ref] === 'string' && depth < 4) return resolve(nodesSpec[ref], path, depth + 1)
        throw new SpecError(path, `"${ref}" is not a node name or a point part; write an anchor like "${ref}.end"`)
      }
      const id = ref.slice(0, dotAt), pin = ref.slice(dotAt + 1)
      const q = byId.get(id)
      if (!q) throw new SpecError(path, allIds.has(id) ? `${id} is drawn later; anchors can only name parts drawn before this one` : `no part with id "${id}"${byId.size ? `; ids so far: ${[...byId.keys()].join(', ')}` : ''}`)
      const pt = q.anchors[pin]
      if (!pt) throw new SpecError(path, `${id} has no anchor "${pin}"; use ${Object.keys(q.anchors).join(', ')}`)
      return pt
    }

    const seen = new Set()
    list.forEach((p, i) => {
      const path = `parts[${i}]`
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw new SpecError(path, 'each part is an object like {"id":"R1","t":"R","dir":"right"}')
      const t = p.t
      if (!TYPES.includes(t)) throw new SpecError(`${path}.t`, `unknown part type ${JSON.stringify(t)}; valid types: ${TYPES.join(', ')}`)
      for (const k of Object.keys(p)) if (!KEYS.has(k)) diag.warn(`${path}.${k}`, `parts don't use "${k}"; part fields are ${[...KEYS].join(', ')}`)
      if (p.id !== undefined) {
        if (typeof p.id !== 'string' || /[.\s]/.test(p.id)) throw new SpecError(`${path}.id`, 'an id is a string without dots or spaces, like "R1"')
        if (seen.has(p.id)) throw new SpecError(`${path}.id`, `the id "${p.id}" is used twice`)
        seen.add(p.id)
      }
      if (p.at !== undefined && p.from !== undefined) diag.warn(path, 'give "at" or "from", not both; using "at"')
      const start = p.at !== undefined ? resolve(p.at, `${path}.at`) : p.from !== undefined ? resolve(p.from, `${path}.from`) : cur
      const q = { i, path, p, t, id: p.id ?? `${t}#${i}`, named: p.id !== undefined, anchors: {} }

      if (t === 'wire') {
        q.cls = 'wire'
        let verts
        if (p.to !== undefined) {
          const target = resolve(p.to, `${path}.to`)
          const via = p.via ?? (p.dir === 'up' || p.dir === 'down' ? 'v' : 'h')
          if (!['h', 'v'].includes(via)) throw new SpecError(`${path}.via`, 'via is "h" (horizontal first, default) or "v" (vertical first)')
          const corner = via === 'h' ? [target[0], start[1]] : [start[0], target[1]]
          verts = [start, corner, target].filter((v, k, a) => k === 0 || len(sub(v, a[k - 1])) > EPS)
          if (verts.length < 2) { diag.warn(`${path}.to`, 'the wire starts at its target, so it has no length'); verts = [start, start] }
        } else {
          const d = p.dir !== undefined ? dirVec(p.dir, `${path}.dir`) : curDir
          const L = p.len ?? 1
          if (typeof L !== 'number' || !(L > 0)) throw new SpecError(`${path}.len`, 'len is a positive number of grid units')
          verts = [start, add(start, mul(d, L))]
        }
        q.verts = verts
        q.anchors = { start: verts[0], end: verts[verts.length - 1] }
        cur = q.anchors.end
        const last = sub(verts[verts.length - 1], verts[verts.length - 2])
        if (len(last) > EPS) curDir = mul(last, 1 / len(last))
      } else if (TWO[t]) {
        q.cls = 'two'
        let d, L
        if (p.to !== undefined) {
          const target = resolve(p.to, `${path}.to`)
          const v = sub(target, start)
          L = len(v)
          if (L < EPS) throw new SpecError(`${path}.to`, `${q.id} would start and end at the same point`)
          d = mul(v, 1 / L)
        } else {
          d = p.dir !== undefined ? dirVec(p.dir, `${path}.dir`) : curDir
          L = p.len ?? 3
          if (typeof L !== 'number' || !(L > 0)) throw new SpecError(`${path}.len`, 'len is a positive number of grid units')
        }
        q.a = start; q.b = add(start, mul(d, L)); q.d = d; q.L = L
        q.anchors = { start: q.a, end: q.b, mid: add(q.a, mul(d, L / 2)) }
        const pol = TWO[t].pol
        if (pol === 'd') Object.assign(q.anchors, { a: q.a, k: q.b })
        if (pol === 'v') Object.assign(q.anchors, { plus: q.b, minus: q.a })
        if (t === 'pot') {
          q.wiper = p.flip ? -1 : 1
          const n = [-d[1], d[0]]
          q.anchors.w = add(q.anchors.mid, mul(n, q.wiper))
        }
        if (L * U < TWO[t].body + 8) diag.warn(`${path}.len`, `${q.id} is too short for its symbol; use len ${Math.ceil((TWO[t].body + 8) / U)} or more`)
        cur = q.b; curDir = d
      } else if (MULTI[t]) {
        q.cls = 'multi'
        const m = MULTI[t]
        const d = p.dir !== undefined ? dirVec(p.dir, `${path}.dir`) : [1, 0]
        const n = p.flip ? [d[1], -d[0]] : [-d[1], d[0]]
        const pin = p.pin ?? m.pin
        if (!m.pins[pin]) throw new SpecError(`${path}.pin`, `${t} pins are ${Object.keys(m.pins).join(', ')}`)
        const loc = (uw) => add(mul(d, uw[0]), mul(n, uw[1]))
        const origin = sub(start, loc(m.pins[pin]))
        for (const [name, uw] of Object.entries(m.pins)) q.anchors[name] = add(origin, loc(uw))
        q.origin = origin; q.d = d; q.n = n
        cur = q.anchors[m.next]
      } else {
        q.cls = 'point'
        q.pt = start
        q.anchors = { start }
        q.d = p.dir !== undefined ? dirVec(p.dir, `${path}.dir`) : t === 'ground' ? [0, 1] : null
        cur = start
      }
      placed.push(q)
      byId.set(q.id, q)
    })

    const nodeNames = {}
    for (const [name, ref] of Object.entries(nodesSpec)) nodeNames[name] = resolve(ref, `nodes.${name}`)

    // ---- connectivity ----
    // Pins: every electrical connection point of a part. Markers (dots,
    // terminals) touch nets but don't count toward junction degree.
    const pins = []
    for (const q of placed) {
      if (q.cls === 'two') {
        const pol = TWO[q.t].pol
        const nm = pol === 'v' ? [`${q.id}-`, `${q.id}+`] : pol === 'i' ? [`${q.id}.start`, `${q.id}.end`] : pol === 'd' ? [`${q.id}.a`, `${q.id}.k`] : [q.id, q.id]
        pins.push({ q, pin: 'start', name: nm[0], pt: q.a }, { q, pin: 'end', name: nm[1], pt: q.b })
        if (q.t === 'pot') pins.push({ q, pin: 'w', name: `${q.id}.w`, pt: q.anchors.w })
      } else if (q.cls === 'multi') {
        for (const [pin, pt] of Object.entries(q.anchors)) pins.push({ q, pin, name: `${q.id}.${pin}`, pt })
      } else if (q.cls === 'point' && q.t !== 'label') {
        pins.push({ q, pin: 'start', name: q.id, pt: q.pt, marker: q.t !== 'ground' })
      }
    }
    const pointMap = new Map()
    const at = (pt) => { const k = key(pt); if (!pointMap.has(k)) pointMap.set(k, { k, pt, pins: [], ends: 0, through: 0, markers: 0 }); return pointMap.get(k) }
    for (const pn of pins) { const P = at(pn.pt); P.pins.push(pn); if (pn.marker) P.markers++ }
    const wireSegs = []
    for (const q of placed) if (q.cls === 'wire') for (let k = 1; k < q.verts.length; k++) {
      const a = q.verts[k - 1], b = q.verts[k]
      if (len(sub(b, a)) < EPS) continue
      at(a).ends++; at(b).ends++
      wireSegs.push({ q, a, b })
    }
    const parent = new Map()
    const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k) } return k }
    for (const k of pointMap.keys()) parent.set(k, k)
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(a, b) }
    for (const s of wireSegs) union(key(s.a), key(s.b))
    for (const s of wireSegs) for (const P of pointMap.values()) if (inside(P.pt, s.a, s.b)) { union(P.k, key(s.a)); P.through += 2 }
    // A pin or wire end landing in the middle of a part is drawn but not connected.
    for (const q of placed) if (q.cls === 'two') for (const P of pointMap.values()) if (inside(P.pt, q.a, q.b)) {
      const who = P.pins[0] ? P.pins[0].q : wireSegs.find((s) => key(s.a) === P.k || key(s.b) === P.k)?.q
      if (who && who !== q) P.mid = true
      if (who && who !== q) diag.warn(who.path, `${who.id} touches the middle of ${q.id} at ${fmtPt(P.pt)}, which doesn't connect; end it at ${q.id}.start or ${q.id}.end`)
    }
    const touches = (P) => P.pins.length + P.ends + P.through
    const degree = (P) => P.pins.length - P.markers + P.ends + P.through

    // Dangling ends.
    for (const P of pointMap.values()) {
      if (touches(P) !== 1 || P.mid) continue
      const pn = P.pins[0]
      if (pn) { if (!pn.marker) diag.warn(pn.q.path, `${pn.name}${pn.q.cls === 'two' || pn.q.cls === 'multi' ? ` (${pn.pin})` : ''} at ${fmtPt(P.pt)} touches nothing; connect it with a wire or end the next part there`) }
      else { const w = wireSegs.find((s) => key(s.a) === P.k || key(s.b) === P.k); if (w) diag.warn(w.q.path, `the wire end at ${fmtPt(P.pt)} touches nothing`) }
    }

    // Parts drawn over each other.
    const spans = []
    for (const q of placed) if (q.cls === 'two') spans.push({ q, a: q.a, b: q.b })
    for (const s of wireSegs) spans.push(s)
    for (let x = 0; x < spans.length; x++) for (let y = x + 1; y < spans.length; y++) {
      const A = spans[x], B = spans[y]
      if (A.q === B.q && A.q.cls === 'wire') continue
      const ab = sub(A.b, A.a), L = len(ab)
      if (Math.abs(cross(ab, sub(B.a, A.a))) / L > 1e-4 || Math.abs(cross(ab, sub(B.b, A.a))) / L > 1e-4) continue
      const t1 = dot(sub(B.a, A.a), ab) / L, t2 = dot(sub(B.b, A.a), ab) / L
      const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(L, Math.max(t1, t2))
      if (hi - lo > 1e-4) diag.warn(B.q.path, `${B.q.id} is drawn over ${A.q.id} from ${fmtPt(add(A.a, mul(ab, lo / L)))} to ${fmtPt(add(A.a, mul(ab, hi / L)))}; move it or shorten it`)
    }

    // Nets, named from "nodes", then ground "0", then n1, n2, ... in drawing order.
    const netName = new Map()
    for (const [name, pt] of Object.entries(nodeNames)) {
      const P = pointMap.get(key(pt))
      if (!P) { diag.warn(`nodes.${name}`, 'that anchor touches no pin or wire'); continue }
      const r = find(P.k)
      if (netName.has(r)) diag.warn(`nodes.${name}`, `"${name}" and "${netName.get(r)}" name the same net`)
      else netName.set(r, name)
    }
    const order = []
    for (const pn of pins) { const r = find(key(pn.pt)); if (!order.includes(r)) order.push(r) }
    for (const s of wireSegs) { const r = find(key(s.a)); if (!order.includes(r)) order.push(r) }
    for (const pn of pins) if (pn.q.t === 'ground') { const r = find(key(pn.pt)); if (!netName.has(r)) netName.set(r, '0') }
    let nk = 0
    for (const r of order) if (!netName.has(r)) { do nk++; while ([...netName.values()].includes(`n${nk}`)); netName.set(r, `n${nk}`) }
    const netOf = (pt) => { const P = pointMap.get(key(pt)); return P ? netName.get(find(P.k)) : '?' }

    for (const q of placed) if (q.cls === 'two' && netOf(q.a) === netOf(q.b)) diag.warn(q.path, `${q.id} is shorted: both ends are on net ${netOf(q.a)}`)

    // ---- geometry for layout (px) ----
    const board = new Board()
    const all = placed.flatMap((q) => Object.values(q.anchors)).map(px)
    const cx = (Math.min(...all.map((p) => p[0])) + Math.max(...all.map((p) => p[0]))) / 2
    const cy = (Math.min(...all.map((p) => p[1])) + Math.max(...all.map((p) => p[1]))) / 2
    const terminals = new Set(placed.filter((q) => q.t === 'terminal').map((q) => key(q.pt)))
    const pens = new Map()
    for (const q of placed) {
      const col = hl.has(q.id) ? theme.highlight : theme.fg
      pens.set(q, { col, sw: hl.has(q.id) ? 2.6 : 1.6 })
      if (q.cls === 'wire') for (let k = 1; k < q.verts.length; k++) board.seg(px(q.verts[k - 1]), px(q.verts[k]), 1, q)
      if (q.cls === 'two') {
        const g = TWO[q.t], A = px(q.a), B = px(q.b), Lp = q.L * U, d = q.d
        const b0 = Lp / 2 - g.body / 2, b1 = Lp / 2 + g.body / 2
        const f = frame(A, d)
        board.seg(A, f.T(Math.max(b0, 0), 0), 1, q); board.seg(f.T(Math.min(b1, Lp), 0), B, 1, q)
        board.seg(f.T(b0 + Math.min(g.hw, g.body / 2), 0), f.T(b1 - Math.min(g.hw, g.body / 2), 0), g.hw, q)
        if (q.t === 'pot') board.seg(f.T(Lp / 2, 0), px(q.anchors.w), 2, q)
        if (g.hw2) board.seg(f.T(Lp / 2 - 4, -g.hw2 / 2 - 2), f.T(Lp / 2 + 6, -g.hw2 / 2 - 2), g.hw2 / 2, q)
        if (q.t === 'switch' && !q.p.closed) board.seg(f.T(b0, 0), f.T(b0 + g.body * Math.cos(0.5), -g.body * Math.sin(0.5)), 2, q)
        q.f = f; q.Lp = Lp; q.b0 = b0; q.b1 = b1
      }
      if (q.cls === 'multi') {
        const T = (u, w) => add(px(q.origin), add(mul(q.d, u), mul(q.n, w)))
        q.T = T
        const box = drawMulti(q.t, T, { col: theme.fg, theme }).box
        q.box = { x0: Math.min(...box.map((p) => p[0])), y0: Math.min(...box.map((p) => p[1])), x1: Math.max(...box.map((p) => p[0])), y1: Math.max(...box.map((p) => p[1])) }
        board.rect(q.box, q)
      }
      if (q.cls === 'point') {
        const P = px(q.pt)
        if (q.t === 'ground') { const box = drawGround(P, q.d).box; board.rect({ x0: Math.min(...box.map((p) => p[0])), y0: Math.min(...box.map((p) => p[1])), x1: Math.max(...box.map((p) => p[0])), y1: Math.max(...box.map((p) => p[1])) }, q) }
        if (q.t === 'terminal' || q.t === 'dot') board.rect({ x0: P[0] - 4, y0: P[1] - 4, x1: P[0] + 4, y1: P[1] + 4 }, q)
      }
    }

    // ---- loops (before labels, so labels avoid them) ----
    const loopsOut = []
    const loopSum = []
    ;(spec.loops ?? []).forEach((lp, i) => {
      const path = `loops[${i}]`
      if (!Array.isArray(lp?.in) || lp.in.length < 2) throw new SpecError(`${path}.in`, 'list the ids of the parts around the mesh, like ["V1", "R1", "R2"]')
      const qs = lp.in.map((id, k) => {
        const q = byId.get(id)
        if (!q) throw new SpecError(`${path}.in[${k}]`, `no part with id "${id}"`)
        if (q.cls !== 'two' && q.cls !== 'wire') throw new SpecError(`${path}.in[${k}]`, `${id} is not a two-terminal part or wire`)
        return q
      })
      // Closed mesh: as a graph of nets, every net touched exactly twice, all connected.
      const ends = qs.map((q) => q.cls === 'two' ? [netOf(q.a), netOf(q.b)] : [netOf(q.anchors.start), netOf(q.anchors.end)])
      const deg = {}
      for (const [x, y] of ends) { deg[x] = (deg[x] ?? 0) + 1; deg[y] = (deg[y] ?? 0) + 1 }
      const bad = Object.entries(deg).filter(([, v]) => v !== 2)
      let closed = !bad.length
      if (closed) {
        const reach = new Set([ends[0][0]])
        for (let grow = true; grow; ) { grow = false; for (const [x, y] of ends) if (reach.has(x) !== reach.has(y)) { reach.add(x); reach.add(y); grow = true } }
        closed = reach.size === Object.keys(deg).length
      }
      if (!closed) diag.warn(`${path}.in`, `${lp.in.join(', ')} don't form one closed mesh${bad.length ? ` (net ${bad.map(([n, v]) => `${n} touched ${v}x`).join(', ')}; each net should be touched twice)` : ''}`)
      const ptsIn = qs.flatMap((q) => Object.values(q.anchors)).map(px)
      const x0 = Math.min(...ptsIn.map((p) => p[0])), x1 = Math.max(...ptsIn.map((p) => p[0]))
      const y0 = Math.min(...ptsIn.map((p) => p[1])), y1 = Math.max(...ptsIn.map((p) => p[1]))
      const c = [(x0 + x1) / 2, (y0 + y1) / 2]
      const r = Math.max(11, Math.min(20, Math.min(x1 - x0, y1 - y0) * 0.22))
      const cw = (lp.dir ?? 'cw') === 'cw'
      if (!['cw', 'ccw'].includes(lp.dir ?? 'cw')) diag.warn(`${path}.dir`, 'dir is "cw" or "ccw"')
      board.rect({ x0: c[0] - r - 2, y0: c[1] - r - 2, x1: c[0] + r + 2, y1: c[1] + r + 2 }, `loop${i}`)
      loopsOut.push({ c, r, cw, label: lp.label, col: color(lp.color, i) })
      loopSum.push(`${lp.label ?? `loop ${i + 1}`} ${cw ? 'cw' : 'ccw'} {${lp.in.join(',')}}`)
    })

    // ---- labels ----
    const labelsSvg = []
    const marksSvg = []
    const overlap = (path, what, many = false) => diag.warn(path, `${what} ${many ? 'overlap' : 'overlaps'} a line or another label; lengthen nearby parts${path.startsWith('parts') ? ' or set "side"' : ''}`)
    const outward = (m) => { const v = sub(m, [cx, cy]); return len(v) > 1 ? mul(v, 1 / len(v)) : [0, -1] }
    const labelSide = new Map()

    for (const q of placed) {
      const lines = [q.p.label, q.p.value]
      if (q.t === 'terminal' || q.t === 'label') lines.length = 1
      const b = block(lines, theme.size)
      if (q.cls === 'two') {
        const n = [-q.d[1], q.d[0]]
        const m = px(q.anchors.mid)
        let sides = [n, mul(n, -1)]
        const pref = SIDES[q.p.side]
        if (q.p.side !== undefined && !pref) diag.warn(`${q.path}.side`, 'side is left, right, above, or below')
        if (pref) sides.sort((s1, s2) => dot(s2, pref) - dot(s1, pref))
        else sides.sort((s1, s2) => dot(s2, outward(m)) - dot(s1, outward(m)) || dot(s2, [0.01, -1]) - dot(s1, [0.01, -1]))
        if (pref) sides = [sides[0]]
        if (!b.lines.length) { labelSide.set(q, sides[0]); continue }
        const cands = sides.map((o) => boxAt(b, pushOut(m, o, clearance(q, o) + 5, b)))
        const best = board.choose(cands)
        const o = sides[best.i]
        labelSide.set(q, o)
        if (best.score) overlap(q.path, `the label of ${q.id}`)
        labelsSvg.push(drawBlock(b, best.R, alignFor(o), theme, theme.fg))
      } else if (q.cls === 'multi') {
        if (!b.lines.length) continue
        const B = q.box, mx = (B.x0 + B.x1) / 2, my = (B.y0 + B.y1) / 2
        const cands = [
          [[B.x1 + 6 + b.W / 2, my - (q.t === 'opamp' ? 30 : 0)], 'start'], [[mx, B.y0 - 6 - b.H / 2], 'middle'],
          [[mx, B.y1 + 6 + b.H / 2], 'middle'], [[B.x0 - 6 - b.W / 2, my - 28], 'end'],
        ]
        if (q.t === 'opamp') cands.unshift(cands.splice(1, 1)[0])
        const best = board.choose(cands.map(([c]) => boxAt(b, c)))
        if (best.score) overlap(q.path, `the label of ${q.id}`)
        labelsSvg.push(drawBlock(b, best.R, cands[best.i][1], theme, theme.fg))
      }
    }

    // Point labels (terminals, label parts, nodes): the free spot around a point.
    const around = (P, b, prefer) => {
      const g = 6
      const dirs = [[0, -1], [1, -1], [-1, -1], [1, 1], [-1, 1], [0, 1], [1, 0], [-1, 0]]
      if (prefer) dirs.sort((u, v) => dot(v, prefer) / len(v) - dot(u, prefer) / len(u))
      return dirs.map((o) => ({ o, R: boxAt(b, [P[0] + o[0] * (g + b.W / 2), P[1] + o[1] * (g + b.H / 2)]) }))
    }
    const wireDirAt = (pt) => {
      const s = wireSegs.find((w) => key(w.a) === key(pt) || key(w.b) === key(pt))
      if (s) { const v = key(s.a) === key(pt) ? sub(s.a, s.b) : sub(s.b, s.a); return mul(v, 1 / len(v)) }
      const two = placed.find((q) => q.cls === 'two' && (key(q.a) === key(pt) || key(q.b) === key(pt)))
      if (two) return key(two.a) === key(pt) ? mul(two.d, -1) : two.d
      return null
    }
    for (const q of placed) {
      if (q.t !== 'terminal' && q.t !== 'label') continue
      if (q.p.label === undefined) { if (q.t === 'label') diag.warn(q.path, 'a label part needs "label" text'); continue }
      const b = block([q.p.label], theme.size)
      const P = px(q.pt)
      const prefer = q.d ?? wireDirAt(q.pt) ?? [1, 0]
      const cands = q.t === 'label' && !q.p.dir ? [{ o: [0, 0], R: boxAt(b, P) }] : around(P, b, prefer)
      const best = board.choose(cands.map((c) => c.R))
      if (best.score) overlap(q.path, `"${q.p.label}"`)
      labelsSvg.push(drawBlock(b, best.R, q.t === 'label' && !q.p.dir ? 'middle' : alignFor(cands[best.i].o), theme, theme.fg))
    }

    // Voltages: + and − beside a part's ends, the label between them, opposite the part's labels.
    const voltSum = []
    ;(spec.voltages ?? []).forEach((v, i) => {
      const path = `voltages[${i}]`
      const q = byId.get(v?.across)
      if (!q || q.cls !== 'two') throw new SpecError(`${path}.across`, `"across" names a two-terminal part id${q ? `; ${q.id} is a ${q.t}` : ''}`)
      const b = block([v.label], theme.size)
      const n = [-q.d[1], q.d[0]]
      const ls = labelSide.get(q)
      const sides = ls && q.p.label !== undefined ? [mul(ls, -1), ls] : [n, mul(n, -1)].sort((s1, s2) => dot(s2, outward(px(q.anchors.mid))) - dot(s1, outward(px(q.anchors.mid))))
      // + at the part's own + end for sources, else at its start (passive sign convention).
      const plusAtEnd = TWO[q.t].pol === 'v'
      const flipPol = !!v.reverse !== plusAtEnd
      const m = px(q.anchors.mid)
      const cand = sides.map((o) => {
        const hw = clearance(q, o)
        const across = Math.abs(o[0]) * b.W / 2 + Math.abs(o[1]) * b.H / 2
        const off = hw + 5 + Math.max(4, across)
        const along = Math.abs(q.d[0]) * b.W / 2 + Math.abs(q.d[1]) * b.H / 2
        const s = Math.min(Math.max(TWO[q.t].body / 2 + 2, along + 9), q.Lp / 2 - 3)
        const c = add(m, mul(o, off))
        const pPlus = add(c, mul(q.d, flipPol ? s : -s)), pMinus = add(c, mul(q.d, flipPol ? -s : s))
        return { o, c, pPlus, pMinus, R: b.lines.length ? boxAt(b, c) : null }
      })
      let k = 0, bestScore = Infinity
      cand.forEach((cd, j) => {
        const sR = (p) => ({ x0: p[0] - 4, y0: p[1] - 4, x1: p[0] + 4, y1: p[1] + 4 })
        const s = (cd.R ? board.score(cd.R) : 0) + board.score(sR(cd.pPlus)) + board.score(sR(cd.pMinus))
        if (s < bestScore) { bestScore = s; k = j }
      })
      const cd = cand[k]
      for (const p of [cd.pPlus, cd.pMinus]) board.labels.push({ R: { x0: p[0] - 4, y0: p[1] - 4, x1: p[0] + 4, y1: p[1] + 4 } })
      if (cd.R) board.labels.push({ R: cd.R })
      if (bestScore) overlap(path, `the voltage marks on ${q.id}`, true)
      marksSvg.push(plusSign(cd.pPlus, theme.positive), minusSign(cd.pMinus, theme.negative))
      if (cd.R) labelsSvg.push(drawBlock(b, cd.R, 'middle', theme, theme.fg))
      const pin = (end) => netOf(end ? q.b : q.a)
      voltSum.push(`${v.label ?? q.id} +${pin(flipPol)} -${pin(!flipPol)}`)
    })

    // Currents: an arrowhead on the part's lead (or a wire's longest run), in a palette color.
    const curSum = []
    ;(spec.currents ?? []).forEach((c, i) => {
      const path = `currents[${i}]`
      const q = byId.get(c?.on)
      if (!q || (q.cls !== 'two' && q.cls !== 'wire')) throw new SpecError(`${path}.on`, `"on" names a two-terminal part or a wire with an id${q ? `; ${q.id} is a ${q.t}` : ''}`)
      const col = color(c.color, i + (spec.loops?.length ?? 0))
      let tip, d, from, to
      if (q.cls === 'two') {
        const leadLen = (q.Lp - TWO[q.t].body) / 2
        if (leadLen < 11) diag.warn(path, `${q.id}'s leads are short for a current arrow; give it a larger len`)
        d = c.reverse ? mul(q.d, -1) : q.d
        const u = (q.b1 + q.Lp) / 2 + (c.reverse ? -4.5 : 4.5)
        tip = q.f.T(Math.min(u, q.Lp - 1), 0)
        from = netOf(c.reverse ? q.b : q.a); to = netOf(c.reverse ? q.a : q.b)
      } else {
        let best = null
        for (let k = 1; k < q.verts.length; k++) { const L = len(sub(q.verts[k], q.verts[k - 1])); if (!best || L > best.L) best = { L, a: q.verts[k - 1], b: q.verts[k] } }
        const v = mul(sub(best.b, best.a), 1 / best.L)
        d = c.reverse ? mul(v, -1) : v
        tip = add(px(add(best.a, mul(v, best.L / 2))), mul(d, 4))
        from = netOf(c.reverse ? q.anchors.end : q.anchors.start); to = netOf(c.reverse ? q.anchors.start : q.anchors.end)
      }
      marksSvg.push(arrowHead(tip, d, col, 9, 4))
      const ac = add(tip, mul(d, -4.5))
      board.rect({ x0: ac[0] - 4.5, y0: ac[1] - 4.5, x1: ac[0] + 4.5, y1: ac[1] + 4.5 }, `cur${i}`)
      curSum.push(`${c.label ?? q.id} ${from}→${to}`)
      if (c.label === undefined) return
      const b = block([c.label], theme.size)
      const n = [-d[1], d[0]]
      const m = add(tip, mul(d, -4))
      const sides = [n, mul(n, -1)].sort((s1, s2) => dot(s2, [0.01, -1]) - dot(s1, [0.01, -1]))
      // Beside the arrowhead on either side, then shifted back or forward along the wire.
      const opts = []
      for (const shift of [0, -1, 1]) for (const o of sides) opts.push({ o, c: add(pushOut(m, o, 7.5, b), mul(d, shift * (Math.abs(d[0]) * b.W / 2 + Math.abs(d[1]) * b.H / 2 + 2))) })
      const best = board.choose(opts.map((x) => boxAt(b, x.c)))
      if (best.score) overlap(path, `"${c.label}"`)
      labelsSvg.push(drawBlock(b, best.R, Math.abs(d[0]) > 0.5 ? 'middle' : alignFor(opts[best.i].o), theme, col))
    })

    // Junction dots where three or more conductors meet.
    const dots = []
    for (const P of pointMap.values()) if (degree(P) >= 3 && !P.pins.some((pn) => pn.q.t === 'dot')) dots.push(px(P.pt))
    for (const q of placed) if (q.t === 'dot') dots.push(px(q.pt))

    // Node labels.
    for (const [name, pt] of Object.entries(nodeNames)) {
      const b = block([name], theme.size)
      const cands = around(px(pt), b, [0.3, -1])
      const best = board.choose(cands.map((c) => c.R))
      if (best.score) overlap(`nodes.${name}`, `node label "${name}"`)
      labelsSvg.push(drawBlock(b, best.R, alignFor(cands[best.i].o), theme, theme.fg))
    }

    // ---- draw ----
    const shorten = (a, b) => {
      // Wires end at a terminal's ring, not its center.
      const v = sub(b, a), L = len(v)
      if (L < 8) return [a, b]
      const u = mul(v, 1 / L)
      return [terminals.has(key([a[0] / U, a[1] / U])) ? add(a, mul(u, 3.2)) : a, terminals.has(key([b[0] / U, b[1] / U])) ? sub(b, mul(u, 3.2)) : b]
    }
    const body = []
    const group = (pen, kids) => el('g', { stroke: pen.col, 'stroke-width': pen.sw, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, kids)
    for (const q of placed) {
      const pen = pens.get(q)
      if (q.cls === 'wire') {
        const v = q.verts.map(px)
        if (v.length === 2) { const [a, b] = shorten(v[0], v[1]); body.push(group(pen, [line(a, b)])) }
        else { const [a] = shorten(v[0], v[1]); const [, b] = shorten(v[v.length - 2], v[v.length - 1]); body.push(group(pen, [polyline([a, ...v.slice(1, -1), b])])) }
      } else if (q.cls === 'two') {
        const ls = labelSide.get(q)
        const n = [-q.d[1], q.d[0]]
        const markSide = ls && q.p.label !== undefined ? -Math.sign(dot(ls, n)) || 1 : 1
        const svg = drawTwo(q.t, q.f, q.Lp, {
          col: pen.col, theme, closed: !!q.p.closed, ansi, markSide, wiper: q.wiper, flip: !!q.p.flip,
          trim0: terminals.has(key(q.a)) ? 3.2 : 0, trim1: terminals.has(key(q.b)) ? 3.2 : 0,
        }).svg
        body.push(group(pen, [svg]))
      } else if (q.cls === 'multi') {
        body.push(group(pen, [drawMulti(q.t, q.T, { col: pen.col, theme }).svg]))
      } else if (q.t === 'ground') {
        body.push(group(pen, [drawGround(px(q.pt), q.d).svg]))
      } else if (q.t === 'terminal') {
        body.push(group(pen, [circle(px(q.pt), 3.2)]))
      }
    }
    for (const p of dots) body.push(circle(p, 3, { fill: theme.fg }))
    for (const L of loopsOut) {
      const a0 = (L.cw ? 210 : 150) * Math.PI / 180, sweep = (L.cw ? 1 : -1) * 290 * Math.PI / 180
      const P = (a) => [L.c[0] + L.r * Math.cos(a), L.c[1] + L.r * Math.sin(a)]
      const s = P(a0), e = P(a0 + sweep)
      const tan = L.cw ? [-Math.sin(a0 + sweep), Math.cos(a0 + sweep)] : [Math.sin(a0 + sweep), -Math.cos(a0 + sweep)]
      body.push(el('path', { d: `M${s[0].toFixed(2)} ${s[1].toFixed(2)}A${L.r} ${L.r} 0 1 ${L.cw ? 1 : 0} ${e[0].toFixed(2)} ${e[1].toFixed(2)}`, fill: 'none', stroke: L.col, 'stroke-width': 1.5 }))
      body.push(arrowHead(add(e, mul(tan, 3)), tan, L.col, 8, 3.6))
      if (L.label !== undefined) body.push(labelSvg(L.label, L.c[0], L.c[1], theme, { fill: L.col, middle: true }))
    }
    body.push(...marksSvg, ...labelsSvg)

    // ---- canvas ----
    const bb = board.bounds(dots.map((p) => ({ x0: p[0] - 3, y0: p[1] - 3, x1: p[0] + 3, y1: p[1] + 3 })))
    const M = 14
    const width = Math.ceil(bb.x1 - bb.x0 + 2 * M), height = Math.ceil(bb.y1 - bb.y0 + 2 * M)
    const out = el('g', { transform: `translate(${(M - bb.x0).toFixed(2)},${(M - bb.y0).toFixed(2)})` }, body)

    // ---- summary ----
    const members = new Map()
    for (const pn of pins) {
      if (pn.q.t === 'ground' || ((pn.q.t === 'terminal' || pn.q.t === 'dot') && !pn.q.named)) continue
      const nn = netOf(pn.pt)
      if (!members.has(nn)) members.set(nn, [])
      members.get(nn).push(pn.name)
    }
    const netList = order.map((r) => netName.get(r)).filter((nn, k, a) => a.indexOf(nn) === k)
    const counted = placed.filter((q) => q.cls === 'two' || q.cls === 'multi')
    const switches = placed.filter((q) => q.t === 'switch').map((q) => `${q.id} ${q.p.closed ? 'closed' : 'open'}`)
    const summary = [
      `circuit: ${counted.length} parts; nets: ${netList.map((nn) => `${nn}{${(members.get(nn) ?? []).join(',')}}`).join(' ')}`,
      switches.length ? switches.join(', ') : '',
      curSum.length ? `currents: ${curSum.join(', ')}` : '',
      voltSum.length ? `voltages: ${voltSum.join(', ')}` : '',
      loopSum.length ? `loops: ${loopSum.join(', ')}` : '',
    ].filter(Boolean).join('; ')
    return { body: out, width, height, defs: '', summary, alt: `circuit with ${counted.length} parts` }
  },
}
