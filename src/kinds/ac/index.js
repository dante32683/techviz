// ac: sinusoidal steady state from R, L, and C values. Phasor diagrams (current as the reference
// in series, voltage in parallel, the sum head to tail, φ, and the v(t) and i(t) projections),
// impedance triangles in the Z or Y plane, Bode plots of a divider or of poles and zeros (exact
// curve over straight-line asymptotes, corners, −3 dB points, slopes), and resonance curves (f0,
// half-power points, bandwidth, Q, one curve per swept value). The summary states every
// computed value, and `expect` names any wrong one.

import { el } from '../../svg.js'
import { labelSvg, measure } from '../../label.js'
import { color } from '../../theme.js'
import { SpecError } from '../../diag.js'
import { Canvas } from '../fbd/draw.js'
import { cx, mul, abs, arg, inv, polar } from './complex.js'
import { qty, freq, show, sig, rect } from './units.js'
import { UNIT, readParts, readCircuit, readSource, analyze, checkExpect, divider, rlc, zAt, text } from './circuit.js'
import { fromDivider, fromPoles } from './transfer.js'
import { drawVectors } from './vectors.js'
import { drawBode, drawResonance } from './plots.js'

const MARGIN = 14
const TYPE_COLORS = { R: ['blue', 'teal', 'gray'], L: ['coral', 'amber', 'red'], C: ['purple', 'pink', 'green'] }
const partColor = (p, parts) => color(TYPE_COLORS[p.type][parts.filter((q) => q.type === p.type).indexOf(p) % 3])
const REF = 'green'

function topology(node) {
  if (node.part) return 'series'
  if (!node.items.every((c) => c.part)) return null
  return node.op === '+' ? 'series' : 'parallel'
}

/** One sweep: {"R": [10, 50]} gives a list of overrides, each with its label. */
function readSweep(spec, env, diag, parts) {
  if (spec.sweep === undefined) return [{ over: {}, label: null }]
  const s = spec.sweep
  const keys = s && typeof s === 'object' && !Array.isArray(s) ? Object.keys(s) : []
  if (keys.length !== 1 || !Array.isArray(s[keys[0]]) || !s[keys[0]].length) throw new SpecError('sweep', 'sweep is one part and its values, like {"R": ["10 ohm", "50 ohm"]}')
  const name = keys[0], p = parts.find((q) => q.name === name)
  if (!p) throw new SpecError(`sweep.${name}`, `"${name}" isn't in parts (${parts.map((q) => q.name).join(', ')})`)
  return s[name].map((v, i) => {
    const x = qty(v, env, `sweep.${name}[${i}]`, UNIT[p.type], diag)
    if (!(x > 0)) throw new SpecError(`sweep.${name}[${i}]`, `${name} must be positive`)
    return { over: { [name]: x }, label: `${name} = ${show(x, UNIT[p.type], 3, true)}` }
  })
}

