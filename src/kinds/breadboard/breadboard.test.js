import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderAsync } from '../../index.js'
import { resistorBands } from './parts.js'

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

test('a resistor value gives its color bands: 4 for two significant digits, 5 for three', () => {
  const code = (v, want) => resistorBands(v, want)?.bands?.join('-')
  assert.equal(code('100\\,\\Omega'), 'brown-black-brown-gold')
  assert.equal(code('16.2\\,\\Omega'), 'brown-blue-red-gold-brown')
  assert.equal(code('4.7\\,k\\Omega'), 'yellow-violet-red-gold')
  assert.equal(code('1\\,M\\Omega'), 'brown-black-green-gold')
  assert.equal(code('0.47\\,\\Omega'), 'yellow-violet-silver-gold')
  assert.equal(code('330\\,\\Omega'), 'orange-orange-brown-gold')
  assert.equal(code('1 kΩ'), 'brown-black-red-gold')
  assert.equal(code('22\u2126'), 'red-red-black-gold', 'the ohm sign as well as capital omega')
  assert.equal(code('10\\,\\mathrm{k}\\Omega'), 'brown-black-orange-gold')
  assert.equal(code('100\\,\\Omega', 5), 'brown-black-black-black-brown')
  assert.equal(code('16.2\\,\\Omega', 4), 'brown-blue-red-gold-brown', 'three digits need 5 bands whatever is asked')
  for (const v of ['R_{s}', '?', '10\\,\\mu F', '', undefined, '0\\,\\Omega']) assert.equal(resistorBands(v), null, String(v))
  for (const v of ['1.234\\,k\\Omega', '0.01\\,\\Omega']) assert.deepEqual(resistorBands(v), { bands: null }, v)
})

