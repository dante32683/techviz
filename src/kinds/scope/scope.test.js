import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderAsync } from '../../index.js'
import { measure } from './measure.js'
import { readSignal } from './signal.js'
import { besselJ } from './spectrum.js'

const load = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))
const problems = (r) => r.diagnostics.filter((d) => d.level !== 'note').map((d) => `${d.path}: ${d.msg}`)
const notes = (r) => r.diagnostics.filter((d) => d.level === 'note').map((d) => d.msg).join('\n')
const spec = (rest) => ({ v: 1, kind: 'scope', ...rest })
const sine = (f, vpp, more = {}) => ({ type: 'sine', f, vpp, ...more })
// A number read back from the summary: the value after `label` in the part about `id`.
const num = (s) => { const m = /(−?[\d.]+) ?(p|n|μ|m|k|M|G)?/.exec(s); return parseFloat(m[1].replace('−', '-')) * ({ p: 1e-12, n: 1e-9, μ: 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9 }[m[2]] ?? 1) }
const read = (summary, id, label) => {
  const part = summary.split('; ').find((p) => p.startsWith(`${id} `))
  assert.ok(part, `no ${id} in ${summary}`)
  const m = new RegExp(`${label} ([>< ]*[−\\d.]+ ?[pnμmkMG]?)`).exec(part)
  assert.ok(m, `no ${label} for ${id} in ${part}`)
  return num(m[1].replace(/[<>]/g, ''))
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`)

// Lab 10: ε = 4 Vpp on CH1 at 2 V/div; V_sense = ε · 16.2 / (100 + 16.2) = 0.558 Vpp on CH2.
test('Lab 10: CH1 reads ε = 4.00 Vpp at 1.00 kHz, CH2 reads V_sense = 558 mV in phase; cursors give 1 ms', async () => {
  const r = await renderAsync(load('lab10.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /CH1 \(\\varepsilon\) 2 V\/div DC: Vpp 4\.00 V, Vmax 2\.00 V, Vmin −2\.00 V, Vrms 1\.41 V, Mean 0\.00 V, Freq 1\.00 kHz/)
  assert.match(r.summary, /CH2 \(V_\{sense\}\) 200 mV\/div DC: Vpp 558 mV/)
  assert.match(r.summary, /delay 0\.00 s, phase 0\.00° from CH1/)
  assert.match(r.summary, /ΔT 1\.00 ms, 1\/ΔT 1\.00 kHz; y 2\.00 V and −2\.00 V, ΔV 4\.00 V/)
  assert.match(r.svg, /Vpp 4\.00 V/)
})

test('Lab 10 with the hooks swapped: CH1 reads 13.9% of ε, and CH2 at 200 mV/div clips', async () => {
  const r = await renderAsync(load('lab10-swapped.json'))
  assert.deepEqual(problems(r), [])
  near(read(r.summary, 'CH1', 'Vpp') / 4, 16.2 / 116.2, 0.002, 'CH1 / ε')
  assert.match(r.summary, /CH2 \(\\varepsilon\) 200 mV\/div DC: Vpp >2\.05 V.*\(clipped\)/)
  assert.match(notes(r), /CH2 clips at 200 mV\/div: the ADC holds −1\.02 V to 1\.02 V/)
})

// A single-pole 20 MHz limit: t_r = 0.35/BW = 17.5 ns; with 200 MHz, √(1.75² + 1²) ≈ 2.0 ns.
test('bandwidth: the 20 MHz limit slows a 1 ns edge to about 0.35/BW = 17.5 ns', async () => {
  const r = await renderAsync(load('bandwidth.json'))
  assert.deepEqual(problems(r), [])
  near(read(r.summary, 'CH2', 'Rise'), 17.5e-9, 0.6e-9, 'CH2 rise')
  near(read(r.summary, 'CH2', 'Fall'), 17.5e-9, 0.6e-9, 'CH2 fall')
  near(read(r.summary, 'CH1', 'Rise'), 2.02e-9, 0.2e-9, 'CH1 rise')
  assert.match(notes(r), /CH2: 20 MHz bandwidth rises in 0\.35\/BW = 17\.5 ns/)
})

test('phase: CH2 45° ahead reads −45° (it leads), and XY gives sin φ = 0.707, φ = 45°', async () => {
  const chans = [{ vdiv: 1, signal: sine(1000, 6) }, { vdiv: 1, signal: sine(1000, 6, { phase: 45 }) }]
  const r = await renderAsync(spec({ timebase: '500 us', channels: chans, measure: ['phase'] }))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /delay −125 μs, phase −45\.0° from CH1/)
  const xy = await renderAsync(spec({ timebase: '500 us', channels: chans, xy: true }))
  assert.match(xy.summary, /XY: CH1 \(x\) against CH2 \(y\), 1:1; an ellipse, sin φ = y₀\/y_max = 0\.707, φ = 45\.0° \(CH2 leads\)/)
  const lag = await renderAsync(spec({ timebase: '500 us', channels: [chans[0], { vdiv: 1, signal: sine(1000, 6, { phase: -120 }) }], xy: true }))
  assert.match(lag.summary, /φ = −120° \(CH2 lags\)/)
  const two = await renderAsync(spec({ timebase: '1 ms', channels: [chans[0], { vdiv: 1, signal: sine(2000, 6) }], xy: true }))
  assert.match(two.summary, /1:2; a Lissajous figure/)
})

test('square measurements: frequency, duty, rise, Vrms, and mean from the samples', async () => {
  const sq = { type: 'square', f: '2 kHz', vpp: 5, offset: 2.5, duty: 0.25, rise: '5 us' }
  const r = await renderAsync(spec({ timebase: '200 us', channels: [{ vdiv: 1, offset: -2.5, signal: sq }], measure: ['freq', 'duty', 'rise', 'fall', 'Ampl'] }))
  assert.deepEqual(problems(r), [])
  near(read(r.summary, 'CH1', 'Freq'), 2000, 1, 'freq')
  near(read(r.summary, 'CH1', 'Duty'), 25, 0.2, 'duty %')
  near(read(r.summary, 'CH1', 'Rise'), 5e-6, 0.05e-6, 'rise')
  near(read(r.summary, 'CH1', 'Ampl'), 5, 0.01, 'amplitude')
  // 0 to 5 V at 25% duty: mean 1.25 V, rms √(0.25 · 25) = 2.5 V (less a little for the edges).
  near(read(r.summary, 'CH1', 'Mean'), 1.25, 0.02, 'mean')
  near(read(r.summary, 'CH1', 'Vrms'), 2.5, 0.03, 'rms')
})

test('pitfalls: aliasing, probe mismatch, AC coupling, clipping, and an untriggered screen', async () => {
  const s = load('pitfalls.json')
  const at = async (step) => renderAsync(s, { step })
  let r = await at(7)
  assert.match(r.summary, /10 kSa\/s, 1001 samples/)
  near(read(r.summary, 'CH1', 'Freq'), 100, 0.5, 'aliased frequency')
  assert.match(notes(r), /10\.1 kHz sampled at 10 kSa\/s is under 2f, so it aliases: the screen shows \|f − k·fs\| = 100 Hz/)
  r = await at(3)
  assert.match(r.summary, /Vpp 300 mV/)
  assert.match(notes(r), /the menu says 1X but the probe is at 10X, so every reading is 0\.1× the true voltage/)
  r = await at(4)
  assert.match(r.summary, /AC 10X menu, 10X probe: Vpp 3\.00 V, Vmax 1\.50 V, Vmin −1\.50 V/)
  r = await at(5)
  assert.match(r.summary, /Vpp >2\.05 V/)
  r = await at(6)
  assert.match(r.summary, /untriggered \(auto, 4 sweeps\)/)
  assert.match(notes(r), /no rise crossing of 4\.00 V on CH1 \(it spans 0\.00 V to 3\.00 V\)/)
  r = await at(1)
  assert.match(r.summary, /Vmax 4\.0\d V/) // 1.35 × the 3 V edge overshoots
  const normal = await renderAsync(spec({ timebase: '1 ms', channels: [{ signal: sine(1000, 2) }], trigger: { level: 5, mode: 'normal' } }))
  assert.match(normal.summary, /untriggered \(normal, screen empty\)/)
})

test('math CH1−CH2 gives the voltage across the 100 Ω: 4 − 0.558 = 3.44 Vpp', async () => {
  const s = load('lab10.json')
  const r = await renderAsync({ ...s, math: { op: 'CH1-CH2', vdiv: '1 V' } })
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /M CH1−CH2, 1 V\/div: Vpp 3\.44 V/)
})

// A ±2 V square: fundamental 4·2/π = 2.546 V peak = 1.80 V rms = 5.11 dBV; the 3rd is a third (−9.54 dB).
test('FFT of a square: odd harmonics at 5.11, −4.43, −8.87 dBV', async () => {
  const r = await renderAsync(spec({ timebase: '1 ms', channels: [{ signal: { type: 'square', f: '1 kHz', vpp: 4 } }], fft: { source: 'CH1', window: 'flattop' } }))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /FFT of CH1 \(flattop, 16384 points, Δf 100 Hz\), 0 Hz to 20 kHz: peaks 1\.00 kHz 5\.1\d dBV, 3\.00 kHz −4\.4\d dBV, 5\.00 kHz −8\.8\d dBV/)
})

// −174 dBm/Hz + 10 log₁₀(1 MHz) + 24 dB = −90 dBm; at 10 kHz RBW it is 20 dB lower.
test('spectrum: the noise floor follows RBW; peak search and delta markers read the lines', async () => {
  const r = await renderAsync(load('spectrum.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /noise floor −174 dBm\/Hz \+ 10 log₁₀\(RBW\) \+ NF = −90\.0 dBm/)
  assert.match(r.summary, /M1 100\.0 MHz −10\.0 dBm, Δ2 \+100 MHz −28\.0 dB, M3 163\.0 MHz −71\.0 dBm/)
  const narrow = await renderAsync({ ...load('spectrum.json'), rbw: '10 kHz', nf: 10 })
  assert.match(narrow.summary, /= −124 dBm/)
  const close = await renderAsync(spec({ mode: 'spectrum', center: '10 MHz', span: '2 MHz', rbw: '100 kHz', signals: [{ f: '10 MHz', dBm: -20 }, { f: '10.05 MHz', dBm: -20 }] }))
  assert.match(notes(close), /closer than RBW 100 kHz, so they merge into one peak/)
  // FM: J₀(2.405) = 0, so the carrier vanishes; AM at m = 1 puts sidebands at −6 dBc.
  near(besselJ(0, 2.405), 0, 1e-3, 'J0 zero')
  near(besselJ(1, 1), 0.44005, 1e-5, 'J1(1)')
  const am = await renderAsync(spec({ mode: 'spectrum', center: '1 MHz', span: '100 kHz', rbw: '1 kHz', signals: [{ type: 'am', f: '1 MHz', fm: '10 kHz', m: 1, dBm: -10 }] }))
  assert.match(am.summary, /990 kHz −16\.0 dBm, 1 MHz −10\.0 dBm, 1\.01 MHz −16\.0 dBm/)
})

// Without noise or jitter the eye is fully open; with σ = 20 mV the height drops by about 6σ = 120 mV.
test('eye: height (μ₁ − 3σ₁) − (μ₀ + 3σ₀) and width UI − 6σ track the noise and jitter', async () => {
  const base = { mode: 'eye', bitrate: '1 Gb/s', vpp: 1, rise: '100 ps' }
  const clean = await renderAsync(spec(base))
  assert.deepEqual(problems(clean), [])
  near(read(clean.summary.replace(/^scope eye: .*?height \(μ₁ − 3σ₁\) − \(μ₀ \+ 3σ₀\) = /, 'H height '), 'H', 'height'), 1, 0.02, 'clean height')
  const noisy = await renderAsync(spec({ ...base, noise: '20 mV', jitter: '10 ps', mask: { w: 0.5, h: '0.4 V' } }))
  const h = num(/height \(μ₁ − 3σ₁\) − \(μ₀ \+ 3σ₀\) = ([−\d.]+ ?m?V)/.exec(noisy.summary)[1])
  near(h, 1 - 6 * 0.02, 0.03, 'noisy height')
  const w = num(/width UI − 6σ = ([\d.]+ ?ps)/.exec(noisy.summary)[1])
  near(w, 1e-9 - 6 * 10e-12, 12e-12, 'width')
  assert.match(noisy.summary, /mask 0\.5 UI × 400 mV: 0 hits/)
  const shut = await renderAsync(spec({ ...base, noise: '120 mV', mask: { w: 0.5, h: '0.6 V' } }))
  assert.match(shut.summary, /mask 0\.5 UI × 600 mV: [1-9]\d* hits/)
})

test('measure() on a sampled sine and an RC square, against closed forms', () => {
  const dt = 1e-6, v = Float64Array.from({ length: 5001 }, (_, i) => 3 * Math.sin(2 * Math.PI * 1000 * i * dt) + 1)
  const m = measure(v, dt)
  near(m.vpp, 6, 1e-3, 'vpp'); near(m.freq, 1000, 0.01, 'freq'); near(m.mean, 1, 1e-3, 'mean')
  near(m.rms, Math.sqrt(1 + 4.5), 1e-3, 'rms with offset')
  // A ±1 V square through RC, τ = T/4: the lowest point is −tanh(T/4τ) = −tanh(1) = −0.762 V.
  const s = readSignal({ type: 'rc', f: 1000, vpp: 2, tau: 250e-6 }, {}, 'signal')
  near(s.fn(0), -Math.tanh(1), 1e-9, 'v_C at the rising edge')
  near(s.fn(0.5e-3), Math.tanh(1), 1e-9, 'v_C at the falling edge')
})

test('bad input: missing timebase, a wrong unit, unknown measurement and window', async () => {
  let r = await renderAsync(spec({ channels: [{ signal: sine(1000, 2) }] }))
  assert.match(r.text, /error at timebase: give the time per division/)
  r = await renderAsync(spec({ timebase: '1 ms', channels: [{ vdiv: '2 ms', signal: sine(1000, 2) }], measure: ['Vpp', 'slew'] }))
  assert.match(r.text, /warning at channels\[0\]\.vdiv: "2 ms" is in s; this takes V/)
  assert.match(r.text, /warning at measure\[1\]: unknown measurement "slew"/)
  r = await renderAsync(spec({ timebase: '1 ms', channels: [{ signal: sine(1000, 2) }], fft: { window: 'kaiser' } }))
  assert.match(r.text, /error at fft\.window: window is one of rect, hann, hamming, blackman, flattop/)
  r = await renderAsync(spec({ timebase: '1 ms', channels: [{ signal: { type: 'saw', f: 1 } }] }))
  assert.match(r.text, /error at channels\[0\]\.signal\.type/)
  r = await renderAsync(spec({ mode: 'spectrum', signals: [] }))
  assert.match(r.text, /error at center: give center and span/)
})
