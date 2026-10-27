// Spectrum screens: a swept analyzer computed from lines (tones, harmonics, AM and FM
// sidebands) seen through a Gaussian RBW filter over the noise floor −174 dBm/Hz +
// 10 log₁₀(RBW) + NF, with markers and peak search; and the scope's FFT of a channel record.

import { el, pathD } from '../../svg.js'
import { labelSvg } from '../../label.js'
import { color } from '../../theme.js'
import { SpecError } from '../../diag.js'
import { qty, eng, engS, nice125, rng } from './units.js'
import { screen, graticule, tracePath, readouts, T, RS } from './screen.js'

const SW = 280, POINTS = 1001

/** Bessel J_n(x) from its integral (1/π)∫₀^π cos(nτ − x sin τ) dτ; the trapezoid rule is exact-ish here. */
export function besselJ(n, x) {
  const K = 256
  let s = 0
  for (let k = 0; k <= K; k++) { const t = (Math.PI * k) / K; s += (k === 0 || k === K ? 0.5 : 1) * Math.cos(n * t - x * Math.sin(t)) }
  return s / K
}

/** Spectral lines [{f, dBm, label}] from the spec's signals. */
function lines(spec, env, diag) {
  const out = []
  for (const [i, s] of (spec.signals ?? []).entries()) {
    const path = `signals[${i}]`
    if (!s || typeof s !== 'object') throw new SpecError(path, 'a signal is {"f": "100 MHz", "dBm": -10} or a typed one like {"type": "harmonics", ...}')
    const q = (k, want, d) => (s[k] === undefined ? d : qty(s[k], env, `${path}.${k}`, want, diag))
    if (s.f === undefined) throw new SpecError(`${path}.f`, 'every signal needs its frequency f')
    const f = q('f', ['Hz']), P = q('dBm', ['dBm'], 0)
    const type = s.type ?? 'tone'
    if (type === 'tone') out.push({ f, dBm: P, label: s.label, i })
    else if (type === 'harmonics') {
      const levels = s.levels ? s.levels.map((v, k) => qty(v, env, `${path}.levels[${k}]`, ['dBm'], diag)) : null
      const n = levels ? levels.length : q('n', [], 5), drop = q('drop', ['dB'], 10)
      for (let k = 1; k <= n; k++) out.push({ f: k * f, dBm: levels ? levels[k - 1] : P - drop * (k - 1), label: k === 1 ? s.label : undefined, i, h: k })
    } else if (type === 'am') {
      const fm = q('fm', ['Hz']), m = q('m', ['%'], 0.5)
      const sb = P + 20 * Math.log10(m / 2)
      out.push({ f, dBm: P, label: s.label, i }, { f: f - fm, dBm: sb, i }, { f: f + fm, dBm: sb, i })
    } else if (type === 'fm') {
      const fm = q('fm', ['Hz']), beta = q('beta', [], 1)
      const K = Math.ceil(beta + 4)
      for (let k = -K; k <= K; k++) {
        const j = Math.abs(besselJ(k, beta))
        if (j > 1e-5) out.push({ f: f + k * fm, dBm: P + 20 * Math.log10(j), label: k === 0 ? s.label : undefined, i })
      }
    } else throw new SpecError(`${path}.type`, 'type is tone (default), harmonics, am, or fm')
  }
  return out
}

/** Peaks of a trace: local maxima at least `prom` dB above the valleys on both sides and above `floor`. */
export function peaks(y, floor, prom = 6) {
  const out = []
  for (let i = 1; i < y.length - 1; i++) {
    if (!(y[i] >= y[i - 1] && y[i] > y[i + 1]) || y[i] < floor) continue
    let l = y[i], r = y[i]
    for (let k = i - 1; k >= 0 && y[k] <= y[i]; k--) l = Math.min(l, y[k])
    for (let k = i + 1; k < y.length && y[k] <= y[i]; k++) r = Math.min(r, y[k])
    if (y[i] - Math.max(l, r) >= prom) out.push(i)
  }
  return out.sort((a, b) => y[b] - y[a])
}

