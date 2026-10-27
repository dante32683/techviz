// Eye diagram: a PRBS at a bit rate through a first-order channel (its 10-90% rise), with
// random jitter on the edges and noise on the levels, folded two unit intervals at a time.
// Eye height (μ₁ − 3σ₁) − (μ₀ + 3σ₀) at the eye center, width UI − 6σ of the crossings, and
// hits inside an optional hexagon mask.

import { el } from '../../svg.js'
import { color } from '../../theme.js'
import { SpecError } from '../../diag.js'
import { qty, eng, engS, nice125, rng } from './units.js'
import { screen, graticule, readouts, T } from './screen.js'
import { pathD } from '../../svg.js'

const SPU = 64 // simulated samples per unit interval
const TAPS = { 7: [7, 6], 9: [9, 5], 11: [11, 9], 15: [15, 14], 23: [23, 18], 31: [31, 28] }
const LEAD = 8

/** PRBS bits from a Fibonacci LFSR (x^a + x^b + 1), seeded all ones. */
export function prbs(order, n) {
  const [a, b] = TAPS[order]
  const mask = 2 ** a - 1 // 2 ** 31 - 1 still fits the 32-bit bitwise ops
  let s = mask
  const out = []
  for (let i = 0; i < n; i++) {
    const bit = ((s >>> (a - 1)) ^ (s >>> (b - 1))) & 1
    s = ((s << 1) | bit) & mask
    out.push(bit)
  }
  return out
}

