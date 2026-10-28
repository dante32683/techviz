// The cascade: reads a chain spec into blocks with numbers, then walks the signal through them.
// Levels add in dB; noise figure follows Friis (F = F1 + (F2 − 1)/G1 + ...); the noise floor at a
// node is −174 dBm/Hz + 10 log10(B) + G + NF; IIP3 adds as 1/IIP3 = Σ G_before/IIP3_i in mW; each
// mixer's frequency plan gives IF = |RF − LO| and the image 2 LO − RF; P1dB and maximum-input
// limits are checked at every block, branches included.

import { SpecError } from '../../diag.js'
import { qty, eng } from '../scope/units.js'
import { PRESETS } from './presets.js'

export const KT = -174 // dBm in 1 Hz at 290 K

const ROLE = {
  source: 'start', antenna: 'start', cable: 'passive', atten: 'passive', amp: 'active', filter: 'passive',
  mixer: 'mixer', switch: 'passive', coupler: 'passive', splitter: 'passive', detector: 'sink', adc: 'sink',
  receiver: 'sink', display: 'sink', port: 'marker', block: 'generic',
}
export const TYPES = Object.keys(ROLE)
const DEFAULT_LOSS = { filter: 0, switch: 0, coupler: 0, splitter: 3, mixer: 7, port: 0 }
const SHORT = { source: 'SRC', antenna: 'ANT', cable: 'cable', atten: 'ATT', amp: 'AMP', filter: 'BPF', mixer: 'MIX', switch: 'SW', coupler: 'CPL', splitter: 'SPL', detector: 'DET', adc: 'ADC', receiver: 'RX', display: 'display', port: '', block: '' }
const BLOCK_FIELDS = new Set(['id', 'type', 'label', 'gain', 'loss', 'nf', 'p1db', 'ip1db', 'oip3', 'iip3', 'max', 'note', 'pass', 'below', 'above', 'stop', 'lo', 'if', 'inject', 'sweep', 'coupling', 'samples', 'rl', 'branch', 'level'])

/** 12.5, −3, +20 with `sign`: d decimals, trailing zeros dropped, a real minus sign. */
export function num(x, d = 1, sign = false) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—'
  let s = x.toFixed(d)
  if (s.includes('.')) s = s.replace(/\.?0+$/, '')
  if (/^-0$/.test(s)) s = '0'
  if (s.startsWith('-')) return '−' + s.slice(1)
  return sign && s !== '0' ? '+' + s : s
}
export const dBm = (x) => `${num(x, 1, true)} dBm`
export const dB = (x, d = 1) => `${num(x, d)} dB`
export const hz = (f) => eng(f, 'Hz', 4, true)
const lin = (db) => 10 ** (db / 10)
const log = (x) => 10 * Math.log10(x)

/** A block's name in facts and warnings: its id, else its label, else its type and number. */
const plain = (s) => String(s).replace(/\\text\{([^}]*)\}/g, '$1').replace(/[{}\\]/g, '').replace(/_/g, '')

/** The preset's blocks with the spec's blocks patched in by id. */
function withPreset(spec) {
  if (spec.preset === undefined) return { blocks: spec.blocks, input: spec.input, from: 'blocks' }
  const p = PRESETS[spec.preset]
  if (!p) throw new SpecError('preset', `preset is ${Object.keys(PRESETS).map((k) => `"${k}"`).join(' or ')}`)
  const blocks = structuredClone(p.blocks)
  const all = blocks.flatMap((b) => [b, ...(b.branch ?? [])])
  for (const [i, patch] of (spec.blocks ?? []).entries()) {
    const hit = all.find((b) => b.id === patch?.id)
    if (!hit) throw new SpecError(`blocks[${i}].id`, `with a preset, blocks patch its blocks by id; "${spec.preset}" has ${all.map((b) => b.id).join(', ')}`)
    Object.assign(hit, patch)
  }
  // A source given its own level replaces the preset's input level.
  const own = (spec.blocks ?? []).some((b) => b?.level !== undefined)
  return { blocks, input: spec.input ?? (own ? undefined : p.input), from: `preset.${spec.preset}`, caption: p.caption }
}