function vectorMode(spec, ctx, cv, facts) {
  const { theme, diag, env } = ctx
  const mode = spec.mode ?? 'phasor'
  const parts = readParts(spec, env, diag)
  const node = readCircuit(spec, parts, diag)
  const src = readSource(spec, env, diag, true)
  const a = analyze(node, parts, src)
  facts.push(...a.facts)
  const hl = new Set(spec.highlight ?? [])
  const withVal = spec.values !== false
  const lab = (name, x, unit) => (withVal ? `${name} = ${show(x, unit)}` : name)
  const sum = spec.sum ?? (mode === 'phasor' ? 'chain' : 'origin')
  if (sum !== 'chain' && sum !== 'origin') throw new SpecError('sum', 'sum is "chain" (head to tail) or "origin" (each from the origin)')
  const caption = []
  let o
  if (mode === 'phasor') {
    const topo = topology(node)
    if (!topo) throw new SpecError('circuit', 'a phasor diagram needs every part in series or every part in parallel; draw a mixed circuit with mode "impedance"')
    if (src.V === null) diag.warn('V', 'no source amplitude: V is taken as 1 V; give "V": "90 V"')
    const series = topo === 'series'
    // Series: rotate so the current lies along +x. Parallel: the source voltage already does.
    const rot = series ? polar(1, -arg(a.sol.I)) : cx(1)
    const legs = parts.map((p) => {
      const s = a.sol.parts.get(p.name), z = mul(series ? s.V : s.I, rot)
      return { z, label: lab(`${series ? 'V' : 'I'}_{${p.name}}`, abs(z), series ? 'V' : 'A'), color: partColor(p, parts), width: hl.has(p.name) ? 3.4 : 2.2 }
    })
    const tot = mul(series ? cx(a.V) : a.sol.I, rot)
    o = {
      legs, chain: sum === 'chain',
      total: { z: tot, label: lab(series ? 'V_{s}' : 'I', abs(tot), series ? 'V' : 'A'), color: theme.fg },
      ref: { label: series ? lab('I', abs(a.sol.I), 'A') : lab('V_{s}', a.V, 'V'), color: color(REF) },
      arc: series ? { from: 0, to: a.phi, label: `\\varphi\\,= ${show(a.phi, '°')}` } : { from: -a.phi, to: 0, label: `\\varphi\\,= ${show(a.phi, '°')}` },
      net: sum === 'origin' ? { label: series ? 'V_{L} − V_{C}' : 'I_{C} − I_{L}' } : null,
    }
    if (spec.wave) {
      if (spec.wave !== true) throw new SpecError('wave', 'wave is true (draw v(t) and i(t) beside the diagram)')
      o.wave = { total: { color: theme.fg, label: series ? 'v' : 'i' }, ref: { color: color(REF), label: series ? 'i' : 'v' } }
    }
    const lag = Math.abs(a.phi) < 0.05 ? 'I\\text{ in phase with }V_{s}' : `I\\text{ ${a.phi > 0 ? 'lags' : 'leads'} }V_{s}\\text{ by }${show(Math.abs(a.phi), '°')}`
    caption.push(`${lag} (\\text{${src.word}})`)
  } else {
    const P = a.P, w = a.w
    const plane = spec.plane ?? (node.op === '||' ? 'Y' : 'Z')
    if (plane !== 'Z' && plane !== 'Y') throw new SpecError('plane', 'plane is "Z" or "Y"')
    const Z = a.sol.Z, Y = inv(Z), tot = plane === 'Z' ? Z : Y
    const unit = plane === 'Z' ? 'Ω' : 'S'
    const matched = node.part || (plane === 'Z' ? node.op === '+' : node.op === '||')
    const kids = node.part ? [node] : node.items
    let legs
    if (matched) {
      legs = kids.map((c) => {
        const p = c.part ? P.get(c.part) : null
        const z = plane === 'Z' ? zAt(c, P, w) : inv(zAt(c, P, w))
        let name
        if (!p) name = `${plane}_{${text(c, true, true)}}`
        else if (plane === 'Z') name = p.type === 'R' ? p.name : `X_{${p.name}}`
        // Conductance G = 1/R and susceptances B_C = ωC, B_L = 1/ωL.
        else name = p.type === 'R' ? (parts.filter((q) => q.type === 'R').length === 1 ? 'G' : `G_{${p.name}}`) : `B_{${p.name}}`
        const val = p ? (withVal ? `${name} = ${show(abs(z), unit)}` : name) : withVal ? `${name} = ${rect(z, unit, 3)}` : name
        return { z, label: val, color: p ? partColor(p, parts) : color('gray'), width: c.part && hl.has(c.part) ? 3.4 : 2.2 }
      })
    } else legs = [{ z: cx(tot.re), label: lab(plane === 'Z' ? 'R_{eq}' : 'G_{eq}', tot.re, unit), color: color('blue'), width: 2.2 }]
    const ang = arg(tot)
    o = {
      legs, chain: sum === 'chain',
      total: { z: tot, label: lab(`|${plane}|`, abs(tot), unit), color: theme.fg },
      ref: null,
      arc: { from: 0, to: ang, label: plane === 'Z' ? `\\varphi\\,= ${show(ang, '°')}` : `\\angle Y = ${show(ang, '°')}` },
      net: sum === 'origin' && Math.abs(tot.re) > 1e-12 ? { label: lab(plane === 'Z' ? 'X' : 'B', tot.im, unit) } : null,
      axes: { x: `\\text{Re}\\,${plane}`, y: `\\text{Im}\\,${plane}` },
      size: 190,
    }
    if (spec.wave) diag.warn('wave', 'wave applies to mode "phasor"')
    caption.push(`${plane}\\text{ at }${show(src.f, 'Hz')}`)
  }
  const crowded = drawVectors(cv, theme, o)
  checkCrowded(crowded, diag)
  const vals = a.vals
  const ex = checkExpect(spec, vals, env, diag, src)
  if (ex) facts.push(ex)
  return caption
}

