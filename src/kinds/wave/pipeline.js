// Pipeline diagrams: one row per instruction, one column per cycle, a box per
// stage. Scheduling is in order with one instruction per stage: an instruction
// can't enter a stage until the one ahead has left it, so a stall holds every
// instruction behind it. Forwarding arrows are checked against the timing.

import { el, esc } from '../../svg.js'
import { labelSvg, measure } from '../../label.js'
import { color } from '../../theme.js'
import { SpecError } from '../../diag.js'

const DEFAULT_STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB']

/** Cycle ranges per stage for each row: [{ stage, from, to }] (1-based cycles, inclusive). */
export function schedule(rows, stages, diag) {
  const prev = { enter: null, leave: null }
  const out = []
  rows.forEach((r, i) => {
    const path = `pipeline[${i}]`
    if (!r || typeof r !== 'object') throw new SpecError(path, 'each row is {"instr": "add x1, x2, x3"} with optional id, stall, flush, start')
    const stall = typeof r.stall === 'number' ? { [stages[1] ?? stages[0]]: r.stall } : r.stall ?? {}
    if (typeof stall !== 'object') throw new SpecError(`${path}.stall`, 'stall is a number of cycles (held in ID) or {"ID": 1}')
    for (const [st, n] of Object.entries(stall)) {
      if (!stages.includes(st)) throw new SpecError(`${path}.stall.${st}`, `no stage "${st}"; stages are ${stages.join(', ')}`)
      if (!(Number.isInteger(n) && n >= 0)) throw new SpecError(`${path}.stall.${st}`, 'stall cycles are a whole number')
    }
    let last = stages.length - 1
    if (r.flush !== undefined) {
      last = stages.indexOf(r.flush)
      if (last < 0) throw new SpecError(`${path}.flush`, `no stage "${r.flush}"; flush names the last stage the instruction reaches`)
    }
    const enter = [], leave = []
    for (let s = 0; s <= last; s++) {
      let t = s === 0 ? (r.start ?? (prev.enter ? prev.enter[0] + 1 : 1)) : leave[s - 1] + 1
      if (s === 0 && r.start !== undefined && !(Number.isInteger(r.start) && r.start >= 1)) throw new SpecError(`${path}.start`, 'start is the cycle (from 1) the instruction enters the first stage')
      if (prev.leave && prev.leave[s] !== undefined) t = Math.max(t, prev.leave[s] + 1)
      if (s > 0) leave[s - 1] = t - 1 // held in the stage before while this one was busy
      enter[s] = t
      leave[s] = t + (stall[stages[s]] ?? 0)
    }
    if (r.start !== undefined && prev.enter && r.start <= prev.enter[0]) diag.warn(`${path}.start`, `starts in cycle ${r.start}, not after the instruction above (cycle ${prev.enter[0]})`)
    // Recompute the held stages' first cycles: a stage starts where the one before ended.
    const cells = []
    for (let s = 0; s <= last; s++) {
      const from = s === 0 ? enter[0] : leave[s - 1] + 1
      cells.push({ stage: stages[s], from, to: leave[s] })
    }
    out.push({ r, cells, flushed: r.flush !== undefined })
    prev.enter = cells.map((c) => c.from)
    prev.leave = cells.map((c) => c.to)
  })
  return out
}

