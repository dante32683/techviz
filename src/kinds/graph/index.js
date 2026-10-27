// graph: graphs for algorithms courses. Edges are written "A-B 4" (undirected) or "A->B 4"
// (directed, weight optional); Graphviz places the nodes and techviz draws them with straight
// edges, weights, and the state of a BFS, DFS, or Dijkstra run computed here, one step per
// visit, beside an optional adjacency list or matrix. The summary has the visit order, levels,
// discovery and finish times, back edges, and shortest distances with their paths.

import { SpecError, Diag } from '../../diag.js'
import { el } from '../../svg.js'
import { color } from '../../theme.js'
import { Canvas, V } from '../fbd/draw.js'
import { placeLabels, drawLabels, extent } from '../fbd/place.js'
import { loadViz, getViz } from '../fsm/engine.js'
import { VAL, IDX, NAME, textW, text, box, arrow, line, finish } from '../ds/draw.js'

const RUNS = ['bfs', 'dfs', 'dijkstra']
const LAYOUTS = { auto: 'neato', circle: 'circo', layered: 'dot' }
const fmt = (d) => (d === Infinity ? '∞' : String(Math.round(d * 1000) / 1000))
const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true })

// ---------------------------------------------------------------- reading the graph

function readGraph(spec) {
  if (!Array.isArray(spec.edges)) throw new SpecError('edges', 'edges is a list like ["A-B 4", "B-C 2"] (undirected) or ["A->B", "B->C"] (directed); the weight is optional')
  const nodes = []
  const add = (n) => { if (!nodes.includes(n)) nodes.push(n) }
  if (spec.nodes !== undefined) {
    if (!Array.isArray(spec.nodes)) throw new SpecError('nodes', 'nodes is a list of names, like ["A", "B", "C"]')
    spec.nodes.forEach((n) => add(String(n)))
  }
  let directed = null
  const edges = spec.edges.map((e, i) => {
    const path = `edges[${i}]`
    const m = /^\s*([A-Za-z0-9_]+)\s*(->|-)\s*([A-Za-z0-9_]+)(?:\s+(-?\d+(?:\.\d+)?))?\s*$/.exec(String(e))
    if (!m) throw new SpecError(path, `"${e}" isn't an edge; write "A-B", "A-B 4", "A->B", or "A->B 4" (names are letters, digits, and _)`)
    const d = m[2] === '->'
    if (directed === null) directed = d
    else if (directed !== d) throw new SpecError(path, 'mix of "-" and "->" edges; a graph is all undirected ("A-B") or all directed ("A->B")')
    add(m[1]); add(m[3])
    return { a: m[1], b: m[3], w: m[4] === undefined ? null : Number(m[4]), i, path }
  })
  const weighted = edges.some((e) => e.w !== null)
  if (weighted) edges.forEach((e) => { if (e.w === null) throw new SpecError(e.path, 'give every edge a weight once one has one (like "A-B 4")') })
  const order = spec.order ?? 'alpha'
  if (!['alpha', 'given'].includes(order)) throw new SpecError('order', 'order is "alpha" (neighbors in name order, default) or "given" (the order of edges)')
  if (spec.nodes === undefined && order === 'alpha') nodes.sort(byName)
  const adj = new Map(nodes.map((n) => [n, []]))
  for (const e of edges) {
    adj.get(e.a).push({ to: e.b, w: e.w ?? 1, e })
    if (!directed) adj.get(e.b).push({ to: e.a, w: e.w ?? 1, e })
  }
  if (order === 'alpha') for (const l of adj.values()) l.sort((x, y) => byName(x.to, y.to))
  return { nodes, edges, directed: !!directed, weighted, adj, order }
}

const edgeKey = (G, a, b) => (G.directed ? `${a}->${b}` : [a, b].sort(byName).join('-'))
const edgeName = (G, e) => `${e.a}${G.directed ? '->' : '-'}${e.b}${e.w !== null ? ` ${e.w}` : ''}`

// ---------------------------------------------------------------- algorithms

