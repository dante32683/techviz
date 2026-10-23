// fsm: state machines (Moore and Mealy) and general directed graphs (raw DOT),
// laid out by Graphviz (viz-js WASM) and drawn here in the theme.

import { SpecError } from '../diag.js'
import { labelSvg, measure, parseLabel } from '../label.js'
import { loadViz, getViz } from './fsm/engine.js'
import { drawGraph } from './fsm/xdot.js'

const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
const plain = (label) => parseLabel(label).map((r) => r.text).join('')
const FONT = 'Helvetica'

const outText = (out) => (out === undefined || out === null ? '' : typeof out === 'object' ? Object.entries(out).map(([k, v]) => `${k}=${v}`).join(', ') : String(out))
const onTokens = (on) => (on === undefined || on === null || String(on).trim() === '' ? null : String(on).split(/[,|]/).map((s) => s.trim()).filter(Boolean))
const WILD = new Set(['*', 'else', 'otherwise', 'default', '-'])

function layout(dot, spec, path) {
  const viz = getViz()
  if (!viz) throw new SpecError('kind', 'the Graphviz engine is not loaded; call prepare(spec) or renderAsync() first')
  const engine = spec.engine ?? 'dot'
  if (!['dot', 'neato', 'circo', 'fdp', 'twopi', 'osage'].includes(engine)) throw new SpecError('engine', 'engine is dot (default), neato, circo, fdp, twopi, or osage')
  try {
    return viz.renderJSON(dot, {
      engine,
      graphAttributes: { fontname: FONT, fontsize: 13, pad: 0 },
      nodeAttributes: { fontname: FONT, fontsize: 13 },
      edgeAttributes: { fontname: FONT, fontsize: 12, arrowsize: 0.7 },
    })
  } catch (err) {
    const msg = (err?.errors ?? []).map((e) => e.message).join('; ') || err?.message || String(err)
    throw new SpecError(path, `Graphviz: ${msg.trim()}`)
  }
}

function renderDot(spec, { theme, diag }) {
  if (typeof spec.dot !== 'string') throw new SpecError('dot', 'dot is a DOT source string like "digraph { a -> b }"')
  for (const k of ['states', 'edges', 'machine', 'inputs', 'complete']) if (spec[k] !== undefined) diag.warn(k, `"${k}" is for state machines; with "dot" it is ignored`)
  const g = layout(spec.dot, spec, 'dot')
  const hl = new Set((spec.highlight ?? []).map(String))
  const out = drawGraph(g, theme, { hlNode: (o) => hl.has(o.name), hlEdge: (e) => e.id !== undefined && hl.has(String(e.id)) })
  const nodes = (g.objects ?? []).slice(g._subgraph_cnt ?? 0)
  const byGvid = new Map((g.objects ?? []).map((o) => [o._gvid, o.name]))
  const edgeList = (g.edges ?? []).map((e) => `${byGvid.get(e.tail)}->${byGvid.get(e.head)}`)
  return { ...out, summary: `dot: ${nodes.length} nodes, ${edgeList.length} edges; ${edgeList.join(', ')}`, alt: 'directed graph' }
}