function readBlock(b, path, env, diag, n) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new SpecError(path, 'each block is an object like {"type": "amp", "gain": 20, "nf": 1.5}')
  if (!ROLE[b.type]) throw new SpecError(`${path}.type`, `type is one of ${TYPES.join(', ')}`)
  for (const k of Object.keys(b)) if (!BLOCK_FIELDS.has(k)) diag.warn(`${path}.${k}`, `a block doesn't use "${k}"`)
  const { type } = b, role = ROLE[type]
  const at = (k, want) => (b[k] === undefined || b[k] === null ? null : qty(b[k], env, `${path}.${k}`, want, diag))
  const o = { id: b.id ?? null, type, role, path, label: b.label ?? SHORT[type], note: b.note ?? null, n }
  o.name = b.id ?? (b.label ? plain(b.label) : `${type}${n}`)
  if (b.gain !== undefined && b.loss !== undefined) throw new SpecError(path, 'give gain or loss, not both')
  if (role === 'start' || role === 'sink') {
    for (const k of ['gain', 'loss', 'nf']) if (b[k] !== undefined) throw new SpecError(`${path}.${k}`, `a ${type} has no ${k}; ${role === 'start' ? 'it starts the chain (give its level)' : 'it ends the chain'}`)
    o.g = null; o.nf = null
  } else {
    o.g = b.gain !== undefined ? at('gain', ['dB']) : b.loss !== undefined ? -at('loss', ['dB']) : DEFAULT_LOSS[type] !== undefined ? -DEFAULT_LOSS[type] : null
    if (o.g === null && type === 'amp') throw new SpecError(path, 'an amp needs its gain, like "gain": 20 (dB)')
    if (o.g === null && (type === 'atten' || type === 'cable')) throw new SpecError(path, `a ${type} needs its loss, like "loss": 6 (dB)`)
    // A passive part at 290 K has NF equal to its loss.
    o.nf = b.nf !== undefined ? at('nf', ['dB']) : o.g !== null && o.g <= 0 && type !== 'amp' ? -o.g : null
    if (o.nf !== null && o.nf < 0) throw new SpecError(`${path}.nf`, 'a noise figure is 0 dB or more')
  }
  if (b.level !== undefined) {
    if (role !== 'start') throw new SpecError(`${path}.level`, 'only a source or antenna takes a level (the signal it delivers); the rest are computed')
    o.level = at('level', ['dBm'])
  }
  for (const k of ['p1db', 'ip1db', 'oip3', 'iip3', 'max']) o[k] = at(k, ['dBm'])
  o.rl = at('rl', ['dB'])
  // Filters: a band (pass, below, or above) and the rejection outside it.
  if (b.pass !== undefined || b.below !== undefined || b.above !== undefined || b.stop !== undefined) {
    if (type !== 'filter') throw new SpecError(path, 'pass, below, above, and stop belong to a filter')
    const given = ['pass', 'below', 'above'].filter((k) => b[k] !== undefined)
    if (given.length > 1) throw new SpecError(path, 'give one of pass ([low, high]), below (a low-pass cutoff), or above (a high-pass cutoff)')
    if (b.pass !== undefined) {
      if (!Array.isArray(b.pass) || b.pass.length !== 2) throw new SpecError(`${path}.pass`, 'pass is [low, high], like ["2.4 GHz", "2.5 GHz"]')
      o.band = b.pass.map((v, k) => qty(v, env, `${path}.pass[${k}]`, ['Hz'], diag))
      if (!(o.band[0] < o.band[1])) throw new SpecError(`${path}.pass`, 'pass is [low, high] with low < high')
      o.shape = 'bpf'
    } else if (b.below !== undefined) { o.band = [0, at('below', ['Hz'])]; o.shape = 'lpf' }
    else if (b.above !== undefined) { o.band = [at('above', ['Hz']), Infinity]; o.shape = 'hpf' }
    o.stop = at('stop', ['dB'])
  }
  if (type === 'filter' && !o.shape) o.shape = 'bpf'
  if (type === 'filter' && b.label === undefined) o.label = o.shape.toUpperCase()
  o.disp = o.label ? plain(o.label) : o.name
  // Mixers: the LO frequency, or the IF and the side the LO sits on.
  for (const k of ['lo', 'if', 'inject', 'sweep']) if (b[k] !== undefined && type !== 'mixer') throw new SpecError(`${path}.${k}`, `${k} belongs to a mixer`)
  if (type === 'mixer') {
    o.loF = at('lo', ['Hz']); o.ifF = at('if', ['Hz'])
    if (b.inject !== undefined && b.inject !== 'low' && b.inject !== 'high') throw new SpecError(`${path}.inject`, 'inject is "low" (LO below RF) or "high" (LO above RF)')
    o.inject = b.inject ?? null
    o.sweep = !!b.sweep
  }
  if (b.coupling !== undefined || b.samples !== undefined) {
    if (type !== 'coupler') throw new SpecError(path, 'coupling and samples belong to a coupler')
  }
  if (type === 'coupler') {
    o.coupling = b.coupling !== undefined ? at('coupling', ['dB']) : 20
    if (b.samples !== undefined && b.samples !== 'forward' && b.samples !== 'reflected') throw new SpecError(`${path}.samples`, 'samples is "forward" (the wave going out) or "reflected" (the wave coming back)')
    o.samples = b.samples ?? 'forward'
  }
  if (b.branch !== undefined && type !== 'coupler' && type !== 'splitter') throw new SpecError(`${path}.branch`, 'only a coupler or splitter has a branch (its second output); a mixer takes its LO from "lo"')
  return o
}