/** States of the run: { label, current, done: [nodes], frontier: [nodes], tree: [edge keys], notes: {node: text}, row: {name, items} }. */
function runAlgo(spec, G, diag) {
  const algo = spec.run
  const base = { label: 'graph', current: null, done: [], frontier: [], tree: [], back: [], notes: {}, row: null, active: [] }
  if (algo === undefined) return { states: [base], facts: [] }
  if (!RUNS.includes(algo)) throw new SpecError('run', `run is ${RUNS.join(', ')}`)
  if (spec.start === undefined) throw new SpecError('start', `${algo} needs "start", a node name`)
  const s = String(spec.start)
  if (!G.adj.has(s)) throw new SpecError('start', `no node "${s}"; nodes are ${G.nodes.join(', ')}`)
  const states = []
  const nbrs = (u) => G.adj.get(u)
  const orderText = G.order === 'alpha' ? 'neighbors in name order' : 'neighbors in edge order'

  if (algo === 'bfs') {
    const dist = { [s]: 0 }, parent = {}, order = [], queue = [s]
    states.push({ ...base, label: `bfs from ${s}: enqueue ${s}`, frontier: [s], row: { name: 'queue', items: [s] } })
    while (queue.length) {
      const u = queue.shift(), added = []
      order.push(u)
      for (const { to } of nbrs(u)) if (!(to in dist)) { dist[to] = dist[u] + 1; parent[to] = u; queue.push(to); added.push(to) }
      states.push({
        ...base, label: `visit ${u}${added.length ? `; enqueue ${added.join(', ')}` : ''}`, current: u, done: [...order], frontier: [...queue],
        tree: Object.entries(parent).map(([v, p]) => edgeKey(G, p, v)), notes: Object.fromEntries(order.map((n, k) => [n, String(k + 1)])),
        row: { name: 'queue', items: [...queue] }, active: added.map((v) => edgeKey(G, u, v)),
      })
    }
    const levels = G.nodes.filter((n) => n in dist).map((n) => `${n}:${dist[n]}`)
    const unreached = G.nodes.filter((n) => !(n in dist))
    return { states, facts: [`bfs from ${s} (${orderText}): visit order ${order.join(' ')}`, `levels ${levels.join(' ')}`, `tree edges ${Object.entries(parent).map(([v, p]) => `${p}${G.directed ? '->' : '-'}${v}`).join(', ') || 'none'}`, `unreachable: ${unreached.join(', ') || 'none'}`] }
  }

  if (algo === 'dfs') {
    const d = {}, f = {}, parent = {}, order = [], back = [], backKeys = [], stack = []
    let time = 0
    const times = () => Object.fromEntries(order.map((n) => [n, f[n] ? `${d[n]}/${f[n]}` : `${d[n]}/`]))
    const snap = (label, u, active = []) => states.push({
      ...base, label, current: u, done: Object.keys(f), frontier: stack.filter((x) => x !== u), tree: Object.entries(parent).map(([v, p]) => edgeKey(G, p, v)), back: [...backKeys],
      notes: times(), row: { name: 'stack', items: [...stack] }, active,
    })
    const visit = (u, from) => {
      d[u] = ++time; order.push(u); stack.push(u)
      snap(from ? `${from} → ${u}: discover ${u} (d = ${d[u]})` : `discover ${u} (d = ${d[u]})`, u, from ? [edgeKey(G, from, u)] : [])
      for (const { to } of nbrs(u)) {
        if (!(to in d)) { parent[to] = u; visit(to, u) }
        else if (!(to in f) && (G.directed || parent[u] !== to)) { back.push(`${u}${G.directed ? '->' : '-'}${to}`); backKeys.push(edgeKey(G, u, to)) }
      }
      f[u] = ++time; stack.pop()
      if (spec.detail) snap(`finish ${u} (f = ${f[u]})`, u)
    }
    visit(s, null)
    if (!spec.detail) snap(`done: ${order.join(' ')}`, null)
    const unreached = G.nodes.filter((n) => !(n in d))
    return { states, facts: [`dfs from ${s} (${orderText}, recursive): visit order ${order.join(' ')}`, `d/f ${order.map((n) => `${n}:${d[n]}/${f[n]}`).join(' ')}`, `tree edges ${Object.entries(parent).map(([v, p]) => `${p}${G.directed ? '->' : '-'}${v}`).join(', ') || 'none'}`, `back edges ${back.join(', ') || 'none'} (${back.length ? 'has a cycle' : 'no cycle'} reachable from ${s})`, `unreachable: ${unreached.join(', ') || 'none'}`] }
  }

  // Dijkstra.
  if (!G.weighted) diag.note('run', 'no weights given, so every edge counts 1')
  const neg = G.edges.find((e) => (e.w ?? 1) < 0)
  if (neg) diag.warn(neg.path, `negative weight on ${edgeName(G, neg)}; Dijkstra's distances can be wrong with negative edges (Bellman-Ford handles them)`)
  const dist = Object.fromEntries(G.nodes.map((n) => [n, Infinity])), prev = {}, done = []
  dist[s] = 0
  const notes = () => Object.fromEntries(G.nodes.map((n) => [n, fmt(dist[n])]))
  states.push({ ...base, label: `dijkstra from ${s}: dist ${s} = 0, others ∞`, frontier: [s], notes: notes() })
  for (;;) {
    const open = G.nodes.filter((n) => !done.includes(n) && dist[n] < Infinity)
    if (!open.length) break
    const u = open.reduce((a, b) => (dist[b] < dist[a] || (dist[b] === dist[a] && byName(b, a) < 0) ? b : a))
    done.push(u)
    const relaxed = [], active = []
    for (const { to, w } of nbrs(u)) {
      if (done.includes(to)) continue
      if (dist[u] + w < dist[to]) { relaxed.push(`${to} ${fmt(dist[to])}→${fmt(dist[u] + w)}`); dist[to] = dist[u] + w; prev[to] = u; active.push(edgeKey(G, u, to)) }
    }
    states.push({
      ...base, label: `take ${u} (${fmt(dist[u])}); ${relaxed.length ? `update ${relaxed.join(', ')}` : 'no updates'}`, current: u, done: [...done],
      frontier: G.nodes.filter((n) => !done.includes(n) && dist[n] < Infinity), tree: Object.entries(prev).map(([v, p]) => edgeKey(G, p, v)), notes: notes(), active,
    })
  }
  const pathTo = (n) => { const p = [n]; while (prev[p[0]] !== undefined) p.unshift(prev[p[0]]); return p.join('→') }
  return { states, facts: [`dijkstra from ${s}: ${G.nodes.map((n) => (dist[n] === Infinity ? `${n} ∞ (unreachable)` : `${n} ${fmt(dist[n])}${n === s ? '' : ` (${pathTo(n)})`}`)).join(', ')}`, `order taken ${done.join(' ')}`] }
}

