import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderAsync } from '../../index.js'
import * as N from './num.js'
import * as M from './matrix.js'
import { readMap, parseOp } from './read.js'

const load = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))
const problems = (r) => r.diagnostics.filter((d) => d.level !== 'note').map((d) => `${d.path}: ${d.msg}`)
const warnings = (r) => r.diagnostics.filter((d) => d.level === 'warning').map((d) => `${d.path}: ${d.msg}`).join('\n')
const spec = (rest) => ({ v: 1, kind: 'linalg', ...rest })
const m = (rows) => rows.map((r) => r.map((x) => N.parseNum(x, {}, '')))
const v = (xs) => xs.map((x) => N.parseNum(x, {}, ''))
const show = (A) => N.matText(A)

test('exact arithmetic: fractions stay fractions, decimals parse exactly, floats snap only on display', () => {
  assert.equal(N.fmt(N.add(N.Q(1, 3), N.Q(1, 6))), '1/2')
  assert.equal(N.fmt(N.parseNum('-3/4', {}, '')), '−3/4')
  assert.equal(N.fmt(N.parseNum(0.1, {}, '')), '1/10')
  assert.equal(N.fmt(N.parseNum('k/2', { k: 3 }, '')), '3/2')
  assert.ok(!N.isQ(N.parseNum('sqrt(2)/2', {}, '')))
  assert.equal(N.fmt(N.parseNum('sqrt(2)/2', {}, '')), '0.7071')
  assert.equal(N.fmt(Math.cos(Math.PI / 2)), '0')
  const s = N.sqrtQ(N.Q(50)); assert.equal(N.surdText(s.c, s.r), '5√2')
  assert.equal(N.surdText(N.sqrtQ(N.Q(13, 4)).c, N.sqrtQ(N.Q(13, 4)).r), '√13/2')
})

test('det and inverse against hand calculations, 2×2 and 3×3', () => {
  const A = m([[1, 2], [3, 4]])
  assert.equal(N.fmt(M.det(A)), '−2')
  // [[a, b], [c, d]]⁻¹ = (1/(ad − bc)) [[d, −b], [−c, a]] = −1/2 [[4, −2], [−3, 1]].
  assert.equal(show(M.inverse(A)), '[[−2, 1], [3/2, −1/2]]')
  const B = m([[2, 0, 0], [0, 3, 4], [0, 4, 9]])
  assert.equal(N.fmt(M.det(B)), '22') // 2 · (27 − 16)
  assert.equal(show(M.inverse(B)), '[[1/2, 0, 0], [0, 9/11, −4/11], [0, −4/11, 3/11]]')
  assert.ok(M.matEq(M.matMul(B, M.inverse(B)), M.identity(3)))
  assert.equal(M.inverse(m([[1, 2], [2, 4]])), null)
  // A row swap flips the sign; cofactor expansion of a permutation-heavy 3×3: det = −1·(0·0 − 1·1)… = 1.
  assert.equal(N.fmt(M.det(m([[0, 1, 0], [0, 0, 1], [1, 0, 0]]))), '1')
})

