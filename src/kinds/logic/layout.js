// Schematic layout, left to right by logic depth: inputs in column 0, each part one column
// past its deepest driver, outputs in the last column. Wires that skip columns pass through
// as dummy nodes (Sugiyama), the column order is set by barycenter sweeps, heights by an
// ordered least-squares fit (straight wires where the order allows), and each channel
// between columns gets one vertical track per net, ordered to avoid crossings. Feedback
// (a register's output looping back) runs in a lane under the drawing.

import { geom, TOP_LANE, texName } from './symbols.js'
import { measure } from '../../label.js'

const PITCH = 8 // track spacing in a channel
const MIN_CH = 18 // narrowest channel
const IO = 13 // input and output label size

/**
 * Lay out a netlist. Returns { nodes: Map key -> node, wires: [{net, value key, segs, dots}],
 * width, height } with every coordinate absolute.
 */
export function layoutNetlist(nl, { labels = {}, valueRoom = false } = {}) {
  const nodes = new Map()
  const add = (n) => { nodes.set(n.key, n); return n }
  const ioNode = (key, kind, label, extra = {}) => {
    // An output label also shows "= 1" when the circuit is simulated.
    const tw = measure(kind === 'const' ? `\\text{${label}}` : texName(label), IO) + (kind === 'out' && valueRoom && extra.width === 1 ? 30 : 0)
    const w = Math.ceil(tw) + (kind === 'out' ? 10 : 12)
    return add({ key, kind, label, w, h: 0, above: 8, below: 7, pins: kind === 'out' ? { i: { x: 0, y: 0, side: 'L' } } : { o: { x: w, y: 0, side: 'R' } }, ...extra })
  }
  // Layout nets: a driver terminal and sink terminals, each {node, pin}.
  const lnets = []
  const byNet = new Map()
  for (const d of nl.inputs) ioNode(`in:${d.name}`, 'in', labels[d.name] ?? d.name, { width: d.width })
  for (const p of nl.parts) {
    const g = geom(p)
    add({ key: `p:${p.id}`, kind: 'part', part: p, g, w: g.w, h: g.h, above: g.above, below: 0, pins: g.pins })
  }
  for (const n of nl.nets.values()) {
    let drv
    if (n.drivers.length) {
      const d = n.drivers[0]
      drv = d.part ? { node: `p:${d.part}`, pin: d.port } : { node: `in:${d.input}`, pin: 'o' }
    } else drv = { node: ioNode(`in:${n.name}`, 'in', `${n.name}?`).key, pin: 'o' }
    const ln = { net: n.name, width: n.width, drv, extra: n.drivers.slice(1).map((d) => ({ node: `p:${d.part}`, pin: d.port })), sinks: [] }
    lnets.push(ln)
    byNet.set(n.name, ln)
  }
  let ki = 0
  for (const p of nl.parts) {
    for (const q of p.ins) {
      const term = { node: `p:${p.id}`, pin: q.name }
      if (q.r.konst !== undefined) {
        const k = ioNode(`k:${ki++}`, 'const', q.r.text, {})
        lnets.push({ net: null, konst: true, kval: q.r.konst, width: q.r.width ?? (p.ins.length && !q.ctl && p.width) ?? 1, drv: { node: k.key, pin: 'o' }, extra: [], sinks: [term] })
      } else byNet.get(q.r.net).sinks.push(term)
    }
  }
  nl.outputs.forEach((o, i) => {
    const node = ioNode(`out:${i}`, 'out', o.label, { width: o.width })
    node.output = o
    if (o.r.konst !== undefined) {
      const k = ioNode(`k:${ki++}`, 'const', o.r.text, {})
      lnets.push({ net: null, konst: true, kval: o.r.konst, width: 1, drv: { node: k.key, pin: 'o' }, extra: [], sinks: [{ node: node.key, pin: 'i' }] })
    } else byNet.get(o.r.net).sinks.push({ node: node.key, pin: 'i', slice: o.r.hi !== null ? o.r : null })
  })
  // Several tri-state drivers share a net: each joins it like a source.
  for (const ln of lnets) ln.srcs = [ln.drv, ...ln.extra]
  const live = lnets.filter((ln) => ln.sinks.length)

  // --- Layers -------------------------------------------------------------------------
  const succ = new Map([...nodes.keys()].map((k) => [k, []]))
  for (const ln of live) for (const s of ln.srcs) for (const t of ln.sinks) succ.get(s.node).push({ to: t.node, ln, t })
  // Back edges. A loop through a register is cut at the register's output, so the register
  // sits right of the logic that feeds it and its output loops back (H&H counters, the PC).
  // Other loops (combinational ones) are cut by a DFS from the inputs.
  const back = new Set()
  const isSeq = (k) => nodes.get(k).kind === 'part' && nodes.get(k).part.seq
  const state = new Map()
  const roots = [...nodes.values()].filter((n) => n.kind === 'in' || n.kind === 'const').concat([...nodes.values()].filter((n) => n.kind === 'part'))
  const dfs = (k) => {
    state.set(k, 1)
    if (!isSeq(k)) {
      for (const e of succ.get(k)) {
        if (state.get(e.to) === 1) back.add(e)
        else if (!state.has(e.to)) dfs(e.to)
      }
    }
    state.set(k, 2)
  }
  for (const r of roots) if (!state.has(r.key)) dfs(r.key)
  const fwdAdj = new Map([...nodes.keys()].map((k) => [k, succ.get(k).filter((e) => !isSeq(k) && !back.has(e)).map((e) => e.to)]))
  const reaches = (from, to) => {
    const seen = new Set([from]), stack = [from]
    while (stack.length) { const k = stack.pop(); if (k === to) return true; for (const w of fwdAdj.get(k)) if (!seen.has(w)) { seen.add(w); stack.push(w) } }
    return false
  }
  for (const n of nodes.values()) {
    if (!isSeq(n.key)) continue
    for (const e of succ.get(n.key)) {
      if (e.to === n.key || reaches(e.to, n.key)) back.add(e)
      else fwdAdj.get(n.key).push(e.to)
    }
  }
  const layer = new Map()
  const preds = new Map([...nodes.keys()].map((k) => [k, []]))
  for (const [k, es] of succ) for (const e of es) if (!back.has(e)) preds.get(e.to).push(k)
  const depth = (k, seen = new Set()) => {
    if (layer.has(k)) return layer.get(k)
    const n = nodes.get(k)
    if (n.kind === 'in' || seen.has(k)) return 0
    seen.add(k)
    const ps = preds.get(k).filter((u) => nodes.get(u).kind !== 'const')
    const L = ps.length ? Math.max(...ps.map((u) => depth(u, seen))) + 1 : 1
    layer.set(k, L)
    return L
  }
  for (const n of nodes.values()) if (n.kind === 'part') depth(n.key)
  for (const n of nodes.values()) if (n.kind === 'in') layer.set(n.key, 0)
  const parts = [...nodes.values()].filter((n) => n.kind === 'part')
  const last = Math.max(0, ...parts.map((n) => layer.get(n.key))) + 1
  // An output whose net also runs on to later parts is a tap, labeled right after its driver;
  // the rest line up in the last column.
  for (const n of nodes.values()) {
    if (n.kind !== 'out') continue
    layer.set(n.key, last)
    const ln = n.output.r.konst === undefined && byNet.get(n.output.r.net)
    if (!ln || ln.srcs.length > 1) continue
    const d = nodes.get(ln.drv.node)
    const dl = d.kind === 'in' ? 0 : layer.get(d.key)
    if (d.kind === 'part' && ln.sinks.some((t) => nodes.get(t.node).kind === 'part' && layer.get(t.node) > dl && !back.has(succ.get(d.key).find((e) => e.t === t)))) layer.set(n.key, dl + 1)
  }
  // Constants sit one column before their reader.
  for (const ln of live) if (ln.konst) layer.set(ln.drv.node, Math.max(0, Math.min(...ln.sinks.map((t) => layer.get(t.node))) - 1))
  const L = last
  for (const n of nodes.values()) n.layer = layer.get(n.key)

  // --- Dummies and channel terminals --------------------------------------------------
  // For each net and channel c (between columns c and c+1): left terminals (sources in c or
  // the net's dummy in c) and right terminals (sinks in c+1 or its dummy in c+1).
  const channels = Array.from({ length: L }, () => [])
  const backNets = []
  for (const ln of live) {
    const srcLayers = ln.srcs.map((s) => nodes.get(s.node).layer)
    const lo = Math.min(...srcLayers)
    const fwd = [], bwd = []
    for (const t of ln.sinks) (ln.srcs.some((s) => nodes.get(t.node).layer > nodes.get(s.node).layer) ? fwd : bwd).push(t)
    const hi = fwd.length ? Math.max(...fwd.map((t) => nodes.get(t.node).layer)) : lo
    ln.dummies = new Map()
    for (let c = lo + 1; c < hi; c++) {
      if (ln.srcs.some((s) => nodes.get(s.node).layer === c) ) continue
      const d = add({ key: `d:${ln.net ?? ln.drv.node}:${c}`, kind: 'dummy', w: 0, h: 0, above: 3, below: 3, layer: c, pins: { i: { x: 0, y: 0, side: 'L' }, o: { x: 0, y: 0, side: 'R' } }, ln })
      ln.dummies.set(c, d.key)
    }
    for (let c = lo; c < hi; c++) {
      const left = ln.srcs.filter((s) => nodes.get(s.node).layer === c)
      if (ln.dummies.has(c)) left.push({ node: ln.dummies.get(c), pin: 'o' })
      const right = fwd.filter((t) => nodes.get(t.node).layer === c + 1)
      if (ln.dummies.has(c + 1)) right.push({ node: ln.dummies.get(c + 1), pin: 'i' })
      if (left.length && right.length) channels[c].push({ ln, left, right })
    }
    if (bwd.length) {
      const src = ln.srcs.reduce((a, b) => (nodes.get(b.node).layer > nodes.get(a.node).layer ? b : a))
      backNets.push({ ln, src, sinks: bwd })
    }
  }
  // Feedback: a lane in the source's right channel down and left to the sinks' left channels.
  for (const b of backNets) {
    const sc = nodes.get(b.src.node).layer
    let entry = channels[sc].find((e) => e.ln === b.ln)
    if (!entry) { entry = { ln: b.ln, left: [b.src], right: [] }; channels[sc].push(entry) }
    entry.laneOut = b
    b.sinkChans = [...new Set(b.sinks.map((t) => nodes.get(t.node).layer - 1))]
    for (const c of b.sinkChans) {
      let e = channels[c].find((x) => x.ln === b.ln)
      if (!e) { e = { ln: b.ln, left: [], right: [] }; channels[c].push(e) }
      e.right.push(...b.sinks.filter((t) => nodes.get(t.node).layer - 1 === c))
      e.laneIn = b
    }
  }

  // --- Order within columns -----------------------------------------------------------
  const cols = Array.from({ length: L + 1 }, () => [])
  for (const n of nodes.values()) cols[n.layer].push(n)
  const declared = (n) => (n.kind === 'in' ? [...nodes.keys()].indexOf(n.key) : n.kind === 'part' ? nl.parts.indexOf(n.part) : n.kind === 'out' ? Number(n.key.slice(4)) : 1e4)
  for (const col of cols) col.sort((a, b) => declared(a) - declared(b))
  const pinFrac = (n, pin) => {
    const p = n.pins[pin]
    if (!p) return 0
    return n.h ? ((p.side === 'T' ? -2 : p.y) / n.h - 0.5) * 0.6 : 0
  }
  const pos = new Map()
  const index = () => { for (const col of cols) col.forEach((n, i) => pos.set(n.key, i)) }
  index()
  const tpos = (t) => pos.get(t.node) + pinFrac(nodes.get(t.node), t.pin)
  const crossings = () => {
    let x = 0
    for (const ch of channels) {
      const links = []
      for (const e of ch) for (const l of e.left) for (const r of e.right) links.push([tpos(l), tpos(r)])
      for (let i = 0; i < links.length; i++) for (let j = i + 1; j < links.length; j++) if ((links[i][0] - links[j][0]) * (links[i][1] - links[j][1]) < 0) x++
    }
    return x
  }
  const sortCol = (c, fromLeft) => {
    const col = cols[c]
    const bary = new Map()
    const ch = fromLeft ? channels[c - 1] : channels[c]
    if (!ch) return
    const acc = new Map()
    for (const e of ch) {
      const mine = fromLeft ? e.right : e.left, theirs = fromLeft ? e.left : e.right
      for (const m of mine) for (const t of theirs) {
        const a = acc.get(m.node) ?? [0, 0]
        a[0] += tpos(t) - pinFrac(nodes.get(m.node), m.pin); a[1]++
        acc.set(m.node, a)
      }
    }
    for (const n of col) { const a = acc.get(n.key); bary.set(n.key, a ? a[0] / a[1] : pos.get(n.key)) }
    col.sort((a, b) => bary.get(a.key) - bary.get(b.key) || pos.get(a.key) - pos.get(b.key))
    // Inputs and outputs keep the order they were given in.
    for (const kind of ['in', 'out']) {
      const slots = col.map((n, i) => (n.kind === kind ? i : -1)).filter((i) => i >= 0)
      const keep = col.filter((n) => n.kind === kind).sort((a, b) => declared(a) - declared(b))
      slots.forEach((s, i) => { col[s] = keep[i] })
    }
    col.forEach((n, i) => pos.set(n.key, i))
  }
  let best = { x: crossings(), order: cols.map((c) => [...c]) }
  for (let it = 0; it < 8 && best.x > 0; it++) {
    if (it % 2 === 0) for (let c = 1; c <= L; c++) sortCol(c, true)
    else for (let c = L - 1; c >= 0; c--) sortCol(c, false)
    const x = crossings()
    if (x < best.x) best = { x, order: cols.map((c) => [...c]) }
  }
  best.order.forEach((o, c) => { cols[c] = o })
  index()

  // --- Heights ------------------------------------------------------------------------
  // Terminal y relative to its node's top: a top pin is reached along a lane above the body.
  const relY = (t) => {
    const n = nodes.get(t.node), p = n.pins[t.pin]
    if (!p) return 0
    if (p.side !== 'T') return p.y
    const tops = Object.entries(n.pins).filter(([, q]) => q.side === 'T').sort((a, b) => a[1].x - b[1].x)
    const k = tops.findIndex(([name]) => name === t.pin)
    return -(4 + TOP_LANE * k)
  }
  const gap = (a, b) => (a.kind === 'part' && b.kind === 'part' ? 14 : a.kind === 'dummy' && b.kind === 'dummy' ? 7 : 9)
  const sep = (a, b) => a.h + a.below + gap(a, b) + b.above
  for (const col of cols) { let y = 0; col.forEach((n, i) => { if (i) y += sep(col[i - 1], n); n.y = y }) }
  // Top pins turn a corner anyway, so they don't pull on a part's height.
  const sideOf = (t) => nodes.get(t.node).pins[t.pin]?.side
  const place = (c, fromLeft) => {
    const col = cols[c], ch = fromLeft ? channels[c - 1] : channels[c]
    if (!ch) return
    const want = new Map()
    for (const e of ch) {
      const mine = fromLeft ? e.right : e.left, theirs = fromLeft ? e.left : e.right
      for (const m of mine) {
        const n = nodes.get(m.node)
        if (sideOf(m) === 'T') continue
        for (const t of theirs) {
          if (sideOf(t) === 'T') continue
          if (!fromLeft && nodes.get(t.node).kind === 'out' && nodes.get(t.node).layer < L) continue // taps follow, never lead
          const a = want.get(n.key) ?? [0, 0]
          a[0] += nodes.get(t.node).y + relY(t) - relY(m); a[1]++
          want.set(n.key, a)
        }
      }
    }
    const d = col.map((n) => { const a = want.get(n.key); return a ? a[0] / a[1] : n.y })
    // Straight wires matter most for pass-throughs and one-input parts; a tap's label yields.
    const w = col.map((n) => (!want.has(n.key) ? 0.05 : n.kind === 'dummy' ? 3 : n.kind === 'out' && n.layer < L ? 0.01 : Object.values(n.pins).filter((p) => p.side === 'L').length <= 1 ? 2 : 1))
    const S = [0]
    for (let i = 1; i < col.length; i++) S.push(S[i - 1] + sep(col[i - 1], col[i]))
    const z = pava(d.map((v, i) => v - S[i]), w)
    col.forEach((n, i) => { n.y = Math.round(z[i] + S[i]) })
  }
  for (let it = 0; it < 6; it++) {
    for (let c = 1; c <= L; c++) place(c, true)
    for (let c = L - 1; c >= 0; c--) place(c, false)
  }
  for (let c = 1; c <= L; c++) place(c, true)
  // Snap away jogs of a few pixels, which read as mistakes: shift a node to line a wire up
  // exactly when its neighbors leave room and no other wire gains a small jog.
  const snap = (c, fromLeft) => {
    const col = cols[c], ch = fromLeft ? channels[c - 1] : channels[c]
    if (!ch) return
    const links = new Map()
    for (const e of ch) {
      const mine = fromLeft ? e.right : e.left, theirs = fromLeft ? e.left : e.right
      if (mine.length + theirs.length > 2 && !fromLeft) continue
      for (const m of mine) for (const t of theirs) {
        if (sideOf(m) === 'T' || sideOf(t) === 'T') continue
        if (!links.has(m.node)) links.set(m.node, [])
        links.get(m.node).push(nodes.get(t.node).y + relY(t) - relY(m))
      }
    }
    col.forEach((n, i) => {
      const targets = links.get(n.key)
      if (!targets) return
      const score = (y) => targets.reduce((s, t) => s + (Math.abs(t - y) < 0.5 ? 10 : Math.abs(t - y) < 6 ? -5 : 0), 0) - Math.abs(y - n.y) * 0.05
      let best = n.y, bs = score(n.y)
      for (const y of targets) {
        if (Math.abs(y - n.y) > 10) continue
        if (i > 0 && y < col[i - 1].y + sep(col[i - 1], n)) continue
        if (i < col.length - 1 && y + sep(n, col[i + 1]) > col[i + 1].y) continue
        const s = score(y)
        if (s > bs) { best = y; bs = s }
      }
      n.y = best
    })
  }
  for (let pass = 0; pass < 2; pass++) {
    snap(0, false)
    for (let c = 1; c <= L; c++) snap(c, true)
  }

  // --- Columns and channels -----------------------------------------------------------
  const termY = (t) => nodes.get(t.node).y + relY(t)
  const colW = cols.map((col) => Math.max(0, ...col.filter((n) => n.kind !== 'dummy').map((n) => n.w)))
  const top = Math.min(...[...nodes.values()].map((n) => n.y - n.above))
  const bottom = Math.max(...[...nodes.values()].map((n) => n.y + n.h + n.below))
  // Lanes for feedback: the widest runs lowest so lanes nest.
  backNets.sort((a, b) => (Math.max(...a.sinkChans) - nodes.get(a.src.node).layer) - (Math.max(...b.sinkChans) - nodes.get(b.src.node).layer))
  backNets.forEach((b, k) => { b.y = bottom + 10 + k * 8 })
  const routes = channels.map((ch) => routeChannel(ch.map((e) => ({
    e,
    left: [...e.left.map(termY), ...(e.laneOut ? [e.laneOut.y] : [])],
    right: [...e.right.map(termY), ...(e.laneIn ? [e.laneIn.y] : [])],
  }))))
  const chW = routes.map((r) => Math.max(MIN_CH, PITCH * (r.tracks + 1)))
  const colX = [0]
  for (let c = 1; c <= L; c++) colX.push(colX[c - 1] + colW[c - 1] + chW[c - 1])
  for (const n of nodes.values()) {
    const c = n.layer
    n.x = n.kind === 'in' || n.kind === 'const' ? colX[c] + colW[c] - n.w : colX[c]
    if (n.kind === 'dummy') { n.w = colW[c]; n.pins.o.x = colW[c] }
  }

  // --- Wires --------------------------------------------------------------------------
  const wires = new Map(live.map((ln) => [ln, { ln, segs: [] }]))
  const seg = (ln, x1, y1, x2, y2) => { if (Math.abs(x1 - x2) > 0.01 || Math.abs(y1 - y2) > 0.01) wires.get(ln).segs.push([x1, y1, x2, y2]) }
  const pinAbs = (t) => { const n = nodes.get(t.node), p = n.pins[t.pin]; return [n.x + (p?.x ?? 0), n.y + (p?.y ?? 0)] }
  for (const ln of live) {
    // Source stubs to the column's right edge.
    for (const s of ln.srcs) {
      const n = nodes.get(s.node), [x, y] = pinAbs(s)
      seg(ln, x, y, colX[n.layer] + colW[n.layer], y)
      if (n.kind === 'in' || n.kind === 'const') seg(ln, x - 8, y, x, y)
    }
    // Dummies run straight across their column.
    for (const k of ln.dummies.values()) { const d = nodes.get(k); seg(ln, colX[d.layer], d.y, colX[d.layer] + colW[d.layer], d.y) }
    // Sink stubs from the column's left edge (top pins along their lane).
    for (const t of ln.sinks) {
      const n = nodes.get(t.node), [x, y] = pinAbs(t), p = n.pins[t.pin]
      if (n.kind === 'out') { seg(ln, x, y, x + 6, y); continue }
      if (p?.side === 'T') {
        const ly = termY(t)
        seg(ln, colX[n.layer], ly, x, ly)
        seg(ln, x, ly, x, y)
      } else seg(ln, colX[n.layer], y, x, y)
    }
  }
  routes.forEach((r, c) => {
    const x0 = colX[c] + colW[c], x1 = colX[c + 1]
    const trackX = (k) => x0 + Math.round((x1 - x0) * (k + 1) / (r.tracks + 1))
    for (const it of r.items) {
      const ln = it.e.ln
      if (it.track === null) { seg(ln, x0, it.left[0], x1, it.left[0]); continue }
      const tx = trackX(it.track)
      it.e.trackX = tx
      for (const y of it.left) seg(ln, x0, y, tx, y)
      for (const y of it.right) seg(ln, tx, y, x1, y)
      const ys = [...it.left, ...it.right]
      seg(ln, tx, Math.min(...ys), tx, Math.max(...ys))
    }
  })
  for (const b of backNets) {
    const out = channels[nodes.get(b.src.node).layer].find((e) => e.ln === b.ln)
    for (const c of b.sinkChans) {
      const inn = channels[c].find((e) => e.ln === b.ln)
      seg(b.ln, inn.trackX, b.y, out.trackX, b.y)
    }
  }
  const out = []
  for (const w of wires.values()) {
    w.segs = mergeSegs(w.segs)
    w.dots = junctions(w.segs)
    out.push(w)
  }
  const xs = [...nodes.values()].flatMap((n) => [n.x, n.x + n.w])
  const allY = out.flatMap((w) => w.segs.flatMap((s) => [s[1], s[3]]))
  return {
    nodes, wires: out, colX, colW, back: backNets,
    box: [Math.min(...xs), Math.min(top, ...allY), Math.max(...xs, ...out.flatMap((w) => w.segs.flatMap((s) => [s[0], s[2]]))), Math.max(bottom, ...allY)],
  }
}