/** Frequency span from center + span or start + stop. */
function range(o, env, diag, path, dflt) {
  const q = (k) => qty(o[k], env, `${path}${k}`, ['Hz'], diag)
  if (o.start !== undefined || o.stop !== undefined) {
    if (o.start === undefined || o.stop === undefined) throw new SpecError(`${path}start`, 'give both start and stop, or center and span')
    return [q('start'), q('stop')]
  }
  if (o.center !== undefined || o.span !== undefined) {
    if (o.span === undefined) throw new SpecError(`${path}span`, 'give span with center (or start and stop)')
    const c = o.center === undefined ? (dflt ? (dflt[0] + dflt[1]) / 2 : 0) : q('center'), s = q('span')
    return [c - s / 2, c + s / 2]
  }
  if (dflt) return dflt
  throw new SpecError(`${path}center`, 'give center and span (or start and stop), like "center": "100 MHz", "span": "50 MHz"')
}

/** The analyzer screen: trace, axes values, settings, and markers. */
function drawScreen(S, theme, { f0, f1, ref, dbdiv, trace, unit, markers, stroke = color('amber') }) {
  const parts = [graticule(S, theme, { center: false })]
  const fx = (f) => S.x + ((f - f0) / (f1 - f0)) * S.w
  const ly = (L) => S.y + ((ref - L) / dbdiv) * S.dy
  const pts = trace.map((L, i) => [S.x + (i / (trace.length - 1)) * S.w, ly(L)])
  parts.push(el('path', { d: tracePath(S, pts), fill: 'none', stroke, 'stroke-width': 1.3, 'stroke-linejoin': 'round' }))
  // Level labels every other line on the left; frequencies under the grid.
  for (let j = 0; j <= S.rows; j += S.rows > 6 ? 2 : 1) parts.push(labelSvg(T(engS(ref - j * dbdiv, '')), S.x - 4, S.y + j * S.dy, theme, { anchor: 'end', size: 9.5, fill: theme.muted, middle: true }))
  const fy = S.y + S.h + 12
  parts.push(labelSvg(T(engS(f0, 'Hz')), S.x, fy, theme, { anchor: 'start', size: 9.5, fill: theme.muted }))
  parts.push(labelSvg(T(engS((f0 + f1) / 2, 'Hz')), S.x + S.w / 2, fy, theme, { size: 9.5, fill: theme.muted }))
  parts.push(labelSvg(T(engS(f1, 'Hz')), S.x + S.w, fy, theme, { anchor: 'end', size: 9.5, fill: theme.muted }))
  parts.push(labelSvg(T(unit), S.x - 4, S.y - 6, theme, { anchor: 'end', size: 9.5, fill: theme.muted }))
  const mc = color('green')
  for (const m of markers) {
    const x = fx(m.f), yy = Math.max(S.y, Math.min(S.y + S.h, ly(m.L)))
    if (x < S.x - 0.5 || x > S.x + S.w + 0.5) continue
    parts.push(el('path', { d: `M${x} ${yy - 2}L${x - 4} ${yy - 8}L${x + 4} ${yy - 8}Z`, fill: mc }))
    parts.push(labelSvg(T(m.name), x, yy - 11, theme, { size: 9.5, fill: mc }))
  }
  return parts.join('')
}