function readChain(list, path, env, diag, ids, counter, isBranch) {
  if (!Array.isArray(list) || !list.length) throw new SpecError(path, isBranch ? 'branch is a list of blocks' : 'blocks is a list of blocks, like [{"type": "antenna"}, {"type": "amp", "gain": 20, "nf": 1.5}]')
  return list.map((b, i) => {
    const p = `${path}[${i}]`
    const o = readBlock(b, p, env, diag, ++counter.n)
    if (o.role === 'start' && (i > 0 || isBranch)) throw new SpecError(`${p}.type`, `${o.type === 'antenna' ? 'an' : 'a'} ${o.type} starts the chain; put it first in blocks`)
    if (o.id !== null) {
      if (ids.has(o.id)) throw new SpecError(`${p}.id`, `id "${o.id}" is used twice`)
      ids.add(o.id)
    }
    if (b.branch !== undefined) {
      if (isBranch) throw new SpecError(`${p}.branch`, 'a branch block has no branch of its own')
      o.branch = readChain(b.branch, `${p}.branch`, env, diag, ids, counter, true)
    }
    return o
  })
}

const inBand = (f, band) => f >= band[0] - 1e-9 * Math.abs(f) && f <= band[1] + 1e-9 * Math.abs(f)
const bandText = (s) => (s.shape === 'lpf' ? `below ${hz(s.band[1])}` : s.shape === 'hpf' ? `above ${hz(s.band[0])}` : `${hz(s.band[0])} to ${hz(s.band[1])}`)

