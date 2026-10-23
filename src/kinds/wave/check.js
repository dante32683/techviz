// WaveJSON checks and the per-cycle summary Claude reads to verify a timing
// diagram against its own reasoning.

import { SpecError } from '../../diag.js'

const WAVE_CHARS = 'pPnNlLhH01xXzud=23456789.|<>'
const CLOCK = new Set(['p', 'P', 'n', 'N'])
const VALUE = /[=2-9]/

/** Signals in drawing order, with their spec paths; groups are ["name", ...items]. */
export function flatten(list) {
  if (!Array.isArray(list)) throw new SpecError('signal', 'signal is a list of {name, wave} objects (groups are ["name", ...signals])')
  const out = []
  const walk = (s, path, group) => {
    if (Array.isArray(s)) {
      const name = typeof s[0] === 'string' ? s[0] : ''
      s.forEach((x, j) => { if (!(j === 0 && name)) walk(x, `${path}[${j}]`, group ? `${group}.${name}` : name) })
    } else if (s && typeof s === 'object' && s.wave !== undefined) out.push({ s, path, group })
  }
  list.forEach((s, i) => walk(s, `signal[${i}]`, ''))
  return out
}

/** Values per cycle, one token per cycle: 0 1 x z u d, a data label, or the clock letter. */
function timeline(sig) {
  const period = sig.period ?? 1
  const data = typeof sig.data === 'string' ? sig.data.trim().split(/\s+/) : Array.isArray(sig.data) ? sig.data.map(String) : []
  let k = 0, prev = 'x'
  const cells = []
  for (const ch of sig.wave) {
    if (ch === '<' || ch === '>') continue
    let v
    if (ch === '.' || ch === '|') v = prev
    else if (VALUE.test(ch)) v = data[k++] ?? '?'
    else if (ch === 'h' || ch === 'H') v = '1'
    else if (ch === 'l' || ch === 'L') v = '0'
    else if (ch === 'X') v = 'x'
    else v = ch
    prev = v
    for (let r = 0; r < period; r++) cells.push(v)
  }
  // Sample each cycle at its start; a phase shifts the wave left by that many cycles.
  const phase = Math.max(0, Number(sig.phase) || 0)
  const out = []
  for (let k = 0; Math.floor(k + phase) < cells.length; k++) out.push(cells[Math.floor(k + phase)])
  return { cells: out, span: cells.length - phase }
}

const rle = (cells) => {
  const out = []
  for (const v of cells) {
    const last = out[out.length - 1]
    if (last && last.v === v) last.n++
    else out.push({ v, n: 1 })
  }
  return out.map(({ v, n }) => (n > 1 ? `${v}×${n}` : v)).join(', ')
}

/** Validate signals; returns { cycles, summary }. */
export function checkSignals(spec, diag) {
  const sigs = flatten(spec.signal)
  const lens = []
  const nodes = new Set()
  for (const { s, path } of sigs) {
    const name = s.name ?? '(unnamed)'
    if (typeof s.wave !== 'string') throw new SpecError(`${path}.wave`, `the wave of "${name}" must be a string like "01.x=."`)
    for (const [i, ch] of [...s.wave].entries()) {
      if (!WAVE_CHARS.includes(ch)) throw new SpecError(`${path}.wave`, `"${name}" has "${ch}" at position ${i}; wave characters are p n P N (clocks), 0 1 l h L H, x z u d, = and 2-9 (data), . (hold), | (gap)`)
    }
    if (s.period !== undefined && !(Number.isInteger(s.period) && s.period > 0)) diag.warn(`${path}.period`, `the period of "${name}" should be a positive whole number`)
    const slots = [...s.wave].filter((c) => VALUE.test(c)).length
    const data = typeof s.data === 'string' ? s.data.trim().split(/\s+/).filter(Boolean) : Array.isArray(s.data) ? s.data : []
    if (s.data !== undefined && typeof s.data !== 'string' && !Array.isArray(s.data)) diag.warn(`${path}.data`, 'data is a list of labels or a space-separated string')
    else if (slots !== data.length && (slots || data.length)) {
      diag.warn(`${path}.data`, `"${name}" has ${slots} data slot${slots === 1 ? '' : 's'} (= or 2-9 in the wave) but ${data.length} data label${data.length === 1 ? '' : 's'}`)
    }
    if (typeof s.node === 'string') for (const c of s.node) if (c !== '.') nodes.add(c)
    lens.push({ name, path, n: timeline(s).span })
  }
  const hb = spec.config?.hbounds
  const longest = Math.max(0, ...lens.map((l) => l.n))
  const cycles = Array.isArray(hb) && hb.length === 2 ? Math.floor(hb[1] - hb[0]) : Math.floor(longest)
  if (!Array.isArray(hb)) {
    for (const l of lens) if (longest - l.n >= 1) diag.warn(`${l.path}.wave`, `"${l.name}" spans ${l.n} cycles but the longest signal spans ${longest}; pad it with "." so the lanes line up`)
  }
  for (const [i, e] of (spec.edge ?? []).entries()) {
    const m = /^\s*(\S)\S*?(\S)(\s|$)/.exec(String(e))
    if (!m) { diag.warn(`edge[${i}]`, 'an edge looks like "a~>b label" with node letters from a signal\'s "node" string'); continue }
    for (const c of [m[1], m[2]]) if (!nodes.has(c)) diag.warn(`edge[${i}]`, `node "${c}" is not in any signal's "node" string`)
  }
  const parts = sigs.map(({ s, group }) => {
    const name = (group ? group + '.' : '') + (s.name ?? '?')
    const skip = Array.isArray(hb) ? Math.max(0, Math.floor(hb[0])) : 0
    const cells = timeline(s).cells.slice(skip, skip + cycles)
    if (cells.length && cells.every((c) => CLOCK.has(c))) return `${name}=clock(${s.wave[0]}${(s.period ?? 1) > 1 ? `, period ${s.period}` : ''})`
    return `${name}=[${rle(cells)}]`
  })
  return { cycles, summary: `wave: ${cycles} cycles, ${sigs.length} signals; ${parts.join('; ')}` }
}

/** Validate a reg bitfield; returns the summary (fields MSB first). */
export function checkReg(spec, diag) {
  if (!Array.isArray(spec.reg)) throw new SpecError('reg', 'reg is a list of fields {bits, name, attr, type}, LSB first')
  let lsb = 0
  const fields = []
  spec.reg.forEach((f, i) => {
    const p = `reg[${i}]`
    if (!f || !Number.isInteger(f.bits) || f.bits <= 0) throw new SpecError(`${p}.bits`, 'each field needs "bits", a positive whole number')
    const msb = lsb + f.bits - 1
    if (typeof f.attr === 'string' && /^[01]+$/.test(f.attr) && f.attr.length !== f.bits) diag.warn(`${p}.attr`, `"${f.name ?? 'field'}" is ${f.bits} bits but attr "${f.attr}" has ${f.attr.length} digits`)
    fields.push(`${msb === lsb ? `[${msb}]` : `[${msb}:${lsb}]`} ${f.name ?? '-'}${f.attr !== undefined ? `=${Array.isArray(f.attr) ? f.attr.join('/') : f.attr}` : ''}`)
    lsb = msb + 1
  })
  const bits = spec.config?.bits
  if (bits !== undefined && bits !== lsb) diag.warn('config.bits', `config.bits is ${bits} but the fields add up to ${lsb}`)
  return { bits: lsb, summary: `reg: ${lsb} bits; ${fields.reverse().join(', ')}` }
}
