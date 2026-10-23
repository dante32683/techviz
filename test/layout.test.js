import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { renderAsync } from '../src/index.js'

for (const f of readdirSync('examples').filter((f) => f.startsWith('layout-'))) {
  for (const theme of ['paper', 'dark', 'host']) {
    test(`${f} renders in ${theme}`, async () => {
      const r = await renderAsync(JSON.parse(readFileSync(`examples/${f}`, 'utf8')), { theme })
      assert.ok(r.svg, r.text)
      assert.equal(r.diagnostics.length, 0, r.text)
    })
  }
}

const struct = (fields, extra = {}) => renderAsync({ v: 1, kind: 'layout', struct: { name: 'S', fields }, ...extra })

test('struct {char; int; short}: offsets 0, 4, 8; sizeof 12; reordered sizeof 8', async () => {
  const r = await struct([{ name: 'c', type: 'char' }, { name: 'i', type: 'int' }, { name: 's', type: 'short' }], { reorder: true })
  assert.match(r.summary, /c @0 \(1\), i @4 \(4\), s @8 \(2\); padding 3 @1, 2 @10 tail = 5 bytes; sizeof 12, alignof 4/)
  assert.match(r.summary, /reordered \(i, s, c\): .*sizeof 8, alignof 4; saves 4 bytes/)
})

test('struct {char; double} depends on the ABI', async () => {
  const f = [{ name: 'c', type: 'char' }, { name: 'd', type: 'double' }]
  assert.match((await struct(f)).summary, /d @8 \(8\).*sizeof 16, alignof 8/)
  assert.match((await struct(f, { abi: 'ilp32' })).summary, /d @4 \(8\).*sizeof 12, alignof 4/)
  assert.match((await struct(f, { abi: 'rv32' })).summary, /d @8 \(8\).*sizeof 16, alignof 8/)
  assert.match((await struct([{ name: 'c', type: 'char' }, { name: 'p', type: 'int *' }], { abi: 'rv32' })).summary, /p @4 \(4\).*sizeof 8/)
  assert.match((await struct(f, { packed: true })).summary, /d @1 \(8\).*sizeof 9, alignof 1/)
})

test('nested struct and arrays', async () => {
  const r = await struct([{ name: 'tag', type: 'char[3]' }, { name: 'pt', type: 'struct point', fields: [{ name: 'x', type: 'int' }, { name: 'y', type: 'int' }] }, { name: 'n', type: 'long' }])
  assert.match(r.summary, /tag @0 \(3\), pt @4 \(8\), n @16 \(8\).*sizeof 24, alignof 8/)
})

test('bytes: little- and big-endian order', async () => {
  const r = await renderAsync({ v: 1, kind: 'layout', bytes: { value: '0x12345678' } })
  assert.match(r.summary, /little-endian 78 56 34 12; big-endian 12 34 56 78/)
  const neg = await renderAsync({ v: 1, kind: 'layout', bytes: { value: -2, size: 2, endian: 'little' } })
  assert.match(neg.summary, /little-endian fe ff/)
  const fl = await renderAsync({ v: 1, kind: 'layout', bytes: { value: 1.5, type: 'float', endian: 'big' } })
  assert.match(fl.summary, /big-endian 3f c0 00 00/)
})

test('map: sizes, gaps, overlap error', async () => {
  const r = await renderAsync({ v: 1, kind: 'layout', map: { regions: [{ name: 'text', from: '0x0', size: '64K' }, { name: 'data', from: '0x10000000', size: '4K' }] } })
  assert.match(r.summary, /text 0x00000000-0x0000FFFF \(64 KiB\), gap 0x00010000-0x0FFFFFFF, data 0x10000000-0x10000FFF \(4 KiB\)/)
  const bad = await renderAsync({ v: 1, kind: 'layout', map: { regions: [{ name: 'a', from: '0x0', to: '0xFF' }, { name: 'b', from: '0x80', size: 16 }] } })
  assert.match(bad.text, /overlaps a/)
})

test('unknown field type is an error naming the field', async () => {
  const r = await struct([{ name: 'w', type: 'wchar' }])
  assert.equal(r.svg, null)
  assert.match(r.text, /struct\.fields\[0\]\.type: unknown type "wchar"/)
})
