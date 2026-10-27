// Binary trees: a BST built from an insertion order or given level by level, kept balanced as
// an AVL tree on request (rotations named, balance factors drawn), and binary heaps drawn as a
// tree above their array. Ops (insert, delete, find; push, pop) are computed state by state.

import { SpecError } from '../../diag.js'
import { color } from '../../theme.js'
import { Canvas, V } from '../fbd/draw.js'
import { placeLabels, drawLabels, extent } from '../fbd/place.js'
import { el } from '../../svg.js'
import { VAL, IDX, textW, text, line, finish } from './draw.js'
import { drawRow } from './array.js'
import { readOps, values, cmp, show, list, val } from './ops.js'

const LEVEL = 50 // vertical distance between depths

// ---------------------------------------------------------------- tree basics

const node = (k) => ({ k, l: null, r: null })
const clone = (n) => (n ? { k: n.k, l: clone(n.l), r: clone(n.r) } : null)
const height = (n) => (n ? 1 + Math.max(height(n.l), height(n.r)) : -1) // edges; empty is -1
const bf = (n) => height(n.l) - height(n.r)
const signed = (b) => (b > 0 ? `+${b}` : String(b))
function* inorder(n) { if (n) { yield* inorder(n.l); yield n; yield* inorder(n.r) } }
function* preorder(n) { if (n) { yield n; yield* preorder(n.l); yield* preorder(n.r) } }
function* postorder(n) { if (n) { yield* postorder(n.l); yield* postorder(n.r); yield n } }
function levelorder(n) { const out = [], q = n ? [n] : []; while (q.length) { const x = q.shift(); out.push(x); if (x.l) q.push(x.l); if (x.r) q.push(x.r) } return out }
const keys = (it) => [...it].map((n) => show(n.k)).join(' ')

/** Keys from the root down toward k (the search path), and the node holding k if any. */
function search(root, k) {
  const path = []
  let n = root
  while (n) { path.push(n.k); const c = cmp(k, n.k); if (!c) return { path, hit: n }; n = c < 0 ? n.l : n.r }
  return { path, hit: null }
}
function parentOf(root, k) {
  let p = null, n = root
  while (n && cmp(k, n.k)) { p = n; n = cmp(k, n.k) < 0 ? n.l : n.r }
  return p
}

/** BST order check with bounds: the first node outside its ancestors' range, as text. */
function bstViolation(root) {
  const walk = (n, lo, hi) => {
    if (!n) return null
    if (lo && cmp(n.k, lo.k) <= 0) return `${show(n.k)} is in the right subtree of ${show(lo.k)} but not larger`
    if (hi && cmp(n.k, hi.k) >= 0) return `${show(n.k)} is in the left subtree of ${show(hi.k)} but not smaller`
    return walk(n.l, lo, n) ?? walk(n.r, n, hi)
  }
  return walk(root, null, null)
}

/** Tree from a level-order list with null for missing nodes (children of i at 2i+1, 2i+2). */
function fromLevels(a, path) {
  const nodes = a.map((k, i) => {
    if (k === null) return null
    if (typeof k !== 'number' && typeof k !== 'string') throw new SpecError(`${path}[${i}]`, 'keys are numbers or short strings; null marks a missing node')
    return node(k)
  })
  nodes.forEach((n, i) => {
    if (!n) return
    n.l = nodes[2 * i + 1] ?? null; n.r = nodes[2 * i + 2] ?? null
  })
  nodes.forEach((n, i) => { if (n && i > 0 && !nodes[Math.floor((i - 1) / 2)]) throw new SpecError(`${path}[${i}]`, `${show(n.k)} sits under a null at index ${Math.floor((i - 1) / 2)}; a node's children are at 2i+1 and 2i+2`) })
  return nodes[0] ?? null
}

// ---------------------------------------------------------------- BST and AVL

const TREE_OPS = { insert: 1, delete: 1, find: 1, search: 1 }
const TREE_HELP = '"insert 40", "delete 30", "find 60"'