export function renderSpectrum(spec, { theme, diag, env }, divs) {
  const [cols, rows] = divs(spec, [10, 10])
  const [f0, f1] = range(spec, env, diag, '')
  if (!(f1 > f0) || f0 < 0) throw new SpecError('span', 'the span must be above 0 and start at 0 Hz or above')
  const span = f1 - f0
  const ref = qty(spec.ref ?? 0, env, 'ref', ['dBm'], diag), dbdiv = qty(spec.dbdiv ?? 10, env, 'dbdiv', ['dB'], diag)
  const auto = (() => { const x = span / 100, e = Math.floor(Math.log10(x)), m = x / 10 ** e; return (m >= 3 ? 3 : 1) * 10 ** e })()
  const rbw = spec.rbw === undefined ? auto : qty(spec.rbw, env, 'rbw', ['Hz'], diag)
  const vbw = spec.vbw === undefined ? rbw : qty(spec.vbw, env, 'vbw', ['Hz'], diag)
  const nf = qty(spec.nf ?? 24, env, 'nf', ['dB'], diag)
  if (!(rbw > 0 && vbw > 0)) throw new SpecError('rbw', 'rbw and vbw must be above 0')
  const danl = -174 + 10 * Math.log10(rbw) + nf
  const L = lines(spec, env, diag)

  // The trace: noise (log-detected, about 5.6 dB rms, correlated over one RBW and smoothed by
  // a narrower VBW) plus each line through the RBW filter, peak-detected per display point.
  const d = span / (POINTS - 1)
  const g = rng(spec.seed ?? 3)
  const raw = Array.from({ length: POINTS }, () => g.gauss())
  const w = Math.max(1, Math.round(rbw / d))
  const smooth = raw.map((_, i) => { let s = 0, c = 0; for (let k = Math.max(0, i - (w >> 1)); k <= Math.min(POINTS - 1, i + (w >> 1)); k++) { s += raw[k]; c++ } return s / Math.sqrt(c) })
  const sigma = 5.6 * Math.sqrt(Math.min(1, vbw / rbw))
  const trace = smooth.map((n, i) => {
    const f = f0 + i * d
    let p = 10 ** ((danl + sigma * n) / 10)
    for (const l of L) {
      const off = Math.max(0, Math.abs(l.f - f) - d / 2) / (rbw / 2)
      if (off < 6) p += 10 ** (l.dBm / 10) * 10 ** (-0.3 * off * off)
    }
    return 10 * Math.log10(p)
  })

  // Markers.
  const pk = peaks(trace, danl + 10)
  const markers = []
  for (const [i, m] of (spec.markers ?? []).entries()) {
    const path = `markers[${i}]`
    let k
    if (m.peak !== undefined) {
      k = pk[(m.peak === true ? 1 : m.peak) - 1]
      if (k === undefined) { diag.warn(`${path}.peak`, `there are only ${pk.length} peaks above the noise`); continue }
    } else if (m.f !== undefined) {
      const f = qty(m.f, env, `${path}.f`, ['Hz'], diag)
      k = Math.round((f - f0) / d)
      if (k < 0 || k >= POINTS) { diag.warn(`${path}.f`, `${engS(f, 'Hz')} is outside the span`); continue }
    } else throw new SpecError(path, 'a marker is {"peak": 1} (1 = highest), {"f": "100 MHz"}, either with "delta": 1')
    const mk = { n: i + 1, f: f0 + k * d, L: trace[k], name: String(i + 1) }
    if (m.delta !== undefined) {
      const r = markers.find((x) => x.n === m.delta)
      if (!r) throw new SpecError(`${path}.delta`, `delta names an earlier marker's number (1 for the first)`)
      mk.delta = r
    }
    markers.push(mk)
  }

  // Notes: lines that can't show as drawn.
  for (const l of L) {
    const where = `signals[${l.i}]`
    if (l.f < f0 || l.f > f1) continue
    if (l.dBm > ref) diag.note(where, `the ${eng(l.dBm, 'dBm')} line at ${engS(l.f, 'Hz')} is above the reference level ${eng(ref, 'dBm')}; raise ref`)
    else if (l.dBm < danl) diag.note(where, `the ${eng(l.dBm, 'dBm')} line at ${engS(l.f, 'Hz')} is under the ${eng(danl, 'dBm')} noise floor; a narrower RBW lowers the floor 10 dB per decade`)
  }
  const vis = L.filter((l) => l.f >= f0 && l.f <= f1).sort((a, b) => a.f - b.f)
  for (let k = 1; k < vis.length; k++) if (vis[k].f - vis[k - 1].f < rbw) diag.note(`signals[${vis[k].i}]`, `lines at ${engS(vis[k - 1].f, 'Hz')} and ${engS(vis[k].f, 'Hz')} are closer than RBW ${engS(rbw, 'Hz')}, so they merge into one peak; lower rbw to resolve them`)

  const ML = 34, MT = 18, dx = SW / cols, dy = dx * 0.72
  const S = screen(ML, MT, cols, rows, dx, dy)
  const parts = [drawScreen(S, theme, { f0, f1, ref, dbdiv, trace, unit: 'dBm', markers })]
  const rowsOut = [[[T(`Ref ${engS(ref, 'dBm')}`), theme.fg], [T(`${engS(dbdiv, 'dB')}/div`), theme.fg], [T(`RBW ${engS(rbw, 'Hz')}`), theme.fg], [T(`VBW ${engS(vbw, 'Hz')}`), theme.fg]]]
  const mc = color('green')
  const mtxt = (m) => (m.delta ? `Δ${m.name} ${m.f >= m.delta.f ? '+' : ''}${eng(m.f - m.delta.f, 'Hz')} ${eng(m.L - m.delta.L, 'dB')}` : `M${m.name} ${eng(m.f, 'Hz', 4)} ${eng(m.L, 'dBm')}`)
  for (const m of markers) rowsOut.push([[T(mtxt(m)), mc]])
  const ro = readouts(rowsOut, S.x, S.y + S.h + 14, SW, theme)
  parts.push(ro.svg)
  const summary = `scope spectrum: ${engS(f0, 'Hz')} to ${engS(f1, 'Hz')} (center ${engS((f0 + f1) / 2, 'Hz')}, span ${engS(span, 'Hz')}), ref ${engS(ref, 'dBm')}, ${engS(dbdiv, 'dB')}/div; ` +
    `RBW ${engS(rbw, 'Hz')}${spec.rbw === undefined ? ' (auto)' : ''}, VBW ${engS(vbw, 'Hz')}, NF ${engS(nf, 'dB')}: noise floor −174 dBm/Hz + 10 log₁₀(RBW) + NF = ${eng(danl, 'dBm')}; ` +
    `${vis.length} lines in span${vis.length ? ': ' + vis.slice(0, 12).map((l) => `${engS(l.f, 'Hz')} ${eng(l.dBm, 'dBm')}${l.label ? ` (${l.label})` : ''}`).join(', ') + (vis.length > 12 ? ', …' : '') : ''}; ` +
    `peaks: ${pk.slice(0, 5).map((k) => `${eng(f0 + k * d, 'Hz', 4)} ${eng(trace[k], 'dBm')}`).join(', ') || 'none'}` +
    (markers.length ? '; ' + markers.map(mtxt).join(', ') : '')
  return { body: parts.join(''), width: ML + SW + 16, height: S.y + S.h + 14 + ro.height + 12, summary, alt: 'spectrum analyzer screen' }
}

