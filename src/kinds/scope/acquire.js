// The oscilloscope's signal path, channel by channel: the probe (its switch against the menu
// setting, its compensation), the analog bandwidth, the coupling, then the ADC (sample rate,
// noise, 8 bits at 25 levels per division, clipping beyond the screen), and the trigger.

import { SpecError } from '../../diag.js'
import { color } from '../../theme.js'
import { readSignal } from './signal.js'
import { qty, rng } from './units.js'

export const NMAX = 40000 // samples simulated per sweep; a faster scope is simulated at this many
const CH_COLORS = ['amber', 'pink', 'teal', 'green'] // Siglent: yellow, magenta, cyan, green
const COMP = { over: 1.35, under: 0.7, ok: 1 }
const ADC_SPAN = 0.64 // the ADC holds ±0.64 × rows divisions (±5.12 of 8), a little past the screen

export function readChannels(spec, env, diag, bandwidth) {
  if (!Array.isArray(spec.channels) || !spec.channels.length) {
    throw new SpecError('channels', 'channels is a list like [{"id": "CH1", "vdiv": "2 V", "signal": {"type": "sine", "f": "1 kHz", "vpp": 4}}]')
  }
  const ids = new Set()
  return spec.channels.map((c, i) => {
    const path = `channels[${i}]`
    if (!c || typeof c !== 'object') throw new SpecError(path, 'a channel is an object with id, vdiv, and signal')
    const id = c.id ?? `CH${i + 1}`
    if (ids.has(id)) throw new SpecError(`${path}.id`, `two channels are named ${id}`)
    ids.add(id)
    const q = (k, want, dflt) => (c[k] === undefined ? dflt : qty(c[k], env, `${path}.${k}`, want, diag))
    const vdiv = q('vdiv', ['V'], 1)
    if (!(vdiv > 0)) throw new SpecError(`${path}.vdiv`, 'vdiv (volts per division) must be above 0')
    const coupling = String(c.coupling ?? 'DC').toUpperCase()
    if (!['DC', 'AC', 'GND'].includes(coupling)) throw new SpecError(`${path}.coupling`, 'coupling is DC, AC, or GND')
    const probe = q('probe', [], 1), tip = q('tip', [], probe)
    let comp = c.comp === undefined ? 1 : typeof c.comp === 'string' && COMP[c.comp] ? COMP[c.comp] : q('comp', [])
    if (!(comp > 0)) throw new SpecError(`${path}.comp`, 'comp is "over", "under", or a gain at the edges like 1.3')
    const bwl = !!c.bwl
    const bw = Math.min(bandwidth, bwl ? 20e6 : Infinity)
    return {
      id, i, path, label: c.label, color: c.color ? color(c.color) : color(CH_COLORS[i % 4]),
      vdiv, offset: q('offset', ['V'], 0), coupling, probe, tip, gain: probe / tip, comp, bwl, bw,
      sig: readSignal(c.signal, env, `${path}.signal`, diag), seed: i + 1,
    }
  })
}

/**
 * The analog trace in displayed volts (probe gain applied, before the ADC) at n points from t0
 * spaced dt. The compensation and bandwidth filters run over a lead-in first so they start settled.
 */
export function analog(ch, t0, dt, n, tdiv) {
  const out = new Float64Array(n)
  if (ch.coupling === 'GND') return out
  const tauC = ch.comp !== 1 ? 0.6 * tdiv : 0
  const tauB = 1 / (2 * Math.PI * ch.bw)
  const np = Math.min(NMAX, Math.ceil((6 * tauC + 10 * tauB) / dt))
  const aH = tauC ? tauC / (tauC + dt) : 0, aL = 1 - Math.exp(-dt / tauB)
  let lp = 0, hp = 0, xp = 0
  for (let i = -np; i < n; i++) {
    const x = ch.sig.fn(t0 + i * dt) * ch.gain
    if (i === -np) { lp = x; xp = x }
    let y = x
    // A mis-set compensation trimmer scales the fast part of each edge: x + (k − 1) · high-pass(x).
    if (tauC) { hp = aH * (hp + x - xp); xp = x; y = x + (ch.comp - 1) * hp }
    lp += aL * (y - lp)
    if (i >= 0) out[i] = lp
  }
  if (ch.coupling === 'AC') {
    let m = ch.sig.mean === null ? null : ch.sig.mean * ch.gain
    if (m === null) { m = 0; for (const x of out) m += x; m /= n }
    for (let i = 0; i < n; i++) out[i] -= m
  }
  return out
}

/**
 * The ADC: adds noise and clips at ±0.64 × rows divisions. Volts back. (The 8-bit steps, 1/25
 * division, are left out: under a pixel on screen, and they only blur the measurements.)
 */
export function digitize(ch, y, rows, seed) {
  const L = rows * ADC_SPAN, n = y.length
  const v = new Float64Array(n)
  const g = rng(seed + 1000 * (ch.sig.noise[0]?.seed ?? 0))
  const noise = ch.coupling === 'GND' ? 0 : Math.hypot(...ch.sig.noise.map((z) => z.rms)) * ch.gain
  for (let i = 0; i < n; i++) {
    let d = (y[i] + (noise ? noise * g.gauss() : 0) + ch.offset) / ch.vdiv
    d = Math.max(-L, Math.min(L, d))
    v[i] = d * ch.vdiv - ch.offset
  }
  return { v, lim: [-L * ch.vdiv - ch.offset, L * ch.vdiv - ch.offset] }
}

/**
 * The first crossing of `level` on the source at or after time `from`, searched over `span`.
 * Returns the time, or null. `level` null means 50% of the source's range.
 */
export function findTrigger(ch, { level, slope }, from, span, tdiv, fine) {
  const ns = Math.min(NMAX, Math.max(4000, Math.ceil(span / fine)))
  const dt = span / ns
  const y = analog(ch, from, dt, ns + 1, tdiv)
  let lo = Infinity, hi = -Infinity
  for (const x of y) { if (x < lo) lo = x; if (x > hi) hi = x }
  const lev = level ?? (lo + hi) / 2
  const hit = (a, b) => (slope !== 'fall' && a < lev && b >= lev) || (slope !== 'rise' && a > lev && b <= lev)
  for (let i = 1; i < y.length; i++) {
    if (!hit(y[i - 1], y[i])) continue
    let t = from + (i - 1 + (lev - y[i - 1]) / (y[i] - y[i - 1])) * dt
    if (dt > fine * 2) {
      // Refine on a fine grid around the coarse crossing.
      const m = 2000, d2 = (4 * dt) / m, y2 = analog(ch, t - 2 * dt, d2, m + 1, tdiv)
      for (let k = 1; k < y2.length; k++) if (hit(y2[k - 1], y2[k])) { t = t - 2 * dt + (k - 1 + (lev - y2[k - 1]) / (y2[k] - y2[k - 1])) * d2; break }
    }
    return { t, level: lev, range: [lo, hi] }
  }
  return { t: null, level: lev, range: [lo, hi] }
}
