import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderAsync } from '../../index.js'

const example = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))
const bb = (fields) => renderAsync({ v: 1, kind: 'breadboard', ...fields })
const warnings = (r) => r.diagnostics.filter((d) => d.level === 'warning').map((d) => `${d.path}: ${d.msg}`)

test('IV curve: the jumpers join the device, sense resistor, and ground rail into three nets', async () => {
  const r = await renderAsync(example('iv-curve.json'))
  assert.match(r.summary, /LO\[5a-e\]\{DUT\.1, LO\} MID\[9a-e,12a-e\]\{DUT\.2, Rs, MID\} GND\[18a-e,t-\]\{Rs, GND\}/)
})

test('op-amp: chip pins land on rows f and e from pin 1, and unused pins are listed as open', async () => {
  const r = await renderAsync(example('inverting-amp.json'))
  assert.match(r.summary, /n1\[13f-j,19f-j\]\{U1\.IN−, Rin, Rf\}/)
  assert.match(r.summary, /VOUT\[14a-e,19a-e\]\{U1\.OUT, Rf, VOUT\}/)
  assert.match(r.summary, /COM\[14f-j,t-,b-\]\{U1\.IN\+, COM\}/)
  assert.match(r.summary, /open: U1\.1, U1\.5, U1\.NC$/)
})

test('holes that do not exist are errors that name the fix', async () => {
  const gap = await bb({ wires: [{ from: 'a1', to: 't-18' }] })
  assert.equal(gap.svg, null)
  assert.match(gap.text, /wires\[0\]\.to: "t-18": rails have no hole at column 18 .*t-17 or t-19/)
  const off = await bb({ cols: 20, parts: [{ id: 'R1', t: 'R', pins: ['a1', 'a21'] }] })
  assert.match(off.text, /parts\[0\]\.pins\[1\]: "a21": the board has columns 1 to 20/)
  const row = await bb({ parts: [{ id: 'R1', t: 'R', pins: ['k1', 'a3'] }] })
  assert.match(row.text, /"k1" is not a hole/)
  const pins = await bb({ parts: [{ id: 'Q1', t: 'npn', pins: ['a1', 'a2'] }] })
  assert.match(pins.text, /npn needs "pins": 3 holes \(e, b, c\)/)
})

test('a part with both leads in one strip is shorted; a lone lead and a doubled hole warn', async () => {
  const r = await bb({
    parts: [{ id: 'R1', t: 'R', pins: ['a5', 'e5'] }, { id: 'R2', t: 'R', pins: ['a8', 'a12'] }, { id: 'D1', t: 'led', pins: ['a12', 'c14'] }],
    posts: [{ id: 'P', to: 'b8' }],
  })
  const w = warnings(r).join('\n')
  assert.match(w, /parts\[0\]\.pins: R1 is shorted: both leads are in 5a-e/)
  assert.match(w, /parts\[2\]\.pins: a12 already holds R2/)
  assert.match(w, /D1\.k is alone in 14a-e/)
  assert.doesNotMatch(w, /R1 is alone/, 'a shorted part is reported once, as shorted')
})

test('a part shorted through a jumper, and a wire that connects nothing', async () => {
  const r = await bb({
    parts: [{ id: 'C1', t: 'C', pins: ['a3', 'a7'] }],
    wires: [{ from: 'b3', to: 'b7' }, { from: 'f20', to: 'f24' }],
  })
  const w = warnings(r).join('\n')
  assert.match(w, /C1 is shorted: both leads are in net n1/)
  assert.match(w, /wires\[1\]: wire W2 connects nothing/)
})

test('nodes name a net and posts name theirs', async () => {
  const r = await renderAsync(example('rc-charge.json'))
  assert.match(r.summary, /v_\{C\}\[10f-j,13f-j\]\{R, C\+, CH2\}/)
  assert.match(r.summary, /COM\[15f-j,b-\]\{C-, COM\}/)
})

test('every bad hole and part is reported in one render, not just the first', async () => {
  const r = await bb({ cols: 30, parts: [{ id: 'R1', t: 'R', pins: ['c31', 'k9'] }, { id: 'Q1', t: 'npn', pins: ['a1', 'a2'] }], wires: [{ from: 'a1', to: 't-18' }] })
  assert.equal(r.svg, null)
  assert.match(r.text, /parts\[0\]\.pins\[0\]: "c31"/)
  assert.match(r.text, /parts\[0\]\.pins\[1\]: "k9" is not a hole/)
  assert.match(r.text, /npn needs "pins": 3 holes/)
  assert.match(r.text, /wires\[0\]\.to: "t-18"/)
})

test('half: "top" draws rows a-e and the top rails only, and rejects holes off that half', async () => {
  const parts = [{ id: 'R1', t: 'R', pins: ['a2', 'a6'] }]
  const full = await bb({ cols: 12, parts })
  const top = await bb({ cols: 12, half: 'top', parts })
  assert.ok(top.height < full.height * 0.7, `${top.height} vs ${full.height}`)
  assert.match(top.summary, /12 columns \(top half\)/)
  const bad = await bb({ cols: 12, half: 'top', parts: [{ id: 'R1', t: 'R', pins: ['a2', 'f2'] }], wires: [{ from: 'b+1', to: 'a1' }] })
  assert.match(bad.text, /"f2": a "half": "top" board has rows a-e only/)
  assert.match(bad.text, /"b\+1": a "half": "top" board has the top rails t\+ and t- only/)
  const wrong = await bb({ half: 'bottom' })
  assert.match(wrong.text, /half: half is "top"/)
})

test('a value label sits by its own part, not beside the next part over', async () => {
  const r = await bb({ cols: 12, parts: [{ id: 'R1', t: 'R', pins: ['a4', 'e4'], value: '1 kΩ' }, { id: 'R2', t: 'R', pins: ['c7', 'c10'] }] })
  const ends = [...r.svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="3.3"/g)].map((m) => [+m[1], +m[2]])
  const x4 = Math.min(...ends.map(([x]) => x)), x7 = Math.min(...ends.filter(([x]) => x > x4 + 1).map(([x]) => x))
  const lx = +r.svg.match(/<text x="([\d.]+)"[^>]*><tspan>1 kΩ/)[1]
  assert.ok(Math.abs(lx - x4) < Math.abs(lx - x7), `label at ${lx}, R1 at ${x4}, R2 at ${x7}`)
})

test('the nets are a note, so check_panel lists them', async () => {
  const r = await renderAsync(example('iv-curve.json'))
  const note = r.diagnostics.find((d) => d.level === 'note')
  assert.match(note.msg, /^nets: LO\[5a-e\]\{DUT\.1, LO\} MID/)
})