test('banded resistors are listed in the summary; an unparseable value keeps the plain body', async () => {
  const iv = await renderAsync(example('iv-curve.json'))
  assert.match(iv.summary, /3 posts; bands: Rs brown-blue-red-gold-brown; nets:/)
  const r = await bb({ cols: 12, parts: [{ id: 'R1', t: 'R', pins: ['a2', 'a6'], value: 'R_{x}' }, { id: 'R2', t: 'R', pins: ['c2', 'c6'] }] })
  assert.doesNotMatch(r.summary, /bands/)
  assert.equal(warnings(r).length, 0)
  assert.doesNotMatch(r.svg, /#8b4a1d|#1a1a1a/, 'no band colors drawn')
})

test('a value with no color code and a band count that does not fit both warn', async () => {
  const r = await bb({ cols: 12, parts: [{ id: 'R1', t: 'R', pins: ['a2', 'a6'], value: '1.234\\,k\\Omega' },
    { id: 'R2', t: 'R', pins: ['c2', 'c6'], value: '16.2\\,\\Omega', bands: 4 }, { id: 'C1', t: 'C', pins: ['e2', 'e6'], bands: 5 }] })
  const w = warnings(r).join('\n')
  assert.match(w, /parts\[0\]\.value: "1\.234\\,k\\Omega" has no color code/)
  assert.match(w, /parts\[1\]\.bands: "16\.2\\,\\Omega" has no 4-band code; drawn with 5 bands/)
  assert.match(w, /parts\[2\]\.bands: only resistors/)
  assert.match(r.summary, /bands: R2 brown-blue-red-gold-brown;/)
})

test('the nets are a note, so check_panel lists them', async () => {
  const r = await renderAsync(example('iv-curve.json'))
  const note = r.diagnostics.find((d) => d.level === 'note')
  assert.match(note.msg, /^nets: LO\[5a-e\]\{DUT\.1, LO\} MID/)
})

test('the mydaq preset: a vertical 60-row board with caps, its header pins wired by name into the nets', async () => {
  const r = await renderAsync(example('mydaq-lab4.json'))
  assert.equal(warnings(r).length, 0, warnings(r).join('\n'))
  assert.match(r.summary, /^breadboard: mydaq board, 60 rows \(vertical\); headers AJ1, DIG, AJ2, SW5V;/)
  assert.match(r.summary, /FAN\+\[3A-E,30A-E,l\+,r\+\]\{R1, S1\.1, FAN\+, AJ2\.5V\}/)
  assert.match(r.summary, /AJ1\.AI0\+\[7A-E\]\{R1, NTC\.1, AJ1\.AI0\+\}/)
  assert.match(r.summary, /DIG\.DIO4\[30F-J\]\{S1\.4, R2, DIG\.DIO4\}/)
  assert.ok(r.height > r.width, 'drawn standing up')
  for (const t of ['AI1 DIGITAL', 'DIO7', 'Wiper', '+5V ON/OFF switch']) assert.ok(r.svg.includes(t), t)
})

test('header pins: by id or a unique label, case and minus sign aside; repeats and unknowns name the fix', async () => {
  const ok = await bb({ preset: 'mydaq', wires: [{ from: 'aj2.+5v', to: 'r+3' }, { from: 'AJ1.0−', to: 'A3' }, { from: 'AJ1.PWRGND', to: 'l-3' }] })
  assert.match(ok.summary, /AJ2\.5V\[3A-E,r\+\]|\{AJ2\.5V/)
  assert.match(ok.summary, /AJ1\.AI0-/)
  const amb = await bb({ preset: 'mydaq', wires: [{ from: 'AJ1.GND', to: 'a3' }] })
  assert.match(amb.text, /AJ1 has 3 pins labeled GND; name one by its id: AJ1\.PWRGND, AJ1\.AOGND, AJ1\.AI0GND/)
  const none = await bb({ preset: 'mydaq', wires: [{ from: 'AJ2.9V', to: 'a3' }, { from: 'XX.1', to: 'a4' }] })
  assert.match(none.text, /AJ2 has no pin "9V"; its pins are G, Y, R/)
  assert.match(none.text, /no header "XX"; the headers are AJ1, DIG, AJ2, SW5V/)
  const off = await bb({ preset: 'mydaq', rows: 30, wires: [{ from: 'AJ2.5V', to: 'a3' }] })
  assert.match(off.text, /header AJ2 starts at row 39, past this 30-row board, so it isn't drawn; give "rows": 50 or more/)
  const dup = await bb({ headers: [{ id: 'J1', pins: ['GND', 'GND'] }] })
  assert.match(dup.text, /two pins have the id "GND"/)
})

test('a header pin wire defaults to red for a supply and black for ground', async () => {
  const r = await bb({ cols: 12, headers: [{ id: 'J1', at: 2, pins: ['5V', 'GND', 'A0'] }],
    parts: [{ id: 'R1', t: 'R', pins: ['c2', 'c6'] }], wires: [{ from: 'J1.5V', to: 'a2' }, { from: 'J1.GND', to: 'a6' }] })
  assert.equal(warnings(r).length, 0, warnings(r).join('\n'))
  assert.match(r.summary, /J1\.5V\[2a-e\]\{R1, J1\.5V\} J1\.GND\[6a-e\]\{R1, J1\.GND\}/)
  const red = (await bb({ cols: 12, wires: [{ from: 't+2', to: 'a2' }], parts: [{ id: 'R1', t: 'R', pins: ['c2', 'c6'] }] })).svg
  const stroke = (svg) => [...svg.matchAll(/stroke="([^"]+)" stroke-width="3.4"/g)].map((m) => m[1])
  assert.equal(stroke(r.svg)[0], stroke(red)[0])
})

test('rails: chosen per side in page order; a missing rail or a horizontal name on a vertical board names the fix', async () => {
  const none = await bb({ cols: 12, rails: { top: '+', bottom: '' }, wires: [{ from: 'b+1', to: 'a1' }] })
  assert.match(none.text, /"b\+1": this board's rails are t\+$/m)
  const vert = await bb({ orient: 'vertical', rows: 12, wires: [{ from: 't-2', to: 'a1' }] })
  assert.match(vert.text, /"t-2": this board's rails are l\+, l-, r-, r\+; on a vertical board that is l-2/)
  const bad = await bb({ rails: { left: '+-' } })
  assert.match(bad.text, /a horizontal board's rail sides are top and bottom/)
  const gaps = await bb({ cols: 12, railGaps: false, parts: [{ id: 'R1', t: 'R', pins: ['t+6', 'a6'] }], wires: [{ from: 't+1', to: 'a1' }] })
  assert.doesNotMatch(gaps.text, /error/)
})

test('a vertical board puts an ic\'s pin 1 top left in row e, and holes take either case with caps', async () => {
  const r = await bb({ orient: 'vertical', rows: 12, caps: true, parts: [{ id: 'U1', t: 'ic', col: 3, pins: 8 }, { id: 'R1', t: 'R', pins: ['A3', 'a7'] }] })
  assert.match(r.summary, /12 rows \(vertical\)/)
  assert.match(r.summary, /n1\[3A-E\]\{U1\.1, R1\}/)
  const flat = await bb({ cols: 12, parts: [{ id: 'U1', t: 'ic', col: 3, pins: 8 }, { id: 'R1', t: 'R', pins: ['a3', 'a7'] }] })
  assert.match(flat.summary, /n1\[3a-e\]\{U1\.8, R1\}/, 'horizontal: pin 1 is in row f, so e3 holds pin 8')
})

test('board options that do not fit are errors', async () => {
  assert.match((await bb({ orient: 'sideways' })).text, /orient is "horizontal"/)
  assert.match((await bb({ orient: 'vertical', half: 'top' })).text, /half works on a horizontal board only/)
  assert.match((await bb({ cols: 20, rows: 20 })).text, /give "cols" or "rows", not both/)
  assert.match((await bb({ preset: 'arduino' })).text, /unknown preset "arduino"; use mydaq/)
})

test('round 1 of practice: header-to-header nets, unknown colors, and where a doubled wire should go', async () => {
  const r = await bb({ preset: 'mydaq', wires: [{ from: 'AJ2.Wiper', to: 'DIG.AI1+' }] })
  assert.match(r.summary, /AJ2\.Wiper\{AJ2\.Wiper, DIG\.AI1\+\}/, 'no empty strip list')
  const c = await bb({ cols: 12, parts: [{ id: 'R1', t: 'R', pins: ['a2', 'a6'] }], wires: [{ from: 'b2', to: 'b6', color: 'yellow' }] })
  assert.match(warnings(c).join('\n'), /wires\[0\]\.color: "yellow" isn't a color; use blue, teal/)
  const d = await bb({ cols: 12, parts: [{ id: 'R1', t: 'R', pins: ['a2', 'a6'] }, { id: 'R2', t: 'R', pins: ['c6', 'c10'] }], wires: [{ from: 'a2', to: 't-3' }] })
  assert.match(warnings(d).join('\n'), /a2 already holds R1; a hole takes one lead; use a free hole in 2a-e, which the board connects/)
})

test('round 3 of practice: the myDAQ board\'s GND pins are one tied net named GND', async () => {
  const r = await bb({ preset: 'mydaq', parts: [{ id: 'R1', t: 'R', pins: ['c3', 'c7'] }],
    wires: [{ from: 'AJ2.GND', to: 'a3' }, { from: 'AJ1.AI0GND', to: 'a7' }, { from: 'DIG.DIO1', to: 'AJ2.R' }, { from: 'DIG.DIO2', to: 'AJ2.G' }] })
  assert.match(r.summary, /GND\[3A-E,7A-E\]\{R1, R1, AJ2\.GND, AJ1\.AI0GND\}/)
  assert.match(warnings(r).join('\n'), /R1 is shorted: both leads are in net GND/)
  const mine = await bb({ cols: 12, headers: [{ id: 'J1', pins: [{ id: 'G1', label: 'GND', tie: 'G' }, 'X', { id: 'G2', label: 'GND', tie: 'G' }] }],
    parts: [{ id: 'R1', t: 'R', pins: ['c3', 'c7'] }], wires: [{ from: 'J1.G1', to: 'a3' }, { from: 'J1.X', to: 'a7' }, { from: 'J1.G2', to: 't-2' }] })
  assert.match(mine.summary, /G\[3a-e,t-\]\{R1, J1\.G1, J1\.G2\}/)
})
