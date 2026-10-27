// Linked lists: singly or doubly linked, optionally circular, with sentinel nodes, head and
// tail and cursor pointers, and NULL slashes. Ops are computed on the sequence of nodes and
// relinked; with "detail" an insert or delete is shown one pointer assignment at a time, the
// new or removed node drawn below the row. Stacks and queues on a list reuse it.

import { SpecError } from '../../diag.js'
import { el } from '../../svg.js'
import { color } from '../../theme.js'
import { Canvas } from '../fbd/draw.js'
import { VAL, NAME, textW, text, box, slash, dot, arrow, clipToBox, finish } from './draw.js'
import { readOps, index, values, show, cmp, val } from './ops.js'

const NH = 28 // node height
const PW = 16 // pointer field width

const LIST_OPS = { push_front: 1, push_back: 1, pop_front: 0, pop_back: 0, insert: 3, delete: 1, find: 1, reverse: 0 }
const LIST_HELP = '"push_front 1", "push_back 9", "insert 5 at 2", "insert 5 after 3", "delete 7", "pop_front", "pop_back", "find 7", "reverse"'

/**
 * mode: 'list' | 'stack' | 'queue'. Returns { states, log, cfg, width }.
 * A state: { label, nodes: {id: {v, next, prev, sentinel}}, order: [ids in the row],
 *            float: {id: [leftId, rightId]}, ptrs: {name: id | null}, hl: [ids] }.
 */