// Layout is automatic, so a crowded label is a note (it still reads, on a backing box).
function checkCrowded(crowded, diag) {
  if (crowded.length) diag.note('', `crowded: ${crowded.map((q) => q.label).join(', ')} sit on backing boxes; values: false or a wider range can help`)
}

function bodeMode(spec, ctx, cv, facts) {
  const { theme, diag, env } = ctx
  let tfs, vals = {}, src = { rms: true, word: 'rms' }
  if (spec.out !== undefined) {
    const parts = readParts(spec, env, diag)
    const node = readCircuit(spec, parts, diag)
    const dv = divider(spec, node, parts)
    tfs = readSweep(spec, env, diag, parts).map((s, k) => {
      const ps = readParts(spec, env, diag, s.over)
      return { tf: fromDivider(dv, new Map(ps.map((p) => [p.name, p]))), label: s.label, color: color(null, k) }
    })
    facts.push(`H = V_out/V_in across ${text(dv.out)} of ${text(node)}, ${parts.map((p) => `${p.name} ${show(p.value, UNIT[p.type], 4, true)}`).join(', ')}`)
    if (spec.f !== undefined) {
      src = readSource(spec, env, diag, true)
      const a = analyze(node, parts, src)
      facts.push(...a.facts); vals = a.vals
    }
  } else {
    if (spec.sweep !== undefined) diag.warn('sweep', 'sweep needs a circuit (parts and out)')
    tfs = [{ tf: fromPoles(spec, env, diag), label: null, color: color(null, 0) }]
  }
  let range
  if (spec.range !== undefined) {
    if (!Array.isArray(spec.range) || spec.range.length !== 2) throw new SpecError('range', 'range is [f_lo, f_hi], like ["10 Hz", "100 kHz"]')
    range = spec.range.map((v, i) => freq(v, env, `range[${i}]`, diag))
    if (!(range[1] > range[0])) throw new SpecError('range', 'the range must have f_hi > f_lo')
  }
  const r = drawBode(cv, theme, tfs, { range, phase: spec.phase !== false })
  checkCrowded(r.crowded, diag)
  const tf = tfs[0].tf
  const desc = tf.fac.map((F) => `${F.zero ? 'zero' : 'pole'}${F.pair ? ' pair' : ''} ${show(F.w / (2 * Math.PI), 'Hz', 4)}${F.pair ? ` (ζ ${sig(F.zeta, 3)}, Q ${F.zeta ? sig(1 / (2 * F.zeta), 3) : '∞'})` : ''}${F.rhp ? ' (right half plane)' : ''}`)
  let slope = 20 * tf.m
  const slopes = [slope]
  for (const F of tf.fac) { slope += (F.zero ? 1 : -1) * (F.pair ? 40 : 20); slopes.push(slope) }
  facts.push(`K ${sig(tf.K, 4)}${tf.m ? `, ${tf.m > 0 ? 'zeros' : 'poles'} at the origin ${Math.abs(tf.m)}` : ''}; ${desc.join(', ') || 'no corners'}; asymptote slopes ${slopes.map((s) => `${s > 0 ? '+' : ''}${s}`).join(', ')} dB/dec`)
  const { m3 } = r
  facts.push(`max |H| ${sig(m3.top, 4)} dB in range; −3 dB ${m3.f.length ? `at ${m3.f.map((f) => show(f, 'Hz', 4)).join(' and ')}${m3.f.length === 2 ? ` (BW ${show(m3.f[1] - m3.f[0], 'Hz', 4)})` : ''}` : 'never in range'}`)
  facts.push(`range ${show(r.lo, 'Hz')} to ${show(r.hi, 'Hz')}${tfs.length > 1 ? `; ${tfs.length} curves (${tfs.map((t) => t.label).join(', ')}), marks for the first` : ''}`)
  const put = (k, v, unit, label) => { vals[k] = { v, unit, label } }
  if (tf.fac.length) put('fc', tf.fac[0].w / (2 * Math.PI), 'Hz', 'f_c')
  const pair = tf.fac.find((F) => F.pair && !F.zero) ?? tf.fac.find((F) => F.pair)
  if (pair) { put('f0', pair.w / (2 * Math.PI), 'Hz', 'f_0'); if (pair.zeta) put('q', 1 / (2 * pair.zeta), '', 'Q') }
  if (m3.f.length) put('f1', m3.f[0], 'Hz', 'f_1 (−3 dB)')
  if (m3.f.length === 2) { put('f2', m3.f[1], 'Hz', 'f_2 (−3 dB)'); put('bw', m3.f[1] - m3.f[0], 'Hz', 'BW (−3 dB)') }
  const ex = checkExpect(spec, vals, env, diag, src)
  if (ex) facts.push(ex)
  return []
}