export function renderPipeline(spec, { theme, diag, uid }) {
  const stages = spec.stages ?? DEFAULT_STAGES
  if (!Array.isArray(stages) || !stages.length || stages.some((s) => typeof s !== 'string')) throw new SpecError('stages', 'stages is a list of names like ["IF", "ID", "EX", "MEM", "WB"]')
  const rows = spec.pipeline
  if (!Array.isArray(rows) || !rows.length) throw new SpecError('pipeline', 'pipeline is a list of rows like {"instr": "lw x1, 0(x2)"}')
  const sched = schedule(rows, stages, diag)
  const ids = new Map()
  sched.forEach((row, i) => { if (row.r.id !== undefined) ids.set(String(row.r.id), i) })
  const cycles = Math.max(...sched.flatMap((row) => row.cells.map((c) => c.to)))
  const hl = new Set((spec.highlight ?? []).map(String))
  const cur = typeof spec.cycle === 'number' ? spec.cycle : null

  const fs = theme.size
  const monoW = (s) => String(s).length * fs * 0.6
  const labW = Math.max(...rows.map((r) => monoW(r.instr ?? r.id ?? ''))) + 16
  const cw = Math.max(40, ...stages.map((s) => measure(s, fs - 1) + 14))
  const rh = 28, ch = 20, top = 30, M = 12
  const L = M + labW
  const X = (cyc) => L + (cyc - 1) * cw
  const Yr = (i) => top + i * rh
  const W = L + cycles * cw + M
  const H = top + rows.length * rh + M - (rh - ch) / 2
  const parts = []

  // Cycle columns: light separators and numbers.
  if (cur !== null && cur >= 1 && cur <= cycles) parts.push(el('rect', { x: X(cur), y: top - 22, width: cw, height: rows.length * rh + 22, fill: theme.highlight, 'fill-opacity': 0.08 }))
  for (let c = 1; c <= cycles + 1; c++) parts.push(el('line', { x1: X(c), y1: top - 6, x2: X(c), y2: top + rows.length * rh - (rh - ch) / 2, stroke: theme.grid, 'stroke-width': 1 }))
  for (let c = 1; c <= cycles; c++) parts.push(labelSvg(String(c), X(c) + cw / 2, top - 12, theme, { size: fs - 1, fill: c === cur ? theme.fg : theme.muted, weight: c === cur ? 'bold' : undefined }))

  const stageColor = (s) => color(stages.indexOf(s))
  sched.forEach((row, i) => {
    const y = Yr(i)
    const on = row.r.id !== undefined && hl.has(String(row.r.id))
    const txt = row.r.instr ?? row.r.id ?? ''
    parts.push(el('text', { x: M, y: y + ch / 2 + fs * 0.35, 'font-family': theme.mono, 'font-size': fs, fill: on ? theme.highlight : row.flushed ? theme.muted : theme.fg, 'font-weight': on ? 'bold' : undefined }, esc(txt)))
    for (const c of row.cells) {
      for (let t = c.from; t <= c.to; t++) {
        const held = t < c.to // a stall: the stage repeats until its last cycle
        const future = cur !== null && t > cur
        const col = stageColor(c.stage)
        const x = X(t) + 2, w = cw - 4
        const dashed = held || row.flushed
        parts.push(el('rect', {
          x, y, width: w, height: ch, rx: 3,
          fill: dashed ? 'none' : col, 'fill-opacity': dashed ? undefined : future ? 0.06 : 0.2,
          stroke: on ? theme.highlight : dashed ? theme.muted : col, 'stroke-width': on ? 2 : 1,
          'stroke-dasharray': dashed ? '3 2' : undefined, 'stroke-opacity': future ? 0.35 : undefined,
        }))
        parts.push(labelSvg(`\\text{${c.stage}}`, x + w / 2, y + ch / 2, theme, { size: fs - 1, middle: true, fill: future ? theme.faint : dashed ? theme.muted : theme.fg }))
      }
    }
    if (row.flushed) {
      const end = row.cells[row.cells.length - 1].to + 1
      parts.push(el('line', { x1: X(row.cells[0].from) + 2, y1: y + ch / 2, x2: X(end) - 2, y2: y + ch / 2, stroke: theme.muted, 'stroke-width': 1 }))
    }
  })

  // Forwarding: from the end of the producer's stage to the start of the consumer's.
  const fwd = spec.forward ?? []
  if (!Array.isArray(fwd)) throw new SpecError('forward', 'forward is a list like {"from": "i1.MEM", "to": "i2.EX"}')
  const notes = []
  const at = (ref, path) => {
    const m = /^(.+)\.([^.]+)$/.exec(String(ref ?? ''))
    if (!m) throw new SpecError(path, `write "rowId.STAGE", like "i1.EX"`)
    if (!ids.has(m[1])) throw new SpecError(path, `no row with id "${m[1]}"; give the row an "id"`)
    const i = ids.get(m[1])
    const cell = sched[i].cells.find((c) => c.stage === m[2])
    if (!cell) throw new SpecError(path, `row "${m[1]}" has no stage "${m[2]}"${sched[i].flushed ? ' (it was flushed)' : ''}`)
    return { i, cell, name: ref }
  }
  const arrowId = `${uid}-fwd`
  const fc = color('coral')
  fwd.forEach((f, k) => {
    const a = at(f.from, `forward[${k}].from`), b = at(f.to, `forward[${k}].to`)
    const ready = a.cell.to, need = b.cell.to
    const ok = ready < need
    if (!ok) diag.warn(`forward[${k}]`, `${f.from} ends in cycle ${ready} but ${f.to} runs in cycle ${need}: the value isn't ready in time; stall the consumer${b.i > a.i ? ` (add "stall" to row ${b.i})` : ''}`)
    notes.push(`${f.from}(c${ready})→${f.to}(c${need})${ok ? '' : ' LATE'}`)
    const on = f.id !== undefined && hl.has(String(f.id))
    // Down from the producer's box, then right into the consumer's box.
    const x1 = X(ready) + cw * 0.62, y1 = Yr(a.i) + ch
    const x2 = X(need) + 2, y2 = Yr(b.i) + ch / 2
    parts.push(el('path', {
      d: `M${x1} ${y1}C${x1} ${y2} ${x1} ${y2} ${x2} ${y2}`,
      fill: 'none', stroke: on ? theme.highlight : fc, 'stroke-width': on ? 2.4 : 1.6, 'marker-end': `url(#${on ? arrowId + 'h' : arrowId})`,
    }))
  })
  const marker = (id, c) => el('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto' }, [el('path', { d: 'M0 0L10 5L0 10z', fill: c })])
  const defs = fwd.length ? marker(arrowId, fc) + marker(arrowId + 'h', theme.highlight) : ''

  const lines = sched.map((row) => {
    const name = row.r.id ?? row.r.instr
    const cells = row.cells.map((c) => `${c.stage}${c.from === c.to ? c.from : `${c.from}-${c.to}(stall ${c.to - c.from})`}`)
    return `${name}: ${cells.join(' ')}${row.flushed ? ' flushed' : ''}`
  })
  const stallCycles = sched.reduce((n, row) => n + row.cells.reduce((m, c) => m + c.to - c.from, 0), 0)
  const summary = `pipeline: ${rows.length} instructions, ${cycles} cycles, ${stallCycles} stall cycles; ${lines.join('; ')}${notes.length ? `; forward ${notes.join(', ')}` : ''}`
  return { body: el('g', {}, parts), width: W, height: H, defs, summary, alt: 'pipeline diagram' }
}
