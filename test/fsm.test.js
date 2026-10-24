import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { renderAsync } from '../src/index.js'

const load = (f) => JSON.parse(readFileSync(`examples/${f}`, 'utf8'))

for (const f of readdirSync('examples').filter((f) => f.startsWith('fsm-'))) {
  for (const theme of ['paper', 'dark', 'light', 'host']) {
    test(`${f} renders in ${theme}`, async () => {
      const r = await renderAsync(load(f), { theme, uid: 'f' })
      assert.ok(r.svg, r.text)
      assert.deepEqual(r.diagnostics, [])
      assert.doesNotMatch(r.svg, /Times-Roman|"Times,serif"|#000000/)
      if (theme === 'host') assert.doesNotMatch(r.svg, /(fill|stroke)="var\(/)
    })
  }
}

test('summary lists transitions and outputs', async () => {
  const r = await renderAsync(load('fsm-moore-101.json'))
  assert.match(r.summary, /^fsm moore: 4 states \(init S0\), 8 transitions: S0 -0-> S0, S0 -1-> S1, /)
  assert.match(r.summary, /outputs S0\[y=0\] S1\[y=0\] S2\[y=0\] S3\[y=1\]; unreachable: none$/)
  const m = await renderAsync(load('fsm-mealy-101.json'))
  assert.match(m.summary, /S2 -1 \/ 1-> S1/)
})

test('an edge to a missing state is an error', async () => {
  const r = await renderAsync({ v: 1, kind: 'fsm', states: [{ id: 'A', init: true }, { id: 'B' }], edges: [{ from: 'A', to: 'C', on: '1' }] })
  assert.equal(r.svg, null)
  assert.match(r.text, /error at edges\[0\]\.to: no state "C"; states are A, B/)
})

test('unreachable states, missing outputs, and incomplete transitions warn', async () => {
  const r = await renderAsync({
    v: 1, kind: 'fsm', machine: 'moore', inputs: ['0', '1'], complete: true,
    states: [{ id: 'A', init: true, out: 'y=0' }, { id: 'B' }, { id: 'C', out: 'y=1' }],
    edges: [{ from: 'A', to: 'B', on: '1' }, { from: 'A', to: 'A', on: '0' }, { from: 'B', to: 'A', on: '0,1' }],
  })
  assert.ok(r.svg, r.text)
  assert.match(r.text, /states\[1\]\.out: Moore state "B" has no output/)
  assert.match(r.text, /state "C" can't be reached from A/)
  assert.match(r.text, /state "C" has no transition on "0", "1"/)
  assert.doesNotMatch(r.text, /state "B" has no transition/)
  assert.match(r.summary, /unreachable: C$/)
})

test('highlight colors the current state and the edge taken', async () => {
  const spec = load('fsm-uart-tx.json')
  const r = await renderAsync(spec, { step: 1, theme: 'paper' })
  assert.equal((r.svg.match(/#E24B4A/g) ?? []).length >= 4, true)
})

test('bad DOT reports the Graphviz error', async () => {
  const r = await renderAsync({ v: 1, kind: 'fsm', dot: 'digraph { a -> }' })
  assert.equal(r.svg, null)
  assert.match(r.text, /error at dot: Graphviz/)
})
