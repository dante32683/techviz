// ds: textbook data structures as boxes and arrows (arrays, linked lists, stacks, queues,
// binary search trees, AVL trees, heaps, hash tables). The spec gives the contents and a list
// of ops; the kind computes every state, so each op becomes a step, and the summary reports the
// facts to check an answer against (traversals, heights, balance factors, probe sequences).
// C memory with addresses belongs to the memory kind; this is the abstract picture.

import { SpecError, Diag } from '../../diag.js'
import { list, show } from './ops.js'
import { simulateArray, drawArray, simulateArrayStack, drawArrayStack, simulateArrayQueue, drawArrayQueue, queueFacts } from './array.js'
import { simulateList, drawList, chainText, listFacts } from './list.js'
import { simulateTree, drawBst, treeFacts, simulateHeap, drawHeap, heapFacts } from './tree.js'
import { simulateHash, drawHash, hashFacts } from './hash.js'

const MODES = ['array', 'list', 'stack', 'queue', 'tree', 'heap', 'hash']
// Options each mode reads (beyond its own key, ops, detail, and highlight).
const OPTIONS = {
  array: ['pointers'],
  list: ['links', 'circular', 'sentinel', 'tail', 'pointers'],
  stack: ['on', 'capacity', 'links'],
  queue: ['on', 'capacity', 'links'],
  tree: ['avl', 'build', 'bst', 'show'],
  heap: ['order', 'build', 'base'],
  hash: ['m', 'h', 'h2', 'probe'],
}
const ALL_OPTIONS = [...new Set(Object.values(OPTIONS).flat())]

function modeOf(spec) {
  const found = MODES.filter((k) => spec[k] !== undefined)
  if (!found.length) throw new SpecError('array', `give one structure: ${MODES.map((m) => `"${m}"`).join(', ')} (its contents, like "tree": [50, 30, 70])`)
  if (found.length > 1) throw new SpecError(found[1], `one structure per diagram (got ${found.join(' and ')})`)
  return found[0]
}

