import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { renderAsync } from '../src/index.js'

const load = (f) => JSON.parse(readFileSync(`examples/${f}`, 'utf8'))

for (const f of readdirSync('examples').filter((f) => f.startsWith('wave-'))) {
  for (const theme of ['paper', 'dark', 'light', 'host']) {
    test(`${f} renders in ${theme}`, async () => {
      const r = await renderAsync(load(f), { theme, uid: 'w' })
      assert.ok(r.svg, r.text)
      assert.deepEqual(r.diagnostics, [])
      assert.doesNotMatch(r.svg, /xlink:href|class="s\d|#0041c4/)
      if (theme === 'host') assert.doesNotMatch(r.svg, /(fill|stroke|color)="var\(/)
    })
  }
}

test('summary lists cycles and per-cycle values', async () => {
  const r = await renderAsync({ v: 1, kind: 'wave', signal: [{ name: 'clk', wave: 'p.......' }, { name: 'rst', wave: '10......' }, { name: 'q', wave: 'x.=.=.=.', data: ['0', '1', '2'] }] })
  assert.ok(r.svg, r.text)
  assert.equal(r.summary, 'wave: 8 cycles, 3 signals; clk=clock(p); rst=[1, 0×7]; q=[x×2, 0×2, 1×2, 2×2]')
})

test('the D flip-flop example: q follows d at each rising edge after reset', async () => {
  const r = await renderAsync(load('wave-dff.json'))
  assert.match(r.summary, /d=\[0×2, 1×2, 0, 1×3\]; q=\[0×2, 1×2, 0, 1×3\]/)
})

test('a bad wave character is an error naming the signal', async () => {
  const r = await renderAsync({ v: 1, kind: 'wave', signal: [{ name: 'clk', wave: 'p..q' }] })
  assert.equal(r.svg, null)
  assert.match(r.text, /error at signal\[0\]\.wave: "clk" has "q" at position 3/)
})

test('data count and lane length mismatches warn with the signal name', async () => {
  const r = await renderAsync({ v: 1, kind: 'wave', signal: [{ name: 'a', wave: '0101' }, { name: 'bus', wave: '=.=', data: ['A'] }] })
  assert.ok(r.svg)
  assert.match(r.text, /signal\[1\]\.data: "bus" has 2 data slots .* but 1 data label/)
  assert.match(r.text, /signal\[1\]\.wave: "bus" spans 3 cycles but the longest signal spans 4/)
})

test('reg summary lists fields MSB first', async () => {
  const r = await renderAsync(load('wave-rtype.json'))
  assert.match(r.summary, /^reg: 32 bits; \[31:25\] funct7=0000000, \[24:20\] rs2=00111, .* \[6:0\] opcode=0110011$/)
})

test('pipeline schedules a load-use stall and checks forwarding', async () => {
  const r = await renderAsync(load('wave-pipeline.json'))
  assert.match(r.summary, /9 cycles, 2 stall cycles; lw: IF1 ID2 EX3 MEM4 WB5; add: IF2 ID3-4\(stall 1\) EX5/)
  const late = await renderAsync({ v: 1, kind: 'wave', pipeline: [{ id: 'lw', instr: 'lw x1, 0(x2)' }, { id: 'add', instr: 'add x3, x1, x4' }], forward: [{ from: 'lw.MEM', to: 'add.EX' }] })
  assert.match(late.text, /lw\.MEM ends in cycle 4 but add\.EX runs in cycle 4/)
  const bad = await renderAsync({ v: 1, kind: 'wave', pipeline: [{ instr: 'nop', stall: { EXE: 1 } }] })
  assert.match(bad.text, /no stage "EXE"/)
})
