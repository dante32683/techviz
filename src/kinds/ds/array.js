// Arrays: cells with indices, named index markers (i, j, lo, mid, hi), swaps, and the sorted
// part shaded, computed from ops (swap, set, binary search, and four sorts traced pass by
// pass). Stacks and circular queues on an array use the same cells.

import { SpecError } from '../../diag.js'
import { color } from '../../theme.js'
import { Canvas } from '../fbd/draw.js'
import { VAL, IDX, NAME, textW, text, box, arrow, finish } from './draw.js'
import { readOps, index, values, cmp, show, list, val } from './ops.js'

const CELL_H = 28
const MARK_COLORS = ['purple', 'coral', 'teal', 'amber', 'green', 'blue', 'pink']

// ---------------------------------------------------------------- array

const ARRAY_OPS = { swap: 2, set: 2, search: 1, sort: 1 }
const ARRAY_HELP = '"swap 0 3", "set 2 9", "search 42" (binary search), "sort insertion" (bubble, selection, insertion, quick)'

export function simulateArray(spec, diag) {
  const a0 = values(spec, 'array', '[5, 2, 9, 1]')
  const marks0 = readMarks(spec, a0.length)
  const hl0 = (spec.highlight ?? []).map(Number).filter((i) => Number.isInteger(i))
  const states = [{ label: 'start', a: a0, marks: marks0, hl: hl0, done: [], fade: [], swap: null }]
  const log = []
  const ops = readOps(spec, ARRAY_OPS, ARRAY_HELP)
  const detail = !!spec.detail
  let a = [...a0]
  const push = (s) => states.push({ marks: {}, hl: [], done: [], fade: [], swap: null, ...s, a: [...(s.a ?? a)] })
  for (const op of ops) {
    const n = a.length
    if (op.verb === 'swap') {
      const i = index(op.args[0], 0, n - 1, op.path), j = index(op.args[1], 0, n - 1, op.path);
      [a[i], a[j]] = [a[j], a[i]]
      push({ label: op.text, swap: [i, j], hl: [i, j] })
      log.push(`swap ${i} ${j} → ${list(a)}`)
    } else if (op.verb === 'set') {
      const i = index(op.args[0], 0, n - 1, op.path)
      a[i] = val(op.args[1])
      push({ label: op.text, hl: [i] })
      log.push(`set ${i} → ${list(a)}`)
    } else if (op.verb === 'search') {
      const x = val(op.args[0])
      const bad = a.findIndex((v, k) => k > 0 && cmp(a[k - 1], v) > 0)
      if (bad > 0) diag.warn(op.path, `binary search needs a sorted array; a[${bad - 1}] = ${show(a[bad - 1])} > a[${bad}] = ${show(a[bad])}. Sort it first (add "sort insertion" before this op)`)
      let lo = 0, hi = n - 1, probes = [], found = -1
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2), c = cmp(a[mid], x)
        const fade = a.map((_, k) => k).filter((k) => k < lo || k > hi)
        const verdict = c === 0 ? `a[${mid}] = ${show(x)}, found` : c < 0 ? `a[${mid}] = ${show(a[mid])} < ${show(x)}, lo = ${mid + 1}` : `a[${mid}] = ${show(a[mid])} > ${show(x)}, hi = ${mid - 1}`
        push({ label: `search ${show(x)}: lo=${lo} hi=${hi} mid=${mid}; ${verdict}`, marks: { lo, mid, hi }, hl: [mid], fade, done: c === 0 ? [mid] : [] })
        probes.push(`mid=${mid} (${show(a[mid])})`)
        if (c === 0) { found = mid; break }
        if (c < 0) lo = mid + 1
        else hi = mid - 1
      }
      if (found < 0) push({ label: `search ${show(x)}: lo=${lo} > hi=${hi}, not found`, marks: markIn({ lo, hi }, n), fade: a.map((_, k) => k) })
      log.push(`search ${show(x)}: ${probes.join(', ')} → ${found >= 0 ? `found at index ${found}` : 'not found'} in ${probes.length} probe${probes.length === 1 ? '' : 's'}`)
    } else if (op.verb === 'sort') {
      const algo = op.args[0].toLowerCase()
      const run = SORTS[algo]
      if (!run) throw new SpecError(op.path, `unknown sort "${op.args[0]}"; use bubble, selection, insertion, or quick`)
      const r = run(a, (s) => push(s), detail)
      a = r.a
      log.push(`sort ${algo}: ${r.passes.join('; ')}; ${r.cmp} comparisons, ${r.swaps} ${algo === 'insertion' ? 'shifts' : 'swaps'} → ${list(a)}`)
    }
  }
  return { states, log, width: cellWidth(states.map((s) => s.a)) }
}