export function renderEye(spec, { theme, diag, env }, divs) {
  const [cols, rows] = divs(spec, [10, 8])
  const q = (k, want, d) => (spec[k] === undefined ? d : qty(spec[k], env, k, want, diag))
  if (spec.bitrate === undefined) throw new SpecError('bitrate', 'give the bit rate, like "bitrate": "1 Gb/s"')
  const br = q('bitrate', ['b/s', 'bps', 'Hz'])
  if (!(br > 0)) throw new SpecError('bitrate', 'the bit rate must be above 0')
  const order = spec.prbs ?? 7
  if (!TAPS[order]) throw new SpecError('prbs', `prbs is one of ${Object.keys(TAPS).join(', ')}`)
  const nb = Math.max(20, Math.min(600, spec.bits ?? 200))
  const UI = 1 / br
  const vpp = q('vpp', ['V'], 1), off = q('offset', ['V'], 0)
  const rise = q('rise', ['s'], 0.3 * UI), jit = q('jitter', ['s'], 0), noise = q('noise', ['V'], 0)
  if (rise > 2 * UI) diag.note('rise', `the ${eng(rise, 's')} rise is over 2 UI (${eng(UI, 's')}): the eye closes from intersymbol interference`)
  const bits = prbs(order, LEAD + nb + 3)
  const g = rng(spec.seed ?? 5)
  const dt = UI / SPU, n = bits.length * SPU
  // NRZ with jittered edges; each edge spreads over one sample so sub-sample jitter still shows.
  const edges = bits.map((_, k) => k * UI + (jit ? jit * g.gauss() : 0))
  const lev = (b) => off + (b ? vpp / 2 : -vpp / 2)
  const x = new Float64Array(n)
  let k = 0
  for (let i = 0; i < n; i++) {
    const t = i * dt
    while (k + 1 < bits.length && t >= edges[k + 1] + dt / 2) k++
    const nx = Math.min(bits.length - 1, k + 1), a = (t - edges[nx]) / dt + 0.5
    x[i] = a > 0 && a < 1 ? lev(bits[k]) + (lev(bits[nx]) - lev(bits[k])) * a : lev(bits[k])
  }
  // First-order channel: 10-90% rise = 2.2 τ.
  const y = new Float64Array(n)
  const al = rise > 0 ? 1 - Math.exp(-dt / (rise / 2.2)) : 1
  let s = x[0]
  for (let i = 0; i < n; i++) { s += al * (x[i] - s); y[i] = s }
  if (noise) {
    // Noise band-limited to about SPU/8 per UI, scaled back to the rms asked for.
    const w = 8, raw = Array.from({ length: n + w }, () => g.gauss())
    let acc = 0
    for (let i = 0; i < w; i++) acc += raw[i]
    for (let i = 0; i < n; i++) { y[i] += (noise * acc) / Math.sqrt(w); acc += raw[i + w] - raw[i] }
  }

  // Crossings of the middle level, folded into one UI: their mean is the crossing phase.
  const mid = off
  const cr = []
  for (let i = LEAD * SPU + 1; i < (LEAD + nb) * SPU; i++) if ((y[i - 1] - mid) * (y[i] - mid) < 0) cr.push((i - 1 + (mid - y[i - 1]) / (y[i] - y[i - 1])) * dt)
  let ang = 0, cs = 0, sn = 0
  for (const t of cr) { cs += Math.cos((2 * Math.PI * t) / UI); sn += Math.sin((2 * Math.PI * t) / UI) }
  ang = Math.atan2(sn, cs)
  const c = ((((ang / (2 * Math.PI)) * UI) % UI) + UI) % UI
  const dev = cr.map((t) => { let d = ((t - c) % UI + UI) % UI; if (d > UI / 2) d -= UI; return d })
  const sigC = Math.sqrt(dev.reduce((p, d) => p + d * d, 0) / Math.max(1, dev.length))
  const width = Math.max(0, UI - 6 * sigC)

  // Levels at the eye center (half a UI after the crossing), split by the decision threshold.
  const ones = [], zeros = []
  for (let b = LEAD; b < LEAD + nb; b++) {
    const t = b * UI + c + UI / 2, i = Math.round(t / dt)
    if (i < n) (y[i] > mid ? ones : zeros).push(y[i])
  }
  const stat = (a) => { const m = a.reduce((p, v) => p + v, 0) / a.length; return [m, Math.sqrt(a.reduce((p, v) => p + (v - m) ** 2, 0) / a.length)] }
  if (!ones.length || !zeros.length) throw new SpecError('bits', 'the eye has no ones or no zeros at its center; check vpp and offset')
  const [m1, s1] = stat(ones), [m0, s0] = stat(zeros)
  const height = m1 - 3 * s1 - (m0 + 3 * s0)

  // Screen: two UI across, the eye centered, crossings at a quarter and three quarters.
  const vdiv = spec.vdiv === undefined ? nice125(vpp / 5) : q('vdiv', ['V'])
  const SW = 280, ML = 18, MT = 16
  const S = screen(ML, MT, cols, rows, SW / cols)
  const tx = (t) => S.x + (t / (2 * UI)) * S.w, vy = (v) => S.Y((v - off) / vdiv)
  const parts = [graticule(S, theme)]
  const traces = []
  for (let b = LEAD; b < LEAD + nb; b++) {
    const ts = b * UI + c - UI / 2, i0 = Math.floor(ts / dt)
    const pts = []
    for (let i = i0; i <= i0 + 2 * SPU + 1 && i < n; i += 2) pts.push([tx(i * dt - ts), vy(y[i])])
    traces.push(pts)
  }
  const ec = color('teal')
  const clip = (pts) => pts.filter(([px]) => px >= S.x && px <= S.x + S.w).map(([px, py]) => [px, Math.max(S.y, Math.min(S.y + S.h, py))])
  // Persistence: every trace faint, so the busy paths build up brighter.
  for (const pts of traces) parts.push(el('path', { d: pathD(clip(pts)), fill: 'none', stroke: ec, 'stroke-width': 1, 'stroke-opacity': 0.22 }))

  // Mask: a hexagon at the eye center, w UI wide, h tall, its flat top half as wide.
  let hits = null, maskTxt = ''
  if (spec.mask) {
    const mw = qty(spec.mask.w ?? 0.5, env, 'mask.w', ['UI'], diag), mh = qty(spec.mask.h ?? vpp * 0.4, env, 'mask.h', ['V'], diag)
    const hex = [[-mw / 2, 0], [-mw / 4, mh / 2], [mw / 4, mh / 2], [mw / 2, 0], [mw / 4, -mh / 2], [-mw / 4, -mh / 2]]
    const inside = (u, v) => Math.abs(v) <= (mh / 2) * Math.min(1, (mw / 2 - Math.abs(u)) / (mw / 4)) && Math.abs(u) <= mw / 2
    hits = 0
    for (let b = LEAD; b < LEAD + nb; b++) {
      const tc = b * UI + c + UI / 2
      for (let i = Math.ceil((tc - (mw / 2) * UI) / dt); i <= (tc + (mw / 2) * UI) / dt && i < n; i++) if (inside((i * dt - tc) / UI, y[i] - mid)) hits++
    }
    const mc = hits ? theme.highlight : color('gray')
    parts.push(el('path', { d: pathD(hex.map(([u, v]) => [tx(UI + u * UI), vy(off + v)]), true), fill: mc, 'fill-opacity': 0.22, stroke: mc, 'stroke-width': 1.2 }))
    maskTxt = `mask ${+mw.toFixed(3)} UI × ${engS(mh, 'V')}: ${hits} hits`
    if (hits) diag.note('mask', `${hits} samples fall inside the mask: the eye fails it`)
  }
  const rowsOut = [
    [[T(`${engS(vdiv, 'V')}/div`), theme.fg], [T(`${engS((2 * UI) / cols, 's')}/div`), theme.fg], [T(`${engS(br, 'b/s')} PRBS${order}`), ec]],
    [[T(`Height ${eng(height, 'V')}`), theme.fg], [T(`Width ${(width / UI).toFixed(2)} UI`), theme.fg], ...(hits === null ? [] : [[T(`Mask ${hits} hits`), hits ? theme.highlight : theme.fg]])],
  ]
  const ro = readouts(rowsOut, S.x, S.y + S.h + 2, SW, theme)
  parts.push(ro.svg)
  const summary = `scope eye: ${engS(br, 'b/s')} PRBS${order}, ${nb} bits overlaid, UI ${eng(UI, 's')}; ${engS(vpp, 'V')} swing, rise ${eng(rise, 's')}, jitter ${eng(jit, 's')} rms, noise ${eng(noise, 'V')} rms; ` +
    `ones ${eng(m1, 'V')} σ ${eng(s1, 'V')}, zeros ${eng(m0, 'V')} σ ${eng(s0, 'V')}: eye amplitude ${eng(m1 - m0, 'V')}, height (μ₁ − 3σ₁) − (μ₀ + 3σ₀) = ${eng(height, 'V')}; ` +
    `crossings σ ${eng(sigC, 's')}: width UI − 6σ = ${eng(width, 's')} (${(width / UI).toFixed(2)} UI)` + (maskTxt ? `; ${maskTxt}` : '')
  return { body: parts.join(''), width: ML + SW + 16, height: S.y + S.h + ro.height + 12, summary, alt: 'eye diagram' }
}