export function simulateTree(spec, diag) {
  const avl = !!spec.avl, detail = !!spec.detail
  const build = spec.build ?? 'insert'
  if (!['insert', 'level'].includes(build)) throw new SpecError('build', 'build is "insert" (the tree list is an insertion order, default) or "level" (level order, null for a missing node)')
  if (!Array.isArray(spec.tree)) throw new SpecError('tree', 'tree is a list of keys, like [50, 30, 70] (inserted in order)')
  const H = { root: null }
  const events = []
  const states = []
  const snap = (label, extra = {}) => ({ label, root: clone(H.root), hl: [], path: [], ...extra })

  const insert = (k, path) => {
    const s = search(H.root, k)
    if (s.hit) { diag.warn(path, `${show(k)} is already in the tree; a BST keeps one copy`); return { dup: true, path: s.path } }
    const n = node(k)
    if (!H.root) H.root = n
    else { const p = parentOf(H.root, k); if (cmp(k, p.k) < 0) p.l = n; else p.r = n }
    return { dup: false, path: s.path }
  }

  // Delete k; returns the key of the physically removed node's parent and the successor used.
  const remove = (k) => {
    const { hit } = search(H.root, k)
    if (!hit) return null
    let target = hit, succ = null
    if (hit.l && hit.r) {
      succ = hit.r
      while (succ.l) succ = succ.l
      target = succ
    }
    const p = parentOf(H.root, target.k)
    const child = target.l ?? target.r
    if (succ) {
      const sk = succ.k
      // Unlink the successor (it has no left child), then move its key up.
      if (p.l === target) p.l = child; else p.r = child
      hit.k = sk
      return { parent: p === hit ? hit.k : p.k, succ: sk, kind: 'two children' }
    }
    if (!p) H.root = child
    else if (p.l === target) p.l = child
    else p.r = child
    return { parent: p ? p.k : null, kind: child ? 'one child' : 'leaf' }
  }

  // Walk up from `from` (a key) to the root, rotating at each node out of balance.
  const rebalance = (from, label) => {
    const done = []
    if (from === null || from === undefined) return done
    const up = search(H.root, from).path.reverse()
    for (const key of up) {
      const z = search(H.root, key).hit
      if (!z) continue
      const b = bf(z)
      if (Math.abs(b) < 2) continue
      const left = b > 0, child = left ? z.l : z.r, cb = bf(child)
      const kase = left ? (cb >= 0 ? 'LL' : 'LR') : (cb <= 0 ? 'RR' : 'RL')
      if (detail) states.push(snap(`${label}: unbalanced at ${show(key)} (bf ${signed(b)}), case ${kase}`, { hl: [key], bal: true }))
      let text
      if (kase === 'LL') { rotate(z, 'right'); text = `right rotation at ${show(key)}` }
      else if (kase === 'RR') { rotate(z, 'left'); text = `left rotation at ${show(key)}` }
      else {
        const ck = child.k
        rotate(child, kase === 'LR' ? 'left' : 'right')
        if (detail) states.push(snap(`${label}: ${kase === 'LR' ? 'left' : 'right'} rotation at ${show(ck)}`, { hl: [ck, key], bal: true }))
        rotate(search(H.root, key).hit, kase === 'LR' ? 'right' : 'left')
        text = `${kase === 'LR' ? 'left' : 'right'} rotation at ${show(ck)}, then ${kase === 'LR' ? 'right' : 'left'} at ${show(key)}`
      }
      done.push(`${kase} at ${show(key)}: ${text}`)
    }
    return done
  }
  const rotate = (z, dir) => {
    const p = parentOf(H.root, z.k)
    let y
    if (dir === 'right') { y = z.l; z.l = y.r; y.r = z } else { y = z.r; z.r = y.l; y.l = z }
    if (!p) H.root = y
    else if (p.l === z) p.l = y
    else p.r = y
  }

  // Build.
  if (build === 'level') {
    H.root = fromLevels(spec.tree, 'tree')
    if (spec.bst !== false) {
      const bad = bstViolation(H.root)
      if (bad) diag.warn('tree', `not a BST: ${bad}. Fix the keys, or set "bst": false for a plain binary tree`)
    }
    if (avl) for (const n of inorder(H.root)) if (Math.abs(bf(n)) > 1) diag.warn('tree', `not AVL-balanced: ${show(n.k)} has balance factor ${signed(bf(n))}`)
  } else {
    spec.tree.forEach((k, i) => {
      if (typeof k !== 'number' && typeof k !== 'string') throw new SpecError(`tree[${i}]`, 'keys are numbers or short strings')
      const r = insert(k, `tree[${i}]`)
      if (!r.dup && avl) events.push(...rebalance(k, `insert ${show(k)}`).map((e) => `insert ${show(k)}: ${e}`))
    })
    if (avl && detail) states.length = 0 // the build itself isn't traced
  }
  states.push(snap('start'))

  for (const op of readOps(spec, TREE_OPS, TREE_HELP)) {
    const k = val(op.args[0])
    if (op.verb === 'insert') {
      const r = insert(k, op.path)
      if (r.dup) { states.push(snap(`${op.text}: already there`, { path: r.path, hl: [k] })); events.push(`${op.text}: duplicate, ignored`); continue }
      const where = r.path.length ? `${cmp(k, r.path[r.path.length - 1]) < 0 ? 'left' : 'right'} of ${show(r.path[r.path.length - 1])}` : 'root'
      const rot = avl ? rebalance(k, op.text) : []
      states.push(snap(rot.length ? `${op.text}: ${rot.map((t) => t.split(': ')[1]).join('; ')}` : op.text, { hl: [k], path: rot.length ? [] : r.path, bal: avl }))
      events.push(`${op.text}: ${[`path ${[...r.path, k].map(show).join('→')} (${where})`, ...rot].join('; ')}`)
    } else if (op.verb === 'delete') {
      const { hit } = search(H.root, k)
      if (!hit) { diag.warn(op.path, `${show(k)} is not in the tree; nothing deleted`); states.push(snap(`${op.text}: not found`)); events.push(`${op.text}: not found`); continue }
      if (detail && hit.l && hit.r) {
        let s = hit.r
        while (s.l) s = s.l
        states.push(snap(`${op.text}: two children; successor ${show(s.k)} (smallest on the right)`, { hl: [k, s.k] }))
      }
      const r = remove(k)
      const rot = avl ? rebalance(r.parent, op.text) : []
      const how = r.succ !== undefined ? `two children, successor ${show(r.succ)} replaces it` : r.kind
      states.push(snap(`${op.text} (${how})${rot.length ? `: ${rot.map((t) => t.split(': ')[1]).join('; ')}` : ''}`, { hl: r.succ !== undefined ? [r.succ] : [], bal: avl }))
      events.push(`${op.text}: ${[how, ...rot].join('; ')}`)
    } else {
      const s = search(H.root, k)
      states.push(snap(`${op.text}: ${s.hit ? 'found' : 'not found'} after ${s.path.length} comparison${s.path.length === 1 ? '' : 's'}`, { path: s.path, hl: s.hit ? [k] : [] }))
      events.push(`${op.text}: path ${s.path.map(show).join('→') || '(empty)'}, ${s.hit ? 'found' : 'not found'}`)
    }
  }
  const r = Math.max(14, ...states.flatMap((s) => [...inorder(s.root)].map((n) => textW(show(n.k), VAL) / 2 + 5)))
  return { states, log: events, avl, r }
}

