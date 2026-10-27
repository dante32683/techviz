import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderAsync } from '../../index.js'

const load = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))
const problems = (r) => r.diagnostics.filter((d) => d.level !== 'note').map((d) => `${d.path}: ${d.msg}`)
const ds = (fields) => renderAsync({ v: 1, kind: 'ds', ...fields })

test('BST from an insertion order: traversals, height, and one step per op', async () => {
  const r = await renderAsync(load('bst-build.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /^ds bst: 8 nodes, height 3 \(edges\); in-order 20 30 35 40 50 60 70 80; pre-order 50 30 20 40 35 70 60 80; post-order 20 35 40 30 60 80 70 50; level-order 50 30 70 20 40 60 80 35; BST order OK/)
  assert.match(r.summary, /insert 35: path 50→30→40→35 \(left of 40\)/)
  assert.equal(r.controls.steps.length, 9) // start plus 8 inserts
  const s2 = await renderAsync(load('bst-build.json'), { step: 2 })
  assert.match(s2.summary, /^ds bst: 2 nodes, height 1/)
  assert.match(s2.summary, /showing step 3 of 9: insert 30/)
})

test('BST delete: a node with two children is replaced by its in-order successor', async () => {
  const r = await ds({ tree: [50, 30, 70, 20, 40, 60, 80], ops: ['delete 50', 'delete 20', 'delete 30'] })
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /delete 50: two children, successor 60 replaces it; delete 20: leaf; delete 30: one child/)
  assert.match(r.summary, /level-order 60 40 70 80/)
})

test('AVL: RR and LR cases name their rotations, and detail shows the unbalanced tree first', async () => {
  const r = await renderAsync(load('avl-rotations.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /RR at 10: left rotation at 10/)
  assert.match(r.summary, /LR at 30: left rotation at 25, then right at 30/)
  assert.match(r.summary, /level-order 20 10 28 25 30; BST order OK; bf = h\(L\) − h\(R\): 10:0 20:-1 25:0 28:0 30:0; AVL balanced/)
  assert.ok(r.controls.steps.includes('insert 28: unbalanced at 30 (bf +2), case LR'))
  const s = await renderAsync(load('avl-rotations.json'), { step: 3 })
  assert.match(s.summary, /AVL broken at 10/)
})

test('AVL delete rebalances with an LL rotation', async () => {
  const r = await ds({ tree: [50, 30, 70, 20, 40, 60, 80, 10], avl: true, ops: ['delete 60', 'delete 80'] })
  assert.match(r.summary, /delete 80: leaf; LL at 50: right rotation at 50/)
  assert.match(r.summary, /level-order 30 20 50 10 40 70/)
})

test('a level-order tree that breaks BST order warns', async () => {
  const r = await ds({ tree: [50, 30, 70, 20, 55], build: 'level' })
  assert.deepEqual(problems(r), ['tree: not a BST: 55 is in the left subtree of 50 but not smaller. Fix the keys, or set "bst": false for a plain binary tree'])
  const plain = await ds({ tree: [50, 30, 70, 20, 55], build: 'level', bst: false })
  assert.deepEqual(problems(plain), [])
  assert.match(plain.summary, /^ds binary tree: 5 nodes/)
})

test('C singly linked list insert: one step per pointer assignment, the new node floating', async () => {
  const r = await renderAsync(load('c-list-insert.json'))
  assert.deepEqual(problems(r), [])
  assert.deepEqual(r.controls.steps, ['start', 'insert 5 after 3: n = new node(5)', 'insert 5 after 3: n->next = p->next', 'insert 5 after 3: p->next = n'])
  assert.match(r.summary, /^ds singly linked list: head → 3 → 5 → 7 → 9 → NULL; 4 nodes; pointers head=3, p=3, n=5/)
  // Before p->next = n, the list still skips the new node, which already points at 7.
  const mid = await renderAsync(load('c-list-insert.json'), { step: 2 })
  assert.match(mid.summary, /head → 3 → 7 → 9 → NULL/)
})

test('doubly linked insert takes four assignments in order; circular lists close the cycle', async () => {
  const r = await ds({ list: [3, 7, 9], links: 'double', detail: true, ops: ['insert 5 at 1'] })
  assert.deepEqual(r.controls.steps.slice(2), ['insert 5 at 1: n->next = p->next', 'insert 5 at 1: n->prev = p', 'insert 5 at 1: n->next->prev = n', 'insert 5 at 1: p->next = n'])
  const c = await ds({ list: [3, 7, 9], circular: true, ops: ['push_front 1', 'delete 9'] })
  assert.match(c.summary, /head → 1 → 3 → 7 → \(back to 1\)/)
})

test('stacks and queues: array and list versions agree on order, the queue wraps', async () => {
  const q = await renderAsync({ v: 1, kind: 'ds', queue: [1, 2, 3], capacity: 5, ops: ['dequeue', 'dequeue', 'enqueue 4', 'enqueue 5', 'enqueue 6'] })
  assert.match(q.summary, /front→rear \[3, 4, 5, 6\]; front = 2, rear = 0/)
  assert.match(q.summary, /enqueue 6 at \[0\]/)
  const s = await ds({ stack: [1, 2], on: 'list', ops: ['push 3', 'pop', 'pop'] })
  assert.match(s.summary, /top → 1 → NULL/)
  const over = await ds({ stack: [1, 2], capacity: 2, ops: ['push 3'] })
  assert.deepEqual(problems(over), ['ops[0]: push 3: overflow, the stack is full (capacity 2)'])
})

test('heap push and pop sift along the right paths', async () => {
  const r = await renderAsync(load('heap.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /^ds heap \(min, 0-based\): \[2, 3, 5, 9, 7, 8\]; 6 items, height 2; children of i at 2i\+1, 2i\+2; heap order OK/)
  assert.match(r.summary, /push 2: sift up \[6\]→\[2\]; pop → 1: 5 to the root, sift down \[0\]→\[2\]/)
  const max = await ds({ heap: [9, 4, 7, 1, 8, 2], build: 'heapify', order: 'max' })
  assert.match(max.summary, /\[9, 8, 7, 1, 4, 2\]/)
  const bad = await ds({ heap: [1, 5, 3, 2], build: 'array' })
  assert.match(problems(bad)[0], /heap order broken: 2 at \[3\] is smaller than its parent 5 at \[1\]/)
})

test('hashing: linear, quadratic, and double probe sequences match the textbook tables', async () => {
  const r = await renderAsync(load('hash-linear.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /insert 31: h = 5, probes 5, 6, 7, 8, 9, 10 \(5 collisions\); insert 73: h = 8, probes 8, 9, 10, 11 \(3 collisions\)/)
  assert.match(r.summary, /n = 8, load factor 0\.62/)
  // Weiss, figures 5.13 and 5.18.
  const q = await ds({ hash: [89, 18, 49, 58, 69], m: 10, probe: 'quadratic' })
  assert.match(q.summary, /insert 58: h = 8, probes 8, 9, 2 .*insert 69: h = 9, probes 9, 0, 3/)
  const d = await ds({ hash: [89, 18, 49, 58, 69], m: 10, probe: 'double', h2: '7 - k mod 7' })
  assert.match(d.summary, /\[0\] 69, .*\[3\] 58, .*\[6\] 49/)
  const c = await ds({ hash: [15, 11, 27, 8, 12, 22], m: 7, ops: ['delete 8'] })
  assert.match(c.summary, /\[1\] 15→22/)
})

test('arrays: binary search probes, sort passes, and an unsorted search warns', async () => {
  const r = await renderAsync(load('sort-search.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /13 comparisons, 10 shifts → \[5, 10, 13, 14, 29, 37\]; search 14: mid=2 \(13\), mid=4 \(29\), mid=3 \(14\) → found at index 3 in 3 probes/)
  const sel = await ds({ array: [29, 10, 14, 37, 13], ops: ['sort selection'] })
  assert.match(sel.summary, /i=0 \[10, 29, 14, 37, 13\]; i=1 \[10, 13, 14, 37, 29\]; .* 10 comparisons, 3 swaps/)
  const quick = await ds({ array: [7, 2, 9, 4, 3, 8], ops: ['sort quick'] })
  assert.match(quick.summary, /^ds array: \[2, 3, 4, 7, 8, 9\]/)
  const un = await ds({ array: [3, 1, 2], ops: ['search 2'] })
  assert.match(problems(un)[0], /binary search needs a sorted array/)
})

test('bad input: unknown ops and two structures are errors', async () => {
  const r = await ds({ tree: [5], ops: ['rotate 5'] })
  assert.equal(r.svg, null)
  assert.match(r.text, /unknown op "rotate"/)
  const two = await ds({ tree: [5], list: [1] })
  assert.match(two.text, /one structure per diagram/)
})
