import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderAsync } from '../../index.js'

const load = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))
const problems = (r) => r.diagnostics.filter((d) => d.level !== 'note').map((d) => `${d.path}: ${d.msg}`)

// The 3-4-5 king-post truss, by hand: Ay = Cy = 5 (symmetry). Joint A: AD·4/5 = −5, so
// AD = −6.25 (C); AB + AD·3/5 = 0, so AB = 3.75 (T). Joint B: BD − 10 = 0, so BD = 10 (T).
const KING = { v: 1, kind: 'truss', unit: 'kN', joints: { A: [0, 0], B: [3, 0], C: [6, 0], D: [3, 4] },
  members: ['AB', 'BC', 'AD', 'CD', 'BD'], supports: [{ at: 'A', type: 'pin' }, { at: 'C', type: 'roller' }] }

test('king-post: reactions and member forces match the hand solution', async () => {
  const r = await renderAsync(load('king-post.json'))
  assert.deepEqual(problems(r), [])
  assert.equal(r.summary, 'truss: 4 joints, 5 members, 3 reactions (m + r = 2j, determinate); loads ΣF = (0, -10) kN; ' +
    'reactions A_{x} = 0, A_{y} = 5 kN, C_{y} = 5 kN; members AB 3.75 kN T, BC 3.75 kN T, AD 6.25 kN C, CD 6.25 kN C, BD 10 kN T')
})

test('a load at the apex makes the king post a zero-force member', async () => {
  const r = await renderAsync({ ...KING, loads: [{ at: 'D', mag: 10, dir: 'down', label: '10 kN' }], forces: true })
  assert.match(r.summary, /members AB 3.75 kN T, BC 3.75 kN T, AD 6.25 kN C, CD 6.25 kN C, BD 0 \(zero-force\)$/)
  assert.match(r.svg, /stroke-dasharray="5 4"/)
})

test('pratt bridge: chords, end posts, and the unloaded center vertical', async () => {
  const r = await renderAsync(load('pratt-bridge.json'))
  assert.match(r.summary, /reactions A_\{x\} = 0, A_\{y\} = 20 kN, E_\{y\} = 20 kN/)
  assert.match(r.summary, /AB 20 kN T, .*FG 30 kN C, GH 30 kN C, AF 28.3 kN C, EH 28.3 kN C, BF 10 kN T, CG 0 \(zero-force\), DH 10 kN T, FC 14.1 kN T, HC 14.1 kN T$/)
})

test('warren section: the cut members agree with moments about F', async () => {
  const r = await renderAsync(load('warren-section.json'))
  assert.match(r.summary, /reactions A_\{x\} = 0, A_\{y\} = 10 kN, D_\{y\} = 8 kN/)
  assert.match(r.summary, /BC 16 kN T, .*EF 13.3 kN C, .*BF 4.81 kN C/)
  assert.match(r.summary, /section through EF, BF, BC$/)
  assert.match(r.svg, /stroke-dasharray="9 4 2 4"/)
})

test('cantilever off a wall: the roller pushes, the pin pulls, two zero-force members', async () => {
  const r = await renderAsync(load('cantilever.json'))
  assert.match(r.summary, /reactions B_\{x\} = -20 kN, B_\{y\} = 10 kN, A_\{x\} = 20 kN/)
  assert.match(r.summary, /AB 0 \(zero-force\), BC 10 kN T, CE 10 kN T, AD 20 kN C, DE 14.1 kN C, CD 0 \(zero-force\), BD 14.1 kN T$/)
})

test('mistakes come back with a path and a fix', async () => {
  const bad = await renderAsync({ ...KING, members: ['AB', 'AE'] })
  assert.equal(bad.svg, null)
  assert.match(bad.text, /members\[1\]: no joint "E"; joints: A, B, C, D/)
  const badLoad = await renderAsync({ ...KING, loads: [{ at: 'Q', mag: 1 }] })
  assert.match(badLoad.text, /loads\[0\]\.at: no joint "Q"/)

  const indet = await renderAsync({ ...KING, supports: [{ at: 'A' }, { at: 'C' }], forces: true })
  assert.ok(indet.svg)
  assert.match(problems(indet).join('\n'), /members: m \+ r = 9, 2j = 8: statically indeterminate/)
  assert.match(indet.summary, /\(m \+ r = 9 > 2j = 8, statically indeterminate; not solved\)$/)

  const unstable = await renderAsync({ ...KING, members: ['AB', 'BC', 'AD', 'CD'] })
  assert.match(problems(unstable).join('\n'), /unstable \(a mechanism\)/)

  const rollers = await renderAsync({ v: 1, kind: 'truss', joints: { A: [0, 0], B: [4, 0], C: [2, 2] }, members: ['AB', 'BC', 'AC'],
    supports: [{ at: 'A', type: 'roller' }, { at: 'B', type: 'roller' }, { at: 'C', type: 'roller' }], loads: [{ at: 'C', mag: 1 }] })
  assert.match(problems(rollers).join('\n'), /geometrically unstable/)

  const dup = await renderAsync({ ...KING, members: ['AB', 'BC', 'AD', 'CD', 'BD', 'BA'] })
  assert.match(problems(dup).join('\n'), /members\[5\]: BA repeats members\[0\]; left out/)
  const lone = await renderAsync({ ...KING, joints: { ...KING.joints, E: [9, 0] } })
  assert.match(problems(lone).join('\n'), /joints\.E: joint E has no members/)
  const cut = await renderAsync({ ...load('warren-section.json'), section: ['AB', 'FG'] })
  assert.match(problems(cut).join('\n'), /section: no straight line crosses exactly AB, FG/)
})
