// Hash tables: separate chaining or open addressing (linear, quadratic, or double hashing) with
// a hash function written as an expression in k. Every insert, delete, and find records its
// home index and probe sequence; the table is drawn as a column of buckets.

import { SpecError } from '../../diag.js'
import { compileFor, ExprError } from '../../expr.js'
import { color } from '../../theme.js'
import { el } from '../../svg.js'
import { Canvas } from '../fbd/draw.js'
import { VAL, IDX, textW, text, box, slash, dot, arrow, finish } from './draw.js'
import { readOps, show } from './ops.js'

const CH = 24 // cell height
const PROBES = ['chain', 'linear', 'quadratic', 'double']

/** "k mod 7" and "k % 7" become mod(k, 7) for the expression language. */
const modForm = (s) => {
  let t = String(s), prev
  do { prev = t; t = t.replace(/([A-Za-z0-9_.]+|\([^()]*\))\s*(?:\bmod\b|%)\s*([A-Za-z0-9_.]+|\([^()]*\))/, 'mod($1, $2)') } while (t !== prev)
  return t
}

function hashFn(src, path, m) {
  try {
    const { fn } = compileFor(modForm(src), ['k', 'm'])
    return (k) => fn({ k, m })
  } catch (err) {
    if (err instanceof ExprError) throw new SpecError(path, `${err.message} (write it in k, like "k mod ${m}" or "3k + 1"; the result is taken mod m)`)
    throw err
  }
}

export function simulateHash(spec, diag) {
  const m = spec.m
  if (!Number.isInteger(m) || m < 1) throw new SpecError('m', 'm is the table size, a whole number like 7 or 11')
  const probe = spec.probe ?? 'chain'
  if (!PROBES.includes(probe)) throw new SpecError('probe', `probe is ${PROBES.join(', ')}`)
  const hsrc = spec.h ?? 'k mod m'
  const h = hashFn(hsrc, 'h', m)
  let h2 = null
  if (probe === 'double') {
    if (spec.h2 === undefined) throw new SpecError('h2', 'double hashing needs h2, the step size, like "7 - k mod 7"')
    h2 = hashFn(spec.h2, 'h2', m)
  } else if (spec.h2 !== undefined) diag.warn('h2', 'h2 is only used with "probe": "double"')
  const home = (k) => ((Math.round(h(k)) % m) + m) % m
  const at = (k, i) => {
    const b = home(k)
    if (probe === 'linear') return (b + i) % m
    if (probe === 'quadratic') return (b + i * i) % m
    return (((b + i * Math.round(h2(k))) % m) + m) % m
  }
  const chain = probe === 'chain'
  const table = chain ? Array.from({ length: m }, () => []) : Array(m).fill(null)
  const DEL = { del: true }
  const states = [], log = []
  const snap = (label, extra = {}) => ({ label, table: chain ? table.map((b) => [...b]) : [...table], probes: [], hl: [], ...extra })
  let n = 0

  const insert = (k, path) => {
    if (typeof k !== 'number' || !Number.isInteger(k)) throw new SpecError(path, `hash keys are whole numbers; "${k}" isn't one`)
    const b = home(k)
    if (chain) {
      if (table[b].some((x) => x === k)) { diag.warn(path, `${k} is already in bucket ${b}`); return { text: `insert ${k}: h = ${b}, already there`, probes: [b], hl: [] } }
      table[b].push(k); n++
      return { text: `insert ${k}: h = ${b}${table[b].length > 1 ? `, chain length ${table[b].length}` : ''}`, probes: [b], hl: [b], key: k }
    }
    if (probe === 'double' && Math.round(h2(k)) % m === 0) diag.warn(path, `h2(${k}) is a multiple of m = ${m}, so its probes never move; pick h2 so it's never 0 mod m`)
    const seq = []
    for (let i = 0; i < m; i++) {
      const j = at(k, i)
      seq.push(j)
      if (table[j] === k) { diag.warn(path, `${k} is already at index ${j}`); return { text: `insert ${k}: already at ${j}`, probes: seq, hl: [] } }
      if (table[j] === null || table[j] === DEL) {
        table[j] = k; n++
        return { text: `insert ${k}: h = ${b}, probes ${seq.join(', ')}${seq.length > 1 ? ` (${seq.length - 1} collision${seq.length > 2 ? 's' : ''})` : ''}`, probes: seq, hl: [j], key: k }
      }
    }
    diag.warn(path, `insert ${k}: no free slot after ${m} probes (${n === m ? 'the table is full' : 'this probe sequence misses the free slots; with quadratic probing keep the load factor at most 0.5 and m prime'})`)
    return { text: `insert ${k}: no free slot, probes ${seq.join(', ')}`, probes: seq, hl: [] }
  }
  // Find (and with del, delete) k: the probe sequence and where it ends.
  const find = (k, del) => {
    const b = home(k)
    if (chain) {
      const i = table[b].findIndex((x) => x === k)
      if (i >= 0 && del) { table[b].splice(i, 1); n-- }
      return { text: `${del ? 'delete' : 'find'} ${k}: h = ${b}, ${i < 0 ? 'not found' : del ? 'removed from the chain' : `found at position ${i} of the chain`}`, probes: [b], hl: i >= 0 && !del ? [b] : [], key: k, found: i >= 0 }
    }
    const seq = []
    for (let i = 0; i < m; i++) {
      const j = at(k, i)
      seq.push(j)
      if (table[j] === null) break
      if (table[j] === k) {
        if (del) { table[j] = DEL; n-- }
        return { text: `${del ? 'delete' : 'find'} ${k}: probes ${seq.join(', ')}, ${del ? `marked deleted at ${j}` : `found at ${j}`}`, probes: seq, hl: [j], key: k, found: true }
      }
    }
    return { text: `${del ? 'delete' : 'find'} ${k}: probes ${seq.join(', ')}, not found`, probes: seq, hl: [], key: k, found: false }
  }

  if (!Array.isArray(spec.hash)) throw new SpecError('hash', 'hash is the list of keys inserted in order, like [18, 41, 22]')
  spec.hash.forEach((k, i) => log.push(insert(k, `hash[${i}]`).text))
  states.push(snap('start'))
  for (const op of readOps(spec, { insert: 1, delete: 1, find: 1 }, '"insert 44", "delete 18", "find 22"')) {
    const k = Number(op.args[0])
    let r
    if (op.verb === 'insert') r = insert(Number.isFinite(k) ? k : op.args[0], op.path)
    else {
      if (!Number.isInteger(k)) throw new SpecError(op.path, `hash keys are whole numbers; "${op.args[0]}" isn't one`)
      r = find(k, op.verb === 'delete')
      if (!r.found && op.verb === 'delete') diag.warn(op.path, `${k} is not in the table; nothing deleted`)
    }
    log.push(r.text)
    states.push(snap(r.text, { probes: r.probes, hl: r.hl, key: r.key }))
  }
  const keysEver = [...spec.hash, ...(spec.ops ?? []).map((o) => String(o).split(/\s+/)[1])]
  const width = Math.max(32, ...keysEver.map((k) => textW(show(k), VAL) + 14))
  return { states, log, m, probe, hsrc, h2src: spec.h2, width, DEL, count: () => n }
}

