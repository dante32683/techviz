import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderAsync } from '../../index.js'
import { parseExpr, mintermsOf, minimize, sopText, posText } from './bool.js'

const load = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))
const problems = (r) => r.diagnostics.filter((d) => d.level !== 'note').map((d) => `${d.path}: ${d.msg}`)
const logic = (fields, opts) => renderAsync({ v: 1, kind: 'logic', ...fields }, opts)

test('Boolean engine: parsing, minterms, minimal SOP and POS', () => {
  const ast = parseExpr("AB + Cin(A ^ B)")
  assert.deepEqual(mintermsOf(ast, ['A', 'B', 'Cin']), [3, 5, 6, 7])
  assert.deepEqual(mintermsOf(parseExpr("~(A + B)C' + !D'"), ['A', 'B', 'C', 'D']), [0, 1, 3, 5, 7, 9, 11, 13, 15])
  const r = minimize([0, 2, 5, 7, 8, 10, 13], [15], 4)
  assert.equal(sopText(r.cover, ['A', 'B', 'C', 'D'], [0]), "B'D' + BD")
  const zeros = [0, 1, 2, 4]
  assert.equal(posText(minimize(zeros, [], 3).cover, ['A', 'B', 'C'], zeros), '(A + B)(A + C)(B + C)') // majority
  assert.throws(() => parseExpr('A + (B'), /no matching/)
})