export function simulateList(spec, diag, mode = 'list') {
  const key = mode
  const items = values(spec, key, '[3, 7, 9]')
  const double = (spec.links ?? 'single') === 'double'
  if (!['single', 'double'].includes(spec.links ?? 'single')) throw new SpecError('links', 'links is "single" (default) or "double"')
  const circular = !!spec.circular, sentinel = !!spec.sentinel, detail = !!spec.detail
  const names = mode === 'stack' ? { head: 'top', tail: 'tail' } : mode === 'queue' ? { head: 'front', tail: 'rear' } : { head: 'head', tail: 'tail' }
  const showTail = mode === 'queue' || (spec.tail ?? double)
  const cfg = { double, circular, sentinel, names, showTail }

  const nodes = {}
  let nid = 0
  const make = (v, s = false) => { const id = s ? `s${nid++}` : `n${nid++}`; nodes[id] = { v, next: null, prev: null, sentinel: s }; return id }
  const front = sentinel ? [make('', true)] : []
  const back = sentinel && double && !circular ? [make('', true)] : []
  // A stack's items are listed bottom to top; on a list the top is the head.
  let seq = (mode === 'stack' ? [...items].reverse() : items).map((v) => make(v))
  const chain = () => [...front, ...seq, ...back]

  // Links and the head/tail pointers for the current sequence.
  const relink = () => {
    const c = chain()
    c.forEach((id, i) => {
      nodes[id].next = c[i + 1] ?? (circular ? c[0] : null)
      nodes[id].prev = double ? (c[i - 1] ?? (circular ? c[c.length - 1] : null)) : null
    })
    return { head: c[0] ?? null, tail: c[c.length - 1] ?? null }
  }
  let ends = relink()
  const cursors = readCursors(spec)
  const snap = (label, { hl = [], ptrs = {}, float = {}, order = chain() } = {}) => {
    const p = { [names.head]: ends.head }
    if (showTail) p[names.tail] = ends.tail
    for (const [k, i] of Object.entries(cursors)) { const j = i < 0 ? seq.length + i : i; if (seq[j]) p[k] = seq[j] }
    const live = new Set([...order, ...Object.keys(float)])
    const copy = Object.fromEntries(Object.entries(nodes).filter(([id]) => live.has(id)).map(([id, n]) => [id, { ...n }]))
    return { label, nodes: copy, order: [...order], float: { ...float }, ptrs: { ...p, ...ptrs }, hl }
  }
  const states = [snap('start')]
  const log = []

  const verbs = mode === 'stack' ? { push: 1, pop: 0, peek: 0, top: 0 } : mode === 'queue' ? { enqueue: 1, dequeue: 0, push: 1, pop: 0 } : LIST_OPS
  const help = mode === 'stack' ? '"push 4", "pop"' : mode === 'queue' ? '"enqueue 4", "dequeue"' : LIST_HELP
  for (const op of readOps(spec, verbs, help)) {
    let { verb, args } = op
    // Stack and queue ops are list ops at the ends.
    if (mode === 'stack') ({ verb, args } = verb === 'push' ? { verb: 'push_front', args } : verb === 'pop' ? { verb: 'pop_front', args } : { verb: 'peek', args })
    if (mode === 'queue') ({ verb, args } = verb === 'enqueue' || verb === 'push' ? { verb: 'push_back', args } : { verb: 'pop_front', args })
    const label = op.text
    if (verb === 'peek') {
      states.push(snap(seq.length ? `${label} → ${show(nodes[seq[0]].v)}` : `${label}: empty`, { hl: seq.slice(0, 1) }))
      log.push(seq.length ? `${label} → ${show(nodes[seq[0]].v)}` : `${label}: empty`)
      continue
    }
    let at = null, v = null
    if (verb === 'push_front') { at = 0; v = val(args[0]) }
    else if (verb === 'push_back') { at = seq.length; v = val(args[0]) }
    else if (verb === 'insert') {
      v = val(args[0])
      if (args[1] === 'at') at = index(args[2], 0, seq.length, op.path, 'position')
      else if (args[1] === 'after') {
        const k = seq.findIndex((id) => cmp(nodes[id].v, val(args[2])) === 0)
        if (k < 0) { diag.warn(op.path, `no node holds ${args[2]}; nothing inserted`); states.push(snap(`${label}: ${args[2]} not found`)); log.push(`${label}: not found`); continue }
        at = k + 1
      } else throw new SpecError(op.path, `write "insert 5 at 2" (position) or "insert 5 after 3" (after the node holding 3)`)
    }
    if (at !== null) {
      const id = make(v)
      if (detail) states.push(...insertSteps(at, id).map((s) => ({ ...s, label: `${label}: ${s.label}` })))
      seq.splice(at, 0, id)
      ends = relink()
      if (!detail) states.push(snap(label, { hl: [id] }))
      log.push(`${label} → ${chainText(nodes, ends.head, cfg)}`)
      continue
    }
    if (verb === 'find') {
      const x = val(args[0])
      const k = seq.findIndex((id) => cmp(nodes[id].v, x) === 0)
      const visits = k < 0 ? seq.length : k + 1
      if (detail) for (let j = 0; j < visits; j++) states.push(snap(`${label}: ${j ? 'cur = cur->next' : `cur = ${names.head}${sentinel ? '->next' : ''}`}${j === k ? ', found' : ''}`, { ptrs: { cur: seq[j] }, hl: j === k ? [seq[j]] : [] }))
      if (k >= 0 && !detail) states.push(snap(`${label}: found at position ${k}`, { ptrs: { cur: seq[k] }, hl: [seq[k]] }))
      if (k < 0) states.push(snap(`${label}: cur = NULL, not found`, { ptrs: { cur: null } }))
      log.push(`${label}: ${k < 0 ? 'not found' : `found at position ${k}`} after ${visits} node${visits === 1 ? '' : 's'}`)
      continue
    }
    if (verb === 'reverse') {
      seq.reverse()
      ends = relink()
      states.push(snap(label))
      log.push(`reverse → ${chainText(nodes, ends.head, cfg)}`)
      continue
    }
    // Deletions.
    let k
    if (verb === 'pop_front') k = 0
    else if (verb === 'pop_back') k = seq.length - 1
    else k = seq.findIndex((id) => cmp(nodes[id].v, val(args[0])) === 0)
    if (!seq.length || k < 0) {
      const why = !seq.length ? 'the list is empty' : `no node holds ${args[0]}`
      diag.warn(op.path, `${label}: ${why}; nothing removed`)
      states.push(snap(`${label}: ${why}`)); log.push(`${label}: ${why}`)
      continue
    }
    const id = seq[k], gone = nodes[id].v
    const shown = mode === 'list' && verb === 'delete' ? label : `${label} → ${show(gone)}`
    if (detail) states.push(...deleteSteps(k, id).map((s) => ({ ...s, label: `${shown}: ${s.label}` })))
    seq.splice(k, 1)
    ends = relink()
    if (detail) {
      states.push(snap(`${shown}: free(d)`))
    } else states.push(snap(shown))
    log.push(`${shown} → ${chainText(nodes, ends.head, cfg)}`)
  }

  // Pointer-by-pointer insertion of node `id` at data position `at` (detail). The new node is
  // drawn floating below the row between its neighbors; links change one statement at a time.
  function insertSteps(at, id) {
    const c = chain(), out = []
    const pos = front.length + at // index in the chain where it goes
    let p = c[pos - 1] ?? null, q = c[pos] ?? null
    const H = names.head
    // In a circular list without a sentinel, the node before the front is the last one.
    const wrap = circular && !sentinel && p === null && c.length > 0
    if (circular && q === null) q = c[0] ?? null
    if (wrap) p = c[c.length - 1]
    if (!c.length) q = null
    const float = { [id]: [c[pos - 1] ?? null, c[pos] ?? null] }
    const pname = wrap ? 'p' : p ? 'p' : null
    const P = (extra = {}) => ({ ...(pname ? { p } : {}), n: id, ...extra })
    const step = (label, hl = [id]) => out.push(snap(label, { hl, ptrs: P(), float, order: c }))
    nodes[id].next = null; nodes[id].prev = null
    step(`n = new node(${show(nodes[id].v)})`)
    if (q !== null) { nodes[id].next = q; step(p && !wrap ? 'n->next = p->next' : `n->next = ${H}`) }
    if (double) {
      if (p !== null) { nodes[id].prev = p; step('n->prev = p') }
      if (q !== null) { nodes[q].prev = id; step(p && !wrap ? 'n->next->prev = n' : `${H}->prev = n`) }
      else if (showTail) { ends = { ...ends, tail: id }; step(`${names.tail} = n`) }
    }
    if (p !== null) { nodes[p].next = id; step('p->next = n') }
    if (p === null || wrap) { ends = { ...ends, head: id }; step(`${H} = n`) }
    if (!double && showTail && q === null && p !== null) { ends = { ...ends, tail: id }; step(`${names.tail} = n`) }
    return out
  }

  // Pointer-by-pointer deletion of node `id` at data position k (detail); d floats below.
  function deleteSteps(k, id) {
    const c = chain(), out = [], pos = front.length + k
    let p = c[pos - 1] ?? null
    const q = nodes[id].next === id ? null : nodes[id].next
    const wrap = circular && !sentinel && p === null && c.length > 1
    if (wrap) p = c[c.length - 1]
    const H = names.head
    const order = c.filter((x) => x !== id)
    const float = { [id]: [c[pos - 1] ?? null, c[pos + 1] ?? null] }
    const ptrs = () => ({ ...(p ? { p } : {}), d: id })
    out.push(snap(p && !wrap ? 'd = p->next' : `d = ${H}`, { hl: [id], ptrs: ptrs() }))
    if (p !== null) { nodes[p].next = q === id ? null : q; out.push(snap('p->next = d->next', { hl: [id], ptrs: ptrs(), float, order })) }
    if (p === null || wrap) { ends = { ...ends, head: c.length > 1 ? q : null }; out.push(snap(`${H} = d->next`, { hl: [id], ptrs: ptrs(), float, order })) }
    if (double && q !== null && q !== id) { nodes[q].prev = p; out.push(snap(p ? 'd->next->prev = p' : `${H}->prev = NULL`, { hl: [id], ptrs: ptrs(), float, order })) }
    if (showTail && ends.tail === id) { ends = { ...ends, tail: p }; out.push(snap(`${names.tail} = p`, { hl: [id], ptrs: ptrs(), float, order })) }
    return out
  }

  const width = Math.max(28, ...Object.values(nodes).map((n) => textW(show(n.v), VAL) + 14))
  return { states, log, cfg, width }
}