function renderMachine(spec, { theme, diag }) {
  const states = spec.states
  if (!Array.isArray(states) || !states.length) throw new SpecError('states', 'give "states": [{"id": "IDLE", "init": true}, ...], or "dot" for a general graph')
  const edges = spec.edges ?? []
  if (!Array.isArray(edges)) throw new SpecError('edges', 'edges is a list of {"from", "to", "on"}')
  const machine = spec.machine ?? (states.some((s) => s?.out !== undefined) ? 'moore' : edges.some((e) => e?.out !== undefined) ? 'mealy' : 'plain')
  if (!['moore', 'mealy', 'plain'].includes(machine)) diag.warn('machine', 'machine is "moore" (outputs on states) or "mealy" (outputs on edges)')

  const byId = new Map()
  states.forEach((s, i) => {
    if (!s || s.id === undefined || s.id === '') throw new SpecError(`states[${i}].id`, 'every state needs an "id"')
    if (byId.has(String(s.id))) throw new SpecError(`states[${i}].id`, `state "${s.id}" is listed twice`)
    byId.set(String(s.id), s)
  })
  const known = [...byId.keys()].join(', ')
  edges.forEach((e, i) => {
    for (const end of ['from', 'to']) {
      if (e?.[end] === undefined) throw new SpecError(`edges[${i}].${end}`, `the edge needs "${end}" (a state id)`)
      if (!byId.has(String(e[end]))) throw new SpecError(`edges[${i}].${end}`, `no state "${e[end]}"; states are ${known}`)
    }
  })

  // Outputs belong to states in a Moore machine and to edges in a Mealy one.
  const isMoore = machine === 'moore', isMealy = machine === 'mealy'
  if (isMoore) {
    if (states.some((s) => s.out !== undefined)) states.forEach((s, i) => { if (s.out === undefined) diag.warn(`states[${i}].out`, `Moore state "${s.id}" has no output while others do`) })
    edges.forEach((e, i) => { if (e.out !== undefined) diag.warn(`edges[${i}].out`, 'a Moore machine has outputs on states; move it to the state\'s "out" or use "machine": "mealy"') })
  }
  if (isMealy) {
    states.forEach((s, i) => { if (s.out !== undefined) diag.warn(`states[${i}].out`, 'a Mealy machine has outputs on edges ("out" on each edge); use "machine": "moore" for state outputs') })
    if (edges.some((e) => e.out !== undefined)) edges.forEach((e, i) => { if (e.out === undefined) diag.warn(`edges[${i}].out`, `edge ${e.from} -> ${e.to} has no output while others do`) })
  }

  const inits = states.filter((s) => s.init)
  if (!inits.length) diag.warn('states', 'mark the start state with "init": true')
  if (inits.length > 1) diag.warn('states', `${inits.length} states have "init": true; a machine starts in one state`)

  // Reachability from the start state(s).
  const adj = new Map([...byId.keys()].map((k) => [k, []]))
  for (const e of edges) adj.get(String(e.from)).push(String(e.to))
  const seen = new Set(inits.map((s) => String(s.id)))
  const stack = [...seen]
  while (stack.length) for (const n of adj.get(stack.pop())) if (!seen.has(n)) { seen.add(n); stack.push(n) }
  const unreachable = inits.length ? [...byId.keys()].filter((k) => !seen.has(k)) : []
  for (const k of unreachable) diag.warn(`states[${states.indexOf(byId.get(k))}]`, `state "${k}" can't be reached from ${inits.map((s) => s.id).join(', ')}`)

  // Completeness and determinism over a listed input alphabet.
  if (spec.complete && !Array.isArray(spec.inputs)) diag.warn('inputs', '"complete": true needs "inputs", the list of input values used in "on"')
  if (Array.isArray(spec.inputs)) {
    const alphabet = spec.inputs.map(String)
    for (const [id] of byId) {
      const cover = new Map()
      let wild = false
      edges.forEach((e, i) => {
        if (String(e.from) !== id) return
        const toks = onTokens(e.on)
        if (!toks || toks.some((t) => WILD.has(t))) { wild = true; return }
        for (const t of toks) {
          if (!alphabet.includes(t)) diag.warn(`edges[${i}].on`, `"${t}" is not in inputs (${alphabet.join(', ')})`)
          if (cover.has(t) && cover.get(t) !== String(e.to)) diag.warn(`edges[${i}].on`, `state "${id}" has two transitions on "${t}" (to ${cover.get(t)} and ${e.to})`)
          cover.set(t, String(e.to))
        }
      })
      const missing = wild ? [] : alphabet.filter((t) => !cover.has(t))
      if (spec.complete && missing.length) diag.warn(`states[${states.indexOf(byId.get(id))}]`, `state "${id}" has no transition on ${missing.map((m) => `"${m}"`).join(', ')}; add edges (a self-loop if it stays)`)
    }
  }

  // Labels: Moore states are two lines (name, output); Mealy edges read "in / out".
  // State names are upright words (S0, IDLE) unless they use TeX markup.
  const name = (s) => { const n = String(s.label ?? s.id); return /[_^\\{]/.test(n) ? n : `\\text{${n}}` }
  const stateLines = (s) => [name(s), ...(isMoore && s.out !== undefined ? [outText(s.out)] : [])]
  const edgeLabel = (e) => {
    const on = e.on === undefined ? '' : String(e.on)
    const rhs = [isMealy || e.out !== undefined ? outText(e.out) : '', e.act ?? ''].filter(Boolean).join(', ')
    return rhs ? (on ? `${on} / ${rhs}` : `/ ${rhs}`) : on
  }
  const fs = theme.size
  const widest = Math.max(...states.map((s) => Math.max(...stateLines(s).map((l) => measure(l, fs)))))
  const lines = Math.max(...states.map((s) => stateLines(s).length))
  const diam = Math.max(46, widest + 18, lines * 17 + 18) / 72

  const nid = new Map([...byId.keys()].map((k, i) => [k, `s${i}`]))
  const dot = ['digraph fsm {', `graph [rankdir=${q(spec.rankdir ?? 'LR')}, nodesep=0.45, ranksep=0.55];`,
    `node [shape=circle, fixedsize=true, width=${diam.toFixed(3)}, height=${diam.toFixed(3)}];`]
  states.forEach((s) => {
    const label = stateLines(s).map(plain).join('\n')
    dot.push(`${nid.get(String(s.id))} [label=${q(label)}, shape=${s.accept ? 'doublecircle' : 'circle'}${s.accept ? `, width=${(diam - 0.08).toFixed(3)}, height=${(diam - 0.08).toFixed(3)}` : ''}];`)
  })
  inits.forEach((s, i) => dot.push(`__init${i} [shape=point, style=invis, width=0.01, height=0.01, label=""]; __init${i} -> ${nid.get(String(s.id))} [minlen=1];`))
  edges.forEach((e, i) => {
    const lab = edgeLabel(e)
    dot.push(`${nid.get(String(e.from))} -> ${nid.get(String(e.to))} [id=${q(`e${i}`)}${lab ? `, label=${q(' ' + plain(lab) + ' ')}` : ''}];`)
  })
  dot.push('}')
  const g = layout(dot.join('\n'), spec, 'states')

  const hl = new Set((spec.highlight ?? []).map(String))
  const stateOf = new Map([...nid].map(([k, v]) => [v, byId.get(k)]))
  const out = drawGraph(g, theme, {
    hlNode: (o) => { const s = stateOf.get(o.name); return !!s && hl.has(String(s.id)) },
    hlEdge: (e) => { const ed = edges[Number(String(e.id ?? '').slice(1))]; return !!ed && ed.id !== undefined && hl.has(String(ed.id)) },
    nodeText: (o, op, i, font, on, Y) => {
      const s = stateOf.get(o.name)
      if (!s) return undefined
      const l = stateLines(s)[i]
      if (l === undefined) return undefined
      return labelSvg(l, op.pt[0], Y(op.pt[1]), theme, { size: font.size, fill: i > 0 ? theme.muted : on ? theme.highlight : theme.fg, weight: i === 0 && on ? 'bold' : undefined })
    },
    edgeText: (e, op, i, font, on, Y) => {
      const ed = edges[Number(String(e.id ?? '').slice(1))]
      if (!ed || i > 0) return undefined
      return labelSvg(edgeLabel(ed), op.pt[0], Y(op.pt[1]), theme, { size: font.size, fill: on ? theme.highlight : theme.fg })
    },
  })

  const fmtEdge = (e) => `${e.from} -${edgeLabel(e) || 'always'}-> ${e.to}`
  const outs = isMoore ? `; outputs ${states.map((s) => `${s.id}[${outText(s.out) || '-'}]`).join(' ')}` : ''
  const summary = `fsm ${machine}: ${states.length} states (init ${inits.map((s) => s.id).join(', ') || 'none'}${states.some((s) => s.accept) ? `; accept ${states.filter((s) => s.accept).map((s) => s.id).join(', ')}` : ''}), ${edges.length} transitions: ${edges.map(fmtEdge).join(', ')}${outs}; unreachable: ${unreachable.join(', ') || 'none'}`
  return { ...out, summary, alt: `${machine === 'plain' ? '' : machine + ' '}state machine` }
}

export default {
  kind: 'fsm',
  fields: ['machine', 'states', 'edges', 'inputs', 'complete', 'rankdir', 'engine', 'dot', 'highlight'],
  collections: ['states', 'edges'],
  async prepare() { await loadViz() },
  render(spec, ctx) {
    if (spec.dot !== undefined) return renderDot(spec, ctx)
    return renderMachine(spec, ctx)
  },
}