/** Weighted isotonic regression (pool adjacent violators): non-decreasing z closest to d. */
function pava(d, w) {
  const blocks = []
  d.forEach((v, i) => {
    blocks.push({ v, w: w[i], n: 1 })
    while (blocks.length > 1 && blocks[blocks.length - 2].v > blocks[blocks.length - 1].v) {
      const b = blocks.pop(), a = blocks.pop()
      const W = a.w + b.w
      blocks.push({ v: W ? (a.v * a.w + b.v * b.w) / W : (a.v + b.v) / 2, w: W, n: a.n + b.n })
    }
  })
  return blocks.flatMap((b) => Array(b.n).fill(b.v))
}

/**
 * Tracks for one channel. items: [{e, left: [y], right: [y]}]. A net with one terminal on each
 * side at the same height runs straight; the others each get a track, ordered to minimize
 * crossings and to keep two nets' horizontal runs from lying on top of each other.
 */
function routeChannel(items) {
  const need = items.filter((it) => !(it.left.length === 1 && it.right.length === 1 && Math.abs(it.left[0] - it.right[0]) < 0.5))
  for (const it of items) it.track = null
  const T = need.length
  if (!T) return { items, tracks: 0 }
  const straight = items.filter((it) => !need.includes(it))
  const segsOf = (it, x) => {
    const ys = [...it.left, ...it.right]
    return {
      v: [x, Math.min(...ys), Math.max(...ys)],
      h: [...it.left.map((y) => [0, x, y]), ...it.right.map((y) => [x, T + 1, y])],
    }
  }
  const cost = (order) => {
    const g = order.map((it, k) => segsOf(it, k + 1))
    for (const it of straight) g.push({ v: null, h: [[0, T + 1, it.left[0]]] })
    let c = 0
    for (let i = 0; i < g.length; i++) for (let j = 0; j < g.length; j++) {
      if (i === j) continue
      const a = g[i], b = g[j]
      if (b.v) for (const [x1, x2, y] of a.h) {
        const [vx, y1, y2] = b.v
        if (vx > x1 && vx < x2) {
          if (y > y1 + 3 && y < y2 - 3) c += 1
          else if (y >= y1 - 3 && y <= y2 + 3) c += 40 // runs into another net's corner or end
        }
      }
      if (j > i) for (const [ax1, ax2, ay] of a.h) for (const [bx1, bx2, by] of b.h) if (Math.abs(ay - by) < 4 && ax1 < bx2 && bx1 < ax2) c += 100
    }
    // Short tracks hug the side their wires come from.
    order.forEach((it, k) => { c += 0.01 * Math.abs(k + 0.5 - (it.right.length >= it.left.length ? T * 0.65 : T * 0.35)) })
    return c
  }
  // Start: nets going down sort by where they start, upward nets after, then improve by moves.
  let order = [...need].sort((a, b) => {
    const da = Math.max(...a.right) - Math.min(...a.left), db = Math.max(...b.right) - Math.min(...b.left)
    return (da >= 0) - (db >= 0) || (da >= 0 ? Math.min(...b.left) - Math.min(...a.left) : Math.min(...a.left) - Math.min(...b.left))
  })
  let cur = cost(order)
  for (let pass = 0; pass < 6; pass++) {
    let improved = false
    for (let i = 0; i < T; i++) for (let j = 0; j < T; j++) {
      if (i === j) continue
      const o = [...order]
      const [it] = o.splice(i, 1)
      o.splice(j, 0, it)
      const c = cost(o)
      if (c < cur - 1e-9) { order = o; cur = c; improved = true }
    }
    if (!improved) break
  }
  order.forEach((it, k) => { it.track = k })
  return { items, tracks: T, cost: cur }
}

