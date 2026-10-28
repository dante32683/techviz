import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderAsync } from '../../index.js'
import { Diag } from '../../diag.js'
import { solve } from './cascade.js'

const load = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))
const problems = (r) => r.diagnostics.filter((d) => d.level !== 'note').map((d) => `${d.path}: ${d.msg}`)
const spec = (rest) => ({ v: 1, kind: 'chain', ...rest })
const run = (s) => { const diag = new Diag(); return { S: solve(s, {}, diag), diag } }
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`)
const lin = (db) => 10 ** (db / 10)
const dB = (x) => 10 * Math.log10(x)
const byId = (S, id) => S.stages.find((s) => s.id === id)

// Front end: LNA (G 20, NF 1.5), BPF (2 dB), mixer (7 dB), IF amp (G 30, NF 4), B = 1 MHz, −90 dBm in.
// Friis: F = F1 + (F2 − 1)/G1 + (F3 − 1)/(G1 G2) + (F4 − 1)/(G1 G2 G3).
const friis = (stages) => {
  let F = 1, G = 1
  stages.forEach(([g, nf], i) => { F += i === 0 ? lin(nf) - 1 : (lin(nf) - 1) / G; G *= lin(g) })
  return dB(F)
}
const FRONT = [[20, 1.5], [-2, 2], [-7, 7], [30, 4]]
const FILTER_FIRST = [[-2, 2], [20, 1.5], [-7, 7], [30, 4]]

test('front end: node levels, Friis NF, noise floor at every node, SNR, sensitivity, and IIP3 match hand calculations', async () => {
  const r = await renderAsync(load('frontend.json'))
  assert.deepEqual(problems(r), [])
  const { S } = run(load('frontend.json'))
  assert.deepEqual(S.nodes.map((n) => n.level), [-90, -70, -72, -79, -49])
  const nf = friis(FRONT) // 2.047 dB
  near(S.T.nf, nf, 1e-9, 'cascade NF')
  near(nf, 2.047, 0.001, 'hand Friis')
  // Each node: −174 + 10 log10(1e6) + ΣG + ΣNF, with ΣNF by Friis over the stages so far.
  S.stages.forEach((s, k) => {
    const sofar = FRONT.slice(0, k + 1)
    near(s.out.nf, friis(sofar), 1e-9, `ΣNF at ${s.name}`)
    near(s.out.N, -174 + 60 + sofar.reduce((a, [g]) => a + g, 0) + friis(sofar), 1e-9, `N at ${s.name}`)
  })
  near(S.nodes[0].N, -114, 1e-9, 'kTB in 1 MHz')
  near(S.T.snr, -90 - (-174 + 60 + nf), 1e-9, 'SNR at the output')
  near(S.T.sens, -174 + 60 + nf + 10, 1e-9, 'sensitivity for SNR 10 dB')
  // IIP3: the LNA's is OIP3 − G = 0 dBm; the mixer's +10 dBm sits behind 18 dB: 1/IIP3 = 1/1 + 10^1.8/10.
  near(S.T.iip3, -dB(1 + lin(18) / lin(10)), 1e-9, 'cascade IIP3')
  near(S.T.oip3, S.T.iip3 + 41, 1e-9, 'OIP3 = IIP3 + G')
  assert.match(r.summary, /levels \(dBm\): in −90, lna −70, bpf −72, mix −79, ifamp −49/)
  assert.match(r.summary, /NF 2\.05 dB \(Friis\)/)
  assert.match(r.summary, /expect: 6 checked, all match/)
})

test('filter ahead of the LNA: its 2 dB adds almost fully to the NF (3.84 dB against 2.05 dB)', async () => {
  const r = await renderAsync(load('filter-first.json'))
  assert.deepEqual(problems(r), [])
  const { S } = run(load('filter-first.json'))
  near(S.T.nf, friis(FILTER_FIRST), 1e-9, 'cascade NF')
  near(S.T.nf, 3.843, 0.001, 'hand Friis')
  near(byId(S, 'lna').out.nf, 2 + 1.5, 1e-9, 'a passive part ahead: F = L F_LNA, so NF adds in dB')
  near(S.T.nf - friis(FRONT), 1.796, 0.001, 'the NF penalty')
  near(S.T.snr, -90 - (-174 + 60 + S.T.nf), 1e-9, 'SNR')
  assert.match(r.summary, /expect: 5 checked, all match/)
})

test('expect names a wrong value and gives the right one', async () => {
  const s = load('frontend.json')
  s.expect = { nf: 1.5, snr: 21.95, lna: { level: -72 }, mix: { image: '2.51 GHz' } }
  const r = await renderAsync(s)
  assert.deepEqual(problems(r), [
    'expect.nf: the cascade NF is 2.05 dB, not 1.5 dB',
    'expect.lna.level: lna output level is −70 dBm, not −72 dBm',
    'expect.mix.image: mix image is 2.3 GHz, not 2.51 GHz',
  ])
  assert.match(r.summary, /expect: 3 of 4 wrong/)
})

test('frequency plan: IF = |RF − LO|, image = 2 LO − RF on either side, and whether the preselector rejects it', async () => {
  const r = await renderAsync(load('image.json'))
  assert.deepEqual(problems(r), [])
  const [p] = run(load('image.json')).S.plans
  near(p.if, 10.7e6, 1, 'IF'); near(p.lo, 108.7e6, 1, 'LO'); near(p.image, 119.4e6, 1, 'image')
  assert.equal(p.inject, 'high')
  assert.deepEqual(p.rejecting.map((q) => q.id), ['pre'])
  assert.equal(p.rejectDb, 30)
  assert.match(r.summary, /mix: RF 98 MHz, LO 108\.7 MHz \(high-side\), IF 10\.7 MHz, image 119\.4 MHz: rejected by pre \(30 dB\)/)
  // Low-side from the IF: LO = RF − IF = 87.3 MHz, image = RF − 2 IF = 76.6 MHz, also outside 88 to 108 MHz.
  const blocks = (mix) => [{ type: 'antenna' }, { id: 'pre', type: 'filter', pass: ['88 MHz', '108 MHz'] }, { id: 'mix', type: 'mixer', ...mix }]
  const [low] = run(spec({ f: '98 MHz', blocks: blocks({ if: '10.7 MHz' }) })).S.plans
  near(low.lo, 87.3e6, 1, 'low-side LO'); near(low.image, 76.6e6, 1, 'low-side image')
  assert.equal(low.inject, 'low'); assert.equal(low.rejecting.length, 1)
  // An IF of 2 MHz puts the image at 94 MHz, inside the preselector: not rejected.
  const { S: S2 } = run(spec({ f: '98 MHz', blocks: blocks({ lo: '96 MHz' }) }))
  near(S2.plans[0].image, 94e6, 1, 'image of a low IF')
  assert.deepEqual(S2.plans[0].passing.map((q) => q.id), ['pre'])
  const r2 = await renderAsync(spec({ f: '98 MHz', plan: true, blocks: blocks({ lo: '96 MHz' }) }))
  assert.match(r2.summary, /image 94 MHz: inside pre's passband, so it is not rejected/)
  // The SA preset's high first IF: RF 1 GHz, IF 3.9 GHz, LO 4.9 GHz, image 8.8 GHz, above its 3 GHz low-pass.
  const [sa] = run(load('sa.json')).S.plans
  near(sa.lo, 4.9e9, 1, 'SA LO'); near(sa.image, 8.8e9, 1, 'SA image')
  assert.deepEqual(sa.rejecting.map((q) => q.id), ['lpf'])
})

test('compression: the tinySA sits 6.5 dB under its +6 dBm maximum behind the pad, and warns without it', async () => {
  const r = await renderAsync(load('tinysa.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /closest sa, 6\.5 dB under its maximum input \+6 dBm/)
  const s = load('tinysa.json')
  s.blocks = s.blocks.filter((b) => b.id !== 'pad')
  delete s.expect
  const r2 = await renderAsync(s)
  assert.deepEqual(problems(r2), ['blocks[2]: sa input is +19.5 dBm, 13.5 dB past its maximum input of +6 dBm; add at least 13.5 dB of attenuation ahead of it'])
  // An LNA's output past its P1dB, and a mixer's input past its input P1dB.
  const r3 = await renderAsync(spec({ input: '-15 dBm', blocks: [{ type: 'antenna' }, { id: 'lna', type: 'amp', gain: 20, nf: 1, p1db: 3 }, { id: 'mix', type: 'mixer', ip1db: 1 }] }))
  assert.deepEqual(problems(r3), [
    'blocks[1]: lna output is +5 dBm, 2 dB past its P1dB of +3 dBm; lower its input (the levels after it assume no compression)',
    'blocks[2]: mix input is +5 dBm, 4 dB past its input P1dB of +1 dBm; add at least 4 dB of attenuation ahead of it',
  ])
  assert.match(r3.summary, /compression: lna output \+5 dBm is 2 dB past its P1dB \+3 dBm; mix input \+5 dBm is 4 dB past its input P1dB \+1 dBm/)
})

test('VNA preset: R gets the split incident wave, A the reflected wave less the coupling, B the transmitted wave', async () => {
  const r = await renderAsync(load('vna.json'))
  assert.deepEqual(problems(r), [])
  const { S } = run(load('vna.json'))
  const rx = (id) => S.stages.flatMap((s) => [s, ...(s.branch ?? [])]).find((q) => q.id === id).in.level
  // 0 dBm − 6 dB split = −6 at R; −7 out of the coupler, −15 dB RL at the DUT, back to the coupler, −20 dB coupled: −42.
  assert.equal(rx('R'), -6); assert.equal(rx('A'), -42); assert.equal(rx('B'), -10)
  // Patching the preset by id: a better match (RL 25 dB) and a 10 dB coupler.
  const { S: S2 } = run(spec({ preset: 'vna', blocks: [{ id: 'dut', rl: 25 }, { id: 'coupler', coupling: 10 }] }))
  assert.equal(S2.stages.find((s) => s.id === 'coupler').branch[0].in.level, -7 - 25 - 10)
  assert.match(r.summary, /coupler branch: reflected by dut \(RL 15 dB\), − 20 dB coupling; A in −42 dBm/)
})

test('SA preset: the input noise floor is −174 + 10 log10(RBW) + NF, and each dB of input attenuation adds a dB', async () => {
  const r = await renderAsync(load('sa.json'))
  assert.deepEqual(problems(r), [])
  const { S } = run(load('sa.json'))
  // atten 10, LPF 0.5, mixer 7, IF gain 20 with NF 8, RBW filter 1 dB; the log amp has no gain, so the NF stops there.
  const nf = friis([[-10, 10], [-0.5, 0.5], [-7, 7], [20, 8], [-1, 1]])
  near(S.T.nf, nf, 1e-9, 'analyzer NF')
  near(S.T.mds, -174 + 40 + nf, 1e-9, 'DANL in a 10 kHz RBW')
  const { S: S20 } = run(spec({ preset: 'sa', bw: '10 kHz', blocks: [{ id: 'atten', loss: 20 }] }))
  near(S20.T.mds - S.T.mds, 10, 1e-9, 'a passive first stage: NF = L + NF_rest')
  const { S: S1k } = run(spec({ preset: 'sa', bw: '1 kHz' }))
  near(S.T.mds - S1k.T.mds, 10, 1e-9, 'RBW 10x narrower, floor 10 dB lower')
})

test('bad input stops with a message that says what to write', async () => {
  const errors = async (s) => (await renderAsync(spec(s))).diagnostics.map((d) => `${d.level} ${d.path}: ${d.msg}`)
  assert.deepEqual(await errors({ blocks: [{ type: 'amp' }] }), ['error blocks[0]: an amp needs its gain, like "gain": 20 (dB)'])
  assert.deepEqual(await errors({ blocks: [{ type: 'amp', gain: 10 }, { type: 'antenna' }] }), ['error blocks[1].type: an antenna starts the chain; put it first in blocks'])
  assert.match((await errors({ preset: 'sa', blocks: [{ id: 'atenn', loss: 20 }] }))[0], /blocks\[0\]\.id: with a preset, blocks patch its blocks by id; "sa" has atten, lpf/)
  assert.match((await errors({ f: '1 GHz', blocks: [{ type: 'mixer', if: '3 GHz' }] }))[0], /use "inject": "high"/)
  assert.deepEqual(await errors({ f: '1 GHz', blocks: [{ id: 'bpf', type: 'filter', pass: ['2 GHz', '3 GHz'] }] }), ["warning blocks[0]: the signal at 1 GHz is outside bpf's passband (2 GHz to 3 GHz); it would be cut, not passed"])
  assert.deepEqual(await errors({ blocks: [{ type: 'amp', gain: '10 dBm' }] }), ['warning blocks[0].gain: "10 dBm" is in dBm; this takes dB'])
  assert.deepEqual(await errors({ table: ['N'], blocks: [{ type: 'amp', gain: 10 }] }), ['error table: the N row (noise floor) needs bw, the noise bandwidth'])
})

test('a long chain wraps to more rows instead of growing past about 350 px', async () => {
  const blocks = [{ type: 'antenna' }, ...Array.from({ length: 9 }, (_, i) => ({ type: 'amp', label: `A${i + 1}`, gain: 10, nf: 3 }))]
  const r = await renderAsync(spec({ input: '-100 dBm', bw: '1 MHz', blocks }))
  assert.deepEqual(problems(r), [])
  assert.ok(r.width <= 352, `width ${r.width}`)
  for (const f of ['frontend.json', 'filter-first.json', 'tinysa.json', 'image.json', 'sa.json', 'vna.json']) {
    const w = (await renderAsync(load(f))).width
    assert.ok(w <= 352, `${f} is ${w} px wide`)
  }
})