const markIn = (m, n) => Object.fromEntries(Object.entries(m).filter(([, v]) => v >= 0 && v < n))
const range = (lo, hi) => Array.from({ length: Math.max(0, hi - lo + 1) }, (_, k) => lo + k)

// Each sort pushes one state per pass (with detail, one per swap or shift) and returns the
// passes written out for the summary.
const SORTS = {
  bubble(a0, push, detail) {
    const a = [...a0], n = a.length, passes = []
    let cmps = 0, swaps = 0
    for (let p = 0; p < n - 1; p++) {
      let swapped = 0
      for (let j = 0; j < n - 1 - p; j++) {
        cmps++
        if (cmp(a[j], a[j + 1]) > 0) {
          [a[j], a[j + 1]] = [a[j + 1], a[j]]; swaps++; swapped++
          if (detail) push({ label: `pass ${p + 1}: swap a[${j}], a[${j + 1}]`, a, swap: [j, j + 1], marks: { j }, done: range(n - p, n - 1) })
        }
      }
      const done = swapped ? range(n - 1 - p, n - 1) : range(0, n - 1)
      push({ label: `bubble pass ${p + 1}: ${swapped} swap${swapped === 1 ? '' : 's'}${swapped ? '' : ', sorted'}`, a, done })
      passes.push(`pass ${p + 1} ${list(a)}`)
      if (!swapped) break
    }
    return { a, passes, cmp: cmps, swaps }
  },
  selection(a0, push) {
    const a = [...a0], n = a.length, passes = []
    let cmps = 0, swaps = 0
    for (let i = 0; i < n - 1; i++) {
      let m = i
      for (let j = i + 1; j < n; j++) { cmps++; if (cmp(a[j], a[m]) < 0) m = j }
      const moved = m !== i
      if (moved) { [a[i], a[m]] = [a[m], a[i]]; swaps++ }
      push({ label: `selection i=${i}: min a[${m}] = ${show(a[i])}${moved ? `, swap a[${i}], a[${m}]` : ', in place'}`, a, swap: moved ? [i, m] : null, marks: moved ? { i, min: m } : { i }, done: range(0, i) })
      passes.push(`i=${i} ${list(a)}`)
    }
    return { a, passes, cmp: cmps, swaps }
  },
  insertion(a0, push, detail) {
    const a = [...a0], n = a.length, passes = []
    let cmps = 0, shifts = 0
    for (let i = 1; i < n; i++) {
      const key = a[i]
      let j = i - 1, moved = 0
      while (j >= 0) {
        cmps++
        if (cmp(a[j], key) <= 0) break
        a[j + 1] = a[j]; j--; moved++; shifts++
        if (detail) push({ label: `i=${i}: shift a[${j + 1}] right`, a: a.map((v, k) => (k === j + 1 ? '' : v)), marks: { i, j: j + 1 }, done: range(0, i) })
      }
      a[j + 1] = key
      push({ label: `insertion i=${i}: insert ${show(key)} at ${j + 1}, ${moved} shift${moved === 1 ? '' : 's'}`, a, marks: { i }, hl: [j + 1], done: range(0, i) })
      passes.push(`i=${i} ${list(a)}`)
    }
    return { a, passes, cmp: cmps, swaps: shifts }
  },
  quick(a0, push) {
    // Lomuto partition with the last element as the pivot.
    const a = [...a0], passes = [], fixed = new Set()
    let cmps = 0, swaps = 0
    const sort = (lo, hi) => {
      if (lo > hi) return
      if (lo === hi) { fixed.add(lo); return }
      const pivot = a[hi]
      let i = lo
      for (let j = lo; j < hi; j++) { cmps++; if (cmp(a[j], pivot) < 0) { if (i !== j) { [a[i], a[j]] = [a[j], a[i]]; swaps++ } i++ } }
      if (i !== hi) { [a[i], a[hi]] = [a[hi], a[i]]; swaps++ }
      fixed.add(i)
      push({ label: `quick: partition [${lo}..${hi}], pivot ${show(pivot)} → index ${i}`, a, marks: { lo, hi, p: i }, hl: [i], done: [...fixed], fade: a.map((_, k) => k).filter((k) => k < lo || k > hi) })
      passes.push(`[${lo}..${hi}] pivot ${show(pivot)} → ${i} ${list(a)}`)
      sort(lo, i - 1); sort(i + 1, hi)
    }
    sort(0, a.length - 1)
    return { a, passes, cmp: cmps, swaps }
  },
}

