import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { renderAsync } from '../../index.js'

const load = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))

test('pointer summary lists targets and addresses', async () => {
  const r = await renderAsync(load('pointers.json'))
  assert.match(r.summary, /p -> x \(0x7ffd0ffc\)/)
  assert.match(r.summary, /pp -> p \(0x7ffd0ff0\)/)
  // A pointer's box shows its target's address.
  assert.match(r.svg, />0x7ffd0ffc</)
})

test('2D arrays: row pointers and the strip resolve', async () => {
  const r = await renderAsync(load('2d-arrays.json'))
  assert.match(r.summary, /grid -> rows, rows\[0\] -> r0, rows\[1\] -> r1, rows\[2\] -> r2/)
  assert.match(r.summary, /a -> strip/)
})

test('freed targets are flagged dangling; NULL is flagged', async () => {
  const mf = await renderAsync(load('malloc-free.json'))
  assert.match(mf.summary, /q -> blk \(0x55a042a0\) \(DANGLING: freed\)/)
  const before = await renderAsync(load('malloc-free.json'), { step: 2 })
  assert.doesNotMatch(before.summary, /DANGLING/)
  const n = await renderAsync(load('null.json'))
  assert.match(n.summary, /p -> NULL/)
})

test('cell pointers use element offsets; rv32 uses 4-byte pointers', async () => {
  const spec = { v: 1, kind: 'memory', abi: 'rv32', frames: [{ id: 'main', vars: [
    { id: 'a', type: 'int[4]', cells: [1, 2, 3, 4] }, { id: 'p', type: 'int *', ptr: 'a[2]' }, { id: 's', type: 'char *', ptr: null }] }] }
  const r = await renderAsync(spec)
  assert.ok(r.svg, r.text)
  // a: 16 bytes below 0x7fffeffc -> 0x7fffefec; a[2] is 8 bytes in.
  assert.match(r.summary, /a 0x7fffefec/)
  assert.match(r.summary, /p -> a\[2\] \(0x7fffeff4\)/)
  assert.match(r.summary, /p 0x7fffefe8/)
})

test('errors: unknown target lists ids, index out of range, duplicate ids', async () => {
  const base = (vars, heap) => ({ v: 1, kind: 'memory', frames: [{ id: 'main', vars }], heap })
  let r = await renderAsync(base([{ id: 'p', type: 'int *', ptr: 'y' }, { id: 'x', type: 'int', value: 1 }]))
  assert.equal(r.svg, null)
  assert.match(r.text, /no item "y"; ids: p, x/)
  r = await renderAsync(base([{ id: 'p', type: 'int *', ptr: 'b[4]' }], [{ id: 'b', type: 'int[4]', cells: [0, 0, 0, 0] }]))
  assert.match(r.text, /b has 4 cells \(0-3\); b\[4\] is out of range/)
  r = await renderAsync(base([{ id: 'x', type: 'int' }, { id: 'x', type: 'int' }]))
  assert.match(r.text, /duplicate id "x"/)
  r = await renderAsync(base([{ type: 'int', value: 1 }, { id: 'y' }]))
  assert.ok(r.svg)
  assert.equal(r.diagnostics.filter((d) => d.level === 'warning').length, 2)
})