export function treeFacts(root, avl, checkBst = true) {
  const out = [`${[...inorder(root)].length} nodes, height ${height(root)} (edges)`]
  out.push(`in-order ${keys(inorder(root)) || '(empty)'}`, `pre-order ${keys(preorder(root))}`, `post-order ${keys(postorder(root))}`, `level-order ${levelorder(root).map((n) => show(n.k)).join(' ')}`)
  if (checkBst) { const bad = bstViolation(root); out.push(bad ? `BST order broken: ${bad}` : 'BST order OK') }
  if (avl) {
    const all = [...inorder(root)]
    out.push(`bf = h(L) − h(R): ${all.map((n) => `${show(n.k)}:${signed(bf(n))}`).join(' ')}`)
    out.push(all.every((n) => Math.abs(bf(n)) <= 1) ? 'AVL balanced' : `AVL broken at ${all.filter((n) => Math.abs(bf(n)) > 1).map((n) => show(n.k)).join(', ')}`)
  }
  return out
}

// ---------------------------------------------------------------- layout and drawing

/** Tidy layout (Reingold–Tilford for binary trees): node → [x, depth]; subtrees never overlap. */
function tidy(root, sep) {
  const off = new Map()
  const walk = (n) => {
    if (!n) return null
    const L = walk(n.l), R = walk(n.r)
    let lo = [0], hi = [0]
    if (L && R) {
      let d = sep
      for (let i = 0; i < Math.min(L.hi.length, R.lo.length); i++) d = Math.max(d, L.hi[i] - R.lo[i] + sep)
      off.set(n.l, -d / 2); off.set(n.r, d / 2)
      const depth = Math.max(L.lo.length, R.lo.length)
      for (let i = 0; i < depth; i++) {
        lo.push(i < L.lo.length ? L.lo[i] - d / 2 : R.lo[i] + d / 2)
        hi.push(i < R.hi.length ? R.hi[i] + d / 2 : L.hi[i] - d / 2)
      }
    } else if (L || R) {
      const c = L ?? R, s = L ? -sep / 2 : sep / 2
      off.set(L ? n.l : n.r, s)
      lo = [0, ...c.lo.map((v) => v + s)]; hi = [0, ...c.hi.map((v) => v + s)]
    }
    return { lo, hi }
  }
  walk(root)
  const pos = new Map()
  const place = (n, x, depth) => { if (!n) return; pos.set(n, [x, depth]); place(n.l, x + (off.get(n.l) ?? 0), depth + 1); place(n.r, x + (off.get(n.r) ?? 0), depth + 1) }
  place(root, 0, 0)
  return pos
}