export function hashFacts(state, run) {
  const n = run.probe === 'chain' ? state.table.reduce((s, b) => s + b.length, 0) : state.table.filter((x) => x !== null && !x.del).length
  const cells = state.table.map((x, i) => `[${i}] ${run.probe === 'chain' ? (x.length ? x.join('→') : '-') : x === null ? '-' : x.del ? 'DEL' : x}`)
  return [`n = ${n}, load factor ${(n / run.m).toFixed(2)}`, cells.join(', ')]
}

export function drawHash(state, run, theme) {
  const cv = new Canvas(), m = run.m
  const hl = new Set(state.hl), probed = new Set(state.probes)
  const amber = color('amber')
  if (run.probe === 'chain') {
    const BW = 22, NW = run.width + 16, G = 22, CH = 28
    for (let i = 0; i < m; i++) {
      const y = i * CH, on = hl.has(i), pr = probed.has(i) && !on
      box(cv, 0, y, BW, CH, theme, { rx: 0, stroke: on ? theme.highlight : pr ? amber : theme.fg, width: on || pr ? 2 : 1.3 })
      text(cv, String(i), -6, y + CH / 2 + 3.5, theme, { size: IDX, fill: theme.muted, anchor: 'end' })
      const b = state.table[i]
      if (!b.length) { slash(cv, 0, y, BW, CH, theme.fg); continue }
      dot(cv, [BW / 2, y + CH / 2], theme.fg)
      b.forEach((k, j) => {
        const x = BW + G + j * (NW + G), isKey = k === state.key && on
        if (j === 0) arrow(cv, [[BW / 2, y + CH / 2], [x - 1, y + CH / 2]], theme.fg)
        box(cv, x, y + 3, NW, CH - 6, theme, { stroke: isKey ? theme.highlight : theme.fg, width: isKey ? 2.2 : 1.3, tint: isKey ? theme.highlight : undefined, opacity: 0.15 })
        cv.mid.push(el('line', { x1: x + NW - 16, y1: y + 3, x2: x + NW - 16, y2: y + CH - 3, stroke: isKey ? theme.highlight : theme.fg, 'stroke-width': 1.1 }))
        text(cv, show(k), x + (NW - 16) / 2, y + CH / 2 + 4.5, theme)
        if (j === b.length - 1) slash(cv, x + NW - 16, y + 3, 16, CH - 6, theme.fg)
        else { dot(cv, [x + NW - 8, y + CH / 2], theme.fg); arrow(cv, [[x + NW - 8, y + CH / 2], [x + NW + G - 1, y + CH / 2]], theme.fg) }
      })
    }
    return finish(cv)
  }
  const W = run.width
  for (let i = 0; i < m; i++) {
    const y = i * CH, x = state.table[i], on = hl.has(i), pr = probed.has(i) && !on
    box(cv, 0, y, W, CH, theme, { rx: 0, stroke: on ? theme.highlight : pr ? amber : theme.fg, width: on || pr ? 2 : 1.3, tint: on ? theme.highlight : pr ? amber : undefined, opacity: 0.15 })
    text(cv, String(i), -6, y + CH / 2 + 3.5, theme, { size: IDX, fill: theme.muted, anchor: 'end' })
    if (x !== null) text(cv, x.del ? 'DEL' : show(x), W / 2, y + CH / 2 + 4.5, theme, { size: x.del ? IDX : VAL, fill: x.del ? theme.muted : theme.fg })
  }
  // The probe sequence as hops down the right side, one lane per hop so they never overlap.
  const seq = state.probes
  for (let s = 1; s < seq.length; s++) {
    const a = seq[s - 1], b = seq[s], xr = W + 8 + 7 * ((s - 1) % 3)
    const ya = a * CH + CH / 2, yb = b * CH + CH / 2
    arrow(cv, [[W + 2, ya], [xr + 6, ya], [xr + 6, yb], [W + 3, yb]], amber, { width: 1.5, head: 6, r: 4 })
  }
  return finish(cv)
}