function readCursors(spec) {
  const m = spec.pointers ?? {}
  if (typeof m !== 'object' || Array.isArray(m)) throw new SpecError('pointers', 'pointers is an object of name: position, like {"cur": 2} (0 is the first node; negative counts from the end)')
  for (const [k, v] of Object.entries(m)) if (!Number.isInteger(v)) throw new SpecError(`pointers.${k}`, 'a list pointer is a node position: 0 for the first node, -1 for the last')
  return m
}

/** head → 3 → 5 → NULL, following next links from the head (a cycle ends "back to ..."). */
export function chainText(nodes, head, cfg) {
  const out = [cfg.names.head]
  const seen = new Set()
  let id = head
  while (id !== null && id !== undefined && nodes[id] && !seen.has(id)) {
    seen.add(id)
    out.push(nodes[id].sentinel ? '[sentinel]' : show(nodes[id].v))
    id = nodes[id].next
  }
  if (id === null || id === undefined) out.push('NULL')
  else out.push(`(back to ${nodes[id]?.sentinel ? 'sentinel' : show(nodes[id]?.v)})`)
  return out.join(cfg.double ? ' ⇄ ' : ' → ')
}

export function listFacts(state, cfg) {
  const data = [...state.order, ...Object.keys(state.float)].filter((id) => !state.nodes[id].sentinel).map((id) => state.nodes[id].v)
  const ptrs = Object.entries(state.ptrs).map(([k, id]) => `${k}=${id === null || id === undefined ? 'NULL' : state.nodes[id]?.sentinel ? 'sentinel' : show(state.nodes[id]?.v)}`)
  return { data, ptrs }
}