function resonanceMode(spec, ctx, cv, facts) {
  const { theme, diag, env } = ctx
  const parts = readParts(spec, env, diag)
  const node = readCircuit(spec, parts, diag)
  const base = rlc(node, parts)
  if (!base) throw new SpecError('circuit', 'resonance needs one L and one C, at most one R, all in series or all in parallel')
  const src = readSource(spec, env, diag, false)
  const V = src.V ?? 1
  const yq = spec.y ?? (base.series ? 'I' : 'Z')
  if (!['I', 'Z', 'P'].includes(yq)) throw new SpecError('y', 'y is "I" (current), "Z" (|Z|), or "P" (average power)')
  const yName = { I: `I_${src.rms ? '{rms}' : '{0}'}`, Z: '|Z|', P: 'P' }[yq]
  const runs = readSweep(spec, env, diag, parts)
  const curves = runs.map((s, k) => {
    const ps = readParts(spec, env, diag, s.over)
    const P = new Map(ps.map((p) => [p.name, p]))
    const res = rlc(node, ps)
    const Z = (f) => zAt(node, P, 2 * Math.PI * f)
    const y = { I: (f) => V / abs(Z(f)), Z: (f) => abs(Z(f)), P: (f) => { const z = Z(f); return ((V * V) / (abs(z) ** 2)) * z.re * (src.rms ? 1 : 0.5) } }[yq]
    const dip = (base.series && yq === 'Z') || (!base.series && yq === 'I')
    const half = yq === 'P' ? y(res.f0) / 2 : dip ? y(res.f0) * Math.SQRT2 : y(res.f0) / Math.SQRT2
    const q = Number.isFinite(res.Q) ? `Q = ${sig(res.Q, 3)}` : 'Q = ∞'
    return {
      y, res, half, color: color(null, k),
      label: s.label ?? q,
      bwLabel: s.label ? q : `\\Delta f = ${show(res.BW, 'Hz')}`,
      fact: `${s.label ? `${s.label.replace(/\s*=\s*/, ' ')}: ` : ''}f0 ${show(res.f0, 'Hz', 4)}, Q ${Number.isFinite(res.Q) ? sig(res.Q, 4) : '∞'}${Number.isFinite(res.Q) ? `, BW ${show(res.BW, 'Hz', 4)} (f1 ${show(res.f1, 'Hz', 4)}, f2 ${show(res.f2, 'Hz', 4)})` : ''}, peak ${yq} ${show(y(res.f0), { I: 'A', Z: 'Ω', P: 'W' }[yq], 4)}`,
    }
  })
  if (curves.some((c) => !Number.isFinite(c.res.Q))) diag.warn('parts', 'with no R the peak is infinite; add an R to see the bandwidth')
  let range
  if (spec.range !== undefined) {
    if (!Array.isArray(spec.range) || spec.range.length !== 2) throw new SpecError('range', 'range is [f_lo, f_hi], like ["50 Hz", "200 Hz"]')
    range = spec.range.map((v, i) => (v === 0 ? 0 : freq(v, env, `range[${i}]`, diag)))
  }
  const r = drawResonance(cv, theme, curves, { range, log: !!spec.log, yName, unit: { I: 'A', Z: 'Ω', P: 'W' }[yq], f0: curves[0].res.f0 })
  checkCrowded(r.crowded, diag)
  facts.push(`${base.series ? 'series' : 'parallel'} RLC, ${parts.map((p) => `${p.name} ${show(p.value, UNIT[p.type], 4, true)}`).join(', ')}; source ${show(V, 'V', 4)} ${src.word}${src.V === null ? ' (default)' : ''}; y ${yq}`)
  facts.push(...curves.map((c) => c.fact))
  let vals = {}
  if (spec.f !== undefined) {
    const s2 = readSource(spec, env, diag, true)
    const a = analyze(node, parts, s2)
    facts.push(`at f: ${a.facts.slice(1).join('; ')}`)
    vals = a.vals
  }
  const r0 = curves[0].res
  vals.f0 = { v: r0.f0, unit: 'Hz', label: 'f_0' }
  if (Number.isFinite(r0.Q)) Object.assign(vals, { q: { v: r0.Q, unit: '', label: 'Q' }, bw: { v: r0.BW, unit: 'Hz', label: 'Δf' }, f1: { v: r0.f1, unit: 'Hz', label: 'f_1' }, f2: { v: r0.f2, unit: 'Hz', label: 'f_2' } })
  const ex = checkExpect(spec, vals, env, diag, src)
  if (ex) facts.push(ex)
  facts.push(`range ${show(r.lo, 'Hz')} to ${show(r.hi, 'Hz')}`)
  return []
}