/**
 * Draw a tree. o: { r, hl: keys, path: keys (search or sift path, drawn amber), notes:
 * node → label (balance factors, heap indices), bad: node → bool, keyOf }.
 */
function drawTree(cv, theme, root, o, y0 = 0) {
  const r = o.r, pos = tidy(root, 2 * r + 8)
  const P = (n) => [pos.get(n)[0], y0 + pos.get(n)[1] * LEVEL]
  const id = o.idOf ?? ((n) => n.k)
  const hl = new Set(o.hl ?? []), path = new Set(o.path ?? [])
  const amber = color('amber')
  const side = new Map([[root, -1]]) // a left child's notes go on its left, a right child's on its right
  for (const [n] of pos) for (const c of [n.l, n.r]) {
    if (!c) continue
    side.set(c, c === n.l ? -1 : 1)
    const a = P(n), b = P(c), d = V.unit(V.sub(b, a))
    const on = path.has(id(n)) && (path.has(id(c)) || hl.has(id(c)))
    line(cv, V.add(a, V.mul(d, r)), V.sub(b, V.mul(d, r)), on ? amber : theme.fg, { width: on ? 2.4 : 1.3 })
  }
  for (const [n] of pos) {
    const [x, y] = P(n), k = id(n), on = hl.has(k), bad = o.bad?.(n), onPath = path.has(k)
    const stroke = on || bad ? theme.highlight : onPath ? amber : theme.fg
    cv.mid.push(el('circle', { cx: x, cy: y, r, fill: on ? theme.highlight : theme.bg ?? 'none', 'fill-opacity': on ? 0.15 : undefined, stroke, 'stroke-width': on || bad || onPath ? 2.2 : 1.4 }))
    cv.trace(Array.from({ length: 16 }, (_, i) => [x + r * Math.cos(i * Math.PI / 8), y + r * Math.sin(i * Math.PI / 8)]), 'node', 1, true)
    cv.fill([[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]], 'node', 1)
    text(cv, show(n.k), x, y + 4.5, theme)
  }
  // Notes beside nodes, placed clear of edges and each other: outward side first.
  const labels = []
  for (const [n] of pos) {
    const note = o.notes?.(n)
    if (note === undefined) continue
    const [x, y] = P(n)
    const outward = side.get(n)
    const cands = [[outward, -0.75], [outward, 0], [-outward, -0.75], [0, 1], [-outward, 0], [outward, 0.75], [-outward, 0.75], [0, -1]].map(([dx, dy]) => {
      const d = V.unit([dx, dy])
      return (w, h) => V.add([x, y], V.mul(d, r + 4 + extent(d, w, h)))
    })
    labels.push({ label: note.text, size: IDX, fill: note.fill ?? theme.muted, cands })
  }
  drawLabels(placeLabels(labels, cv), cv, theme)
  return pos
}