/** Read the spec and walk the signal: levels, Friis NF, noise, IP3, limits, and frequency plans. */
export function solve(spec, env, diag) {
  const src = withPreset(spec)
  const ids = new Set(), counter = { n: 0 }
  const main = readChain(src.blocks, src.from === 'blocks' ? 'blocks' : src.from, env, diag, ids, counter, false)
  const start = main[0].role === 'start' ? main[0] : null
  const stages = start ? main.slice(1) : main
  if (!stages.length) throw new SpecError('blocks', 'add the blocks after the source')
  const at = (k, want) => (spec[k] === undefined ? null : qty(spec[k], env, k, want, diag))
  if (src.input !== undefined && start?.level !== undefined) throw new SpecError('input', `give the level once: input or ${start.path}.level`)
  const L0 = src.input !== undefined ? qty(src.input, env, 'input', ['dBm'], diag) : start?.level ?? null
  const f0 = at('f', ['Hz']), B = at('bw', ['Hz']), snrReq = at('snr', ['dB'])
  if (B !== null && !(B > 0)) throw new SpecError('bw', 'bw is the noise bandwidth, like "1 MHz"')
  const kTB = B !== null ? KT + log(B) : null

  const limits = [], plans = []
  const limit = (s, what, level, lim, isIn) => {
    if (level === null || lim === null) return
    const over = level - lim
    limits.push({ s, what, level, lim, over, isIn })
    if (over > 0) {
      const fix = isIn ? `add at least ${dB(over)} of attenuation ahead of it` : 'lower its input (the levels after it assume no compression)'
      diag.warn(s.path, `${s.name} ${isIn ? 'input' : 'output'} is ${dBm(level)}, ${dB(over)} past its ${what} of ${dBm(lim)}; ${fix}`)
    }
  }
  const checkLimits = (s) => {
    limit(s, 'maximum input', s.in.level, s.max, true)
    limit(s, 'input P1dB', s.in.level, s.ip1db, true)
    if (s.out) limit(s, 'P1dB', s.out.level, s.p1db, false)
  }
  const checkBand = (s, f) => {
    if (s.type !== 'filter' || !s.band || f === null) return
    if (!inBand(f, s.band)) diag.warn(s.path, `the signal at ${hz(f)} is outside ${s.name}'s passband (${bandText(s)}); it would be cut, not passed`)
  }

  // The main path.
  const nodes = [{ level: L0, f: f0, G: 0, nf: 0, N: kTB }]
  let L = L0, f = f0, G = 0, F = 1, gOK = true, nfOK = true, nfStop = null, gStop = null
  let ip3Inv = 0, ip3Any = false, ip3OK = true
  let filters = [] // filters since the last mixer, for its image
  for (const s of stages) {
    s.in = { level: L, f }
    s.inNode = nodes[nodes.length - 1]
    checkBand(s, f)
    if (s.type === 'filter' && s.band) filters.push(s)
    // Friis: this stage's excess noise divided by the gain ahead of it.
    if (nfOK) {
      if (s.nf === null || !gOK) { nfOK = false; nfStop = s } else F += (lin(s.nf) - 1) / lin(G)
    }
    if (s.iip3 !== null || s.oip3 !== null) {
      ip3Any = true
      const iip3 = s.iip3 ?? (s.g !== null ? s.oip3 - s.g : null)
      if (iip3 === null || !gOK) ip3OK = false
      else ip3Inv += lin(G) / lin(iip3)
    }
    if (gOK) { if (s.g === null) { gOK = false; gStop = s } else G += s.g }
    L = L !== null && gOK ? L + s.g : null
    if (s.type === 'mixer') {
      const plan = mixPlan(s, f, filters, diag)
      if (plan) plans.push(plan)
      f = plan?.if ?? null
      filters = []
    }
    if (s.role === 'sink') f = null
    s.out = s.role === 'sink' ? null : { level: L, f, G: gOK ? G : null, nf: nfOK && gOK ? log(F) : null }
    if (s.out) s.out.N = kTB !== null && s.out.G !== null && s.out.nf !== null ? kTB + s.out.G + s.out.nf : null
    nodes.push(s.out)
    checkLimits(s)
  }

  // Branches: a splitter's second output, or a coupler's coupled arm (the forward wave, or the wave
  // reflected by the first block downstream with a return loss, back through the same passive path).
  for (const [k, s] of stages.entries()) {
    if (!s.branch) continue
    let bl = null, how = ''
    if (s.type === 'splitter') { bl = s.out?.level ?? null; how = `second output, ${dB(-s.g)} split` }
    else if (s.samples === 'forward') { bl = s.in.level !== null ? s.in.level - s.coupling : null; how = `forward wave − ${dB(s.coupling)}` }
    else {
      let path = 0, ok = true
      const rest = stages.slice(k + 1)
      const r = rest.find((q) => q.rl !== null)
      for (const q of rest) {
        if (q === r) break
        if (q.g === null || q.g > 0 || q.role === 'sink') ok = false
        else path += q.g
      }
      if (r && ok && s.out?.level !== null && s.out) {
        bl = s.out.level + 2 * path - r.rl - s.coupling
        how = `reflected by ${r.name} (RL ${dB(r.rl)})${path ? `, ${dB(-2 * path)} there and back` : ''}, − ${dB(s.coupling)} coupling`
      } else how = r ? 'reflected wave unknown (the path to the reflection has gain or an unknown loss)' : 'reflected wave unknown: give a block downstream its return loss, rl'
    }
    s.branchLevel = bl
    s.branchHow = how
    let Lb = bl
    for (const q of s.branch) {
      q.in = { level: Lb, f: s.out?.f ?? s.in.f }
      checkBand(q, q.in.f)
      Lb = Lb !== null && q.g !== null && q.role !== 'sink' ? Lb + q.g : null
      q.out = q.role === 'sink' ? null : { level: Lb, f: q.in.f }
      checkLimits(q)
    }
  }

  // Totals at the last node where each is known.
  const last = (key) => [...nodes].reverse().find((nd) => nd && nd[key] !== null && nd[key] !== undefined) ?? null
  const gNode = last('G'), nfNode = last('nf'), lvNode = last('level')
  const T = { G: gNode && gNode !== nodes[0] ? gNode.G : null, nf: nfNode && nfNode !== nodes[0] ? nfNode.nf : null, out: lvNode && lvNode !== nodes[0] ? lvNode.level : null }
  if (kTB !== null && T.nf !== null) {
    T.mds = kTB + T.nf
    if (snrReq !== null) T.sens = T.mds + snrReq
    if (L0 !== null) T.snr = L0 - T.mds
  }
  if (ip3Any && ip3OK && ip3Inv > 0) {
    T.iip3 = -log(ip3Inv)
    if (T.G !== null) T.oip3 = T.iip3 + T.G
    if (T.mds !== undefined) T.sfdr = (2 / 3) * (T.iip3 - T.mds)
  }
  return { start, stages, main, nodes, L0, f0, B, kTB, snrReq, T, plans, limits, nfStop, gStop, ip3Any, ip3OK, preset: spec.preset ?? null, caption: src.caption ?? null }
}