// ---------------------------------------------------------------- drawing

function layout(G, spec, r) {
  const viz = getViz()
  if (!viz) throw new SpecError('kind', 'the Graphviz engine is not loaded; call prepare(spec) or renderAsync() first')
  const engine = LAYOUTS[spec.layout ?? 'auto']
  if (!engine) throw new SpecError('layout', 'layout is "auto" (default), "circle", or "layered" (top to bottom, for directed graphs)')
  const q = (s) => `"${s}"`
  const size = ((2 * r) / 72).toFixed(3)
  const dot = [`${G.directed ? 'digraph' : 'graph'} g {`, `graph [layout=${engine}, overlap=false, splines=false, sep="+12", nodesep=0.5, ranksep=0.55];`,
    `node [shape=circle, fixedsize=true, width=${size}, label=""];`, `edge [len=${G.weighted ? 1.25 : 1.05}];`,
    ...G.nodes.map((n) => `${q(n)};`), ...G.edges.map((e) => `${q(e.a)} ${G.directed ? '->' : '--'} ${q(e.b)};`), '}']
  const g = viz.renderJSON(dot.join('\n'))
  const pos = new Map()
  for (const o of g.objects ?? []) if (o.pos) { const [x, y] = o.pos.split(',').map(Number); pos.set(o.name, [x, -y]) }
  return pos
}