export function drawBst(state, run, theme, checkBst) {
  const cv = new Canvas()
  if (!state.root) { text(cv, 'root = NULL', 0, 0, theme, { fill: theme.muted, mono: true }); return finish(cv) }
  const showBf = run.avl || (run.show ?? []).includes('bf'), showH = (run.show ?? []).includes('height')
  drawTree(cv, theme, state.root, {
    r: run.r, hl: state.hl, path: state.path,
    bad: (n) => run.avl && Math.abs(bf(n)) > 1,
    notes: showBf || showH ? (n) => {
      const b = bf(n), parts = []
      if (showBf) parts.push(signed(b))
      if (showH) parts.push(`h=${height(n)}`)
      return { text: parts.join(' '), fill: Math.abs(b) > 1 && showBf ? theme.highlight : theme.muted }
    } : undefined,
  })
  return finish(cv)
}

// ---------------------------------------------------------------- heap

const HEAP_HELP = '"push 4", "pop"'

export function simulateHeap(spec, diag) {
  const order = spec.order ?? 'min'
  if (!['min', 'max'].includes(order)) throw new SpecError('order', 'order is "min" (default) or "max"')
  const base = spec.base ?? 0
  if (![0, 1].includes(base)) throw new SpecError('base', 'base is 0 (children at 2i+1, 2i+2; default) or 1 (children at 2i, 2i+1)')
  const build = spec.build ?? 'insert'
  if (!['insert', 'heapify', 'array'].includes(build)) throw new SpecError('build', 'build is "insert" (push each value in order, default), "heapify" (bottom-up), or "array" (the list is the heap as stored)')
  const detail = !!spec.detail
  const better = (x, y) => (order === 'min' ? cmp(x, y) < 0 : cmp(x, y) > 0)
  const a = []
  const states = [], log = []
  const snap = (label, extra = {}) => ({ label, a: [...a], hl: [], path: [], ...extra })
  let swaps = 0

  const siftUp = (i, label) => {
    const path = [i]
    while (i > 0) {
      const p = Math.floor((i - 1) / 2)
      if (!better(a[i], a[p])) break
      ;[a[i], a[p]] = [a[p], a[i]]; swaps++
      if (detail && label) states.push(snap(`${label}: swap [${i + base}] ↔ parent [${p + base}]`, { hl: [p], path: [...path, p] }))
      i = p; path.push(i)
    }
    return path
  }
  const siftDown = (i, label) => {
    const path = [i]
    for (;;) {
      const l = 2 * i + 1, r = l + 1
      let m = i
      if (l < a.length && better(a[l], a[m])) m = l
      if (r < a.length && better(a[r], a[m])) m = r
      if (m === i) break
      ;[a[i], a[m]] = [a[m], a[i]]; swaps++
      if (detail && label) states.push(snap(`${label}: swap [${i + base}] ↔ child [${m + base}]`, { hl: [m], path: [...path, m] }))
      i = m; path.push(i)
    }
    return path
  }
  const idx = (path) => path.map((i) => `[${i + base}]`).join('→')

  const init = values(spec, 'heap', '[5, 3, 8, 1]')
  if (build === 'array') {
    a.push(...init)
    a.forEach((v, i) => { if (i > 0 && better(v, a[Math.floor((i - 1) / 2)])) diag.warn(`heap[${i}]`, `heap order broken: ${show(v)} at [${i + base}] is ${order === 'min' ? 'smaller' : 'larger'} than its parent ${show(a[Math.floor((i - 1) / 2)])} at [${Math.floor((i - 1) / 2) + base}]`) })
  } else if (build === 'heapify') {
    a.push(...init)
    if (detail) states.push(snap('heapify: the list as given'))
    for (let i = Math.floor(a.length / 2) - 1; i >= 0; i--) {
      const p = siftDown(i, `heapify at [${i + base}]`)
      if (detail && p.length === 1) states.push(snap(`heapify at [${i + base}]: already in order`, { hl: [i] }))
    }
    log.push(`heapify: ${swaps} swap${swaps === 1 ? '' : 's'} → ${list(a)}`)
  } else {
    for (const v of init) { a.push(v); siftUp(a.length - 1) }
  }
  states.push(snap(states.length ? 'heapify: done' : 'start'))

  for (const op of readOps(spec, { push: 1, insert: 1, pop: 0, extract: 0 }, HEAP_HELP)) {
    if (op.verb === 'push' || op.verb === 'insert') {
      const v = val(op.args[0])
      a.push(v)
      if (detail) states.push(snap(`${op.text}: place at [${a.length - 1 + base}]`, { hl: [a.length - 1] }))
      const p = siftUp(a.length - 1, op.text)
      states.push(snap(op.text, { hl: [p[p.length - 1]], path: p }))
      log.push(`${op.text}: sift up ${idx(p)}`)
    } else {
      if (!a.length) { diag.warn(op.path, 'pop: the heap is empty'); states.push(snap('pop: empty')); log.push('pop: empty'); continue }
      const top = a[0], last = a.pop()
      if (a.length) {
        a[0] = last
        if (detail) states.push(snap(`pop → ${show(top)}: last ${show(last)} moves to the root`, { hl: [0] }))
        const p = siftDown(0, `pop → ${show(top)}`)
        states.push(snap(`pop → ${show(top)}`, { hl: [p[p.length - 1]], path: p }))
        log.push(`pop → ${show(top)}: ${show(last)} to the root, sift down ${idx(p)}`)
      } else { states.push(snap(`pop → ${show(top)}`)); log.push(`pop → ${show(top)}`) }
    }
  }
  const r = Math.max(14, ...states.flatMap((s) => s.a.map((v) => textW(show(v), VAL) / 2 + 5)))
  const width = Math.max(30, ...states.flatMap((s) => s.a.map((v) => textW(show(v), VAL) + 14)))
  return { states, log, order, base, r, width, better }
}