/** RF, LO, IF, and the image for a mixer, and whether a filter ahead of it rejects the image. */
function mixPlan(s, rf, filters, diag) {
  if (rf === null) {
    if (s.loF !== null && s.ifF !== null) return { s, rf: null, lo: s.loF, if: s.ifF }
    return s.ifF !== null ? { s, rf: null, lo: null, if: s.ifF } : null
  }
  let lo, iff, inject
  if (s.loF !== null) {
    lo = s.loF; iff = Math.abs(rf - lo); inject = lo > rf ? 'high' : 'low'
    if (s.inject && s.inject !== inject) diag.warn(`${s.path}.inject`, `the LO at ${hz(lo)} is ${inject}-side for RF at ${hz(rf)}, not ${s.inject}-side`)
    if (s.ifF !== null && Math.abs(iff - s.ifF) > 1e-6 * rf) diag.warn(`${s.path}.if`, `|RF − LO| = |${hz(rf)} − ${hz(lo)}| is ${hz(iff)}, not ${hz(s.ifF)}`)
  } else if (s.ifF !== null) {
    iff = s.ifF; inject = s.inject ?? 'low'
    lo = inject === 'high' ? rf + iff : rf - iff
    if (lo <= 0) throw new SpecError(`${s.path}.if`, `an IF of ${hz(iff)} is above RF ${hz(rf)}, so the LO can't sit below RF; use "inject": "high" (LO = RF + IF)`)
  } else return null
  if (iff === 0) diag.warn(s.path, 'RF and LO are the same frequency, so the IF is 0 Hz')
  const image = 2 * lo - rf
  const rejecting = filters.filter((q) => !inBand(image, q.band))
  const passing = filters.filter((q) => inBand(image, q.band))
  const stops = rejecting.filter((q) => q.stop !== null)
  return { s, rf, lo, if: iff, image, inject, filters, rejecting, passing, rejectDb: stops.length ? stops.reduce((a, q) => a + q.stop, 0) : null }
}

