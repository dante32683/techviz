// Oscilloscope (time mode): acquires every channel over one sweep from the trigger, draws the
// traces on the graticule with the 0 V tags and trigger marks, and reads out settings,
// automatic measurements, cursors, math, XY, and an FFT pane.

import { el, pathD } from '../../svg.js'
import { color } from '../../theme.js'
import { SpecError } from '../../diag.js'
import { NMAX, readChannels, analog, digitize, findTrigger } from './acquire.js'
import { measure, phaseOf } from './measure.js'
import { qty, eng, engS, rng } from './units.js'
import { screen, graticule, tracePath, zeroTag, edgeMark, readouts, T, RS } from './screen.js'
import { fftPane } from './spectrum.js'

const NAMES = {
  vpp: 'Vpp', vmax: 'Vmax', vmin: 'Vmin', ampl: 'Ampl', amplitude: 'Ampl', vrms: 'Vrms', rms: 'Vrms', mean: 'Mean',
  freq: 'Freq', frequency: 'Freq', f: 'Freq', period: 'Period', rise: 'Rise', fall: 'Fall', duty: 'Duty', phase: 'Phase', delay: 'Delay',
}
const SW = 280 // screen width, px

export function divs(spec, dflt) {
  if (spec.divs === undefined) return dflt
  const d = spec.divs
  if (!Array.isArray(d) || d.length !== 2 || !d.every((x) => Number.isInteger(x) && x >= 2 && x <= 20)) throw new SpecError('divs', 'divs is [cols, rows] of whole divisions, like [14, 8]')
  return d
}

/** A measurement's readout value; clipped peaks read as bounds, like a scope's ">". */
function show(name, m, ph) {
  // Round-off far below the reading's scale shows as 0, not 3 pV.
  const z = (x) => (Math.abs(x) < Math.max(Math.abs(m.vpp), Math.abs(m.vmax), 1e-9) * 1e-4 ? 0 : x)
  const v = (x, u) => eng(u === 'V' ? z(x) : x, u)
  switch (name) {
    case 'Vpp': return (m.clipped ? '>' : '') + v(m.vpp, 'V')
    case 'Vmax': return (m.clipHi ? '>' : '') + v(m.vmax, 'V')
    case 'Vmin': return (m.clipLo ? '<' : '') + v(m.vmin, 'V')
    case 'Ampl': return v(m.ampl, 'V')
    case 'Vrms': return v(m.rms, 'V')
    case 'Mean': return v(m.mean, 'V')
    case 'Freq': return v(m.freq, 'Hz')
    case 'Period': return v(m.period, 's')
    case 'Rise': return (m.riseLimited ? '<' : '') + v(m.riseLimited ? 1.5 * m.dt : m.rise, 's')
    case 'Fall': return (m.fallLimited ? '<' : '') + v(m.fallLimited ? 1.5 * m.dt : m.fall, 's')
    case 'Duty': return m.duty === undefined ? '—' : eng(m.duty * 100, '%')
    case 'Phase': return ph ? eng(Math.abs(ph.phase) < 0.005 ? 0 : ph.phase, '°') : '—'
    case 'Delay': return ph ? eng(Math.abs(ph.delay) < (m.period ?? 1) * 1e-5 ? 0 : ph.delay, 's') : '—'
  }
}

