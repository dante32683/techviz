import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderAsync } from '../../index.js'

const load = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))
const problems = (r) => r.diagnostics.filter((d) => d.level !== 'note').map((d) => `${d.path}: ${d.msg}`)
const graph = (fields) => renderAsync({ v: 1, kind: 'graph', ...fields })

test('bfs: visit order, levels, and tree edges, one step per visit', async () => {
  const r = await renderAsync(load('bfs-list.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /^graph \(undirected\): 6 nodes, 7 edges A-B, A-C, B-D, C-D, C-E, D-F, E-F; degree A:2 B:2 C:3 D:3 E:2 F:2/)
  assert.match(r.summary, /bfs from A \(neighbors in name order\): visit order A B C D E F; levels A:0 B:1 C:1 D:2 E:2 F:3; tree edges A-B, A-C, B-D, C-E, D-F; unreachable: none/)
  assert.deepEqual(r.controls.steps, ['bfs from A: enqueue A', 'visit A; enqueue B, C', 'visit B; enqueue D', 'visit C; enqueue E', 'visit D; enqueue F', 'visit E', 'visit F'])
})

test('dfs: discovery and finish times, back edges, and a reachable cycle', async () => {
  const r = await renderAsync(load('dfs-matrix.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /d\/f A:1\/10 B:2\/9 C:3\/4 D:5\/8 E:6\/7; tree edges A->B, B->C, B->D, D->E; back edges C->A, E->D \(has a cycle reachable from A\)/)
  assert.ok(r.controls.steps.includes('finish C (f = 4)'))
  const dag = await graph({ edges: ['1->2', '1->3', '2->4', '3->4'], run: 'dfs', start: '1' })
  assert.match(dag.summary, /back edges none \(no cycle reachable from 1\)/)
  // Edge order instead of name order changes the visit order.
  const given = await graph({ edges: ['A-C', 'A-B', 'C-D'], run: 'dfs', start: 'A', order: 'given' })
  assert.match(given.summary, /visit order A C D B/)
})

test('dijkstra: distances with their paths, and relaxations in the step labels', async () => {
  const r = await renderAsync(load('dijkstra.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /dijkstra from A: A 0, B 3 \(A→C→B\), C 2 \(A→C\), D 8 \(A→C→B→D\), E 10 \(A→C→B→D→E\), F 13 \(A→C→B→D→E→F\); order taken A C B D E F/)
  assert.ok(r.controls.steps.includes('take C (2); update B 4→3, D ∞→10, E ∞→12'))
  const neg = await graph({ edges: ['A->B 2', 'B->C -1'], run: 'dijkstra', start: 'A' })
  assert.match(problems(neg)[0], /negative weight on B->C -1/)
  const cut = await graph({ edges: ['A-B 1'], nodes: ['A', 'B', 'Z'], run: 'dijkstra', start: 'A' })
  assert.match(cut.summary, /Z ∞ \(unreachable\)/)
})

test('bad edges and starts are errors that say what to write', async () => {
  assert.match((await graph({ edges: ['A-B', 'B->C'] })).text, /mix of "-" and "->"/)
  assert.match((await graph({ edges: ['A to B'] })).text, /write "A-B", "A-B 4"/)
  assert.match((await graph({ edges: ['A-B'], run: 'bfs', start: 'Q' })).text, /no node "Q"/)
  assert.match((await graph({ edges: ['A-B 1', 'B-C'] })).text, /give every edge a weight/)
})