function draw(G, state, spec, theme) {
  const cv = new Canvas()
  const r = Math.max(15, ...G.nodes.map((n) => textW(n, VAL) / 2 + 6))
  const pos = layout(G, spec, r)
  const hl = new Set((spec.highlight ?? []).map(String))
  const done = new Set(state.done), frontier = new Set(state.frontier), tree = new Set(state.tree), active = new Set(state.active), back = new Set(state.back)
  const green = color('green'), amber = color('amber')
  const labels = []

  // Edges: straight, shortened to the circles; a directed pair A->B, B->A splits into two.
  const keys = new Set(G.edges.map((e) => `${e.a}->${e.b}`))
  G.edges.forEach((e) => {
    const k = edgeKey(G, e.a, e.b), tag = `e:${e.i}`
    let a = pos.get(e.a), b = pos.get(e.b)
    if (e.a === e.b) { // self-loop
      const c = V.add(a, [0, -r - 9])
      cv.back.push(el('circle', { cx: c[0], cy: c[1], r: 10, fill: 'none', stroke: theme.fg, 'stroke-width': 1.3 }))
      cv.trace(Array.from({ length: 12 }, (_, i) => V.add(c, [10 * Math.cos(i * Math.PI / 6), 10 * Math.sin(i * Math.PI / 6)])), tag, 0.6, true)
      if (e.w !== null) labels.push({ label: String(e.w), size: IDX + 1, fill: theme.muted, cands: [(w, h) => V.add(c, [0, -10 - h / 2 - 2])], own: tag })
      return
    }
    const d = V.unit(V.sub(b, a)), n = V.perp(d)
    const shift = G.directed && keys.has(`${e.b}->${e.a}`) ? 5 : 0
    a = V.add(V.add(a, V.mul(d, r)), V.mul(n, shift)); b = V.add(V.sub(b, V.mul(d, r)), V.mul(n, shift))
    const on = hl.has(k) || hl.has(`${e.a}-${e.b}`) || active.has(k)
    const stroke = on ? theme.highlight : tree.has(k) ? green : theme.fg
    const width = on || tree.has(k) ? 2.6 : 1.3, dash = back.has(k) && !on ? '5 3' : undefined
    if (G.directed) arrow(cv, [a, b], stroke, { width, head: 9, tag, layer: 'back', dash })
    else line(cv, a, b, stroke, { width, tag, dash })
    if (e.w !== null) {
      // A split pair's weights sit on the outer side of each arrow.
      const sides = shift ? [n] : [n, V.mul(n, -1)]
      const cands = [0.5, 0.38, 0.62].flatMap((f) => sides.map((s) => (w, h) => V.add(V.add(a, V.mul(V.sub(b, a), f)), V.mul(s, 3 + extent(s, w, h)))))
      labels.push({ label: String(e.w), size: IDX + 1, fill: on ? theme.highlight : theme.fg, cands, own: tag })
    }
  })

  // Nodes.
  for (const nm of G.nodes) {
    const [x, y] = pos.get(nm)
    const cur = state.current === nm || hl.has(nm)
    const stroke = cur ? theme.highlight : frontier.has(nm) ? amber : theme.fg
    const fill = cur ? theme.highlight : done.has(nm) ? green : undefined
    cv.mid.push(el('circle', { cx: x, cy: y, r, fill: fill ?? theme.bg ?? 'none', 'fill-opacity': fill ? (cur ? 0.18 : 0.22) : undefined, stroke, 'stroke-width': cur || frontier.has(nm) ? 2.4 : 1.4 }))
    cv.trace(Array.from({ length: 16 }, (_, i) => [x + r * Math.cos(i * Math.PI / 8), y + r * Math.sin(i * Math.PI / 8)]), `n:${nm}`, 1, true)
    cv.fill([[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]], `n:${nm}`, 1)
    text(cv, nm, x, y + 4.5, theme)
  }
  // Node notes (visit order, d/f times, distances) first, then edge weights.
  const center = [...pos.values()].reduce((s, p) => V.add(s, V.mul(p, 1 / pos.size)), [0, 0])
  const noteItems = []
  for (const [nm, t] of Object.entries(state.notes)) {
    const c = pos.get(nm), away = V.unit(V.sub(c, center))
    const first = V.len(away) ? away : [0, -1]
    const cands = []
    for (const k of [0, 1, -1, 2, -2, 3, -3, 4]) {
      const ang = Math.atan2(first[1], first[0]) + (k * Math.PI) / 4, dd = [Math.cos(ang), Math.sin(ang)]
      cands.push((w, h) => V.add(c, V.mul(dd, r + 3 + extent(dd, w, h))))
    }
    noteItems.push({ label: t, size: IDX + 0.5, fill: t === '∞' ? theme.muted : color('teal'), cands })
  }
  drawLabels(placeLabels([...noteItems, ...labels], cv), cv, theme)

  // Below: the BFS queue or DFS stack, then the adjacency views.
  const ys = () => Math.max(...cv.ext.map((p) => p[1]))
  const x0 = Math.min(...[...pos.values()].map((p) => p[0])) - r
  if (state.row) {
    const y = ys() + 12
    text(cv, state.row.name, x0, y + 15, theme, { size: NAME, mono: true, fill: theme.muted, anchor: 'start' })
    const cx = x0 + textW(state.row.name, NAME, true) + 8
    const W = Math.max(24, ...G.nodes.map((n) => textW(n, VAL) + 12))
    if (!state.row.items.length) text(cv, 'empty', cx, y + 15, theme, { size: IDX, fill: theme.faint, anchor: 'start' })
    state.row.items.forEach((it, k) => { box(cv, cx + k * W, y, W, 22, theme, { rx: 0 }); text(cv, it, cx + k * W + W / 2, y + 15.5, theme) })
  }
  const views = [].concat(spec.view ?? [])
  for (const v of views) {
    if (v === 'list') drawList(cv, G, theme, x0, ys() + 22)
    else if (v === 'matrix') drawMatrix(cv, G, theme, x0, ys() + 22)
    else throw new SpecError('view', 'view is "list" (adjacency list), "matrix" (adjacency matrix), or both as a list')
  }
  return finish(cv)
}

