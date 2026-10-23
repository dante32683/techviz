import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { renderAsync } from '../src/index.js'

const load = (f) => JSON.parse(readFileSync(`examples/${f}`, 'utf8'))
const spec = (parts, extra = {}) => ({ v: 1, kind: 'circuit', parts, ...extra })
const warnings = (r) => r.diagnostics.filter((d) => d.level === 'warning')

for (const f of readdirSync('examples').filter((f) => f.startsWith('circuit-'))) {
  for (const theme of ['paper', 'dark', 'host']) {
    test(`${f} renders cleanly in ${theme}`, async () => {
      const r = await renderAsync(load(f), { theme })
      assert.ok(r.svg, r.text)
      assert.equal(r.diagnostics.length, 0, r.text)
    })
  }
}

test('two-mesh nets and loops', async () => {
  const r = await renderAsync(load('circuit-two-mesh.json'))
  assert.match(r.summary, /nets: b\{V1-,R2,V2-\} n1\{V1\+,R1\} a\{R1,R3,R2\} n2\{R3,V2\+\}/)
  assert.match(r.summary, /loops: I_\{1\} cw \{V1,R1,R2\}, I_\{2\} cw \{R2,R3,V2\}/)
})

test('wheatstone nets from diagonal parts', async () => {
  const r = await renderAsync(load('circuit-wheatstone.json'))
  assert.match(r.summary, /nets: a\{R1,R3,B1-\} b\{R1,R2,G\} c\{R2,Rx,B1\+\} d\{R3,Rx,G\}/)
})

test('switch state follows steps', async () => {
  const s = load('circuit-rc-switch.json')
  assert.match((await renderAsync(s, { step: 0 })).summary, /S1 open/)
  const closed = await renderAsync(s, { step: 1 })
  assert.match(closed.summary, /S1 closed; currents: i\(t\) n3→n4; voltages: v_\{C\}\(t\) \+n4 -n1/)
})

test('unknown part type is an error listing valid types', async () => {
  const r = await renderAsync(spec([{ id: 'R1', t: 'resistor' }]))
  assert.equal(r.svg, null)
  assert.match(r.text, /parts\[0\]\.t: unknown part type "resistor"; valid types: R, C, Cp/)
})

test('missing anchor and later part are errors', async () => {
  let r = await renderAsync(spec([{ id: 'R1', t: 'R' }, { t: 'wire', to: 'R1.foo' }]))
  assert.match(r.text, /parts\[1\]\.to: R1 has no anchor "foo"; use start, end, mid/)
  r = await renderAsync(spec([{ id: 'R1', t: 'R', from: 'R2.end' }, { id: 'R2', t: 'R' }]))
  assert.match(r.text, /R2 is drawn later/)
})

test('dangling ends, overlaps, and shorts warn', async () => {
  let r = await renderAsync(spec([{ id: 'V1', t: 'V', dir: 'up' }, { id: 'R1', t: 'R', dir: 'right' }, { id: 'R2', t: 'R', dir: 'down' }]))
  assert.ok(r.svg)
  assert.deepEqual(warnings(r).map((d) => d.path), ['parts[0]', 'parts[2]'])
  assert.match(r.text, /V1- \(start\) at \[0, 0\] touches nothing/)
  r = await renderAsync(spec([{ id: 'R1', t: 'R', dir: 'right' }, { t: 'wire', from: 'R1.start', dir: 'right', len: 2 }]))
  assert.match(r.text, /wire#1 is drawn over R1 from \[0, 0\] to \[2, 0\]/)
  r = await renderAsync(spec([{ id: 'R1', t: 'R', dir: 'right' }, { t: 'wire', dir: 'down' }, { t: 'wire', to: 'R1.start' }]))
  assert.match(r.text, /R1 is shorted: both ends are on net n1/)
})

test('a loop that is not a closed mesh warns', async () => {
  const r = await renderAsync(spec([
    { id: 'V1', t: 'V', dir: 'up' }, { id: 'R1', t: 'R', dir: 'right' }, { id: 'R2', t: 'R', dir: 'down' }, { t: 'wire', to: 'V1.start' },
  ], { loops: [{ in: ['V1', 'R1'], label: 'I' }] }))
  assert.ok(r.svg)
  assert.match(r.text, /loops\[0\]\.in: V1, R1 don't form one closed mesh/)
})

test('crowded labels warn', async () => {
  const r = await renderAsync(spec([
    { id: 'V1', t: 'V', dir: 'up', len: 2, label: 'V_{s}', value: '12 V' }, { id: 'R1', t: 'R', dir: 'right', len: 2, label: 'R_{1}', value: '1\\,k\\Omega' },
    { id: 'R2', t: 'R', dir: 'down', len: 2, label: 'R_{2}' }, { t: 'wire', to: 'V1.start' },
  ], { voltages: [{ across: 'R1', label: 'v_{1}' }] }))
  assert.match(r.text, /voltages\[0\]: the voltage marks on R1 overlap/)
})