test('row reduction: every step of the 3×4 example matches the hand reduction (Lay forward, then backward)', async () => {
  const S = load('rref-one-free.json')
  const A = m(S.A), b = v(S.b)
  const { steps, R, pivots } = M.reduce(A.map((r, i) => [...r, b[i]]))
  const hand = [
    ['', '[[2, 4, −2, 2], [1, 3, 2, 4], [3, 7, 0, 6]]'],
    ['R₂ ← R₂ − (1/2)R₁, R₃ ← R₃ − (3/2)R₁', '[[2, 4, −2, 2], [0, 1, 3, 3], [0, 1, 3, 3]]'],
    ['R₃ ← R₃ − R₂', '[[2, 4, −2, 2], [0, 1, 3, 3], [0, 0, 0, 0]]'],
    ['R₁ ← R₁ − 4R₂', '[[2, 0, −14, −10], [0, 1, 3, 3], [0, 0, 0, 0]]'],
    ['R₁ ← (1/2)R₁', '[[1, 0, −7, −5], [0, 1, 3, 3], [0, 0, 0, 0]]'],
  ]
  assert.deepEqual(steps.map((s) => [s.ops.map(M.opText).join(', '), show(s.M)]), hand)
  assert.ok(steps[2].echelon, 'the forward phase ends at step 2 in echelon form')
  assert.deepEqual(pivots, [[0, 0], [1, 1]])
  assert.ok(M.isRref(R))
  // x₁ − 7x₃ = −5 and x₂ + 3x₃ = 3, so x = (−5, 3, 0) + x₃(7, −3, 1).
  const sol = M.solution(R, 3, pivots)
  assert.deepEqual([sol.consistent, sol.free, N.vecText(sol.p), sol.basis.map(N.vecText)], [true, [2], '(−5, 3, 0)', ['(7, −3, 1)']])
  for (const t of [0, 1, -2, '1/3']) assert.ok(M.vecEq(M.matVec(A, M.vadd(sol.p, M.vscale(N.parseNum(t, {}, ''), sol.basis[0]))), b))
  const r = await renderAsync(S)
  assert.deepEqual(problems(r), [])
  assert.deepEqual(r.controls.steps, ['start: the matrix', 'R₂ ← R₂ − (1/2)R₁, R₃ ← R₃ − (3/2)R₁', 'R₃ ← R₃ − R₂ (echelon form)', 'R₁ ← R₁ − 4R₂', 'R₁ ← (1/2)R₁ (RREF)'])
  assert.match(r.summary, /free x3; x = \(−5, 3, 0\) \+ x3\(7, −3, 1\) \(infinitely many solutions\)/)
  assert.match(r.summary, /expect: 5 checked, all match/)
  assert.doesNotMatch(r.summary.replace(/≈ [^;]*/g, ''), /\d\.\d/, 'rational inputs give no decimals')
  // Step 0 draws the matrix alone; the last adds the solution set.
  const first = await renderAsync(S, { step: 0 })
  assert.doesNotMatch(first.svg, /free/)
  assert.match(r.svg, />free</)
})

test('rank, nullity, Col A and Nul A bases, and the pivot columns (Lay §2.8 / §4.2)', () => {
  const A = m([[1, 3, 4, 7], [3, 9, 7, 6]])
  const s = M.spaces(A)
  // RREF [[1, 3, 0, −5], [0, 0, 1, 3]]: x₁ = −3x₂ + 5x₄, x₃ = −3x₄.
  assert.equal(show(s.R), '[[1, 3, 0, −5], [0, 0, 1, 3]]')
  assert.deepEqual([s.rank, s.nullity, s.pivotCols], [2, 2, [0, 2]])
  assert.deepEqual(s.col.map(N.vecText), ['(1, 3)', '(4, 7)'])
  assert.deepEqual(s.nul.map(N.vecText), ['(−3, 1, 0, 0)', '(5, 0, −3, 1)'])
  for (const x of s.nul) assert.ok(M.isZeroVec(M.matVec(A, x)))
})

test('eigenvalues and eigenvectors: rational, repeated, defective, surd, and complex', () => {
  const pairs = (A) => M.eigenvalues(A).values.map((e) => [M.eigText(e), e.mult, M.eigenvectors(A, e).map((b) => b.map(N.vecText))])
  // det(A − λI) = λ² − λ − 2 = (λ − 2)(λ + 1).
  const A = m([[1, 1], [2, 0]])
  assert.equal(M.polyText(M.charPoly(A)), 'λ² − λ − 2')
  assert.deepEqual(pairs(A), [['−1', 1, [['(−1, 2)']]], ['2', 1, [['(1, 1)']]]])
  for (const [lam, x] of [[2, [1, 1]], [-1, [-1, 2]]]) assert.ok(M.vecEq(M.matVec(A, v(x)), M.vscale(N.Q(lam), v(x))))
  // Lay §5.3 Example 4 style: λ = 2 twice with a 2-dimensional eigenspace, and λ = 9.
  const B = m([[4, -1, 6], [2, 1, 6], [2, -1, 8]])
  assert.equal(M.polyText(M.charPoly(B)), 'λ³ − 13λ² + 40λ − 36')
  assert.deepEqual(pairs(B), [['2', 2, [['(1, 2, 0)', '(−3, 0, 1)']]], ['9', 1, [['(1, 1, 1)']]]])
  // A shear has λ = 1 twice and one eigenvector line.
  assert.deepEqual(pairs(m([[1, 1], [0, 1]])), [['1', 2, [['(1, 0)']]]])
  // λ² − 5λ − 2: (5 ± √33)/2.
  assert.equal(M.eigText(M.eigenvalues(m([[1, 2], [3, 4]])).values[0]), '(5 ± √33)/2')
  // Lay §5.5 Example 3: λ = 0.8 ± 0.6i, a rotation by 36.87° with r = 1; A = PCP⁻¹.
  const C = m([[0.5, -0.6], [0.75, 1.1]])
  const e = M.eigenvalues(C).values[0]
  assert.equal(M.eigText(e), '(4 ± 3i)/5')
  const rs = M.rotationScaling(C, e)
  assert.equal(show(rs.C), '[[4/5, −3/5], [3/5, 4/5]]')
  assert.equal(N.fmt(rs.r2), '1')
  assert.ok(Math.abs(rs.phi - (Math.atan2(0.6, 0.8) * 180) / Math.PI) < 1e-9)
  assert.ok(M.matEq(M.matMul(M.matMul(rs.P, rs.C), M.inverse(rs.P)), C))
  assert.equal(M.eigText(M.eigenvalues(m([[0, -1], [1, 0]])).values[0]), '±i')
})