test('full adder from gates: truth tables, minimal SOP, expect, critical path, values', async () => {
  const r = await renderAsync(load('full-adder.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /S = Σm\(1,2,4,7\) = A'B'Cin \+ A'BCin' \+ AB'Cin' \+ ABCin \(minimal SOP\)/)
  assert.match(r.summary, /Cout = Σm\(3,5,6,7\) = AB \+ ACin \+ BCin/)
  assert.match(r.summary, /expect S = A \^ B \^ Cin: matches; expect Cout = AB \+ ACin \+ BCin: matches/)
  assert.match(r.summary, /critical path 3 gate delays: [AB] → x1 → a2 → Cout/)
  assert.match(r.summary, /values: A=1 B=1 Cin=0 → S=0 Cout=1/)
  // A wire fans out: junction dots are drawn.
  assert.match(r.svg, /<circle[^>]*r="2.6"/)
})

test('a wrong expect warns with the first row that differs', async () => {
  const spec = load('full-adder.json')
  spec.expect = { Cout: 'AB + Cin' }
  const r = await renderAsync(spec)
  assert.deepEqual(problems(r), ['expect.Cout: Cout doesn\'t match "AB + Cin": 1 of 8 rows differ, first at A=0 B=0 Cin=1 (circuit 0, expected 1); circuit Σm(3,5,6,7), expected Σm(1,3,5,6,7)'])
  assert.match(r.summary, /expect Cout: MISMATCH/)
})

test('4:1 mux from 2:1 muxes matches its SOP; select from the top', async () => {
  const r = await renderAsync(load('mux4.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /Y = S1'S0'D0 \+ S1'S0D1 \+ S1S0'D2 \+ S1S0D3 \(minimal SOP\); expect Y = .*: matches/)
  assert.match(r.summary, /S1=1 S0=0 D0=0 D1=1 D2=1 D3=0 → Y=1/)
})

test('diagnostics: undriven net, several drivers, unused output and input, combinational loop', async () => {
  const typo = await logic({ inputs: ['A', 'B'], parts: [{ id: 'g', t: 'and', in: ['A', 'b'] }] })
  assert.deepEqual(problems(typo), ['parts[0].in: net "b" has no driver (did you mean B?); add it to inputs or fix the name', 'inputs: input B is unused'])
  const two = await logic({ inputs: ['A', 'B'], parts: [{ id: 'g1', t: 'and', in: ['A', 'B'], out: 'Y' }, { id: 'g2', t: 'or', in: ['A', 'B'], out: 'Y' }], outputs: ['Y'] })
  assert.ok(problems(two).some((p) => /net "Y" has 2 drivers \(g1, g2\); only tri-state buffers may share a net/.test(p)))
  const unused = await logic({ inputs: ['A', 'B'], parts: [{ id: 'g1', t: 'and', in: ['A', 'B'] }, { id: 'g2', t: 'not', in: ['A'] }], outputs: ['g1'] })
  assert.deepEqual(problems(unused), ['parts[1]: the output of g2 is unused; connect it or list it in outputs'])
  const sr = await logic({ inputs: { S: 0, R: 0 }, parts: [{ id: 'Q', t: 'nor', in: ['R', 'Qb'] }, { id: 'Qb', t: 'nor', in: ['S', 'Q'] }], outputs: ['Q', 'Qb'] })
  assert.ok(problems(sr).some((p) => /combinational loop: Q → Qb → Q/.test(p)), problems(sr).join('\n'))
  assert.ok(sr.svg)
})

test('tri-state buffers share a bus: the enabled one drives it', async () => {
  const spec = { inputs: { A: 1, B: 0, S: 1 }, parts: [
    { id: 't0', t: 'tri', in: ['A'], en: '~S', out: 'Y' }, { id: 't1', t: 'tri', in: ['B'], en: 'S', out: 'Y' }], outputs: ['Y'] }
  const r = await logic(spec)
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /S=1 → Y=0/)
  assert.match(r.summary, /Y = Σm\(3,4,6,7\) = AS' \+ BS \(minimal SOP\)/)
})

test('expressions build gates; simplify draws the minimal SOP', async () => {
  const r = await renderAsync(load('sop-expr.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /Y = Σm\(0,4,5\) = AB' \+ B'C' \(minimal SOP\)/)
  assert.match(r.summary, /2 not, 2 and, 1 or/)
  assert.equal(r.controls.steps.length, 8)
  const raw = await logic({ expr: { Y: "~(AB) + C'" } })
  assert.match(raw.summary, /1 nand/)
  assert.match(raw.summary, /Y = Σm\(0,1,2,3,4,5,6\)/)
})

test('counter: one step per clock cycle, reset in cycle 0', async () => {
  const spec = load('counter.json')
  const r = await renderAsync(spec)
  assert.deepEqual(problems(r), [])
  assert.equal(r.controls.steps.length, 6)
  assert.equal(r.controls.steps[0], 'cycle 0: reset=1')
  assert.match(r.summary, /cycle 5 of 5: reset=0 → Q=0100; state q=0100→0101 at the next edge/)
  const c2 = await renderAsync(spec, { step: 2 })
  assert.match(c2.summary, /Q=0001/)
  assert.match(r.summary, /critical path 1 level: q → sum → q.d/)
})

test('PC next-state logic: 32-bit buses, branch taken in cycle 1', async () => {
  const pcs = []
  for (const step of [0, 1, 2]) pcs.push(/PC=(0x[0-9A-F]+)/.exec((await renderAsync(load('pc-next.json'), { step })).summary)[1])
  assert.deepEqual(pcs, ['0x0', '0x4', '0xC'])
  const r = await renderAsync(load('pc-next.json'))
  assert.match(r.summary, /2 inputs \(PCSrc, ImmExt\[31:0\]\), 1 output \(PC\[31:0\]\)/)
  assert.match(r.svg, /stroke-width="2.4"/) // buses are drawn thick
})

test('blocks: decoder, ALU, register file, comparator, priority encoder', async () => {
  const dec = await logic({ inputs: { A1: 1, A0: 0 }, parts: [{ id: 'd', t: 'dec', in: ['A1', 'A0'] }], outputs: ['d', 'd.y1', 'd.y2', 'd.y3'] })
  assert.deepEqual(problems(dec), [])
  assert.match(dec.summary, /d=0 d.y1=0 d.y2=1 d.y3=0/)
  const alu = (op, a, b) => logic({ inputs: { 'A[7:0]': a, 'B[7:0]': b, 'F[2:0]': op }, parts: [{ id: 'alu', t: 'alu', in: ['A', 'B'], op: 'F' }], outputs: { Y: 'alu', Z: 'alu.zero' } })
  assert.match((await alu(1, 5, 5)).summary, /Y=0x0 Z=1/)
  assert.match((await alu(5, 3, 250)).summary, /Y=0x0 Z=1/) // slt is signed: 3 < -6 is false
  assert.match((await alu(5, 250, 3)).summary, /Y=0x1 Z=0/)
  const rf = await logic({ inputs: { 'A1[4:0]': 5, 'A2[4:0]': 0, 'A3[4:0]': 6, 'WD[31:0]': 9, WE: 1 },
    parts: [{ id: 'rf', t: 'regfile', in: ['A1', 'A2', 'A3', 'WD'], we: 'WE', init: { 5: 7, 0: 3 } }], outputs: { RD1: 'rf.rd1', RD2: 'rf.rd2' } })
  assert.match(rf.summary, /RD1=0x7 RD2=0x0; rf writes x6=0x9 at the next edge/)
  const cmp = await logic({ inputs: { 'A[3:0]': 3, 'B[3:0]': 9 }, parts: [{ id: 'c', t: 'cmp', in: ['A', 'B'] }], outputs: ['c.eq', 'c.lt', 'c.gt'] })
  assert.match(cmp.summary, /c.eq=0 c.lt=1 c.gt=0/)
  const enc = await logic({ inputs: { D0: 1, D1: 0, D2: 1, D3: 0 }, parts: [{ id: 'e', t: 'enc', in: ['D0', 'D1', 'D2', 'D3'] }], outputs: ['e', 'e.v'] })
  assert.match(enc.summary, /e=10 e.v=1/)
})

test('a flip-flop with feedback gives next-state equations', async () => {
  const r = await logic({ inputs: ['T'], parts: [{ id: 'x', t: 'xor', in: ['T', 'q'] }, { id: 'q', t: 'dff', in: ['x'] }], outputs: ['q'] })
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /next q = Σm\(1,2\) = T'q \+ Tq' \(minimal SOP\)/)
})

test('bad specs: unknown part type, bad reference, bus too wide for a value', async () => {
  const t = await logic({ inputs: ['A'], parts: [{ id: 'g', t: 'andd', in: ['A', 'A'] }] })
  assert.match(t.text, /unknown part "andd"/)
  const ref = await logic({ inputs: ['A'], parts: [{ id: 'g', t: 'not', in: ['A[1:2]'] }] })
  assert.match(ref.text, /write the slice high bit first/)
  const v = await logic({ inputs: { 'A[1:0]': 7 }, parts: [{ id: 'g', t: 'not', in: ['A'] }] })
  assert.match(v.text, /7 doesn't fit in 2 bits/)
})