/** One line per fact for the summary. */
export function facts(S) {
  const out = []
  const nm = (s) => s.name
  const lv = (x) => (x === null || x === undefined ? '—' : num(x, 1, true))
  const head = [`chain: ${S.stages.length} stages${S.preset ? ` (preset ${S.preset})` : ''}`]
  if (S.f0 !== null) head.push(`f ${hz(S.f0)}`)
  if (S.B !== null) head.push(`B ${hz(S.B)} (kTB ${dBm(S.kTB)})`)
  out.push(head.join(', '))
  if (S.L0 !== null) out.push(`levels (dBm): in ${lv(S.L0)}, ${S.stages.map((s) => `${nm(s)} ${s.out ? lv(s.out.level) : `(in ${lv(s.in.level)})`}`).join(', ')}`)
  out.push(`stages: ${S.stages.map((s) => {
    const p = [`G ${s.g === null ? '—' : num(s.g, 2, true)}`, `NF ${s.nf === null ? '—' : num(s.nf, 2)}`]
    if (s.out?.G !== null && s.out?.G !== undefined) p.push(`ΣG ${num(s.out.G, 2, true)}`)
    if (s.out?.nf !== null && s.out?.nf !== undefined) p.push(`ΣNF ${num(s.out.nf, 2)}`)
    if (s.out?.N !== null && s.out?.N !== undefined) p.push(`N ${num(s.out.N, 1)}`)
    return `${nm(s)} ${p.join(' ')}`
  }).join('; ')}`)
  const T = S.T, tot = []
  if (T.G !== null) tot.push(`gain ${dB(T.G, 2)}`)
  if (T.nf !== null) tot.push(`NF ${dB(T.nf, 2)} (Friis)`)
  if (T.out !== null) tot.push(`output ${dBm(T.out)}`)
  if (T.mds !== undefined) tot.push(`noise floor at the input ${num(T.mds, 2, true)} dBm (MDS)`)
  if (T.snr !== undefined) tot.push(`SNR ${dB(T.snr, 2)}`)
  if (T.sens !== undefined) tot.push(`sensitivity ${num(T.sens, 2, true)} dBm for SNR ${dB(S.snrReq)}`)
  if (T.iip3 !== undefined) tot.push(`IIP3 ${num(T.iip3, 2, true)} dBm${T.oip3 !== undefined ? `, OIP3 ${num(T.oip3, 2, true)} dBm` : ''}${T.sfdr !== undefined ? `, SFDR ${dB(T.sfdr)}` : ''}`)
  if (tot.length) out.push(`cascade: ${tot.join(', ')}`)
  if (S.nfStop && S.nfStop.role !== 'sink') out.push(`NF stops at ${nm(S.nfStop)} (${S.nfStop.nf === null ? 'no nf' : 'unknown gain ahead'})`)
  if (S.gStop && S.gStop.role !== 'sink') out.push(`levels stop at ${nm(S.gStop)} (no gain)`)
  if (S.ip3Any && !S.ip3OK) out.push('IIP3 not computed: a stage with IP3 has an unknown gain ahead of it')
  for (const s of S.stages) if (s.branch) {
    out.push(`${nm(s)} branch: ${s.branchHow}; ${s.branch.map((q) => `${nm(q)} ${q.out ? lv(q.out.level) : `in ${lv(q.in.level)}`} dBm`).join(', ')}`)
  }
  for (const p of S.plans) {
    if (p.rf === null) { out.push(`${nm(p.s)}: ${p.lo !== null ? `LO ${hz(p.lo)}, ` : ''}IF ${hz(p.if)} (give f for the image)`); continue }
    let img
    if (!p.filters.length) img = `no filter ahead of ${nm(p.s)}, so the image is not rejected`
    else if (p.passing.length) img = `inside ${p.passing.map(nm).join(' and ')}'s passband, so it is not rejected`
    else img = `rejected by ${p.rejecting.map(nm).join(' and ')}${p.rejectDb !== null ? ` (${dB(p.rejectDb)})` : ''}`
    out.push(`${nm(p.s)}: RF ${hz(p.rf)}, LO ${hz(p.lo)} (${p.inject}-side${p.s.sweep ? ', swept' : ''}), IF ${hz(p.if)}, image ${hz(p.image)}: ${img}`)
  }
  const over = S.limits.filter((l) => l.over > 0)
  if (over.length) out.push(`compression: ${over.map((l) => `${nm(l.s)} ${l.isIn ? 'input' : 'output'} ${dBm(l.level)} is ${dB(l.over)} past its ${l.what} ${dBm(l.lim)}`).join('; ')}`)
  else if (S.limits.length) {
    const c = S.limits.reduce((a, b) => (b.over > a.over ? b : a))
    out.push(`compression: none; closest ${nm(c.s)}, ${dB(-c.over)} under its ${c.what} ${dBm(c.lim)}`)
  }
  return out
}
