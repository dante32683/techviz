import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { renderAsync } from '../../index.js'
import { fromDivider, fromPoles, evalFactors } from './transfer.js'
import { readParts, readCircuit, divider } from './circuit.js'
import { abs, arg } from './complex.js'
import { Diag } from '../../diag.js'

const load = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))
const problems = (r) => r.diagnostics.filter((d) => d.level !== 'note').map((d) => `${d.path}: ${d.msg}`)
const warnings = (r) => r.diagnostics.filter((d) => d.level === 'warning').map((d) => `${d.path}: ${d.msg}`).join('\n')
const spec = (rest) => ({ v: 1, kind: 'ac', ...rest })
const PRE = { p: 1e-12, n: 1e-9, μ: 1e-6, m: 1e-3, k: 1e3, M: 1e6 }
/** The number after `label` in the summary, with its SI prefix: "V_C 111.8 V" gives 111.8. */
const read = (summary, label) => {
  const m = new RegExp(`${label.replace(/[|()]/g, '\\$&')} (−?[\\d.]+) ?([pnμmkM])?(?:Hz|Ω|V|A|W|°|rad|dB)`).exec(summary)
  assert.ok(m, `no ${label} in ${summary}`)
  return parseFloat(m[1].replace('−', '-')) * (PRE[m[2]] ?? 1)
}
/** The drawing's text, with tags dropped (labels split "−" into its own tspan). */
const words = (svg) => svg.replace(/<[^>]+>/g, '')
const near = (a, b, rel, what) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${what}: ${a} is not within ${rel * 100}% of ${b}`)
const TAU = 2 * Math.PI

// PHYS 42 Late AC practice B, problem 2, against its worked key: X_L 30.1593, X_C 132.629,
// Z 106.771, I_rms 0.842925, φ −73.6816°, V_R 25.2877, V_L 25.4220, V_C 111.796.
test('practice B #2: X_L, X_C, Z, I, φ, and every element voltage match the key', async () => {
  const r = await renderAsync(load('phys42-b2-phasors.json'))
  assert.deepEqual(problems(r), [])
  const s = r.summary
  near(read(s, 'X_L'), 30.1593, 5e-4, 'X_L'); near(read(s, 'X_C'), 132.629, 5e-4, 'X_C')
  near(read(s, '= 30.00 − j102.5 Ω ='), 106.771, 5e-4, '|Z|')
  near(read(s, 'φ'), -73.6816, 5e-4, 'φ')
  near(read(s, 'I'), 0.842925, 5e-4, 'I rms')
  near(read(s, 'V_R'), 25.2877, 5e-4, 'V_R'); near(read(s, 'V_L'), 25.4220, 5e-4, 'V_L'); near(read(s, 'V_C'), 111.796, 5e-4, 'V_C')
  assert.match(s, /current leads the voltage \(capacitive\)/)
  // The phasor sum gives the source back: √(V_R² + (V_L − V_C)²) = 90.0 V.
  near(Math.hypot(25.2877, 25.4220 - 111.796), 90, 1e-4, 'phasor sum')
  // pf = cos φ = 0.2810 (leading); P = I²R = 0.842925² · 30 = 21.316 W.
  assert.match(s, /pf 0\.2810 leading, P 21\.32 W average/)
  assert.match(s, /expect: XL ok, XC ok, Z ok, I ok, phi ok, V_R ok, V_L ok, V_C ok/)
  assert.match(words(r.svg), /φ = −73\.7°/)
  assert.match(words(r.svg), /I leads Vs by 73\.7° \(rms\)/)
})

test('expect names a wrong value and says why: sign of φ, peak for rms, twice P, radians', async () => {
  const base = { parts: { R: '30 ohm', L: '0.0800 H', C: '20 uF' }, V: '90 V', f: '60 Hz' }
  const r = await renderAsync(spec({ ...base, expect: { phi: 73.68, I: 1.192, V_C: '120 V', P: 42.63, Z: '106.8 ohm' } }))
  const w = warnings(r)
  assert.match(w, /expect\.phi: 73\.68 has the wrong sign .*φ = −73\.68°/)
  assert.match(w, /expect\.I: 1\.192 is the peak value; this spec uses rms: I = 0\.8429 A rms/)
  assert.match(w, /expect\.V_C: 120 V is wrong: V_\{C\} = 111\.8 V rms/)
  assert.match(w, /expect\.P: 42\.63 is twice the average power/)
  assert.doesNotMatch(w, /expect\.Z/)
  assert.match(r.summary, /expect: phi WRONG, I WRONG, V_C WRONG, P WRONG, Z ok/)
  const rad = await renderAsync(spec({ ...base, expect: { phi: -1.286 } }))
  assert.match(warnings(rad), /is in radians/)
  // In peak values the source is 90 V peak, so I = 0.8429 A peak and the rms value is the miss.
  const pk = await renderAsync(spec({ ...base, rms: false, expect: { I: 0.596 } }))
  assert.match(warnings(pk), /is the rms value; this spec uses peak/)
  assert.match(pk.summary, /I 0\.8429 A peak/)
  // P is the same physical average power: ½ V₀ I₀ cos φ.
  assert.match(pk.summary, /P 10\.66 W average/)
})

test('parallel RLC: voltage reference; branch currents V/R, V/X_L, V/X_C; φ = arctan((I_L − I_C)/I_R)', async () => {
  const r = await renderAsync(load('parallel-rlc-waves.json'))
  assert.deepEqual(problems(r), [])
  const w = TAU * 60, IR = 120 / 100, IL = 120 / (w * 0.4), IC = 120 * w * 5e-6
  near(read(r.summary, 'I_R'), IR, 5e-4, 'I_R'); near(read(r.summary, 'I_L'), IL, 5e-4, 'I_L'); near(read(r.summary, 'I_C'), IC, 5e-4, 'I_C')
  near(read(r.summary, 'I'), Math.hypot(IR, IL - IC), 5e-4, 'I')
  near(read(r.summary, 'φ'), (Math.atan((IL - IC) / IR) * 180) / Math.PI, 5e-4, 'φ')
  assert.match(r.summary, /current lags the voltage \(inductive\)/)
  assert.match(r.summary, /every V 120\.0 V/)
})

test('impedance: Z plane for a series circuit, Y plane for a parallel one, and nested steps', async () => {
  const r = await renderAsync(load('phys42-b2-impedance.json'))
  assert.deepEqual(problems(r), [])
  assert.match(words(r.svg), /\|Z\| = 107 Ω/); assert.match(words(r.svg), /X = −102 Ω/)
  const y = await renderAsync(spec({ mode: 'impedance', circuit: 'parallel', parts: { R: '100 ohm', L: '0.4 H', C: '5 uF' }, f: '60 Hz' }))
  assert.deepEqual(problems(y), [])
  assert.match(words(y.svg), /\|Y\| = /)
  const n = await renderAsync(spec({ mode: 'impedance', circuit: 'R + (L || C)', parts: { R: '30 ohm', L: '80 mH', C: '20 uF' }, f: '60 Hz' }))
  assert.deepEqual(problems(n), [])
  // L || C at 377 rad/s: Y = 1/(j30.16) + j/132.6 = −j0.02562 S, so Z = j39.04 Ω; plus R.
  assert.match(n.summary, /L \|\| C: Y = −j0\.03316 \+ j0\.007540 S = −j0\.02562 S, Z = 1\/Y = j39\.04 Ω/)
  assert.match(n.summary, /R \+ \(L \|\| C\): Z = 30\.00 \+ j39\.04 Ω/)
})

test('RC low-pass Bode: corner and −3 dB at 1/(2πRC), slopes 0 then −20 dB/dec, −45° at the corner', async () => {
  const r = await renderAsync(load('rc-lowpass-bode.json'))
  assert.deepEqual(problems(r), [])
  const fc = 1 / (TAU * 1e3 * 100e-9)
  near(read(r.summary, 'pole'), fc, 5e-4, 'pole'); near(read(r.summary, '−3 dB at'), fc, 5e-4, '−3 dB')
  assert.match(r.summary, /asymptote slopes 0, -20 dB\/dec/)
  assert.match(words(r.svg), /−45\.0°/); assert.match(words(r.svg), /−20 dB\/dec/)
})

test('series RLC band-pass and notch: −3 dB points at ∓R/2L + √((R/2L)² + ω0²), BW = R/(2πL)', async () => {
  const parts = { R: '100 ohm', L: '10 mH', C: '1 uF' }
  const a = 100 / (2 * 0.01), w0 = 1 / Math.sqrt(0.01 * 1e-6)
  const f1 = (Math.sqrt(a * a + w0 * w0) - a) / TAU, f2 = (Math.sqrt(a * a + w0 * w0) + a) / TAU
  for (const out of ['R', 'L + C']) {
    const r = await renderAsync(spec({ mode: 'bode', parts, out, expect: { f1, f2, f0: w0 / TAU } }))
    assert.deepEqual(problems(r), [], out)
    const m = /−3 dB at ([\d.]+) Hz and ([\d.]+) kHz \(BW ([\d.]+) kHz\)/.exec(r.summary)
    near(+m[1], f1, 1e-3, `${out} f1`); near(+m[2] * 1e3, f2, 1e-3, `${out} f2`); near(+m[3] * 1e3, 100 / (TAU * 0.01), 1e-3, `${out} BW`)
    assert.match(r.summary, /expect: f1 ok, f2 ok, f0 ok/)
  }
  const bp = await renderAsync(spec({ mode: 'bode', parts, out: 'R' }))
  assert.match(bp.summary, /zeros at the origin 1; pole pair 1\.592 kHz \(ζ 0\.500, Q 1\.00\); asymptote slopes \+20, -20 dB\/dec/)
})

test('the factored H matches the circuit for every divider, the tank included', () => {
  const diag = new Diag()
  for (const [circuit, out, parts] of [['R + C', 'C', { R: 1e3, C: 1e-7 }], ['R + C', 'R', { R: 1e3, C: 1e-7 }], ['L + R', 'R', { L: 0.01, R: 100 }],
    ['R + L + C', 'L + C', { R: 100, L: 0.01, C: 1e-6 }], ['R + (L || C)', 'L || C', { R: 1e3, L: 0.01, C: 1e-6 }], ['R1 + (R2 || C)', 'R2 || C', { R1: 1e3, R2: 1e3, C: 1e-6 }]]) {
    const s = { parts, circuit, out }, ps = readParts(s, {}, diag), node = readCircuit(s, ps, diag)
    const tf = fromDivider(divider(s, node, ps), new Map(ps.map((p) => [p.name, p])))
    for (const f of [3, 100, 1234, 1e4, 3e5]) {
      const h = tf.H(f), g = evalFactors(tf, f)
      assert.ok(Math.abs(abs(h) / abs(g) - 1) < 1e-9 && Math.abs(arg(h) - arg(g)) < 1e-6, `${circuit} out ${out} at ${f} Hz`)
    }
  }
})

test('poles and zeros: 40 dB gain, poles at 100 Hz and 10 kHz; slopes 0, −20, −40', async () => {
  const r = await renderAsync(load('two-pole-amp-bode.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /K 100\.0; pole 100\.0 Hz, pole 10\.00 kHz; asymptote slopes 0, -20, -40 dB\/dec; max \|H\| 40\.00 dB/)
  // The second pole pulls the −3 dB point a hair under 100 Hz.
  near(read(r.summary, '−3 dB at'), 100, 1e-3, '−3 dB')
  const z = fromPoles({ zeros: [0], poles: ['1 kHz', { f: '10 kHz', Q: 5 }], gain: 2 }, {}, new Diag())
  assert.equal(z.m, 1); assert.equal(z.fac[1].pair, true); near(z.fac[1].zeta, 0.1, 1e-12, 'ζ = 1/2Q')
})

// Q = (1/R)√(L/C) = 100/R with L = 10 mH, C = 1 μF; BW = R/(2πL); f0 = 1/(2π√LC) = 1591.5 Hz.
test('resonance: f0, Q, BW, and the half-power points for each swept R', async () => {
  const r = await renderAsync(load('rlc-resonance-q.json'))
  assert.deepEqual(problems(r), [])
  for (const R of [10, 40]) {
    const part = r.summary.split('; ').find((p) => p.startsWith(`R ${R} Ω:`))
    assert.ok(part, `no R ${R} in ${r.summary}`)
    near(read(part, 'f0'), 1 / (TAU * Math.sqrt(1e-8)), 5e-4, 'f0')
    near(+/Q ([\d.]+)/.exec(part)[1], 100 / R, 5e-4, 'Q')
    near(read(part, 'BW'), R / (TAU * 0.01), 5e-4, 'BW')
    // The half-power points straddle f0 geometrically: f1 f2 = f0².
    near(read(part, 'f1') * read(part, 'f2'), 1 / (TAU * TAU * 1e-8), 1e-3, 'f1 f2')
    near(read(part, 'peak I'), 1 / R, 5e-4, 'peak I = V/R')
  }
  assert.match(words(r.svg), /R = 10 Ω/); assert.match(words(r.svg), /Q = 2\.50/)
})

test('examples lay out with no crowded labels', async () => {
  for (const f of readdirSync(new URL('examples/', import.meta.url))) {
    for (const theme of ['dark', 'paper']) {
      const r = await renderAsync(load(f), { theme })
      assert.ok(!r.diagnostics.some((d) => /crowded/.test(d.msg)), `${f} ${theme}: ${r.text}`)
    }
  }
})

test('bad input: units, unknown parts, topology, and missing fields say what to write', async () => {
  const p = { R: '30 ohm', L: '80 mH', C: '20 uF' }
  const uh = await renderAsync(spec({ parts: { ...p, C: '20 uH' }, V: 90, f: 60 }))
  assert.match(warnings(uh), /parts\.C: "20 uH" is in H; this takes F/)
  const bad = async (s, re) => { const r = await renderAsync(spec(s)); assert.equal(r.svg, null); assert.match(r.text, re) }
  await bad({ parts: p, circuit: 'R + X', V: 90, f: 60 }, /"X" isn't in parts/)
  await bad({ parts: p, circuit: 'R + (L || C', V: 90, f: 60 }, /unexpected end/)
  await bad({ parts: p, circuit: 'R + (L || C)', V: 90, f: 60 }, /phasor diagram needs every part in series or every part in parallel/)
  await bad({ parts: { Q1: 5 }, V: 90, f: 60 }, /starts with R, L, or C/)
  await bad({ parts: p, V: 90 }, /give the source frequency/)
  await bad({ mode: 'bode', parts: p }, /needs out \(a divider\) or poles and zeros/)
  await bad({ mode: 'bode', parts: p, out: 'X' }, /"X" isn't in parts/)
  await bad({ mode: 'bode', parts: p, circuit: 'parallel', out: 'C' }, /needs a series divider/)
  await bad({ mode: 'resonance', parts: { R: 10, C: 1e-6 } }, /resonance needs one L and one C/)
  await bad({ mode: 'resonance', parts: p, sweep: { X: [1] } }, /"X" isn't in parts/)
  await bad({ parts: { L: '10 mH', C: '1 uF' }, V: 1, f: 1 / (TAU * Math.sqrt(1e-8)) }, /impedance is zero/)
  await bad({ mode: 'wiggle', parts: p }, /mode is phasor \(default\), impedance, bode, or resonance/)
})