/** Merge collinear segments that touch or overlap. Segments are [x1, y1, x2, y2], axis-aligned. */
function mergeSegs(segs) {
  const h = new Map(), v = new Map(), out = []
  for (let [x1, y1, x2, y2] of segs) {
    if (Math.abs(y1 - y2) < 0.01) { if (x1 > x2) [x1, x2] = [x2, x1]; const k = y1.toFixed(1); if (!h.has(k)) h.set(k, []); h.get(k).push([x1, x2]) }
    else { if (y1 > y2) [y1, y2] = [y2, y1]; const k = x1.toFixed(1); if (!v.has(k)) v.set(k, []); v.get(k).push([y1, y2]) }
  }
  const merge = (list) => {
    list.sort((a, b) => a[0] - b[0])
    const r = []
    for (const [a, b] of list) { const l = r[r.length - 1]; if (l && a <= l[1] + 0.01) l[1] = Math.max(l[1], b); else r.push([a, b]) }
    return r
  }
  for (const [k, list] of h) for (const [a, b] of merge(list)) out.push([a, Number(k), b, Number(k)])
  for (const [k, list] of v) for (const [a, b] of merge(list)) out.push([Number(k), a, Number(k), b])
  return out
}

/** Junction dots: points where three or more wire ends meet, or a wire ends on another's middle. */
function junctions(segs) {
  const deg = new Map()
  const key = (x, y) => `${x.toFixed(1)},${y.toFixed(1)}`
  const bump = (x, y, d) => { const k = key(x, y); deg.set(k, (deg.get(k) ?? 0) + d) }
  for (const [x1, y1, x2, y2] of segs) { bump(x1, y1, 1); bump(x2, y2, 1) }
  const pts = [...deg.keys()].map((k) => k.split(',').map(Number))
  for (const [x, y] of pts) {
    for (const [x1, y1, x2, y2] of segs) {
      const onH = Math.abs(y1 - y2) < 0.01 && Math.abs(y - y1) < 0.05 && x > Math.min(x1, x2) + 0.05 && x < Math.max(x1, x2) - 0.05
      const onV = Math.abs(x1 - x2) < 0.01 && Math.abs(x - x1) < 0.05 && y > Math.min(y1, y2) + 0.05 && y < Math.max(y1, y2) - 0.05
      if (onH || onV) bump(x, y, 2)
    }
  }
  return [...deg.entries()].filter(([, d]) => d >= 3).map(([k]) => k.split(',').map(Number))
}