export default {
  kind: 'ac',
  fields: ['mode', 'parts', 'circuit', 'V', 'f', 'rms', 'sum', 'wave', 'values', 'plane', 'out', 'poles', 'zeros', 'gain', 'range', 'phase', 'sweep', 'log', 'y', 'expect', 'highlight'],
  collections: [],
  render(spec, ctx) {
    const { theme } = ctx
    const mode = spec.mode ?? 'phasor'
    const run = { phasor: vectorMode, impedance: vectorMode, bode: bodeMode, resonance: resonanceMode }[mode]
    if (!run) throw new SpecError('mode', 'mode is phasor (default), impedance, bode, or resonance')
    const cv = new Canvas()
    const facts = []
    const caption = run(spec, ctx, cv, facts)
    let xs = cv.ext.map((p) => p[0]), ys = cv.ext.map((p) => p[1])
    let x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys)
    for (const c of caption) {
      const y = y1 + 20
      cv.front.push(labelSvg(c, (x0 + x1) / 2, y, theme, { size: theme.size - 1, fill: theme.muted }))
      const w = measure(c, theme.size - 1)
      x0 = Math.min(x0, (x0 + x1) / 2 - w / 2); x1 = Math.max(x1, (x0 + x1) / 2 + w / 2); y1 = y + 4
    }
    const body = el('g', { transform: `translate(${(MARGIN - x0).toFixed(1)},${(MARGIN - y0).toFixed(1)})` }, [...cv.back, ...cv.mid, ...cv.front])
    return { body, width: x1 - x0 + 2 * MARGIN, height: y1 - y0 + 2 * MARGIN, summary: `ac ${mode}: ${facts.join('; ')}`, alt: `AC ${mode} diagram` }
  },
}