function readMarks(spec, n) {
  const m = spec.pointers ?? {}
  if (typeof m !== 'object' || Array.isArray(m)) throw new SpecError('pointers', 'pointers is an object of name: index, like {"i": 0, "j": 3}')
  const out = {}
  for (const [k, v] of Object.entries(m)) {
    const i = Number(v) < 0 ? n + Number(v) : Number(v)
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new SpecError(`pointers.${k}`, `index ${v} is outside the array (0 to ${n - 1}; negative counts from the end)`)
    out[k] = i
  }
  return out
}

const cellWidth = (arrays) => Math.max(30, ...arrays.flat().map((v) => textW(show(v === '' ? 0 : v), VAL) + 14))

/** Stable marker colors: by first appearance across every state. */
export function markerColors(states) {
  const names = []
  for (const s of states) for (const k of Object.keys(s.marks ?? {})) if (!names.includes(k)) names.push(k)
  return Object.fromEntries(names.map((k, i) => [k, color(MARK_COLORS[i % MARK_COLORS.length])]))
}

/**
 * A horizontal row of cells with indices above and markers below. `cells` are values ('' for
 * empty). Returns the canvas. opts: { width, marks, hl, done, fade, swap, colors, first }.
 */
export function drawRow(theme, cells, o, cv = new Canvas(), [x0, y0] = [0, 0]) {
  const W = o.width, hl = new Set(o.hl ?? []), done = new Set(o.done ?? []), fade = new Set(o.fade ?? [])
  cells.forEach((v, k) => {
    const x = x0 + k * W, on = hl.has(k)
    box(cv, x, y0, W, CELL_H, theme, {
      stroke: on ? theme.highlight : theme.fg, width: on ? 2.2 : 1.3, rx: 0,
      tint: on ? theme.highlight : done.has(k) ? color('green') : undefined, opacity: on ? 0.15 : 0.2,
    })
    if (v !== '' && v !== null && v !== undefined) text(cv, show(v), x + W / 2, y0 + CELL_H / 2 + 4.5, theme, { fill: fade.has(k) ? theme.faint : theme.fg })
    text(cv, String(k + (o.first ?? 0)), x + W / 2, y0 - 5, theme, { size: IDX, fill: theme.muted })
  })
  if (o.swap) {
    const [i, j] = [...o.swap].sort((p, q) => p - q)
    const a = [x0 + i * W + W / 2, y0 - 17], b = [x0 + j * W + W / 2, y0 - 17]
    const lift = Math.min(26, 10 + (j - i) * 4)
    const top = y0 - 17 - lift
    const c = theme.highlight
    arrow(cv, [a, [a[0], top + 4], [b[0], top + 4], b], c, { width: 1.5, r: 8, tag: 'swap' })
    arrow(cv, [b, [b[0], top + 4], [a[0], top + 4], a], c, { width: 1.5, r: 8, tag: 'swap' })
  }
  drawMarkers(cv, theme, o.marks ?? {}, (k) => x0 + k * W + W / 2, y0 + CELL_H, o.colors ?? {})
  return cv
}