/** Run the spec's ops: { mode, run, draw, describe(state) }. */
function simulate(spec, diag) {
  const mode = modeOf(spec)
  for (const k of ALL_OPTIONS) if (spec[k] !== undefined && !OPTIONS[mode].includes(k)) diag.warn(k, `"${k}" is for ${MODES.filter((m) => OPTIONS[m].includes(k)).join(' or ')}; a ${mode} ignores it`)
  const on = spec.on ?? 'array'
  if ((mode === 'stack' || mode === 'queue') && !['array', 'list'].includes(on)) throw new SpecError('on', 'on is "array" (default) or "list"')
  const hl = spec.highlight ?? []

  if (mode === 'array') {
    const run = simulateArray(spec, diag)
    for (const s of run.states) s.hl = [...s.hl, ...hl.map(Number).filter(Number.isInteger)]
    return {
      mode, run, draw: drawArray, alt: 'array',
      describe: (s) => {
        const sorted = s.a.every((v, i) => i === 0 || !(typeof v === 'number' && typeof s.a[i - 1] === 'number' ? s.a[i - 1] > v : String(s.a[i - 1]) > String(v)))
        const marks = Object.entries(s.marks).map(([k, i]) => `${k}=${i}`).join(' ')
        return `ds array: ${list(s.a)} (${s.a.length} items)${marks ? `; markers ${marks}` : ''}; ${sorted ? 'sorted ascending' : 'not sorted'}`
      },
    }
  }
  if (mode === 'list' || ((mode === 'stack' || mode === 'queue') && on === 'list')) {
    const run = simulateList(spec, diag, mode)
    const hlv = new Set(hl.map(String))
    for (const s of run.states) s.hl = [...s.hl, ...Object.keys(s.nodes).filter((id) => hlv.has(String(s.nodes[id].v)))]
    const { cfg } = run
    const kind = mode === 'list' ? `${cfg.double ? 'doubly' : 'singly'} linked list${cfg.circular ? ', circular' : ''}${cfg.sentinel ? ', with sentinel' : ''}` : `${mode} on a ${cfg.double ? 'doubly ' : ''}linked list`
    return {
      mode, run, draw: drawList, alt: kind,
      describe: (s) => {
        const f = listFacts(s, cfg)
        return `ds ${kind}: ${chainText(s.nodes, s.ptrs[cfg.names.head], cfg)}; ${f.data.length} node${f.data.length === 1 ? '' : 's'}${f.ptrs.length ? `; pointers ${f.ptrs.join(', ')}` : ''}`
      },
    }
  }
  if (mode === 'stack') {
    const run = simulateArrayStack(spec, diag)
    return {
      mode, run, draw: drawArrayStack, alt: 'stack on an array',
      describe: (s) => `ds stack (array, capacity ${run.cap}): bottom→top ${list(s.s)}; top = ${s.s.length - 1}${s.s.length ? ` (${show(s.s[s.s.length - 1])})` : ' (empty)'}${run.popped.length ? `; popped ${run.popped.map(show).join(', ')}` : ''}`,
    }
  }
  if (mode === 'queue') {
    const run = simulateArrayQueue(spec, diag)
    return {
      mode, run, draw: drawArrayQueue, alt: 'circular queue on an array',
      describe: (s) => {
        const f = queueFacts(s, run.cap)
        return `ds queue (circular array, capacity ${run.cap}): front→rear ${list(f.items)}; front = ${s.front}, rear = ${f.rear ?? 'none (empty)'} (rear is the last item's index), count ${s.count}${run.out.length ? `; dequeued ${run.out.map(show).join(', ')}` : ''}`
      },
    }
  }
  if (mode === 'tree') {
    const run = simulateTree(spec, diag)
    run.show = spec.show ?? []
    if (!Array.isArray(run.show) || run.show.some((x) => !['bf', 'height'].includes(x))) throw new SpecError('show', 'show is a list of "bf" (balance factor) and "height", drawn beside each node')
    const hlk = hl.map(String)
    for (const s of run.states) s.hl = [...s.hl, ...hlk.map((k) => (/^-?\d+(\.\d+)?$/.test(k) ? Number(k) : k))]
    const checkBst = spec.bst !== false
    return {
      mode, run, draw: (s, r, theme) => drawBst(s, r, theme, checkBst), alt: run.avl ? 'AVL tree' : checkBst ? 'binary search tree' : 'binary tree',
      describe: (s) => `ds ${run.avl ? 'avl' : checkBst ? 'bst' : 'binary tree'}: ${treeFacts(s.root, run.avl || run.show.includes('bf'), checkBst).join('; ')}`,
    }
  }
  if (mode === 'heap') {
    const run = simulateHeap(spec, diag)
    for (const s of run.states) s.hl = [...s.hl, ...hl.map(Number).filter(Number.isInteger)]
    return {
      mode, run, draw: drawHeap, alt: `${run.order}-heap`,
      describe: (s) => `ds heap (${run.order}, ${run.base}-based): ${heapFacts(s.a, run).join('; ')}`,
    }
  }
  const run = simulateHash(spec, diag)
  for (const s of run.states) s.hl = [...s.hl, ...hl.map(Number).filter(Number.isInteger)]
  const how = run.probe === 'chain' ? 'separate chaining, appended' : run.probe === 'double' ? `double hashing, h2(k) = ${run.h2src}` : `${run.probe} probing`
  return {
    mode, run, draw: drawHash, alt: 'hash table',
    describe: (s) => `ds hash (${how}; m = ${run.m}, h(k) = ${run.hsrc}): ${hashFacts(s, run).join('; ')}`,
  }
}

export default {
  kind: 'ds',
  fields: ['ops', 'detail', 'highlight', ...MODES, ...ALL_OPTIONS],
  collections: [],
  steps(spec) {
    const { run } = simulate(spec, new Diag())
    return run.states.length > 1 ? run.states.map((s, k) => ({ label: s.label, __state: k })) : []
  },
  render(spec, { theme, diag }) {
    if (spec.detail !== undefined && typeof spec.detail !== 'boolean') throw new SpecError('detail', 'detail is true (show each pointer change, swap, or rotation as its own step) or false')
    const sim = simulate(spec, diag)
    const { run } = sim
    const k = Number.isInteger(spec.__state) ? Math.min(spec.__state, run.states.length - 1) : run.states.length - 1
    const state = run.states[k]
    const out = sim.draw(state, run, theme)
    const parts = [sim.describe(state)]
    if (run.states.length > 1 && k < run.states.length - 1) parts.push(`showing step ${k + 1} of ${run.states.length}: ${state.label}`)
    if (run.log.length) parts.push(`ops: ${run.log.join('; ')}`)
    return { ...out, summary: parts.join('; '), alt: sim.alt }
  },
}