const WINDOWS = {
  rect: () => 1,
  hann: (x) => 0.5 - 0.5 * Math.cos(2 * Math.PI * x),
  hamming: (x) => 0.54 - 0.46 * Math.cos(2 * Math.PI * x),
  blackman: (x) => 0.42 - 0.5 * Math.cos(2 * Math.PI * x) + 0.08 * Math.cos(4 * Math.PI * x),
  flattop: (x) => 0.21557895 - 0.41663158 * Math.cos(2 * Math.PI * x) + 0.277263158 * Math.cos(4 * Math.PI * x) - 0.083578947 * Math.cos(6 * Math.PI * x) + 0.006947368 * Math.cos(8 * Math.PI * x),
}

/** In-place radix-2 FFT. */
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], j = i + k + len / 2
        const vr = re[j] * cr - im[j] * ci, vi = re[j] * ci + im[j] * cr
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[j] = ur - vr; im[j] = ui - vi
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
      }
    }
  }
}

/** The magnitude spectrum of a record in dBV rms, windowed. Returns { f, dB, df, n }. */
export function spectrumOf(v, dt, window = 'hann') {
  const N = v.length
  let n, data, ds
  if (N <= 16384) { n = 2 ** Math.floor(Math.log2(N)); data = Float64Array.from(v.subarray(0, n)); ds = dt }
  else {
    n = 16384; ds = ((N - 1) * dt) / n
    data = Float64Array.from({ length: n }, (_, k) => { const x = (k * ds) / dt, i = Math.floor(x); return i + 1 < N ? v[i] + (v[i + 1] - v[i]) * (x - i) : v[N - 1] })
  }
  const wf = WINDOWS[window]
  let cg = 0
  for (let k = 0; k < n; k++) { const w = wf(k / n); data[k] *= w; cg += w }
  const im = new Float64Array(n)
  fft(data, im)
  const half = n / 2, f = new Float64Array(half), dB = new Float64Array(half)
  for (let k = 0; k < half; k++) {
    const mag = Math.hypot(data[k], im[k]) / cg
    const rms = k ? (mag * 2) / Math.SQRT2 : mag
    f[k] = k / (n * ds)
    dB[k] = 20 * Math.log10(Math.max(rms, 1e-9))
  }
  return { f, dB, df: 1 / (n * ds), n }
}