/** Marker arrows pointing up at cells, names below; names at one index join with commas. */
function drawMarkers(cv, theme, marks, cx, yb, colors) {
  const at = new Map()
  for (const [name, k] of Object.entries(marks)) at.set(k, [...(at.get(k) ?? []), name])
  const rows = [] // right edge of the last label in each row
  for (const k of [...at.keys()].sort((p, q) => p - q)) {
    const names = at.get(k), label = names.join(','), x = cx(k), w = textW(label, NAME, true)
    let row = rows.findIndex((r) => r < x - w / 2 - 4)
    if (row < 0) { row = rows.length; rows.push(-Infinity) }
    rows[row] = x + w / 2
    const fill = colors[names[0]] ?? theme.fg
    const len = 14 + row * 15
    arrow(cv, [[x, yb + 4 + len], [x, yb + 3]], fill, { width: 1.5, head: 6, tag: 'mark' })
    text(cv, label, x, yb + len + 16, theme, { size: NAME, mono: true, fill })
  }
}

export function drawArray(state, run, theme) {
  const colors = markerColors(run.states)
  return finish(drawRow(theme, state.a, { ...state, width: run.width, colors }))
}

// ---------------------------------------------------------------- stack and queue on an array

export function simulateArrayStack(spec, diag) {
  const items = values(spec, 'stack', '[1, 2, 3]')
  const ops = readOps(spec, { push: 1, pop: 0, peek: 0, top: 0 }, '"push 4", "pop", "peek"')
  const dry = [items.length]
  { let n = items.length; for (const op of ops) { n += op.verb === 'push' ? 1 : op.verb === 'pop' ? -1 : 0; dry.push(Math.max(0, n)) } }
  const cap = spec.capacity ?? Math.max(...dry) + 1
  if (!Number.isInteger(cap) || cap < 1) throw new SpecError('capacity', 'capacity is a whole number of cells')
  if (items.length > cap) throw new SpecError('capacity', `${items.length} items don't fit in capacity ${cap}`)
  const s = [...items], popped = [], log = []
  const states = [{ label: 'start', s: [...s], hl: [] }]
  for (const op of ops) {
    if (op.verb === 'push') {
      if (s.length >= cap) { diag.warn(op.path, `push ${op.args[0]}: overflow, the stack is full (capacity ${cap})`); states.push({ label: `${op.text}: overflow`, s: [...s], hl: [] }); log.push(`${op.text}: overflow`); continue }
      s.push(val(op.args[0]))
      states.push({ label: op.text, s: [...s], hl: [s.length - 1] }); log.push(op.text)
    } else if (op.verb === 'pop') {
      if (!s.length) { diag.warn(op.path, 'pop: underflow, the stack is empty'); states.push({ label: 'pop: underflow', s: [], hl: [] }); log.push('pop: underflow'); continue }
      const v = s.pop(); popped.push(v)
      states.push({ label: `pop → ${show(v)}`, s: [...s], hl: [], gone: s.length }); log.push(`pop → ${show(v)}`)
    } else {
      states.push({ label: `peek → ${s.length ? show(s[s.length - 1]) : 'empty'}`, s: [...s], hl: s.length ? [s.length - 1] : [] }); log.push(`peek → ${s.length ? show(s[s.length - 1]) : 'empty'}`)
    }
  }
  return { states, log, cap, popped, width: Math.max(40, cellWidth(states.map((q) => q.s))) }
}