export function drawList(state, run, theme) {
  const { cfg } = run
  const cv = new Canvas()
  const DW = run.width, ptrW = PW * (cfg.double ? 2 : 1)
  const dw = (id) => (state.nodes[id].sentinel ? 10 : DW) // a sentinel holds no data
  const nw = (id) => dw(id) + ptrW
  const floats = Object.keys(state.float)
  const G = floats.length ? 40 : 24
  const pos = {} // id → [x, y]
  let x = 0
  for (const id of state.order) { pos[id] = [x, 0]; x += nw(id) + G }
  for (const id of floats) {
    const [l, r] = state.float[id]
    const lx = l && pos[l] ? pos[l][0] + nw(l) : null, rx = r && pos[r] ? pos[r][0] : null
    const cx = lx !== null && rx !== null ? (lx + rx) / 2 : lx !== null ? lx + G / 2 + nw(id) / 2 : rx !== null ? rx - G / 2 - nw(id) / 2 : 0
    pos[id] = [cx - nw(id) / 2, NH + 34]
  }
  const hl = new Set(state.hl)
  const rect = (id) => [pos[id][0], pos[id][1], nw(id), NH]
  const dataX = (id) => pos[id][0] + (cfg.double ? PW : 0)
  const nextDot = (id) => [pos[id][0] + nw(id) - PW / 2, pos[id][1] + (cfg.double ? 9 : NH / 2)]
  const prevDot = (id) => [pos[id][0] + PW / 2, pos[id][1] + NH - 9]

  // Nodes.
  for (const id of [...state.order, ...floats]) {
    const n = state.nodes[id], [x, y] = pos[id], on = hl.has(id), NW = nw(id)
    const stroke = on ? theme.highlight : n.sentinel ? theme.muted : theme.fg
    const opt = { stroke, width: on ? 2.2 : 1.3, dash: n.sentinel ? '4 3' : undefined, tint: on ? theme.highlight : floats.includes(id) ? color('teal') : undefined, opacity: on ? 0.15 : 0.18, tag: `node:${id}` }
    box(cv, x, y, NW, NH, theme, opt)
    const sep = (sx) => cv.mid.push(el('line', { x1: sx, y1: y, x2: sx, y2: y + NH, stroke, 'stroke-width': 1.1, 'stroke-dasharray': n.sentinel ? '4 3' : undefined }))
    if (cfg.double) sep(x + PW)
    sep(x + NW - PW)
    if (!n.sentinel) text(cv, show(n.v), dataX(id) + DW / 2, y + NH / 2 + 4.5, theme)
    if (n.next === null) slash(cv, x + NW - PW, y, PW, NH, stroke)
    if (cfg.double && n.prev === null) slash(cv, x, y, PW, NH, stroke)
  }

  // Links. Row neighbors get straight arrows; links to or from a floating node go straight
  // (dropping below the row first when the float is far away); backward links (a circular
  // list's wrap) go under the row.
  let level = 0
  const under = []
  for (const id of [...state.order, ...floats]) {
    const n = state.nodes[id]
    for (const field of cfg.double ? ['next', 'prev'] : ['next']) {
      const t = n[field]
      if (t === null || !pos[t]) continue
      const from = field === 'next' ? nextDot(id) : prevDot(id)
      dot(cv, from, theme.fg)
      const fl = floats.includes(id) || floats.includes(t)
      const ci = state.order.indexOf(id), ct = state.order.indexOf(t)
      if (fl) {
        const anchor = [pos[t][0] + nw(t) * (field === 'next' ? 0.3 : 0.7), pos[t][1] + NH / 2]
        const far = Math.abs(anchor[0] - from[0]) > 1.6 * (DW + ptrW) && !floats.includes(id)
        const bend = far ? [[from[0], NH + 10]] : []
        const start = far ? bend[0] : from
        arrow(cv, [from, ...bend, clipToBox(start, anchor, rect(t), 1)], theme.fg, { r: 5 })
      } else if (field === 'next' && ct === ci + 1) {
        arrow(cv, [from, [pos[t][0] - 1, from[1]]], theme.fg)
      } else if (field === 'prev' && ct === ci - 1) {
        arrow(cv, [from, [pos[t][0] + nw(t) + 1, from[1]]], theme.fg)
      } else under.push({ id, t, from, field })
    }
  }
  for (const u of under) {
    const yb = NH + 12 + 10 * level++
    const tx = dataX(u.t) + dw(u.t) * (u.field === 'next' ? 0.35 : 0.65)
    arrow(cv, [u.from, [u.from[0], yb], [tx, yb], [tx, NH + 1]], theme.fg, { r: 5 })
  }

  // External pointers: names above row nodes (below floating ones), joined when they share one.
  const byNode = new Map()
  const nulls = []
  for (const [name, id] of Object.entries(state.ptrs)) {
    if (id === null || id === undefined || !pos[id]) { nulls.push(name); continue }
    byNode.set(id, [...(byNode.get(id) ?? []), name])
  }
  const pc = color('purple')
  for (const [id, ptrNames] of byNode) {
    const label = ptrNames.join(', '), x = dataX(id) + dw(id) / 2
    if (floats.includes(id)) {
      const y = pos[id][1] + NH
      arrow(cv, [[x, y + 18], [x, y + 2]], pc, { width: 1.5, head: 6 })
      text(cv, label, x, y + 31, theme, { size: NAME, mono: true, fill: pc })
    } else {
      arrow(cv, [[x, -20], [x, -2]], pc, { width: 1.5, head: 6 })
      text(cv, label, x, -25, theme, { size: NAME, mono: true, fill: pc })
    }
  }
  if (nulls.length) {
    const x0 = state.order.length ? -12 : 0
    const label = `${nulls.join(', ')} = NULL`
    text(cv, label, x0 + (state.order.length ? 0 : textW(label, NAME, true) / 2), state.order.length ? NH / 2 + 4 : 0, theme, { size: NAME, mono: true, fill: pc, anchor: state.order.length ? 'end' : 'middle' })
  }
  if (!state.order.length && !floats.length && !nulls.length) text(cv, 'empty', 0, 0, theme, { fill: theme.muted })
  return finish(cv)
}