/** The FFT pane under a time screen. */
export function fftPane(o, t, dt, x, y, SW, cols, theme, diag, env) {
  let window = String(o.window ?? 'hann').toLowerCase()
  if (window === 'hanning') window = 'hann'
  if (window === 'rectangular' || window === 'none') window = 'rect'
  if (!WINDOWS[window]) throw new SpecError('fft.window', `window is one of ${Object.keys(WINDOWS).join(', ')}`)
  const sp = spectrumOf(t.sweeps[0], dt, window)
  const f0guess = t.m?.freq ?? sp.f[1] * 10
  const dflt = [0, cols * nice125((10.5 * f0guess) / cols)]
  const [fa, fb] = range(o, env, diag, 'fft.', dflt)
  const inSpan = []
  for (let k = 0; k < sp.f.length; k++) if (sp.f[k] >= fa && sp.f[k] <= fb) inSpan.push(k)
  if (inSpan.length < 2) throw new SpecError('fft', `the FFT bins are ${eng(sp.df, 'Hz')} apart, too coarse for this span; widen the span or slow the timebase`)
  const ys = inSpan.map((k) => sp.dB[k])
  const top = Math.max(...ys.slice(sp.f[inSpan[0]] === 0 ? 1 : 0))
  const ref = o.ref === undefined ? Math.ceil((top + 5) / 10) * 10 : qty(o.ref, env, 'fft.ref', ['dBV', 'dB'], diag)
  const dbdiv = qty(o.dbdiv ?? 10, env, 'fft.dbdiv', ['dB'], diag)
  const rows = 8, dx = SW / cols
  const S = screen(x, y + 10, cols, rows, dx, dx * 0.5)
  const pk = peaks(ys, ref - rows * dbdiv, 10).filter((i) => sp.f[inSpan[i]] > 0)
  const markers = pk.length ? [{ f: sp.f[inSpan[pk[0]]], L: ys[pk[0]], name: 'P' }] : []
  const parts = [drawScreen(S, theme, { f0: fa, f1: fb, ref, dbdiv, trace: ys, unit: 'dBV', markers, stroke: t.color })]
  const items = [[T(`FFT ${t.id} ${window}`), t.color], [T(`${engS(dbdiv, 'dB')}/div`), theme.fg], [T(`Δf ${eng(sp.df, 'Hz')}`), theme.muted]]
  if (markers.length) items.push([T(`P ${eng(markers[0].f, 'Hz')} ${eng(markers[0].L, 'dBV')}`), color('green')])
  const ro = readouts([items], S.x, S.y + S.h + 14, SW, theme)
  parts.push(ro.svg)
  const summary = `FFT of ${t.id} (${window}, ${sp.n} points, Δf ${eng(sp.df, 'Hz')}), ${engS(fa, 'Hz')} to ${engS(fb, 'Hz')}: peaks ` +
    (pk.slice(0, 5).map((i) => `${eng(sp.f[inSpan[i]], 'Hz')} ${eng(ys[i], 'dBV')}`).join(', ') || 'none')
  return { svg: parts.join(''), height: S.y + S.h + 14 + ro.height - y + 4, summary }
}
