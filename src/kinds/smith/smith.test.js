import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderAsync } from '../../index.js'
import { Diag } from '../../diag.js'
import { solve } from './solve.js'

const load = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))
const problems = (r) => r.diagnostics.filter((d) => d.level !== 'note').map((d) => `${d.path}: ${d.msg}`)
const spec = (rest) => ({ v: 1, kind: 'smith', ...rest })
const run = (s) => solve(s, {}, new Diag())
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`)
const rel = (a, b, tol, what) => near(a, b, Math.abs(b) * tol, what)
const W = (f) => 2 * Math.PI * f
// Z_in of a load through a lossless line of l wavelengths: Z0 (ZL + jZ0 tan βl) / (Z0 + jZL tan βl).
const zin = ([R, X], z0, l) => {
  const t = Math.tan(2 * Math.PI * l)
  const nr = R, ni = X + z0 * t, dr = z0 - X * t, di = R * t
  const d = dr * dr + di * di
  return [(z0 * (nr * dr + ni * di)) / d, (z0 * (ni * dr - nr * di)) / d]
}

// Z_L = 40 + j30 on 50 Ω: Γ = (−10 + j30)/(90 + j30) = j/3, so |Γ| = 1/3, VSWR = (1 + 1/3)/(1 − 1/3) = 2,
// RL = 20 log10 3 = 9.542 dB, ML = −10 log10(1 − 1/9) = 0.5115 dB. 100 Ω and 25 Ω sit on the same circle.
test('VSWR 2:1: 40 + j30 Ω gives Γ = j/3, VSWR 2, RL 9.54 dB, ML 0.512 dB, like 100 Ω and 25 Ω', async () => {
  const r = await renderAsync(load('vswr.json'))
  assert.deepEqual(problems(r), [])
  const S = run(load('vswr.json'))
  const [zl, r100, r25] = S.points
  near(zl.g[0], 0, 1e-12, 'Re Γ'); near(zl.g[1], 1 / 3, 1e-12, 'Im Γ')
  near(zl.vswr, 2, 1e-12, 'VSWR'); near(zl.rl, 20 * Math.log10(3), 1e-9, 'RL'); near(zl.ml, -10 * Math.log10(8 / 9), 1e-9, 'ML')
  near(r100.g[0], 1 / 3, 1e-12, 'Γ of 100 Ω'); near(r25.g[0], -1 / 3, 1e-12, 'Γ of 25 Ω')
  near(S.circles[0].mag, 1 / 3, 1e-12, '|Γ| of the 2:1 circle')
  assert.match(r.summary, /ZL: Z 40 \+ j30 Ω, z 0\.8 \+ j0\.6, y 0\.8 − j0\.6, Γ j0\.333 = 0\.333∠90°, VSWR 2\.00, RL 9\.54 dB, ML 0\.512 dB/)
  assert.match(r.summary, /circle VSWR 2: \|Γ\| 0\.333, VSWR 2\.00, RL 9\.54 dB/)
  assert.match(r.summary, /expect: 5 checked, all match/)
})

test('a point given as Y, y, polar Γ, or R + L at a frequency lands at the same z = 1 + j1', () => {
  const L = 50 / W(1e9) // X_L = 50 Ω at 1 GHz
  const S = run(spec({ f: '1 GHz', points: [
    { id: 'a', Z: [50, 50] }, { id: 'b', Y: [0.01, -0.01] }, { id: 'c', y: '0.5 - j0.5' },
    { id: 'd', gamma: { mag: Math.sqrt(0.2), ang: (Math.atan2(0.4, 0.2) * 180) / Math.PI } }, { id: 'e', R: 50, L },
  ] }))
  for (const p of S.points) {
    near(p.z[0], 1, 1e-9, `${p.id} r`); near(p.z[1], 1, 1e-9, `${p.id} x`)
    near(p.g[0], 0.2, 1e-9, `${p.id} Re Γ`); near(p.g[1], 0.4, 1e-9, `${p.id} Im Γ`) // Γ = j/(2 + j) = 0.2 + j0.4
    near(p.vswr, (1 + Math.sqrt(0.2)) / (1 - Math.sqrt(0.2)), 1e-9, `${p.id} VSWR`)
  }
})

// Z_L = 30 + j40 (|Γ| = 0.5): λ/8 turns Γ = j0.5 to 0.5, so Z_in = Z0 (1 + 0.5)/(1 − 0.5) = 150 Ω (the voltage
// maximum, Z0 · VSWR); λ/4 inverts it: Z_in = Z0²/Z_L = 2500/(30 + j40) = 30 − j40 Ω.
test('line: 30 + j40 Ω through λ/8 is 150 Ω and through λ/4 is Z0²/Z_L = 30 − j40 Ω; 24.7 mm at vf 0.66 and 1 GHz is λ/8', async () => {
  const r = await renderAsync(load('line.json'))
  assert.deepEqual(problems(r), [])
  const [l8, l4] = run(load('line.json')).moves
  near(l8.Z[0], 150, 1e-9, 'R after λ/8'); near(l8.Z[1], 0, 1e-9, 'X after λ/8')
  near(l4.Z[0], 30, 1e-9, 'R after λ/4'); near(l4.Z[1], -40, 1e-9, 'X after λ/4')
  assert.match(r.summary, /move 1 l8 \(line 0\.125λ = 24\.7 mm at vf 0\.66 toward the generator\) from ZL: Z 150 Ω/)
  assert.match(r.summary, /move 2 l4 .* from l8: Z 30 − j40 Ω/)
  // λ = vf c / f = 0.66 × 299792458 / 1e9 = 0.19786 m.
  const m = run(spec({ f: '1 GHz', points: [{ Z: [100, 50] }], moves: [{ line: '24.7 mm', vf: 0.66 }] })).moves[0]
  near(m.d, 0.0247 / ((0.66 * 299792458) / 1e9), 1e-12, 'd in wavelengths')
})

test('line: any length matches the Z_in formula, and toward the load undoes toward the generator', () => {
  for (const l of [0.03, 0.1, 0.2, 0.37]) {
    const [mv] = run(spec({ points: [{ Z: [100, 50] }], moves: [{ line: l }] })).moves
    const want = zin([100, 50], 50, l)
    near(mv.Z[0], want[0], 1e-9, `R at ${l}λ`); near(mv.Z[1], want[1], 1e-9, `X at ${l}λ`)
  }
  const [, back] = run(spec({ points: [{ Z: [100, 50] }], moves: [{ line: 0.1 }, { line: 0.1, toward: 'load' }] })).moves
  near(back.Z[0], 100, 1e-9, 'R back at the load'); near(back.Z[1], 50, 1e-9, 'X back at the load')
})

// Pozar Example 5.1: Z_L = 200 − j100 Ω on Z0 = 100 Ω at 500 MHz. r = 2 > 1, so the shunt element sits at the
// load: B = (X_L ± √(R_L/Z0) √(R_L² + X_L² − Z0 R_L)) / (R_L² + X_L²) and X = 1/B + X_L Z0/R_L − Z0/(B R_L).
// Pozar prints B = 0.0029 S (C = 0.92 pF), X = 122 Ω (L = 38.8 nH); B = −0.0069 S (L = 46.1 nH), X = −122 Ω (C = 2.61 pF).
test('L-match: Pozar Example 5.1 gives C 0.92 pF + L 38.8 nH, or L 46.1 nH + C 2.61 pF', async () => {
  const s = spec({ z0: 100, f: '500 MHz', points: [{ id: 'ZL', Z: '200 - j100' }], match: true })
  const S = run(s)
  const [RL, XL, Z0, w] = [200, -100, 100, W(500e6)]
  const sols = [1, -1].map((sg) => {
    const B = (XL + sg * Math.sqrt(RL / Z0) * Math.sqrt(RL * RL + XL * XL - Z0 * RL)) / (RL * RL + XL * XL)
    return { B, X: 1 / B + (XL * Z0) / RL - Z0 / (B * RL) }
  })
  assert.equal(S.match.sols.length, 2)
  S.match.sols.forEach((sol, k) => {
    const [sh, se] = sol.els
    assert.equal(sh.shunt, true); assert.equal(se.shunt, false)
    rel(sh.delta / Z0, sols[k].B, 1e-9, `B of solution ${k + 1}`)
    rel(se.delta * Z0, sols[k].X, 1e-9, `X of solution ${k + 1}`)
  })
  const [[c1, l1], [l2, c2]] = S.match.sols.map((sol) => sol.els.map((e) => e.value))
  rel(c1, sols[0].B / w, 1e-9, 'C1'); rel(l1, sols[0].X / w, 1e-9, 'L1')
  rel(l2, -1 / (w * sols[1].B), 1e-9, 'L2'); rel(c2, -1 / (w * sols[1].X), 1e-9, 'C2')
  rel(c1, 0.92e-12, 0.01, 'C1 against Pozar'); rel(l1, 38.8e-9, 0.01, 'L1 against Pozar')
  rel(l2, 46.1e-9, 0.01, 'L2 against Pozar'); rel(c2, 2.61e-12, 0.01, 'C2 against Pozar')
  const r = await renderAsync(s)
  assert.match(r.summary, /1\) shunt C 0\.923 pF, then series L 39 nH; 2\) shunt L 46\.1 nH, then series C 2\.6 pF/)
})

// r < 1: the series element sits at the load. Z_L = 20 + j10 on 50 Ω: X = ±√(R_L (Z0 − R_L)) − X_L = ±24.49 − 10,
// B = ±√((Z0 − R_L)/R_L) / Z0 = ±0.02449 S. y_L = 2 − j1 has g > 1, so a shunt element first can't work.
test('L-match: a load with r < 1 and g > 1 has only the two series-first solutions (Pozar 5.1b)', () => {
  const S = run(spec({ f: '1 GHz', points: [{ Z: '20 + j10' }], match: true }))
  assert.equal(S.match.sols.length, 2)
  const want = [1, -1].map((sg) => ({ X: sg * Math.sqrt(20 * 30) - 10, B: (sg * Math.sqrt(30 / 20)) / 50 }))
  S.match.sols.forEach((sol, k) => {
    assert.equal(sol.order, 'series-first')
    rel(sol.els[0].delta * 50, want[k].X, 1e-9, `X ${k + 1}`)
    rel(sol.els[1].delta / 50, want[k].B, 1e-9, `B ${k + 1}`)
  })
})

test('L-match walk: shunt C to r = 1, then series L to match, lands at the center with solution 1\'s values; steps go one move at a time', async () => {
  const s = load('lmatch.json')
  const r = await renderAsync(s)
  assert.deepEqual(problems(r), [])
  const S = run(s)
  const [c1, l1] = S.moves
  near(c1.z[0], 1, 1e-9, 'r after the shunt C')
  near(l1.z[0], 1, 1e-9, 'r at the end'); near(l1.z[1], 0, 1e-9, 'x at the end'); near(l1.mag, 0, 1e-9, '|Γ| at the end')
  // The same values as the closed form (z = 2 − j1 is Pozar 5.1 at 50 Ω: B doubles, X halves).
  rel(c1.value, S.match.sols[0].els[0].value, 1e-9, 'C'); rel(l1.value, S.match.sols[0].els[1].value, 1e-9, 'L')
  rel(c1.value, (2 * 0.00289898) / W(500e6), 1e-5, 'C from Pozar\'s B'); rel(l1.value, 122.474 / 2 / W(500e6), 1e-5, 'L from Pozar\'s X')
  assert.deepEqual(r.controls.steps, ['ZL: z = 2 − j1', '1. shunt C 1.85 pF (b +0.29) to r=1', '2. series L 19.5 nH (x +1.22) to match'])
  const first = await renderAsync(s, { step: 1 })
  assert.match(first.summary, /showing 1 of 2 moves/)
  assert.doesNotMatch(first.summary, /move 2/)
  // The other solution: a shunt L then a series C.
  const other = run({ ...s, moves: [{ shunt: 'L', to: 'r=1' }, { series: 'C', to: 'match' }], expect: undefined })
  rel(other.moves[0].value, S.match.sols[1].els[0].value, 1e-9, 'L of solution 2')
  rel(other.moves[1].value, S.match.sols[1].els[1].value, 1e-9, 'C of solution 2')
})

test('moves: a component value turns into its normalized change, and an impossible "to" says what to use', () => {
  // A series 10 nH at 1 GHz on 50 Ω adds x = ωL/Z0 = 1.2566; a shunt 2 pF adds b = ωC Z0 = 0.6283.
  const S = run(spec({ f: '1 GHz', points: [{ z: [0.5, 0] }], moves: [{ series: 'L', value: '10 nH' }, { shunt: 'C', value: '2 pF' }] }))
  near(S.moves[0].delta, (W(1e9) * 10e-9) / 50, 1e-12, 'x of 10 nH')
  near(S.moves[0].z[1], (W(1e9) * 10e-9) / 50, 1e-9, 'x after it')
  near(S.moves[1].delta, W(1e9) * 2e-12 * 50, 1e-12, 'b of 2 pF')
  // r = 2: the series element's r = 2 circle never meets g = 1.
  assert.throws(() => run(spec({ points: [{ Z: [100, 0] }], moves: [{ series: 'L', to: 'g=1' }] })), /never meets the g=1 circle; put a shunt element first/)
  // Above both crossings, a series L moves away; a series C reaches g = 1.
  assert.throws(() => run(spec({ points: [{ z: [0.5, 1] }], moves: [{ series: 'L', to: 'g=1' }] })), /use a series C/)
  assert.throws(() => run(spec({ points: [{ z: [1, 1] }], moves: [{ series: 'L', to: 'match' }] })), /takes a series C/)
})

// Z_L = 30 + j40 sits at Γ = j0.5; the voltage maximum (Γ = 0.5, Z = 150 Ω) is a quarter turn clockwise: λ/8.
// A λ/4 transformer of √(50 × 150) = 86.6 Ω then gives 86.6²/150 = 50 Ω.
test('quarter-wave: λ/8 to the maximum (150 Ω), then √(50 × 150) = 86.6 Ω matches it', async () => {
  const r = await renderAsync(load('quarter.json'))
  assert.deepEqual(problems(r), [])
  const [toMax, qw] = run(load('quarter.json')).moves
  near(toMax.d, 0.125, 1e-12, 'line to the maximum'); near(toMax.Z[0], 150, 1e-9, 'R at the maximum')
  near(qw.zt, Math.sqrt(50 * 150), 1e-9, 'Zt')
  near(qw.Z[0], 50, 1e-9, 'R after the transformer'); near(qw.Z[1], 0, 1e-9, 'X after the transformer')
  assert.match(r.summary, /move 2 qw \(λ\/4 transformer 86\.6 Ω\) from toMax: Z 50 Ω, z 1, Γ 0 = 0, VSWR 1\.00, RL ∞ dB/)
  // The minimum is the other way round the |Γ| circle: Z0/VSWR = 16.7 Ω, 3λ/8 from the load.
  const [toMin] = run(spec({ points: [{ Z: '30 + j40' }], moves: [{ line: true, to: 'min' }] })).moves
  near(toMin.d, 0.375, 1e-12, 'line to the minimum'); near(toMin.Z[0], 50 / 3, 1e-9, 'R at the minimum')
})

// Series RLC, R = 36 Ω, f0 = 2.45 GHz, Q = 8: X = R Q (u − 1/u) with u = f/f0, so the best match is at f0 where
// |Γ| = 14/86 and VSWR = 50/36. VSWR ≤ 2 needs 8x² ≤ (r + 1)² − 9(r − 1)², so |x| ≤ 0.53066 with r = 0.72,
// u − 1/u = ±0.53066/(0.72 × 8), u = (a + √(a² + 4))/2: 2.3397 to 2.5655 GHz.
test('sweep: the RLC antenna is best at f0 (VSWR 50/36) and inside 2:1 from 2.340 to 2.565 GHz; markers read x = R Q (u − 1/u)', async () => {
  const r = await renderAsync(load('sweep.json'))
  assert.deepEqual(problems(r), [])
  const [s] = run(load('sweep.json')).sweeps
  rel(s.best.f, 2.45e9, 1e-6, 'best f'); near(s.best.mag, 14 / 86, 1e-9, 'best |Γ|'); near(s.best.vswr, 50 / 36, 1e-6, 'best VSWR')
  const xmax = Math.sqrt((1.72 ** 2 - 9 * 0.28 ** 2) / 8), a = xmax / (0.72 * 8), u = (a + Math.sqrt(a * a + 4)) / 2
  assert.equal(s.bands.length, 1)
  rel(s.bands[0].lo, 2.45e9 / u, 1e-7, 'band low edge'); rel(s.bands[0].hi, 2.45e9 * u, 1e-7, 'band high edge')
  const x = (f) => 0.72 * 8 * (f / 2.45e9 - 2.45e9 / f)
  for (const m of s.markers) {
    const g = [(0.72 - 1) ** 2 + x(m.f) ** 2, 0], d = (0.72 + 1) ** 2 + x(m.f) ** 2 // |z − 1|² and |z + 1|²
    near(m.mag, Math.sqrt(g[0] / d), 1e-9, `|Γ| at marker ${m.n}`)
  }
  assert.match(r.summary, /best 2\.45 GHz z 0\.72, \|Γ\| 0\.163, VSWR 1\.39, RL 15\.8 dB; VSWR ≤ 2 from 2\.34 GHz to 2\.57 GHz \(226 MHz, 9\.2%\)/)
  assert.match(r.summary, /marker 1 2\.40 GHz: z 0\.72 − j0\.238/)
})

test('sweep from dB/angle data: the best sample, and band edges interpolated linearly in |Γ|', async () => {
  const s0 = load('data.json')
  const r = await renderAsync(s0)
  assert.deepEqual(problems(r), [])
  const [s] = run(s0).sweeps
  assert.equal(s.best.f, 440e6)
  const rows = s0.sweeps[0].data, lim = 1 / 3, mag = (db) => 10 ** (db / 20)
  const edge = (a, b) => (a[0] + ((b[0] - a[0]) * (mag(a[1]) - lim)) / (mag(a[1]) - mag(b[1]))) * 1e6
  rel(s.bands[0].lo, edge(rows[2], rows[3]), 1e-9, 'band low edge')
  rel(s.bands[0].hi, edge(rows[7], rows[8]), 1e-9, 'band high edge')
  assert.match(r.summary, /standards: open Γ = 1, short Γ = −1, load Γ = 0/)
})

test('expect names each wrong value with the computed one', async () => {
  const r = await renderAsync(spec({ f: '500 MHz', points: [{ id: 'ZL', Z: '100 - j50' }], match: true, moves: [{ id: 'C1', shunt: 'C', to: 'r=1' }],
    expect: { ZL: { vswr: 2.5, rl: '6.99 dB' }, C1: { value: '2.2 pF' }, match: ['1.85 pF', '5.2 pF'] } }))
  const warn = problems(r)
  assert.deepEqual(warn, [
    'expect.ZL.vswr: ZL VSWR is 2.62, not 2.5',
    'expect.C1.value: C1 C is 1.85 pF, not 2.2 pF',
    'expect.match: no L-match solution uses 1.85 pF and 5.2 pF; the solutions are 1) shunt C 1.85 pF, then series L 19.5 nH; 2) shunt L 23.1 nH, then series C 5.2 pF',
  ])
  assert.match(r.summary, /expect: 3 of 4 wrong/)
})

test('bad input errors say what to write', async () => {
  const err = async (s) => (await renderAsync(spec(s))).text
  assert.match(await err({ points: [{ Z: 50, gamma: [0, 0] }] }), /give one of Z, gamma/)
  assert.match(await err({ points: [{ R: 50, L: '10 nH' }] }), /needs a frequency/)
  assert.match(await err({ points: [{ Z: 50 }], moves: [{ series: 'L', value: '2 pF', f: '1 GHz' }] }), /"2 pF" is in F; this takes H/)
  assert.match(await err({ points: [{ Z: 50 }], moves: [{ shunt: 'C', x: 0.5 }] }), /a shunt element changes b/)
  assert.match(await err({ points: [{ Z: 50 }], moves: [{ line: '3 cm' }] }), /a line in meters needs a frequency/)
  assert.match(await err({ points: [{ Z: [100, 30] }], moves: [{ quarter: true }] }), /Move to the real axis first/)
  assert.match(await err({ points: [{ Z: 50 }], moves: [{ line: 0.1, to: 'max' }] }), /write "line": true/)
})