export function drawArrayStack(state, run, theme) {
  const cv = new Canvas(), W = run.width, H = 26, n = run.cap
  const hl = new Set(state.hl)
  for (let k = 0; k < n; k++) {
    const y = (n - 1 - k) * H, on = hl.has(k)
    box(cv, 0, y, W, H, theme, { rx: 0, stroke: on ? theme.highlight : theme.fg, width: on ? 2.2 : 1.3, tint: on ? theme.highlight : undefined, opacity: 0.15 })
    if (k < state.s.length) text(cv, show(state.s[k]), W / 2, y + H / 2 + 4.5, theme)
    text(cv, String(k), -6, y + H / 2 + 3.5, theme, { size: IDX, fill: theme.muted, anchor: 'end' })
  }
  const top = state.s.length - 1, c = color('purple')
  const y = top >= 0 ? (n - 1 - top) * H + H / 2 : n * H + 8
  arrow(cv, [[W + 26, y], [W + 3, y]], c, { width: 1.5, head: 6 })
  text(cv, top >= 0 ? 'top' : 'top = -1', W + 30, y + 4, theme, { size: NAME, mono: true, fill: c, anchor: 'start' })
  return finish(cv)
}

export function simulateArrayQueue(spec, diag) {
  const items = values(spec, 'queue', '[1, 2, 3]')
  const ops = readOps(spec, { enqueue: 1, dequeue: 0, push: 1, pop: 0 }, '"enqueue 4", "dequeue"')
  const dry = [items.length]
  { let n = items.length; for (const op of ops) { n += op.verb === 'enqueue' || op.verb === 'push' ? 1 : -1; dry.push(Math.max(0, n)) } }
  const cap = spec.capacity ?? Math.max(...dry) + 1
  if (!Number.isInteger(cap) || cap < 1) throw new SpecError('capacity', 'capacity is a whole number of cells')
  if (items.length > cap) throw new SpecError('capacity', `${items.length} items don't fit in capacity ${cap}`)
  const cells = Array.from({ length: cap }, (_, k) => (k < items.length ? items[k] : ''))
  let front = 0, count = items.length
  const out = [], log = []
  const snap = (label, hl = []) => ({ label, cells: [...cells], front, count, hl })
  const states = [snap('start')]
  for (const op of ops) {
    if (op.verb === 'enqueue' || op.verb === 'push') {
      if (count === cap) { diag.warn(op.path, `${op.text}: overflow, the queue is full (capacity ${cap})`); states.push(snap(`${op.text}: overflow`)); log.push(`${op.text}: overflow`); continue }
      const r = (front + count) % cap
      cells[r] = val(op.args[0]); count++
      states.push(snap(op.text, [r])); log.push(`${op.text} at [${r}]`)
    } else {
      if (!count) { diag.warn(op.path, 'dequeue: underflow, the queue is empty'); states.push(snap('dequeue: underflow')); log.push('dequeue: underflow'); continue }
      const v = cells[front], from = front
      cells[front] = ''; out.push(v)
      front = (front + 1) % cap; count--
      states.push(snap(`dequeue → ${show(v)}`)); log.push(`dequeue → ${show(v)} from [${from}]`)
    }
  }
  return { states, log, cap, out, width: cellWidth(states.map((q) => q.cells)) }
}

export function drawArrayQueue(state, run, theme) {
  const { cap } = run, rear = (state.front + state.count - 1) % cap
  const marks = state.count ? { front: state.front, rear } : { front: state.front }
  const colors = { front: color('purple'), rear: color('coral') }
  return finish(drawRow(theme, state.cells, { width: run.width, marks, hl: state.hl, colors }))
}

export const queueFacts = (state, cap) => {
  const items = Array.from({ length: state.count }, (_, k) => state.cells[(state.front + k) % cap])
  return { items, rear: state.count ? (state.front + state.count - 1) % cap : null }
}