export function heapFacts(a, run) {
  const bad = []
  a.forEach((v, i) => { if (i > 0 && run.better(v, a[Math.floor((i - 1) / 2)])) bad.push(`[${i + run.base}]`) })
  const h = a.length ? Math.floor(Math.log2(a.length)) : -1
  return [`${list(a)}`, `${a.length} items, height ${h}`, run.base ? 'children of i at 2i, 2i+1' : 'children of i at 2i+1, 2i+2', bad.length ? `heap order broken at ${bad.join(', ')}` : 'heap order OK']
}

export function drawHeap(state, run, theme) {
  const cv = new Canvas()
  const a = state.a
  if (!a.length) { text(cv, 'empty heap', 0, 0, theme, { fill: theme.muted }); return finish(cv) }
  // The array as a tree of index nodes.
  const nodes = a.map((k, i) => ({ k, i, l: null, r: null }))
  nodes.forEach((n, i) => { n.l = nodes[2 * i + 1] ?? null; n.r = nodes[2 * i + 2] ?? null })
  const pos = drawTree(cv, theme, nodes[0], {
    r: run.r, idOf: (n) => n.i, hl: state.hl, path: state.path,
    notes: (n) => ({ text: String(n.i + run.base) }),
  })
  const xs = [...pos.values()].map((p) => p[0])
  const depth = Math.max(...[...pos.values()].map((p) => p[1]))
  const W = run.width, rowW = a.length * W
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  drawRow(theme, a, { width: W, hl: state.hl, first: run.base }, cv, [cx - rowW / 2, depth * LEVEL + run.r + 40])
  return finish(cv)
}
