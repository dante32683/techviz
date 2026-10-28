import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderAsync } from '../../index.js'
import { solveModel, R } from './gas.js'
import { Diag } from '../../diag.js'

const load = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))
const problems = (r) => r.diagnostics.filter((d) => d.level !== 'note').map((d) => `${d.path}: ${d.msg}`)
const warnings = (r) => r.diagnostics.filter((d) => d.level === 'warning').map((d) => `${d.path}: ${d.msg}`).join('\n')
const spec = (rest) => ({ v: 1, kind: 'thermo', ...rest })
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`)
const solve = (s) => { const d = new Diag(); const M = solveModel(s, {}, d); return { M, d } }
const leg = (M, id) => M.legs.find((L) => L.id === id)
const ATM = 101325, L = 1e-3
const RECT = { type: 'rectangle', P: ['1.0 atm', '3.0 atm'], V: ['1.0 L', '3.0 L'] }

// Rectangle, monatomic, n 0.10, A (1 atm, 1 L) → B (3 atm, 1 L) → C (3 atm, 3 L) → D (1 atm, 3 L), by hand
// (1 atm·L = 101.325 J; ΔE_int = (3/2) Δ(PV); W = P ΔV on the isobars; Q = ΔE_int + W):
//   A→B: W 0, ΔE_int = 1.5·(3 − 1)·101.325 = 303.975, Q 303.975
//   B→C: W = 3·2·101.325 = 607.95, ΔE_int = 1.5·(9 − 3)·101.325 = 911.925, Q 1519.875
//   C→D: W 0, ΔE_int = Q = −911.925;  D→A: W −202.65, ΔE_int −303.975, Q −506.625
//   net W 405.3, Q_in 1823.85, e = 405.3/1823.85 = 2/9, Carnot 1 − T_A/T_C = 1 − 1/9
test('rectangle cycle: W, Q, and ΔE_int per leg, net work, and e against Carnot match the hand values', () => {
  const { M } = solve({ n: 0.1, cycle: RECT })
  const want = { AB: [0, 303.975, 303.975], BC: [607.95, 1519.875, 911.925], CD: [0, -911.925, -911.925], DA: [-202.65, -506.625, -303.975] }
  for (const [id, [W, Q, dE]] of Object.entries(want)) {
    near(leg(M, id).W, W, 1e-6, `W_${id}`); near(leg(M, id).Q, Q, 1e-6, `Q_${id}`); near(leg(M, id).dE, dE, 1e-6, `ΔE_${id}`)
  }
  near(M.W, 405.3, 1e-9, 'W_net'); near(M.Qin, 1823.85, 1e-9, 'Q_in'); near(M.Qout, 1418.55, 1e-9, 'Q_out')
  near(M.e, 2 / 9, 1e-12, 'e'); near(M.eC, 8 / 9, 1e-12, 'e_C')
  near(M.states[0].T, (ATM * L) / (0.1 * R), 1e-9, 'T_A')
  near(M.dE, 0, 1e-9, 'ΔE_int around the cycle')
})

// Isothermal and adiabatic expansions from A (1 mol, 1 atm, 22.4 L) to twice the volume:
//   isothermal W = P_A V_A ln 2 = 2269.68·0.693147 = 1573.21 J = Q
//   adiabatic P_C = P_A 2^(−5/3), T_C = T_A 2^(−2/3), W = (3/2) P_A V_A (1 − 2^(−2/3)) = −ΔE_int, Q 0
test('isothermal against adiabatic: the work and the adiabatic end state', async () => {
  const { M } = solve(load('isothermal-vs-adiabatic.json'))
  const PV = ATM * 22.4 * L
  near(leg(M, 'AB').W, PV * Math.LN2, 1e-6, 'W isothermal'); near(leg(M, 'AB').Q, PV * Math.LN2, 1e-6, 'Q isothermal')
  near(leg(M, 'AC').W, 1.5 * PV * (1 - 2 ** (-2 / 3)), 1e-6, 'W adiabatic'); near(leg(M, 'AC').Q, 0, 0, 'Q adiabatic')
  const C = M.states.find((s) => s.id === 'C')
  near(C.P, ATM * 2 ** (-5 / 3), 1e-6, 'P_C'); near(C.T, M.states[0].T * 2 ** (-2 / 3), 1e-9, 'T_C')
  near(leg(M, 'AC').W, 1259.8, 0.1, 'W adiabatic, rounded')
  const r = await renderAsync(load('isothermal-vs-adiabatic.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /A→B isothermal: W \+1573 J, Q \+1573 J, ΔE_int 0 J, ΔS \+5\.763 J\/K/)
  assert.match(r.summary, /expect: (\w+ ok, )*\w+ ok$/)
})

// Named cycles against their closed forms:
//   Carnot (1 mol, 500 K / 300 K, 10 → 30 L): W_AB = R·500·ln 3 = 4566.93 J, V_C = 30 (5/3)^1.5 L, e = 0.4,
//     W_net = R·200·ln 3, ΔS_AB = R ln 3
//   Otto (diatomic, r 8): e = 1 − 8^(−0.4) = 0.564725;  Diesel (r 10, rc 2): e = 1 − 10^(−0.4)(2^1.4 − 1)/1.4
//   Brayton (rp 10): e = 1 − 10^(−0.4/1.4);  Stirling (monatomic, 600/300 K, 1 → 2 L, no regenerator):
//     e = 300 ln 2 / (600 ln 2 + 1.5·300) = 0.240150
test('named cycles: efficiencies and end states match the closed forms', () => {
  const c = solve({ n: 1, cycle: { type: 'carnot', Th: '500 K', Tc: '300 K', V: ['10 L', '30 L'] } }).M
  near(leg(c, 'AB').W, R * 500 * Math.log(3), 1e-6, 'Carnot W_AB'); near(c.e, 0.4, 1e-12, 'Carnot e'); near(c.eC, 0.4, 1e-12, 'Carnot e_C')
  near(c.states[2].V, 30 * L * (5 / 3) ** 1.5, 1e-12, 'Carnot V_C'); near(c.W, R * 200 * Math.log(3), 1e-6, 'Carnot W_net')
  near(leg(c, 'AB').dS, R * Math.log(3), 1e-9, 'Carnot ΔS_AB'); near(leg(c, 'BC').dS, 0, 1e-9, 'adiabatic ΔS')
  const o = solve({ gas: 'diatomic', cycle: { type: 'otto', r: 8, V: '500 cm^3', P: '100 kPa', T: '300 K', Tmax: '1500 K' } }).M
  near(o.e, 1 - 8 ** -0.4, 1e-12, 'Otto e'); near(o.states[1].T, 300 * 8 ** 0.4, 1e-9, 'Otto T_B')
  const d = solve({ gas: 'diatomic', cycle: { type: 'diesel', r: 10, rc: 2, V: '1 L', P: '100 kPa', T: '300 K' } }).M
  near(d.e, 1 - 10 ** -0.4 * (2 ** 1.4 - 1) / 1.4, 1e-12, 'Diesel e')
  const b = solve({ gas: 'diatomic', cycle: { type: 'brayton', rp: 10, P: '100 kPa', T: '300 K', V: '1 L', Tmax: '1400 K' } }).M
  near(b.e, 1 - 10 ** (-0.4 / 1.4), 1e-12, 'Brayton e')
  const s = solve({ n: 1, cycle: { type: 'stirling', Th: '600 K', Tc: '300 K', V: ['1 L', '2 L'] } }).M
  near(s.e, (300 * Math.LN2) / (600 * Math.LN2 + 450), 1e-12, 'Stirling e')
  // Every cycle closes: ΔE_int sums to zero and W = Q.
  for (const M of [c, o, d, b, s]) { near(M.dE, 0, 1e-9 * M.Qin, 'ΔE_int around'); near(M.W, M.Q, 1e-9 * M.Qin, 'W = Q around') }
})

// Run backward: K_R = Q_in/|W|, K_P = Q_out/|W|. Rectangle: 1418.55/405.3 = 3.5 and 4.5. Carnot 500/300 K:
// K_R = 300/200 = 1.5, K_P = 2.5. A reversed rectangle takes in heat hotter than it gives it out, so no Carnot bound.
test('cycles run backward give K_R and K_P, with the Carnot COP only where it bounds the cycle', async () => {
  const r = solve({ n: 0.1, cycle: { ...RECT, reverse: true } }).M
  near(r.W, -405.3, 1e-9, 'W'); near(r.KR, 3.5, 1e-12, 'K_R'); near(r.KP, 4.5, 1e-12, 'K_P')
  assert.equal(r.KRC, undefined)
  const c = solve({ n: 1, cycle: { type: 'carnot', Th: '500 K', Tc: '300 K', V: ['10 L', '30 L'], reverse: true } }).M
  near(c.KR, 1.5, 1e-9, 'Carnot K_R'); near(c.KP, 2.5, 1e-9, 'Carnot K_P'); near(c.KRC, 1.5, 1e-9, 'Carnot limit K_R')
  const ex = load('rectangle-cycle.json')
  for (const step of [0, 1]) assert.match((await renderAsync(ex, { step })).summary, /expect: (\w+ ok, )*\w+ ok$/, `step ${step}`)
})

// A straight leg whose heat changes sign: B (1 L, 3 atm) → C (3 L, 1 atm) on P = 4 − V (atm, L):
// dQ = (3/2) d(PV) + P dV = (10 − 4V) dV, in up to V = 2.5 L (4.5 atm·L = 455.96 J), out after (0.5 atm·L).
test('a straight leg whose heat changes sign is reported piece by piece', () => {
  const { M } = solve({ cycle: { type: 'triangle', P: ['1.0 atm', '3.0 atm'], V: ['1.0 L', '3.0 L'] } })
  const bc = leg(M, 'BC')
  near(bc.qin, 4.5 * 101.325, 0.05, 'heat in along B→C'); near(bc.qout, 0.5 * 101.325, 0.05, 'heat out along B→C')
  near(M.e, 202.65 / (303.975 + 405.3), 1e-9, 'e from the legs\' net Q')
  assert.equal(M.split.length, 1)
})

test('energy flow: engines, refrigerators, and heat pumps, with the second law checked', async () => {
  const fr = await renderAsync(load('refrigerator-flow.json'))
  assert.deepEqual(problems(fr), [])
  assert.match(fr.summary, /refrigerator: Q_c 300\.0 J, W 75\.00 J, Q_h = Q_c \+ W = 375\.0 J, K_R = Q_c\/W = 4\.000; Carnot limit K_R = T_c\/\(T_h − T_c\) = 13\.91/)
  const eng = await renderAsync(spec({ mode: 'flow', Th: '600 K', Tc: '300 K', Qh: '2.0 kJ', e: 0.3, expect: { W: '600 J', Qc: '1400 J', eC: 0.5 } }))
  assert.match(eng.summary, /expect: W ok, Qc ok, eC ok$/)
  const hp = await renderAsync(spec({ mode: 'flow', device: 'heat pump', Th: '20 °C', Tc: '-5 °C', W: '1.0 kW', K: 3.2 }))
  assert.match(hp.summary, /Q_c 2\.200 kW, W 1\.000 kW, Q_h = Q_c \+ W = 3\.200 kW, K_P = Q_h\/W = 3\.200; Carnot limit K_P = T_h\/\(T_h − T_c\) = 11\.73/)
  const bad = await renderAsync(spec({ mode: 'flow', Th: '400 K', Tc: '300 K', Qh: '1000 J', W: '400 J' }))
  assert.match(warnings(bad), /e: e = 0\.400 beats the Carnot limit 0\.250: no engine between 400 K and 300 K can \(the second law\)/)
  const cyc = await renderAsync(spec({ mode: 'flow', n: 1, cycle: { type: 'carnot', Th: '500 K', Tc: '300 K', V: ['10 L', '30 L'] }, expect: { e: 0.4, Qh: '4567 J' } }))
  assert.match(cyc.summary, /expect: e ok, Qh ok$/)
})

// Heating 1.00 kg of ice from −20 °C to 120 °C: 1·2090·20 + 1·334000 + 1·4186·100 + 1·2256000 + 1·2020·20
// = 41.8 + 334 + 418.6 + 2256 + 40.4 = 3090.8 kJ. 0.50 kg from −10 °C with 100 kJ: 10.45 kJ warms it,
// 89.55 kJ melts 89.55/334 = 0.2681 kg.
test('heating curve: each stretch and the total, and a stop partway through melting', async () => {
  const r = await renderAsync(load('heating-curve.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /total Q 3091 kJ, ends at 120\.0 °C/)
  const p = await renderAsync(spec({ mode: 'heating', m: '0.50 kg', from: '-10 °C', Q: '100 kJ', expect: { Tf: '0 °C' } }))
  assert.match(p.summary, /ends at 0 °C with 0\.2681 kg of 0\.5000 kg melted/)
  assert.match(p.summary, /expect: Tf ok$/)
  const slip = await renderAsync(spec({ mode: 'heating', m: '1 kg', from: '-20 °C', to: '50 °C', expect: { Q: '251.1 kJ' } }))
  assert.match(warnings(slip), /leaves out the latent heat/)
})

// N2 at 300 K: v_rms = √(3·8.314·300/0.02801) = 516.9 m/s, v_p = √(2/3) v_rms = 422.0, v̄ = √(8/3π) v_rms = 476.2.
test('Maxwell–Boltzmann speeds', async () => {
  const r = await renderAsync(spec({ mode: 'speeds', gas: 'N2', T: '300 K', expect: { vrms: 516.9, vp: 422.0, vavg: 476.2 } }))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /expect: vrms ok, vp ok, vavg ok$/)
  const w = warnings(await renderAsync(spec({ mode: 'speeds', gas: 'N2', T: '300 K', expect: { vrms: 16.34, vp: 516.9 } })))
  assert.match(w, /uses M in g\/mol/); assert.match(w, /is v_rms = √\(3RT\/M\); v_p = √\(2RT\/M\)/)
})

test('expect names each slip: signs, C_p for C_V, the first law, °C, L·atm, log₁₀, γ, K_R for K_P', async () => {
  const rect = await renderAsync(spec({ n: 0.1, cycle: RECT, expect: { W_DA: 203, Q_BC: 912, Q_AB: 506.6, dE_BC: 1520, T_C: 823.7, e: 0.889, W_BC: 6.0 } }))
  const w = warnings(rect)
  assert.match(w, /expect\.W_DA: 203\.0 has the wrong sign: W is the work done by the gas, positive when it expands/)
  assert.match(w, /expect\.Q_BC: 912\.0 uses C_V; at constant pressure Q = nC_pΔT/)
  assert.match(w, /expect\.Q_AB: 506\.6 uses C_p; at constant volume Q = nC_VΔT/)
  assert.match(w, /expect\.dE_BC: 1520 uses C_p; ΔE_int = nC_VΔT on every path/)
  assert.match(w, /expect\.T_C: 823\.7 is in °C; T here is in kelvin/)
  assert.match(w, /expect\.e: 0\.8890 is the Carnot limit 1 − T_c\/T_h/)
  assert.match(w, /expect\.W_BC: 6\.000 is in L·atm; 1 L·atm = 101\.3 J/)
  const law = warnings(await renderAsync(spec({ n: 0.1, cycle: RECT, expect: { Q_BC: 304 } })))
  assert.match(law, /comes from ΔE_int = Q \+ W; OpenStax's first law is ΔE_int = Q − W/)
  const iso = load('isothermal-vs-adiabatic.json')
  // T_A (V_A/V_C)^γ = 273.0·2^(−5/3) = 86.0 K: T V^γ held constant instead of T V^(γ−1).
  const w2 = warnings(await renderAsync({ ...iso, expect: { W_AB: 683.2, P_C: 0.3789, T_C: 273.0 * 2 ** (-5 / 3) } }))
  assert.match(w2, /expect\.W_AB: 683\.2 uses log₁₀/)
  assert.match(w2, /expect\.P_C: 0\.3789 uses γ = 1\.40; this gas has γ = 1\.67/)
  assert.match(w2, /expect\.T_C: .* uses T V\^γ/)
  const carnot = warnings(await renderAsync(spec({ n: 1, cycle: { type: 'carnot', Th: '500 K', Tc: '300 K', V: ['10 L', '30 L'] }, expect: { eC: 0.8816 } })))
  assert.match(carnot, /uses °C; the Carnot limit needs kelvin/)
  const fr = warnings(await renderAsync(spec({ n: 0.1, cycle: { ...RECT, reverse: true }, expect: { KR: 4.5 } })))
  assert.match(fr, /is K_P = Q_h\/\|W\| \(a heat pump's\); K_R = Q_c\/\|W\|/)
})

test('bad input: underdetermined states, unknown processes, a T-S diagram without n, a leg off its process', async () => {
  const err = async (s) => (await renderAsync(spec(s))).diagnostics.filter((d) => d.level === 'error').map((d) => `${d.path}: ${d.msg}`)
  assert.match((await err({ states: [{ P: '1 atm', V: '1 L' }, { V: '2 L' }], legs: [{ to: 'B', process: 'line' }] }))[0], /a line leg needs both ends known/)
  assert.match((await err({ states: [{ P: '1 atm', V: '1 L' }, { V: '2 L' }], legs: [{ to: 'B', process: 'isobar' }] }))[0], /process is isobaric, isochoric, isothermal, adiabatic, or line/)
  assert.match((await err({ states: [{ P: '1 atm', V: '1 L' }, { P: '2 atm' }], legs: [{ to: 'B', process: 'isobaric' }] }))[0], /the isobaric leg already fixes P at B; give B V or T instead/)
  assert.match((await err({ mode: 'ts', cycle: RECT }))[0], /a T-S diagram needs n/)
  assert.match((await err({ states: [{ P: '1 atm', V: '1 L', T: -20 }] }))[0], /below absolute zero; a bare temperature is kelvin, so write Celsius as "-20 °C"/)
  assert.match((await err({ mode: 'flow', Qh: '1 kJ', W: '200 W' }))[0], /every amount as energy \(J\) or every one as power \(W\)/)
  const off = await renderAsync(spec({ states: [{ P: '1 atm', V: '1 L' }, { P: '2 atm', V: '2 L' }], legs: [{ to: 'B', process: 'isobaric' }] }))
  assert.match(warnings(off), /A→B is isobaric, but P_A ≠ P_B; fix a state or the process/)
})