test('eigen example: summary, steps, and expect', async () => {
  const r = await renderAsync(load('eigen-real.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /det\(A − λI\) = λ² − λ − 2; λ = −1: eigenspace basis \(−1, 2\); λ = 2: eigenspace basis \(1, 1\)/)
  assert.equal(r.controls.steps.length, 2)
  assert.match(r.summary, /expect: 3 checked, all match/)
  const cx = await renderAsync(spec({ mode: 'eigen', A: [[0.5, -0.6], [0.75, 1.1]] }))
  assert.match(cx.summary, /λ = \(4 ± 3i\)\/5 \(complex, no real eigenvectors\); as a rotation-scaling \(A = PCP⁻¹\): r = \|λ\| = 1, φ = 36\.87°/)
  const big = await renderAsync(spec({ mode: 'eigen', A: [[4, -1, 6], [2, 1, 6], [2, -1, 8]] }))
  assert.deepEqual(problems(big), [])
  assert.match(big.summary, /λ = 2 \(multiplicity 2\): eigenspace basis \(1, 2, 0\), \(−3, 0, 1\)/)
})

test('named maps and compositions: matrices, det, and the order of a product', async () => {
  const map = (x) => show(readMap(x, {}, 'A').M)
  assert.equal(map({ rotate: 90 }), '[[0, −1], [1, 0]]')
  assert.equal(map({ rotate: 60 }), '[[1/2, −0.866], [0.866, 1/2]]')
  // Reflection across the line through (1, 2): (1/5)[[1 − 4, 4], [4, 4 − 1]].
  assert.equal(map({ reflect: [1, 2] }), '[[−3/5, 4/5], [4/5, 3/5]]')
  assert.equal(map({ project: [1, 2] }), '[[1/5, 2/5], [2/5, 4/5]]')
  assert.equal(map({ shear: 2, axis: 'y' }), '[[1, 0], [2, 1]]')
  assert.equal(map({ reflect: 'y=x' }), '[[0, 1], [1, 0]]')
  const r = await renderAsync(load('rotate-then-scale.json'))
  assert.deepEqual(problems(r), [])
  // S R: rotate first, then scale x by 2: [[2, 0], [0, 1]] [[0, −1], [1, 0]] = [[0, −2], [1, 0]].
  assert.match(r.summary, /the whole map is SR = \[\[0, −2\], \[1, 0\]\]/)
  assert.match(r.summary, /SRe1 = \(0, 1\), SRe2 = \(−2, 0\); areas × \|det\| = 2, orientation kept/)
  assert.deepEqual(r.controls.steps, ['start: the identity', '1. R: rotation by 90°', '2. S: scaling x by 2, y by 1, so far SR'])
  const mid = await renderAsync(load('rotate-then-scale.json'), { step: 1 })
  assert.match(mid.summary, /showing step 1 of 2: R = \[\[0, −1\], \[1, 0\]\]/)
  const flip = await renderAsync(spec({ A: { reflect: 'y' }, shape: 'F' }))
  assert.match(flip.summary, /orientation flipped/)
  const proj = await renderAsync(spec({ A: { project: [2, 1] } }))
  assert.match(proj.summary, /rank 1, nullity 1/)
  assert.match(proj.svg, />Nul </)
})

test('vectors: projection (Lay §6.2 Example 3), onto a plane (§6.3 Example 2), combos, span, angle', async () => {
  const r = await renderAsync(load('projection.json'))
  assert.deepEqual(problems(r), [])
  // ŷ = (y·u/u·u)u = (40/20)(4, 2) = (8, 4); z = (−1, 2); cos θ = 40/(√85·√20).
  assert.match(r.summary, /ŷ = \(8, 4\), z = y − ŷ = \(−1, 2\)/)
  assert.match(r.summary, /y·u = 40, ‖y‖ = √85, ‖u‖ = 2√5, cos θ = 4√17\/17, θ = 14\.04°/)
  assert.ok(Math.abs(Math.acos(40 / Math.sqrt(85 * 20)) * 180 / Math.PI - 14.04) < 0.005)
  const w = await renderAsync(spec({ vectors: [{ id: 'u1', v: [2, 5, -1] }, { id: 'u2', v: [-2, 1, 1] }, { id: 'y', v: [1, 2, 3] }], project: { of: 'y', onto: ['u1', 'u2'] } }))
  assert.deepEqual(problems(w), [])
  assert.match(w.summary, /ŷ = \(−2\/5, 2, 1\/5\), z = y − ŷ = \(7\/5, 0, 14\/5\)/)
  const c = await renderAsync(spec({ vectors: [{ id: 'a', v: [1, -2] }, { id: 'b2', v: [2, 1] }, { id: 'b', v: [7, 1] }], combo: { of: ['a', 'b2'], target: 'b' }, expect: { c: [1, 3] } }))
  assert.match(c.summary, /a \+ 3b2 = b \(7, 1\): weights a 1, b2 3 \(unique\)/)
  assert.match(c.summary, /expect: 1 checked, all match/)
  const out = await renderAsync(spec({ vectors: [{ id: 'u', v: [1, 2] }, { id: 'w', v: [2, 4] }, { id: 'b', v: [1, 0] }], combo: { of: ['u', 'w'], target: 'b' }, span: ['u', 'w'] }))
  assert.match(out.summary, /b \(1, 0\) is not in Span\{u, w\}/)
  assert.match(out.summary, /Span\{u, w\}: a line through 0 \(rank 1, linearly dependent\)/)
  const a = await renderAsync(spec({ vectors: [{ id: 'u', v: [1, 0] }, { id: 'v', v: [1, 1] }, { id: 's', v: '2u - v' }], angle: ['u', 'v'] }))
  assert.match(a.summary, /cos θ = √2\/2, θ = 45°/)
  assert.match(a.summary, /s = \(1, −1\)/)
})

test('least squares: the normal equations and β̂ by hand (Lay §6.6), and x̂ for Ax = b (§6.5)', async () => {
  const r = await renderAsync(load('least-squares.json'))
  assert.deepEqual(problems(r), [])
  // XᵀX = [[n, Σx], [Σx, Σx²]] = [[4, 6], [6, 14]]; Xᵀy = (Σy, Σxy) = (6, 11); β = (9/10, 2/5).
  assert.match(r.summary, /XᵀX = \[\[4, 6\], \[6, 14\]\], Xᵀy = \(6, 11\)/)
  assert.match(r.summary, /β̂ = \(9\/10, 2\/5\): y = 9\/10 \+ \(2\/5\)x/)
  assert.match(r.summary, /residuals \(1\/10, −3\/10, 3\/10, −1\/10\), sum of squares 1\/5/)
  const lay = await renderAsync(spec({ data: [[2, 1], [5, 2], [7, 3], [8, 3]] }))
  assert.match(lay.summary, /β̂ = \(2\/7, 5\/14\)/)
  const quad = await renderAsync(spec({ data: [[-1, 1], [0, 0], [1, 1], [2, 4]], degree: 2 }))
  assert.match(quad.summary, /β̂ = \(0, 0, 1\)/)
  const ab = await renderAsync(spec({ mode: 'lsq', A: [[4, 0], [0, 2], [1, 1]], b: [2, 0, 11], expect: { xhat: [1, 2], error: 'sqrt(84)' } }))
  assert.match(ab.summary, /x̂ = \(1, 2\) \(unique/)
  assert.match(ab.summary, /‖b − Ax̂‖ = 2√21 ≈ 9\.165/)
  assert.match(ab.summary, /expect: 2 checked, all match/)
})

test('expect names each wrong value with the right one and the usual slip', async () => {
  const A = [[1, 2], [3, 4]]
  const r = await renderAsync(spec({ mode: 'eigen', A, expect: { det: 2, inverse: [[4, -2], [-3, 1]], eigenvectors: [[1, 2]], rank: 1, eigenvalues: [1, 2] } }))
  const w = warnings(r)
  assert.match(w, /expect\.det: det A is −2, not 2 \(the sign is flipped/)
  assert.match(w, /expect\.inverse: .*that is the adjugate; divide it by det A = −2/)
  assert.match(w, /expect\.eigenvectors\[0\]: \(1, 2\) is not an eigenvector: Ax = \(5, 11\)/)
  assert.match(w, /expect\.rank: rank is 2, not 1/)
  assert.match(w, /the eigenvalues are \(5 ± √33\)\/2/)
  assert.match(r.summary, /expect: 5 of 5 wrong/)
  const ok = await renderAsync(spec({ mode: 'eigen', A, expect: { eigenvalues: ['(5+sqrt(33))/2', '(5-sqrt(33))/2'], inverse: [[-2, 1], [1.5, -0.5]] } }))
  assert.match(ok.summary, /expect: 2 checked, all match/)
  const s = load('rref-one-free.json')
  const bad = await renderAsync({ ...s, expect: { x: [1, 1, 1], nul: [[7, -3, 1], [14, -6, 2]], free: [2], solutions: 'one', col: [[1, 0, 0]] } })
  const wb = warnings(bad)
  assert.match(wb, /\(1, 1, 1\) is not a solution: Ax = \(4, 6, 10\), not b = \(2, 4, 6\)/)
  assert.match(wb, /Nul A has dimension 1, so a basis has 1 vector, not 2/)
  assert.match(wb, /the free variables are x3, not 2/)
  assert.match(wb, /infinitely many solutions, not "one"/)
  assert.match(wb, /\(1, 0, 0\) is not in Col A/)
  const cx = await renderAsync(spec({ mode: 'eigen', A: [[0, -1], [1, 0]], expect: { eigenvalues: ['i', '-i'] } }))
  assert.match(cx.summary, /all match/)
})

test('an inconsistent system, your own row operations, and bad input', async () => {
  // Lay §2.2 Example 7: [A | I] reduces to [I | A⁻¹]; the echelon frame boxes all three pivots.
  const inv = await renderAsync(spec({ mode: 'rref', A: [[0, 1, 2], [1, 0, 3], [4, -3, 8]], b: 'I', expect: { inverse: [[-4.5, 7, -1.5], [-2, 4, -1], [1.5, -2, 0.5]] } }))
  assert.deepEqual(problems(inv), [])
  assert.match(inv.summary, /\[A \| I\] reduces to \[I \| A⁻¹\], so A⁻¹ = \[\[−9\/2, 7, −3\/2\], \[−2, 4, −1\], \[3\/2, −2, 1\/2\]\]/)
  assert.match(inv.summary, /expect: 1 checked, all match/)
  const red = M.reduce(m([[0, 1, 2, 1, 0, 0], [1, 0, 3, 0, 1, 0], [4, -3, 8, 0, 0, 1]]))
  assert.deepEqual(red.steps.find((s) => s.echelon).pivots, [[0, 0], [1, 1], [2, 2]])
  const sing = await renderAsync(spec({ mode: 'rref', A: [[1, 2], [2, 4]], b: 'I' }))
  assert.match(sing.summary, /not I, so A is not invertible/)
  const r = await renderAsync(spec({ A: [[1, 2, 3], [2, 4, 6], [1, 1, 1]], b: [1, 3, 2], expect: { solutions: 'none' } }))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /inconsistent: row 3 reads 0 = 1, no solution/)
  assert.match(r.svg, /inconsistent/)
  const ops = await renderAsync(spec({ A: [[1, 3, 4], [3, 9, 7]], b: [7, 6], ops: ['R2 - 3R1', '(-1/5)R2'] }))
  assert.match(ops.summary, /1\. R₂ ← R₂ − 3R₁: \[\[1, 3, 4, 7\], \[0, 0, −5, −15\]\]; 2\. R₂ ← −\(1\/5\)R₂: \[\[1, 3, 4, 7\], \[0, 0, 1, 3\]\]/)
  assert.match(ops.summary, /these steps end before RREF; the RREF is \[\[1, 3, 0, −5\], \[0, 0, 1, 3\]\]/)
  assert.match(ops.svg, /not yet in RREF/)
  for (const [o, want] of [['R1 <-> R3', 'R₁ ↔ R₃'], ['R3 + 3/2 R1', 'R₃ ← R₃ + (3/2)R₁'], ['R2/2', 'R₂ ← (1/2)R₂'], ['2R2 - 3R1', 'R₂ ← 2R₂ − 3R₁']]) assert.equal(M.opText(parseOp(o, 3, {}, 'ops')), want)
  const cases = [
    [spec({ A: [[1, 2], [3]] }), /A\[1\]: row 2 has 1 entries; row 1 has 2/],
    [spec({ A: [[1, 2], [3, 4]], b: [1, 2], ops: ['R2 - 2R5'] }), /ops\[0\]: there is no row 5/],
    [spec({ A: [[1, 2], [3, 4]], b: [1, 2], ops: ['R1 + R2 + R3'] }), /ops\[0\]: there is no row 3/],
    [spec({ A: [[1, 2], [3, 4], [5, 6]], b: [1, 2, 3], ops: ['R1 + R2 + R3'] }), /ops\[0\]: .*more than one other row/],
    [spec({ A: [[1, 2], [3, 4]], b: [1, 2], ops: ['0R1 + R2'] }), /ops\[0\]: .*drops R1/],
    [spec({ vectors: [{ id: 'u', v: [1, 2] }], sum: ['u', 'q'] }), /no vector "q"/],
    [spec({ mode: 'eigen', A: [[1, 2, 3]] }), /square matrix/],
    [spec({ A: { spin: 3 } }), /name the map with one of/],
  ]
  for (const [s, re] of cases) { const x = await renderAsync(s); assert.equal(x.svg, null); assert.match(x.text, re) }
})

test('review fixes: zero vectors, complex and repeated eigenvalues in expect, rounded decimals, and float eigenspaces', async () => {
  // A zero vector makes no angle and has no projection worth drawing: a SpecError, not a crash.
  for (const [s, re] of [
    [spec({ vectors: [{ id: 'u', v: [1, 2] }, { id: 'z', v: [0, 0] }], angle: ['u', 'z'] }), /angle\[1\]: z is the zero vector/],
    [spec({ vectors: [{ id: 'u', v: [1, 2] }, { id: 'y', v: [0, 0] }], project: { of: 'y', onto: 'u' } }), /project\.of: y is the zero vector/],
    [spec({ vectors: [{ id: 'u', v: [1, 0, 0] }, { id: 'w', v: [0, 1, 0] }, { id: 'y', v: [1, 2, 3] }], project: { of: 'y', onto: ['u', 'w'] }, expect: { dot: 3 } }), /expect\.dot: dot needs "angle", or "project" onto one vector/],
    [spec({ A: { project: 'origin' } }), /A\.project: project onto a line/],
  ]) { const x = await renderAsync(s); assert.equal(x.svg, null); assert.match(x.text, re) }
  const reflect = await renderAsync(spec({ A: { reflect: 'origin' } }))
  assert.match(reflect.summary, /reflection through the origin/)

  // "-1-2i" is the conjugate of -1+2i; "1+-2i" is the pair.
  const cx = await renderAsync(spec({ mode: 'eigen', A: [[-1, -2], [2, -1]], expect: { eigenvalues: ['-1+2i', '-1-2i'] } }))
  assert.match(cx.summary, /expect: 1 checked, all match/)
  const cx2 = await renderAsync(spec({ mode: 'eigen', A: [[1, -2], [2, 1]], expect: { eigenvalues: ['1+-2i'] } }))
  assert.match(cx2.summary, /expect: 1 checked, all match/)
  const cx3 = await renderAsync(spec({ mode: 'eigen', A: [[-1, -1], [1, -1]], expect: { eigenvalues: ['-1+i', '-1-i'] } }))
  assert.match(cx3.summary, /expect: 1 checked, all match/)

  // Multiplicity counts when a value is listed more than once; listing each once also passes.
  const D = [[1, 0, 0], [0, 1, 0], [0, 0, 2]]
  const twice = await renderAsync(spec({ mode: 'eigen', A: D, expect: { eigenvalues: [1, 2, 2] } }))
  assert.match(warnings(twice), /the eigenvalues are 1 \(×2\), 2, not 1, 2, 2/)
  for (const ok of [[1, 1, 2], [1, 2], [2, 1, 1]]) assert.match((await renderAsync(spec({ mode: 'eigen', A: D, expect: { eigenvalues: ok } }))).summary, /all match/)

  // A written decimal is a rounded value, compared to 0.1%; an exact fraction still compares exactly.
  const third = await renderAsync(spec({ A: [[1, 0], [0, '1/3']], expect: { det: 0.333 } }))
  assert.match(third.summary, /all match/)
  assert.match(warnings(await renderAsync(spec({ A: [[1, 0], [0, '1/3']], expect: { det: '333/1000' } }))), /det A is 1\/3, not 333\/1000/)
  const c = await renderAsync(spec({ vectors: [{ id: 'u', v: [1, 2] }, { id: 'w', v: [2, 1] }, { id: 'y', v: [1, 1] }], combo: { of: ['u', 'w'], target: 'y' }, expect: { c: [0.333, 0.333] } }))
  assert.match(c.summary, /all match/)

  // A float matrix's Nul A and Col A accept a rounded basis.
  const fl = await renderAsync(spec({ mode: 'rref', A: [['sqrt(2)', 1], ['2*sqrt(2)', 2]], expect: { nul: [[-0.7071, 1]], col: [[0.7071, 1.4142]] } }))
  assert.match(fl.summary, /all match/)

  // With b, the RREF of [A | b] counts (and so does that of A alone).
  for (const R of [[[1, 0, -4], [0, 1, 4.5]], [[1, 0], [0, 1]]]) assert.match((await renderAsync(spec({ mode: 'rref', A: [[1, 2], [3, 4]], b: [5, 6], expect: { rref: R } }))).summary, /all match/)
  assert.match(warnings(await renderAsync(spec({ mode: 'rref', A: [[1, 2], [3, 4]], b: [5, 6], expect: { rref: [[1, 0, -4], [0, 1, 4]] } }))), /the RREF of \[A \| b\] is \[\[1, 0, −4\], \[0, 1, 9\/2\]\]/)

  // A float λI: the whole plane (or space) is the eigenspace, and a triple root stays real.
  for (const A of [{ scale: 'sqrt(2)' }, [['sqrt(2)', 0, 0], [0, 'sqrt(2)', 0], [0, 0, 'sqrt(2)']]]) {
    const n = Array.isArray(A) ? 3 : 2
    const { values } = M.eigenvalues(readMap(A, {}, 'A').M)
    assert.equal(values.length, 1)
    assert.equal(values[0].kind, 'f')
    assert.equal(values[0].mult, n)
    assert.ok(Math.abs(values[0].v - Math.SQRT2) < 1e-9)
    assert.equal(M.eigenvectors(readMap(A, {}, 'A').M, values[0])[0].length, n)
  }
  const rot = await renderAsync(spec({ mode: 'eigen', A: { scale: 'sqrt(2)' } }))
  assert.deepEqual(problems(rot), [])
  assert.match(rot.summary, /λ = 1\.414 \(numeric\) \(multiplicity 2\): eigenspace basis \(1, 0\), \(0, 1\)/)

  // Surds: √0 is 0, and a coefficient of −1 shows no 1.
  assert.deepEqual(N.sqrtQ(N.ZERO), { c: N.ZERO, r: 1n })
  assert.equal(N.surdText(N.Q(-1, 2), 2n), '−√2/2')
  const ang = await renderAsync(spec({ vectors: [{ id: 'u', v: [1, 0] }, { id: 'w', v: [-1, 1] }], angle: ['u', 'w'] }))
  assert.match(ang.summary, /cos θ = −√2\/2, θ = 135°/)
  const fit = await renderAsync(spec({ mode: 'lsq', data: [[0, 1], [1, 3], [2, 5]] }))
  assert.doesNotMatch(fit.summary, /√0/)
})