function drawList(cv, G, theme, x0, y0) {
  const H = 22, VW = Math.max(24, ...G.nodes.map((n) => textW(n, VAL) + 12))
  const cell = (t) => Math.max(22, textW(t, VAL) + 10)
  G.nodes.forEach((n, i) => {
    const y = y0 + i * (H + 4)
    box(cv, x0, y, VW, H, theme, { rx: 0, tint: theme.muted, opacity: 0.12 })
    text(cv, n, x0 + VW / 2, y + 15.5, theme)
    let x = x0 + VW
    for (const { to, w } of G.adj.get(n)) {
      const parts = G.weighted ? [to, String(w)] : [to]
      const ws = parts.map(cell), tot = ws.reduce((a, b) => a + b, 0)
      arrow(cv, [[x + 2, y + H / 2], [x + 15, y + H / 2]], theme.muted, { width: 1.1, head: 5 })
      x += 16
      box(cv, x, y, tot, H, theme, { rx: 2 })
      let cx = x
      parts.forEach((t, k) => {
        if (k) cv.mid.push(el('line', { x1: cx, y1: y, x2: cx, y2: y + H, stroke: theme.fg, 'stroke-width': 1 }))
        text(cv, t, cx + ws[k] / 2, y + 15.5, theme, { size: k ? IDX + 1 : VAL, fill: k ? theme.muted : theme.fg })
        cx += ws[k]
      })
      x += tot
    }
  })
}

function drawMatrix(cv, G, theme, x0, y0) {
  const n = G.nodes.length
  const w = new Map()
  for (const e of G.edges) { w.set(`${e.a},${e.b}`, e.w ?? 1); if (!G.directed) w.set(`${e.b},${e.a}`, e.w ?? 1) }
  const C = Math.max(24, ...G.nodes.map((m) => textW(m, VAL) + 10), ...[...w.values()].map((v) => textW(String(v), VAL) + 10)), H = 22
  G.nodes.forEach((m, i) => {
    text(cv, m, x0 + C * (i + 1) + C / 2, y0 + 15, theme, { fill: theme.muted })
    text(cv, m, x0 + C / 2, y0 + H * (i + 1) + 15.5, theme, { fill: theme.muted })
  })
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = w.get(`${G.nodes[i]},${G.nodes[j]}`)
    const x = x0 + C * (j + 1), y = y0 + H * (i + 1)
    box(cv, x, y, C, H, theme, { rx: 0, width: 1, stroke: theme.faint })
    const t = v !== undefined ? String(v) : G.weighted ? '' : '0'
    if (t) text(cv, t, x + C / 2, y + 15.5, theme, { fill: v !== undefined ? theme.fg : theme.faint })
  }
}

// ---------------------------------------------------------------- the kind

function facts(G) {
  const deg = G.directed
    ? G.nodes.map((n) => `${n}:${G.edges.filter((e) => e.b === n).length}/${G.adj.get(n).length}`).join(' ')
    : G.nodes.map((n) => `${n}:${G.adj.get(n).length}`).join(' ')
  return `graph (${G.directed ? 'directed' : 'undirected'}${G.weighted ? ', weighted' : ''}): ${G.nodes.length} nodes, ${G.edges.length} edges ${G.edges.map((e) => edgeName(G, e)).join(', ')}; ${G.directed ? 'in/out degree' : 'degree'} ${deg}`
}

export default {
  kind: 'graph',
  fields: ['nodes', 'edges', 'run', 'start', 'order', 'view', 'layout', 'detail', 'highlight'],
  collections: [],
  async prepare() { await loadViz() },
  steps(spec) {
    const G = readGraph(spec)
    const { states } = runAlgo(spec, G, new Diag())
    return states.length > 1 ? states.map((s, k) => ({ label: s.label, __state: k })) : []
  },
  render(spec, { theme, diag }) {
    const G = readGraph(spec)
    if (spec.detail !== undefined && spec.run !== 'dfs') diag.warn('detail', 'detail adds finish steps to a dfs run; other runs already step per visit')
    const { states, facts: runFacts } = runAlgo(spec, G, diag)
    const k = Number.isInteger(spec.__state) ? Math.min(spec.__state, states.length - 1) : states.length - 1
    const out = draw(G, states[k], spec, theme)
    const parts = [facts(G), ...runFacts]
    if (states.length > 1 && k < states.length - 1) parts.push(`showing step ${k + 1} of ${states.length}: ${states[k].label}`)
    return { ...out, summary: parts.join('; '), alt: `${G.directed ? 'directed' : 'undirected'} graph${spec.run ? ` with a ${spec.run} run` : ''}` }
  },
}
