import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderAsync } from '../../index.js'

const load = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))
const problems = (r) => r.diagnostics.filter((d) => d.level !== 'note').map((d) => `${d.path}: ${d.msg}`)
const kmap = (fields) => renderAsync({ v: 1, kind: 'kmap', ...fields })

test('4 variables with a don\'t-care: corner group and center group; one step per group', async () => {
  const r = await renderAsync(load('corners-dc.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /Y = Σm\(0,2,5,7,8,10,13\) \+ d\(15\)/)
  assert.match(r.summary, /prime implicants: B'D', BD; essential: B'D', BD; minimal SOP: B'D' \+ BD \(2 terms, 4 literals\)/)
  assert.match(r.summary, /wraparound groups: B'D' \(m0,2,8,10\)/)
  assert.match(r.summary, /expect B'D' \+ BD: matches$/)
  assert.deepEqual(r.controls.steps, ['the map', "B'D' (essential)", 'BD (essential)'])
  // The corner group is four clipped pieces.
  assert.equal((r.svg.match(/clip-path="url\(#t-k0\)"/g) ?? []).length, 0) // uid differs from the test's
  const s0 = await renderAsync(load('corners-dc.json'), { step: 0, uid: 'u' })
  assert.match(s0.summary, /showing 0 of 2 groups/)
  const all = await renderAsync(load('corners-dc.json'), { uid: 'u' })
  assert.equal((all.svg.match(/clip-path="url\(#u-k0\)"/g) ?? []).length, 5) // 4 corner pieces + the center square
})

test('POS groups the zeros, wrapping top to bottom', async () => {
  const r = await renderAsync(load('pos.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /minimal POS: \(A \+ B\)\(B' \+ D\) \(2 factors, 4 literals\)/)
  assert.match(r.summary, /minimal SOP: AB' \+ BD/)
  assert.match(r.summary, /wraparound groups: \(B' \+ D\) \(m4,6,12,14\)/)
})

test('3 variables: a non-essential prime implicant is left out of the cover', async () => {
  const r = await renderAsync(load('three-var.json'))
  assert.match(r.summary, /prime implicants: A'B', AC', B'C'; essential: A'B', AC'; minimal SOP: A'B' \+ AC'/)
})

test('5 variables: two maps; a group spans both', async () => {
  const r = await renderAsync(load('five-var.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /minimal SOP: ABCE \+ C'E' \+ CD'E \(3 terms, 9 literals\)/)
  assert.match(r.summary, /C'E' \(m0,2,8,10,16,18,24,26\)/)
})

test('expect: wrong cells warn; a correct but longer answer is noted', async () => {
  const wrong = await kmap({ vars: ['A', 'B', 'C', 'D'], minterms: [0, 2, 5, 7, 8, 10, 13], dc: [15], expect: "B'D' + ABD" })
  assert.deepEqual(problems(wrong), ["expect: \"B'D' + ABD\" is wrong at m5, m7 (should be 1, should be 1)"])
  const long = await kmap({ vars: ['A', 'B', 'C'], minterms: [0, 1, 4, 6], expect: "A'B' + AC' + B'C'" })
  assert.deepEqual(problems(long), [])
  assert.match(long.summary, /matches, but the minimum has 2 terms/)
})

test('expr input, and errors for bad indices', async () => {
  const r = await kmap({ expr: "AB + A'C" })
  assert.match(r.summary, /kmap 3 variables \(A, B, C; A is the MSB\): Y = Σm\(1,3,6,7\)/)
  assert.match((await kmap({ vars: ['A', 'B'], minterms: [5] })).text, /5 is out of range for 2 variables/)
  assert.match((await kmap({ vars: ['A', 'B', 'C'], minterms: [1, 2], dc: [2] })).text, /2 is listed as both a minterm and a don't-care/)
  assert.match((await kmap({ minterms: [1], maxterms: [2] })).text, /give one of minterms, maxterms, or expr/)
})