export function renderTime(spec, { theme, diag, env }) {
  const [cols, rows] = divs(spec, [10, 8])
  const tb = spec.timebase && typeof spec.timebase === 'object' ? spec.timebase : { div: spec.timebase }
  if (tb.div === undefined) throw new SpecError('timebase', 'give the time per division, like "timebase": "200 us" (or {"div": "200 us", "pos": "1 ms"})')
  const tdiv = qty(tb.div, env, 'timebase.div', ['s'], diag), pos = qty(tb.pos ?? 0, env, 'timebase.pos', ['s'], diag)
  if (!(tdiv > 0)) throw new SpecError('timebase.div', 'the time per division must be above 0')
  const bandwidth = qty(spec.bandwidth ?? 200e6, env, 'bandwidth', ['Hz'], diag)
  const rate = qty(spec.rate ?? 1e9, env, 'rate', ['Sa/s'], diag)
  const mem = qty(spec.mem ?? 14e6, env, 'mem', ['pts'], diag)
  const chs = readChannels(spec, env, diag, bandwidth)
  const byId = new Map(chs.map((c) => [c.id, c]))
  const T0 = cols * tdiv
  const fs = Math.min(rate, mem / T0)
  let N = Math.floor(T0 * fs * (1 + 1e-9)) + 1, dt = 1 / fs
  if (N < 8) throw new SpecError(spec.mem !== undefined ? 'mem' : 'rate', `only ${N} samples fit on the screen; raise the rate or memory depth`)
  const simulated = N > NMAX
  if (simulated) { N = NMAX; dt = T0 / (N - 1) }

  // Trigger.
  const tr = spec.trigger ?? {}
  const src = byId.get(tr.source ?? chs[0].id)
  if (!src) throw new SpecError('trigger.source', `no channel ${tr.source}; channels: ${chs.map((c) => c.id).join(', ')}`)
  const slope = { rising: 'rise', falling: 'fall', both: 'either' }[tr.slope] ?? tr.slope ?? 'rise'
  if (!['rise', 'fall', 'either'].includes(slope)) throw new SpecError('trigger.slope', 'slope is rise, fall, or either')
  const tmode = tr.mode ?? 'auto'
  if (!['auto', 'normal', 'single'].includes(tmode)) throw new SpecError('trigger.mode', 'mode is auto, normal, or single')
  const fmin = Math.min(...src.sig.terms.map((t) => t.f ?? Infinity))
  const span = Math.min(1000 * T0, Math.max(2 * T0, Number.isFinite(fmin) ? 2.5 / fmin : 0))
  const trig = findTrigger(src, { level: tr.level === undefined ? null : qty(tr.level, env, 'trigger.level', ['V'], diag), slope }, 0, span, tdiv, Math.min(dt, T0 / 4000))
  const triggered = trig.t !== null
  const sweeps = triggered ? [trig.t + pos] : tmode === 'auto' ? (() => { const g = rng(7); return Array.from({ length: Math.max(1, Math.min(8, tr.sweeps ?? 4)) }, () => g.uni() * span) })() : []
  const tref = triggered ? trig.t : sweeps[0] ?? 0 // screen times are from the trigger

  // Acquire.
  const acq = sweeps.map((tc, s) => chs.map((ch) => digitize(ch, analog(ch, tc - T0 / 2, dt, N, tdiv), rows, ch.seed + 17 * s)))
  const t0 = (sweeps[0] ?? tref) - T0 / 2 // first sample time of sweep 0
  const meas = acq.length ? chs.map((ch, k) => measure(acq[0][k].v, dt, acq[0][k].lim)) : []
  const rel = (t) => t + t0 - tref // record time to screen time from the trigger

  // Math channel.
  let math = null
  if (spec.math) {
    const mm = typeof spec.math === 'string' ? { op: spec.math } : spec.math
    const m = /^\s*(\w+)\s*([-+*])\s*(\w+)\s*$/.exec(mm.op ?? '')
    if (!m) throw new SpecError('math.op', 'op is like "CH1-CH2", "CH1+CH2", or "CH1*CH2"')
    const [a, b] = [m[1], m[3]].map((id) => { const c = byId.get(id); if (!c) throw new SpecError('math.op', `no channel ${id}`); return c })
    const f = { '-': (x, y) => x - y, '+': (x, y) => x + y, '*': (x, y) => x * y }[m[2]]
    const sweepsV = acq.map((chans) => { const va = chans[a.i].v, vb = chans[b.i].v; return Float64Array.from(va, (x, i) => f(x, vb[i])) })
    math = {
      id: 'M', label: mm.label, op: `${a.id}${m[2] === '-' ? '−' : m[2] === '*' ? '×' : '+'}${b.id}`, color: color(mm.color ?? 'purple'),
      vdiv: qty(mm.vdiv ?? (m[2] === '*' ? a.vdiv * b.vdiv : Math.max(a.vdiv, b.vdiv)), env, 'math.vdiv', ['V'], diag),
      offset: qty(mm.offset ?? 0, env, 'math.offset', ['V'], diag), sweeps: sweepsV,
    }
    if (acq.length) math.m = { ...measure(sweepsV[0], dt), clipped: meas[a.i].clipped || meas[b.i].clipped }
  }
  const traces = [...chs.map((ch, k) => ({ ...ch, sweeps: acq.map((s) => s[k].v), m: meas[k] })), ...(math ? [math] : [])]
  const traceOf = (id, path) => { const t = traces.find((x) => x.id === id); if (!t) throw new SpecError(path, `no channel ${id}; channels: ${traces.map((x) => x.id).join(', ')}`); return t }

  // Measurements.
  const names = (spec.measure ?? ['Vpp', 'freq']).map((n, i) => {
    const k = NAMES[String(n).toLowerCase()]
    if (!k) diag.warn(`measure[${i}]`, `unknown measurement "${n}"; use ${Object.values(NAMES).filter((v, j, a) => a.indexOf(v) === j).join(', ')}`)
    return k
  }).filter(Boolean)
  const ref = traces[0]
  const phases = new Map(traces.slice(1).map((t) => [t.id, t.m && ref.m ? phaseOf(ref.m, t.m) : null]))

  // Cursors.
  let cur = null
  if (spec.cursors) {
    const c = spec.cursors
    const s = traceOf(c.source ?? ref.id, 'cursors.source')
    cur = { source: s }
    if (c.x === 'period') {
      const r = (s.m?.rising ?? []).map(rel), k = r.findIndex((t) => t >= -0.02 * (s.m.period ?? 0))
      const i = k >= 0 && k + 1 < r.length ? k : r.length - 2
      if (i >= 0 && r.length >= 2) cur.x = [r[i], r[i + 1]].map((t) => (Math.abs(t) < T0 * 1e-6 ? 0 : t))
      else diag.warn('cursors.x', `${s.id} has under two rising crossings on screen, so "period" has nothing to span`)
    } else if (Array.isArray(c.x) && c.x.length === 2) cur.x = c.x.map((v, i) => qty(v, env, `cursors.x[${i}]`, ['s'], diag))
    else if (c.x !== undefined) throw new SpecError('cursors.x', 'x is [t1, t2] (s from the trigger) or "period"')
    if (c.y === 'peaks') { if (s.m) cur.y = [s.m.vmax, s.m.vmin] }
    else if (Array.isArray(c.y) && c.y.length === 2) cur.y = c.y.map((v, i) => qty(v, env, `cursors.y[${i}]`, ['V'], diag))
    else if (c.y !== undefined) throw new SpecError('cursors.y', 'y is [v1, v2] (volts on the source channel) or "peaks"')
  }

  // Teaching notes: what the settings did to the picture.
  const fsTxt = engS(fs, 'Sa/s')
  if (fs < rate && !simulated) diag.note('mem', `${engS(mem, 'pts')} over ${engS(T0, 's')} limits the sample rate to ${fsTxt} (below the ${engS(rate, 'Sa/s')} maximum)`)
  for (const [k, ch] of chs.entries()) {
    const n = ch.id, m = meas[k]
    if (ch.sig.fmax && ch.sig.fmax > fs / 2) {
      const f = ch.sig.f ?? ch.sig.fmax, fa = Math.abs(f - Math.round(f / fs) * fs)
      diag.note(`channels[${k}]`, `${n}: ${engS(f, 'Hz')} sampled at ${fsTxt} is under 2f, so it aliases: the screen shows |f − k·fs| = ${engS(fa, 'Hz')}${m?.freq ? ` (measured ${eng(m.freq, 'Hz')})` : ''}; raise the sample rate or memory depth`)
    }
    if (m?.clipped) diag.note(`channels[${k}].vdiv`, `${n} clips at ${engS(ch.vdiv, 'V')}/div: the ADC holds ${eng(acq[0][k].lim[0], 'V')} to ${eng(acq[0][k].lim[1], 'V')}, so Vpp reads ${eng(m.vpp, 'V')}; raise V/div`)
    if (ch.gain !== 1) diag.note(`channels[${k}].probe`, `${n}: the menu says ${ch.probe}X but the probe is at ${ch.tip}X, so every reading is ${+ch.gain.toPrecision(3)}× the true voltage`)
    if (ch.comp !== 1) diag.note(`channels[${k}].comp`, `${n}: probe ${ch.comp > 1 ? 'over' : 'under'}-compensated (edge gain ${+ch.comp.toPrecision(3)}): square corners ${ch.comp > 1 ? 'overshoot' : 'round off'}; turn the probe's trimmer until they are flat`)
    if (ch.coupling === 'AC' && ch.sig.mean) diag.note(`channels[${k}].coupling`, `${n}: AC coupling removes the ${eng(ch.sig.mean * ch.gain, 'V')} mean`)
    if (ch.coupling === 'GND') diag.note(`channels[${k}].coupling`, `${n}: GND coupling draws the 0 V line, not the signal`)
    // Rise time against the bandwidth, when the bandwidth shapes the edge.
    const ts = 0.35 / ch.bw
    if (m?.rise && !m.riseLimited && !m.clipped && ch.comp === 1 && (ch.bwl || ts > 0.2 * ch.sig.rise) && m.rise < 3 * Math.hypot(ts, ch.sig.rise) && ch.sig.terms.some((t) => t.rise !== undefined)) {
      const exp = Math.hypot(ts, ch.sig.rise)
      diag.note(`channels[${k}]`, `${n}: ${engS(ch.bw, 'Hz')} bandwidth rises in 0.35/BW = ${eng(ts, 's')}; with the signal's ${eng(ch.sig.rise, 's')}, √(sum of squares) = ${eng(exp, 's')}; measured ${eng(m.rise, 's')}`)
    }
  }
  if (!triggered) {
    const [lo, hi] = trig.range
    diag.note('trigger', `no ${slope === 'either' ? '' : slope + ' '}crossing of ${eng(trig.level, 'V')} on ${src.id} (it spans ${eng(lo, 'V')} to ${eng(hi, 'V')}): ${tmode === 'auto' ? `auto mode free-runs, so the ${sweeps.length} sweeps don't line up` : `${tmode} mode waits and draws nothing`}`)
  }

  // Layout.
  const xy = spec.xy ? (spec.xy === true ? [chs[0]?.id, chs[1]?.id] : spec.xy) : null
  if (xy && (!Array.isArray(xy) || xy.length !== 2)) throw new SpecError('xy', 'xy is true (CH1 against CH2) or ["X source", "Y source"]')
  if (xy && chs.length + (math ? 1 : 0) < 2) throw new SpecError('xy', 'XY needs two channels')
  const ML = 34, MR = 24, MT = 22
  const dx = xy ? Math.min(28, SW / rows) : SW / cols
  const S = xy ? screen(ML + (SW - rows * dx) / 2, MT, rows, rows, dx) : screen(ML, MT, cols, rows, dx)
  const parts = [graticule(S, theme)]
  const hl = new Set(spec.highlight ?? [])
  const summary = []
  const W = ML + SW + MR
  const rowsOut = []
  const sh = (ch) => `${ch.id}${ch.label ? ` (${ch.label.replace(/\\text\{([^}]*)\}/g, '$1')})` : ''}`

  if (xy) {
    const [X, Y] = xy.map((id, i) => traceOf(id, `xy[${i}]`))
    const g = (t, v) => (v + t.offset) / t.vdiv
    for (const [s, vx] of X.sweeps.entries()) {
      const vy = Y.sweeps[s]
      const pts = Array.from(vx, (x, i) => [S.X(rows / 2 + g(X, x)), S.Y(g(Y, vy[i]))])
      parts.push(el('path', { d: tracePath({ ...S, w: 1e9 }, pts), fill: 'none', stroke: Y.color, 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-opacity': s ? 0.6 : 1 }))
    }
    rowsOut.push([[T(`X ${X.id}`), X.color, 4], [T(`${engS(X.vdiv, 'V')}/div`), X.color], [T(`Y ${Y.id}`), Y.color, 4], [T(`${engS(Y.vdiv, 'V')}/div`), Y.color], [T(fsTxt), theme.muted]])
    const lj = X.m && Y.m ? lissajous(X, Y, X.sweeps[0], Y.sweeps[0]) : null
    if (lj) rowsOut.push([[T(`φ = ${eng(lj.phase, '°')}`), theme.fg], [T(`f ratio ${lj.ratio}`), theme.fg]])
    const shape = lj && (lj.sin < 0.002 ? 'a line' : lj.sin > 0.998 ? 'a circle or upright ellipse' : 'an ellipse')
    summary.push(`XY: ${X.id} (x) against ${Y.id} (y)` + (lj ? `, ${lj.ratio}; ${lj.ratio === '1:1' ? `${shape}, sin φ = y₀/y_max = ${lj.sin.toFixed(3)}, φ = ${eng(lj.phase, '°')}${lj.phase ? ` (${lj.phase > 0 ? `${Y.id} leads` : `${Y.id} lags`})` : ''}` : 'a Lissajous figure'}` : ''))
  } else {
    // Traces, each sweep of an untriggered screen in its own place.
    for (const t of traces) {
      for (const [s, v] of t.sweeps.entries()) {
        const pts = Array.from(v, (x, i) => [S.x + (i * dt * S.w) / T0, S.Y((x + t.offset) / t.vdiv)])
        parts.push(el('path', { d: tracePath(S, pts), fill: 'none', stroke: t.color, 'stroke-width': hl.has(t.id) ? 2.6 : 1.5, 'stroke-linejoin': 'round', 'stroke-opacity': s ? 0.7 : 1 }))
        // Few samples on screen: dots show where the samples are (the aliasing picture).
        if (v.length <= S.w / 4) for (const [x, y] of pts) if (y >= S.y && y <= S.y + S.h) parts.push(el('circle', { cx: x, cy: y, r: 2, fill: t.color }))
      }
    }
    // 0 V tags; one that would cover another steps left.
    const placed = []
    for (const t of traces) {
      const y = S.Y(t.offset / t.vdiv)
      let col = 0
      while (placed.some((p) => p.col === col && Math.abs(p.y - y) < 11)) col++
      placed.push({ y, col })
      parts.push(zeroTag({ ...S, x: S.x - 14 * col }, y, t.color, t.id.replace(/^CH/, ''), theme))
    }
    if (triggered || sweeps.length) {
      parts.push(edgeMark(S, 'top', S.X(cols / 2 - pos / tdiv), theme.fg))
      parts.push(edgeMark(S, 'right', S.Y((trig.level + src.offset) / src.vdiv), src.color))
    }
    if (cur?.x) for (const t of cur.x) { const x = S.X(cols / 2 + (t - pos) / tdiv); if (x >= S.x && x <= S.x + S.w) parts.push(el('line', { x1: x, y1: S.y, x2: x, y2: S.y + S.h, stroke: theme.fg, 'stroke-width': 1, 'stroke-dasharray': '4 3', 'stroke-opacity': 0.8 })) }
    if (cur?.y) for (const v of cur.y) { const y = S.Y((v + cur.source.offset) / cur.source.vdiv); if (y >= S.y && y <= S.y + S.h) parts.push(el('line', { x1: S.x, y1: y, x2: S.x + S.w, y2: y, stroke: cur.source.color, 'stroke-width': 1, 'stroke-dasharray': '4 3' })) }

    // Settings: each channel's scale; then time, sample rate, and trigger.
    const set = chs.flatMap((ch) => [[T(ch.id), ch.color, 4], [T(`${engS(ch.vdiv, 'V')}/div` + (ch.coupling !== 'DC' ? ` ${ch.coupling}` : '') + (ch.probe !== 1 ? ` ${engS(ch.probe, '')}X` : '') + (ch.bwl ? ' BW' : '')), ch.color]])
    if (math) set.push([T(`M ${math.op}`), math.color, 4], [T(`${engS(math.vdiv, 'V')}/div`), math.color])
    rowsOut.push(set)
    const state = triggered ? '' : tmode === 'auto' ? 'Auto: ' : 'Wait: '
    rowsOut.push([[T(`${engS(tdiv, 's')}/div`), theme.fg], [T(fsTxt), theme.muted],
      [T(`${state}T ${src.id} ${slope === 'fall' ? '↓' : slope === 'rise' ? '↑' : '↕'} ${engS(trig.level, 'V')}`), triggered ? src.color : theme.highlight]])
  }
  // Measurement rows, one per trace.
  for (const t of traces) {
    if (!t.m || !names.length) continue
    const items = t.label ? [[T(t.id), t.color, 4], [t.label, t.color]] : [[T(t.id), t.color]]
    for (const n of names) {
      if ((n === 'Phase' || n === 'Delay') && t === ref) continue
      items.push([T(`${n} ${show(n, t.m, phases.get(t.id))}`), theme.fg])
    }
    if (items.length > 1) rowsOut.push(items)
  }
  if (cur && (cur.x || cur.y)) {
    const items = []
    if (cur.x) { const d = Math.abs(cur.x[1] - cur.x[0]); items.push([T(`ΔT ${eng(d, 's')} (${eng(1 / d, 'Hz')})`), theme.fg]) }
    if (cur.y) items.push([T(`ΔV ${eng(Math.abs(cur.y[0] - cur.y[1]), 'V')}`), cur.source.color])
    rowsOut.push(items)
  }
  const ro = readouts(rowsOut, S.x - (xy ? (SW - rows * dx) / 2 : 0), S.y + S.h + 2, SW, theme)
  parts.push(ro.svg)
  let H = S.y + S.h + ro.height + 12

  // Summary: the screen, then every channel's numbers.
  const head = `scope time: ${cols}×${rows} div, ${engS(tdiv, 's')}/div (${engS(T0, 's')} across), ${fsTxt}${simulated ? ` (drawn from ${NMAX} samples)` : `, ${N} samples`}; ` +
    (triggered ? `trigger ${src.id} ${slope} at ${eng(trig.level, 'V')}${pos ? `, position ${engS(pos, 's')}` : ''}` : `untriggered (${tmode}${tmode === 'auto' ? `, ${sweeps.length} sweeps` : ', screen empty'})`)
  const line = (t) => {
    const m = t.m
    if (!m) return `${sh(t)}: no data`
    const bits = [`Vpp ${show('Vpp', m)}`, `Vmax ${show('Vmax', m)}`, `Vmin ${show('Vmin', m)}`, `Vrms ${show('Vrms', m)}`, `Mean ${show('Mean', m)}`, `Freq ${show('Freq', m)}`]
    for (const n of ['Ampl', 'Period', 'Rise', 'Fall', 'Duty']) if (names.includes(n) || (m.flat && ['Rise', 'Fall', 'Duty'].includes(n))) bits.push(`${n} ${show(n, m)}`)
    const ph = phases.get(t.id)
    if (ph) bits.push(`delay ${show('Delay', m, ph)}, phase ${show('Phase', m, ph)} from ${ref.id}`)
    const scale = t.id === 'M' ? `${t.op}, ${engS(t.vdiv, 'V')}/div` : `${engS(t.vdiv, 'V')}/div ${t.coupling}${t.probe !== 1 || t.tip !== 1 ? ` ${t.probe}X menu, ${t.tip}X probe` : ''}${t.bwl ? ' BWL' : ''}`
    return `${sh(t)} ${scale}: ${bits.join(', ')}${m.clipped ? ' (clipped)' : ''}`
  }
  const cursorTxt = cur && (cur.x || cur.y) ? `cursors on ${cur.source.id}: ` + [cur.x && `x ${cur.x.map((v) => eng(v, 's')).join(' and ')}, ΔT ${eng(Math.abs(cur.x[1] - cur.x[0]), 's')}, 1/ΔT ${eng(1 / Math.abs(cur.x[1] - cur.x[0]), 'Hz')}`, cur.y && `y ${cur.y.map((v) => eng(v, 'V')).join(' and ')}, ΔV ${eng(Math.abs(cur.y[0] - cur.y[1]), 'V')}`].filter(Boolean).join('; ') : ''

  // FFT pane under the time screen.
  let fftTxt = ''
  if (spec.fft) {
    const f = typeof spec.fft === 'string' ? { source: spec.fft } : spec.fft
    const t = traceOf(f.source ?? ref.id, 'fft.source')
    if (t.sweeps.length) {
      const out = fftPane(f, t, dt, S.x, H - 4, SW, cols, theme, diag, env)
      parts.push(out.svg)
      H += out.height
      fftTxt = out.summary
    }
  }
  const text = [head, ...traces.map(line), xy ? summary[0] : '', cursorTxt, fftTxt].filter(Boolean).join('; ')
  return { body: parts.join(''), width: W, height: H, summary: text, alt: 'oscilloscope screen' }
}

/**
 * Lissajous phase from the XY figure: where X crosses its middle going up and going down,
 * Y sits at ±y₀; sin φ = y₀ / y_max, and the tilt (the sign of the X-Y covariance) picks the quadrant.
 */
function lissajous(X, Y, vx, vy) {
  const mx = (X.m.vmax + X.m.vmin) / 2, my = (Y.m.vmax + Y.m.vmin) / 2, ymax = (Y.m.vmax - Y.m.vmin) / 2
  let up = 0, dn = 0, nu = 0, nd = 0, cov = 0
  for (let i = 1; i < vx.length; i++) {
    cov += (vx[i] - mx) * (vy[i] - my)
    if (vx[i - 1] < mx && vx[i] >= mx) { up += vy[i]; nu++ }
    if (vx[i - 1] > mx && vx[i] <= mx) { dn += vy[i]; nd++ }
  }
  const fx = X.m.freq, fy = Y.m.freq
  const r = fx && fy ? fy / fx : null
  const ratio = r ? ratioText(r) : 'f ratio unknown'
  if (!nu || !nd || !(ymax > 0)) return null
  let s = Math.max(-1, Math.min(1, (up / nu - dn / nd) / 2 / ymax))
  if (Math.abs(s) < 0.002) s = 0
  const c = Math.sign(cov) * Math.sqrt(1 - s * s)
  return { sin: Math.abs(s), phase: (Math.atan2(s, c) * 180) / Math.PI, ratio: r && Math.abs(r - 1) < 0.02 ? '1:1' : ratio }
}
function ratioText(r) {
  for (let q = 1; q <= 6; q++) { const p = Math.round(r * q); if (p && Math.abs(r - p / q) < 0.02 * r) return `${q}:${p}` }
  return `1:${r.toFixed(2)}`
}
