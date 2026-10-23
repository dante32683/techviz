// memory: stack, heap, and globals with pointer arrows, Python-Tutor style,
// for teaching C and C++. Stack frames are boxes of variables (newest on top);
// heap blocks sit in columns to the right, one column per level of pointer
// indirection, aligned with what points at them. Pointers hold addresses:
// with "addresses": "auto" each item gets a plausible address and a pointer's
// box shows its target's address. Arrows are routed orthogonally around boxes.

import { el } from '../svg.js'
import { labelSvg, measure } from '../label.js'
import { color } from '../theme.js'
import { SpecError } from '../diag.js'
import { typeInfo, structLayout, ABI_NAMES } from './memory/ctype.js'
import { Router, roundedPath } from './memory/route.js'

const raw = (s) => [{ text: String(s), shift: 0 }]
const MONO = 0.55
const monoW = (s, size) => String(s).length * size * MONO
const sansW = (s, size) => measure(raw(s), size)
// SVG collapses runs of spaces; non-breaking spaces keep code indentation.
const mono = (s, x, y, theme, o = {}) => labelSvg(raw(String(s).replace(/ /g, '\u00a0')), x, y, theme, { mono: true, ...o })
const sans = (s, x, y, theme, o = {}) => labelSvg(raw(s), x, y, theme, o)
const hex = (n) => '0x' + n.toString(16)
// resvg ignores orient="auto-start-reverse" (the core arrowMarker), so arrows that
// end pointing up or left need a plain orient="auto" marker.
const marker = (id, fill) => el('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, [el('path', { d: 'M0 0L10 5L0 10z', fill })])

// Vertical metrics.
const NAME_H = 18, BOX_H = 28, IDX_H = 13, STRIP_H = 20, BR_H = 22, ADDR_H = 15
const FRAME_HEAD = 26, FRAME_PAD_L = 22, FRAME_PAD_R = 16, FRAME_PAD_B = 10, VAR_GAP = 14
const REG_H = 20, MARGIN = 14, BLOCK_GAP = 16
const VF = 12 // value font size

const BASES = {
  auto64: { stack: 0x7ffd1000, heap: 0x55a042a0, globals: 0x404010 },
  auto32: { stack: 0x7fffeffc, heap: 0x10040000, globals: 0x10010000 },
  small: { stack: 0x400, heap: 0x200, globals: 0x100 },
}

function parsePtr(p) {
  if (p === null || p === 'NULL' || p === 'null' || p === 'nullptr' || p === 0) return { kind: 'null' }
  if (p === 'dangling') return { kind: 'dangling' }
  if (typeof p === 'string') return { kind: 'ref', ref: p }
  return { kind: 'bad' }
}

function parseRef(s) {
  const m = /^([^[\].\s]+)((?:\[\s*\d+\s*\])*)(?:\.([A-Za-z_]\w*))?$/.exec(String(s).trim())
  if (!m) return null
  return { id: m[1], idx: [...m[2].matchAll(/\d+/g)].map((x) => Number(x[0])), field: m[3] }
}

export default {
  kind: 'memory',
  fields: ['frames', 'heap', 'globals', 'code', 'line', 'addresses', 'abi', 'highlight'],
  collections: ['frames', 'heap', 'globals'],
  render(spec, { theme, diag, uid }) {
    const abi = spec.abi ?? 'lp64'
    if (!ABI_NAMES.includes(abi)) throw new SpecError('abi', `unknown abi "${abi}"; use ${ABI_NAMES.join(', ')}`)
    const ptrSize = typeInfo('void *', abi).size
    const amode = spec.addresses ?? 'auto'
    if (!['auto', 'off', 'small'].includes(amode)) throw new SpecError('addresses', 'use "auto", "small", or "off"')
    const showAddr = amode !== 'off'
    const PTR = color('purple'), VAL = color('blue'), WARN = color('amber')

    // 1. Collect every item (stack vars, heap blocks, globals) as one object list.
    const objs = [], byId = new Map(), frames = []
    const seen = new Map()
    const claim = (id, path) => {
      if (seen.has(id)) throw new SpecError(path, `duplicate id "${id}" (also at ${seen.get(id)}); ids must be unique across frames, vars, heap, and globals (use "name" to show the same variable name twice)`)
      seen.set(id, path)
    }
    const addObj = (item, path, region, frame) => {
      if (!item || typeof item !== 'object') throw new SpecError(path, 'each item is an object like {"id": "x", "type": "int", "value": "5"}')
      let id = item.id
      if (id === undefined) { diag.warn(path, 'give each item an "id" so pointers, steps, and highlight can refer to it'); id = `#${objs.length}` }
      else claim(String(id), path)
      if (item.type === undefined && region !== 'heap') diag.warn(`${path}.type`, 'give the C type, like "int" or "int *"')
      const o = { id: String(id), name: item.name ?? (region === 'heap' ? null : String(id)), type: item.type ?? '', region, frame, path, item }
      o.tintName = item.tint
      o.value = item.value; o.text = item.text
      o.freed = !!item.freed
      if (item.cells !== undefined) {
        if (!Array.isArray(item.cells)) throw new SpecError(`${path}.cells`, 'cells is a list: values like [1, 2, 3] or objects like {"ptr": "x"}')
        o.cells = item.cells.map((c, k) => {
          if (c === null || typeof c !== 'object') return { value: c ?? '' }
          const cc = { ...c }
          if ('ptr' in c) cc.p = parsePtr(c.ptr)
          if (cc.p?.kind === 'bad') throw new SpecError(`${path}.cells[${k}].ptr`, 'ptr is an id or cell like "r1[2]", null for NULL, or "dangling"')
          return cc
        })
        if (!o.cells.length) diag.warn(`${path}.cells`, 'an empty array draws nothing; give its cells')
      } else if ('ptr' in item) {
        o.p = parsePtr(item.ptr)
        if (o.p.kind === 'bad') throw new SpecError(`${path}.ptr`, 'ptr is an id or cell like "r1[2]", null for NULL, or "dangling"')
      }
      objs.push(o); byId.set(o.id, o)
      return o
    }
    const frameList = spec.frames ?? []
    if (!Array.isArray(frameList)) throw new SpecError('frames', 'frames is a list like [{"id": "main", "vars": [...]}]')
    frameList.forEach((f, i) => {
      const path = `frames[${i}]`
      if (!f || typeof f !== 'object') throw new SpecError(path, 'a frame is {"id": "main", "vars": [...]}')
      if (f.id === undefined) diag.warn(path, 'give each frame an "id" (the function name, like "main")')
      else claim(String(f.id), path)
      const fr = { id: String(f.id ?? `frame${i}`), name: f.name ?? String(f.id ?? '?'), vars: [], path }
      if (f.vars !== undefined && !Array.isArray(f.vars)) throw new SpecError(`${path}.vars`, 'vars is a list of variables')
      ;(f.vars ?? []).forEach((v, k) => fr.vars.push(addObj(v, `${path}.vars[${k}]`, 'stack', fr)))
      frames.push(fr)
    })
    for (const [key, region] of [['heap', 'heap'], ['globals', 'globals']]) {
      if (spec[key] === undefined) continue
      if (!Array.isArray(spec[key])) throw new SpecError(key, `${key} is a list of items`)
      spec[key].forEach((it, k) => addObj(it, `${key}[${k}]`, region))
    }
    const heap = objs.filter((o) => o.region === 'heap'), globals = objs.filter((o) => o.region === 'globals')

    // 2. Shape and sizes of each object.
    for (const o of objs) {
      o.ti = typeInfo(o.type, abi)
      if (o.cells) {
        const hasPtr = o.cells.some((c) => c.p), named = o.cells.some((c) => c.name !== undefined)
        let dir = o.item.dir ?? (hasPtr || named ? 'v' : 'h')
        if (dir === 'h' && hasPtr) { diag.warn(`${o.path}.dir`, 'arrays holding pointers are drawn vertically'); dir = 'v' }
        o.dir = dir
        const dims = o.ti?.dims ?? []
        o.rowlen = dir === 'h' ? (o.item.rowlen ?? (dims.length === 2 ? dims[1] : null)) : null
        if (o.rowlen !== null && !(Number.isInteger(o.rowlen) && o.rowlen > 0)) throw new SpecError(`${o.path}.rowlen`, 'rowlen is a positive whole number of cells per row')
        if (o.rowlen && o.cells.length % o.rowlen) diag.warn(`${o.path}.rowlen`, `${o.cells.length} cells don't split into rows of ${o.rowlen}`)
        if (dims.length && dims[0] && dims.reduce((a, b) => a * b, 1) !== o.cells.length) diag.warn(`${o.path}.cells`, `type ${o.type} has ${dims.reduce((a, b) => a * b, 1)} elements but ${o.cells.length} cells are given`)
        if (named || o.cells.some((c) => c.type)) {
          const lay = structLayout(o.cells.map((c) => ({ name: c.name, type: c.type ?? (c.p ? 'void *' : (o.ti?.dims.length ? o.type.replace(/\[.*$/, '') : 'int')) })), abi)
          o.offsets = lay.fields.map((f) => f.offset); o.size = lay.size; o.align = lay.align
        } else {
          const es = o.ti?.elem.size ?? (hasPtr ? ptrSize : 4)
          o.offsets = o.cells.map((_, k) => k * es); o.size = es * o.cells.length; o.align = o.ti?.align ?? es
        }
      } else {
        o.size = o.ti?.size ?? (o.p ? ptrSize : 4); o.align = o.ti?.align ?? Math.min(o.size, 8)
      }
    }

    // 3. Addresses: given per item ("addr"), else assigned like a real process.
    const bases = amode === 'small' ? BASES.small : ptrSize === 4 ? BASES.auto32 : BASES.auto64
    {
      let sp = bases.stack
      frames.forEach((fr, i) => {
        if (i) sp -= 2 * ptrSize // return address and saved frame pointer
        for (const o of fr.vars) { sp -= o.size; sp = Math.floor(sp / o.align) * o.align; o.addr = sp }
      })
      let g = bases.globals
      for (const o of globals) { g = Math.ceil(g / o.align) * o.align; o.addr = g; g += o.size }
      let hp = bases.heap
      for (const o of heap) { o.addr = hp; hp += amode === 'small' ? Math.ceil(Math.max(o.size, 1) / 16) * 16 : Math.max(32, Math.ceil((o.size + 8) / 16) * 16) }
      for (const o of objs) if (o.item.addr !== undefined) {
        const a = typeof o.item.addr === 'number' ? o.item.addr : /^0x[0-9a-f]+$/i.test(String(o.item.addr)) ? parseInt(o.item.addr, 16) : NaN
        if (!Number.isFinite(a)) throw new SpecError(`${o.path}.addr`, 'give the address as hex like "0x7ffc1000"')
        o.addr = a
      }
    }

    // 4. Resolve references (pointer targets and highlight).
    const ids = () => objs.map((o) => o.id).join(', ')
    const resolve = (s, path) => {
      const r = parseRef(s)
      if (!r) throw new SpecError(path, `can't read "${s}"; refer to an id ("x"), a cell ("r1[2]", "a[1][2]" with rowlen), or a field ("node.next")`)
      const o = byId.get(r.id)
      if (!o) {
        if (frames.some((f) => f.id === r.id)) throw new SpecError(path, `"${r.id}" is a frame; point at one of its variables`)
        throw new SpecError(path, `no item "${r.id}"; ids: ${ids()}`)
      }
      if (r.field !== undefined) {
        if (!o.cells) throw new SpecError(path, `${o.id} has no fields; give it cells with names`)
        const k = o.cells.findIndex((c) => c.name === r.field)
        if (k < 0) throw new SpecError(path, `${o.id} has no field "${r.field}"; fields: ${o.cells.map((c) => c.name).filter(Boolean).join(', ')}`)
        if (r.idx.length) throw new SpecError(path, 'use either an index or a field, not both')
        return { o, cell: k, cells: [k] }
      }
      if (!r.idx.length) return { o, cell: null, cells: o.cells ? o.cells.map((_, k) => k) : [] }
      if (!o.cells) throw new SpecError(path, `${o.id} is not an array, so "${s}" has nothing to index`)
      const n = o.cells.length
      if (o.rowlen) {
        const rows = Math.ceil(n / o.rowlen)
        if (r.idx.length > 2) throw new SpecError(path, `${o.id} has two dimensions`)
        if (r.idx[0] >= rows) throw new SpecError(path, `${o.id} has ${rows} rows (0-${rows - 1}); row ${r.idx[0]} is out of range`)
        if (r.idx.length === 1) { const c = r.idx[0] * o.rowlen; const cs = []; for (let k = c; k < Math.min(n, c + o.rowlen); k++) cs.push(k); return { o, cell: c, cells: cs, row: r.idx[0] } }
        if (r.idx[1] >= o.rowlen) throw new SpecError(path, `${o.id} rows have ${o.rowlen} cells (0-${o.rowlen - 1}); column ${r.idx[1]} is out of range`)
        const c = r.idx[0] * o.rowlen + r.idx[1]
        if (c >= n) throw new SpecError(path, `${s} is past the end of ${o.id}`)
        return { o, cell: c, cells: [c] }
      }
      if (r.idx.length > 1) throw new SpecError(path, `${o.id} is one-dimensional; give "rowlen" (or a type like int[3][4]) to index it as [row][col]`)
      if (r.idx[0] >= n) throw new SpecError(path, `${o.id} has ${n} cells (0-${n - 1}); ${s} is out of range`)
      return { o, cell: r.idx[0], cells: [r.idx[0]] }
    }
    const links = []
    for (const o of objs) {
      const srcs = o.cells ? o.cells.map((c, k) => [c, k, `${o.path}.cells[${k}].ptr`]).filter(([c]) => c.p) : o.p ? [[o, null, `${o.path}.ptr`]] : []
      for (const [c, k, path] of srcs) {
        const l = { src: o, cell: k, p: c.p }
        if (c.p.kind === 'ref') l.t = resolve(c.p.ref, path)
        links.push(l)
        c.link = l
      }
    }
    const hl = new Set(), hlFrames = new Set()
    for (const [i, h] of (spec.highlight ?? []).entries()) {
      if (frames.some((f) => f.id === h)) { hlFrames.add(h); continue }
      let r
      try { r = resolve(h, `highlight[${i}]`) } catch (e) { diag.warn(`highlight[${i}]`, e.message); continue }
      if (r.cell === null && !r.o.cells) hl.add(r.o.id)
      else for (const k of (r.cell === null ? r.cells : r.cells)) hl.add(`${r.o.id}#${k}`)
      if (r.cell === null && r.o.cells) hl.add(r.o.id)
    }

    // Text shown in a box: the explicit "text", else a pointer's target address or NULL, else the value.
    const targetAddr = (t) => t.o.addr + (t.cell === null ? 0 : t.o.offsets[t.cell])
    const shown = (c) => {
      if (c.text !== undefined) return String(c.text)
      if (c.p) {
        if (c.p.kind === 'null') return 'NULL'
        if (c.p.kind === 'dangling') return '?'
        return showAddr ? hex(targetAddr(c.link.t)) : ''
      }
      return c.value === undefined || c.value === null ? '' : String(c.value)
    }
    const nameOf = (o, k) => k === null || k === undefined ? o.id : o.cells[k].name !== undefined ? `${o.id}.${o.cells[k].name}` : o.rowlen ? `${o.id}[${Math.floor(k / o.rowlen)}][${k % o.rowlen}]` : `${o.id}[${k}]`
    const tgtName = (t) => t.row !== undefined ? `${t.o.id}[${t.row}]` : nameOf(t.o, t.cell)

    // Arrows into a horizontal array past its first cell come in from below, along a strip.
    for (const l of links) if (l.t && l.t.o.cells && l.t.o.dir === 'h' && l.t.cell > 0) { l.lane = l.t.o.strip ?? 0; l.t.o.strip = l.lane + 1 }

    // 5. Measure.
    const addrText = (o) => !showAddr ? '' : o.region === 'heap' ? hex(o.addr) : `&${o.name} = ${hex(o.addr)}`
    for (const o of objs) {
      const head = []
      if (o.region !== 'heap') head.push({ s: o.name, size: 12, fill: theme.fg })
      else if (o.name) head.push({ s: o.name, size: 12, fill: theme.fg })
      if (o.type) head.push({ s: o.type, size: 11, fill: theme.muted })
      if (o.freed) head.push({ s: 'freed', size: 11, fill: WARN, sans: true })
      o.head = head
      const headW = head.reduce((w, h) => w + (h.sans ? sansW(h.s, h.size) : monoW(h.s, h.size)) + 7, -7)
      const aw = monoW(addrText(o), 10.5)
      if (!o.cells) {
        o.boxW = Math.max(52, monoW(shown(o), VF) + 20)
        o.w = Math.max(headW, o.boxW, aw)
        o.h = NAME_H + BOX_H + (showAddr ? ADDR_H : 0)
      } else if (o.dir === 'h') {
        o.cellW = Math.max(28, ...o.cells.map((c) => monoW(shown(c), VF) + 14))
        o.boxW = o.cellW * o.cells.length
        o.w = Math.max(headW, o.boxW, aw)
        o.h = NAME_H + IDX_H + BOX_H + (o.strip ? STRIP_H + 6 * (o.strip - 1) : 0) + (o.rowlen ? BR_H : 0) + (showAddr ? ADDR_H : 0)
      } else {
        o.labW = Math.max(...o.cells.map((c, k) => monoW(c.name ?? `[${k}]`, 11))) + 14
        o.valW = Math.max(52, ...o.cells.map((c) => monoW(shown(c), VF) + 20))
        o.boxW = o.labW + o.valW
        o.w = Math.max(headW, o.boxW, aw)
        o.h = NAME_H + BOX_H * o.cells.length + (showAddr ? ADDR_H : 0)
      }
    }
    // Where the box (the cells) starts below the object's top, and the y of cell k's center.
    const boxTop = (o) => NAME_H + (o.cells && o.dir === 'h' ? IDX_H : 0)
    const cellCY = (o, k) => boxTop(o) + (o.cells && o.dir === 'v' ? BOX_H * (k ?? 0) : 0) + BOX_H / 2

    // 6. Place: code at the left, then globals and stack, then heap columns.
    const code = spec.code === undefined ? [] : Array.isArray(spec.code) ? spec.code.map(String) : String(spec.code).split('\n')
    const line = spec.line
    if (line !== undefined && !(Number.isInteger(line) && line >= 1 && line <= code.length)) diag.warn('line', `line is 1-based and must be 1-${code.length || 'the number of code lines'}`)
    const LH = 20, numW = code.length ? monoW(String(code.length), 11) + 10 : 0
    const codeW = code.length ? 12 + numW + Math.max(...code.map((s) => monoW(s, 12))) + 8 : 0
    let x = MARGIN
    const codeX = x
    if (code.length) x += codeW + 26
    const leftX = x
    const hasLeft = frames.length || globals.length
    const innerW = Math.max(60, ...frames.flatMap((f) => f.vars.map((o) => o.w)), ...globals.map((o) => o.w), ...frames.map((f) => monoW(f.name, 12)))
    const frameW = FRAME_PAD_L + innerW + FRAME_PAD_R
    let y = MARGIN
    const labels = [], boxes = []
    const stackVars = (list, top) => { let yy = top; for (const o of list) { o.x = leftX + FRAME_PAD_L; o.y = yy; yy += o.h + VAR_GAP } return yy - VAR_GAP }
    if (globals.length) {
      labels.push({ s: 'globals', x: leftX, y })
      y += REG_H
      const bot = stackVars(globals, y + 12)
      boxes.push({ x: leftX, y, w: frameW, h: bot - y + FRAME_PAD_B })
      y = bot + FRAME_PAD_B + 18
    }
    if (frames.length) {
      labels.push({ s: 'stack', x: leftX, y })
      y += REG_H
      for (const fr of [...frames].reverse()) {
        const bot = fr.vars.length ? stackVars(fr.vars, y + FRAME_HEAD) : y + FRAME_HEAD - 6
        fr.box = { x: leftX, y, w: frameW, h: bot - y + FRAME_PAD_B }
        y = bot + FRAME_PAD_B + 12
      }
    }
    const codeY = MARGIN + REG_H
    let right = hasLeft ? leftX + frameW : code.length ? codeX + codeW : MARGIN

    // Heap columns by pointer depth: the longest chain of heap pointers from a block the
    // stack or globals point at (cycle back-edges ignored), so row arrays sit right of
    // the row-pointer array even when a stack pointer also points into them.
    const depth = new Map(), back = new Set(), onStack = new Set(), done = new Set()
    const out = (o) => links.filter((l) => l.src === o && l.t?.o.region === 'heap' && l.t.o !== o)
    const dfs = (o) => {
      done.add(o); onStack.add(o)
      for (const l of out(o)) { if (onStack.has(l.t.o)) back.add(l); else if (!done.has(l.t.o)) dfs(l.t.o) }
      onStack.delete(o)
    }
    for (const l of links) if (l.t && l.src.region !== 'heap' && l.t.o.region === 'heap' && !done.has(l.t.o)) dfs(l.t.o)
    for (const o of heap) if (!done.has(o)) dfs(o)
    for (const o of heap) depth.set(o, 0)
    for (let pass = 0; pass < heap.length; pass++) for (const o of heap) for (const l of out(o)) if (!back.has(l)) depth.set(l.t.o, Math.max(depth.get(l.t.o), depth.get(o) + 1))
    const ncol = heap.length ? Math.max(...heap.map((o) => depth.get(o))) + 1 : 0
    const heapTop = MARGIN + REG_H
    const gutters = []
    const leftRight = right
    const placed = []
    for (let c = 0; c < ncol; c++) {
      const col = heap.filter((o) => depth.get(o) === c)
      if (!col.length) continue
      const inc = links.filter((l) => l.t && col.includes(l.t.o)).length
      const gw = Math.min(110, Math.max(46, 26 + 10 * inc))
      // Align each block with the first placed pointer to it, without overlaps.
      const want = (o) => {
        const ys = links.filter((l) => l.t?.o === o && l.src.y !== undefined).map((l) => l.src.y + cellCY(l.src, l.cell) - cellCY(o, l.t.o.dir === 'v' ? l.t.cell : null))
        return ys.length ? Math.min(...ys) : Infinity
      }
      const order = col.map((o, i) => ({ o, i, w: want(o) })).sort((a, b) => a.w - b.w || a.i - b.i)
      // The column sits right of everything that points into it; a block that would
      // overlap an earlier column's block moves down below it.
      const srcRight = links.filter((l) => l.t && col.includes(l.t.o) && l.src.region === 'heap' && placed.includes(l.src)).map((l) => l.src.x + l.src.w)
      const colX = Math.max(leftRight, ...srcRight) + (c === 0 && !hasLeft && !code.length ? 0 : gw)
      let cur = heapTop
      for (const { o, w } of order) {
        o.x = colX; o.y = Math.max(cur, Number.isFinite(w) ? w : cur)
        for (let moved = true; moved; ) {
          moved = false
          for (const p of placed) if (p.x < o.x + o.w + 8 && p.x + p.w + 8 > o.x && p.y < o.y + o.h + BLOCK_GAP && p.y + p.h + BLOCK_GAP > o.y) { o.y = p.y + p.h + BLOCK_GAP; moved = true }
        }
        cur = o.y + o.h + BLOCK_GAP
        placed.push(o)
      }
      gutters.push([colX - gw, colX])
      if (c === 0) labels.push({ s: 'heap', x: colX, y: MARGIN })
      right = Math.max(right, ...col.map((o) => o.x + o.w))
    }

    // 7. Draw objects, recording obstacles for the router.
    const obstacles = [], parts = [], under = []
    const ob = (x, y, w, h) => obstacles.push({ x, y, w, h })
    const tint = (o, c) => color(c?.tint ?? o.tintName ?? (c?.p || (!o.cells && (o.p || o.ti?.ptr)) ? 'purple' : 'blue'))
    const cellRect = (o, k) => {
      const bt = o.y + boxTop(o)
      if (!o.cells) return { x: o.x, y: bt, w: o.boxW, h: BOX_H }
      if (o.dir === 'h') return { x: o.x + k * o.cellW, y: bt, w: o.cellW, h: BOX_H }
      return { x: o.x + o.labW, y: bt + k * BOX_H, w: o.valW, h: BOX_H }
    }
    const drawCell = (o, c, k, r, rx = 0) => {
      const isHl = hl.has(k === null ? o.id : `${o.id}#${k}`)
      const col = o.freed ? theme.faint : tint(o, c)
      const out = []
      out.push(el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: rx || undefined, fill: isHl ? theme.highlight : col, 'fill-opacity': isHl ? 0.22 : 0.16 }))
      if (o.freed) out.push(el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: rx || undefined, fill: `url(#${uid}-hatch)` }))
      const s = shown(c)
      const dim = o.freed || c.p?.kind === 'null' || c.p?.kind === 'dangling'
      if (s) out.push(mono(s, r.x + r.w / 2, r.y + r.h / 2, theme, { size: VF, middle: true, fill: c.p?.kind === 'dangling' ? WARN : dim ? theme.muted : theme.fg }))
      return { out, isHl, col }
    }
    const strokeOf = (o, c, isHl) => isHl ? theme.highlight : o.freed ? WARN : tint(o, c)
    for (const o of objs) {
      if (o.x === undefined) continue
      const g = []
      // Head: name and type (heap: type), above the box.
      let hx = o.x
      for (const h of o.head) {
        g.push(h.sans ? sans(h.s, hx, o.y + 13, theme, { anchor: 'start', size: h.size, fill: h.fill }) : mono(h.s, hx, o.y + 13, theme, { anchor: 'start', size: h.size, fill: h.fill }))
        hx += (h.sans ? sansW(h.s, h.size) : monoW(h.s, h.size)) + 7
      }
      ob(o.x, o.y + 2, hx - 7 - o.x, NAME_H - 4)
      const dash = o.freed ? '5 3' : undefined
      if (!o.cells) {
        const r = cellRect(o, null)
        const { out, isHl } = drawCell(o, o, null, r, 6)
        g.push(...out)
        g.push(el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 6, fill: 'none', stroke: strokeOf(o, o, isHl), 'stroke-width': isHl ? 2.2 : 1.4, 'stroke-dasharray': o.p?.kind === 'dangling' ? '4 3' : dash }))
        ob(r.x, r.y, r.w, r.h)
      } else {
        const bt = o.y + boxTop(o)
        if (o.dir === 'h') {
          o.cells.forEach((c, k) => {
            const r = cellRect(o, k)
            g.push(mono(String(k), r.x + r.w / 2, o.y + NAME_H + 9, theme, { size: 10, fill: theme.muted }))
            g.push(...drawCell(o, c, k, r).out)
          })
          ob(o.x, o.y + NAME_H, o.boxW, IDX_H - 2)
          // Cell dividers and outline; highlighted cells get their own outline on top.
          for (let k = 1; k < o.cells.length; k++) { const r = cellRect(o, k); g.push(el('line', { x1: r.x, y1: bt, x2: r.x, y2: bt + BOX_H, stroke: o.freed ? WARN : tint(o, o.cells[k]), 'stroke-width': o.rowlen && k % o.rowlen === 0 ? 2.2 : 1, 'stroke-opacity': o.rowlen && k % o.rowlen === 0 ? 1 : 0.7 })) }
          g.push(el('rect', { x: o.x, y: bt, width: o.boxW, height: BOX_H, fill: 'none', stroke: o.freed ? WARN : tint(o, o.cells[0]), 'stroke-width': 1.4, 'stroke-dasharray': dash }))
          o.cells.forEach((c, k) => { if (hl.has(`${o.id}#${k}`)) { const r = cellRect(o, k); g.push(el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, fill: 'none', stroke: theme.highlight, 'stroke-width': 2.4 })) } })
          ob(o.x, bt, o.boxW, BOX_H)
          let yy = bt + BOX_H + (o.strip ? STRIP_H + 6 * (o.strip - 1) : 0)
          if (o.rowlen) {
            const rows = Math.ceil(o.cells.length / o.rowlen)
            for (let rr = 0; rr < rows; rr++) {
              const x0 = o.x + rr * o.rowlen * o.cellW + 3, x1 = o.x + Math.min(o.cells.length, (rr + 1) * o.rowlen) * o.cellW - 3
              g.push(el('path', { d: `M${x0} ${yy + 3}L${x0} ${yy + 7}L${x1} ${yy + 7}L${x1} ${yy + 3}`, fill: 'none', stroke: theme.muted, 'stroke-width': 1 }))
              g.push(sans(`row ${rr}`, (x0 + x1) / 2, yy + 18, theme, { size: 10.5, fill: theme.muted }))
            }
            ob(o.x, yy + 2, o.boxW, BR_H - 2)
            yy += BR_H
          }
          if (showAddr) { g.push(mono(addrText(o), o.x, yy + 11, theme, { anchor: 'start', size: 10.5, fill: theme.muted })); ob(o.x, yy + 2, monoW(addrText(o), 10.5), ADDR_H - 3) }
        } else {
          o.cells.forEach((c, k) => {
            const r = cellRect(o, k)
            const lr = { x: o.x, y: r.y, w: o.labW, h: BOX_H }
            g.push(el('rect', { x: lr.x, y: lr.y, width: lr.w, height: lr.h, fill: o.freed ? theme.faint : tint(o, c), 'fill-opacity': 0.07 }))
            g.push(mono(c.name ?? `[${k}]`, o.x + o.labW - 7, r.y + BOX_H / 2, theme, { anchor: 'end', size: 11, fill: theme.muted, middle: true }))
            g.push(...drawCell(o, c, k, r).out)
            if (k) g.push(el('line', { x1: o.x, y1: r.y, x2: o.x + o.boxW, y2: r.y, stroke: o.freed ? WARN : tint(o, c), 'stroke-width': 1, 'stroke-opacity': 0.7 }))
          })
          const st = o.freed ? WARN : tint(o, o.cells[0])
          g.push(el('line', { x1: o.x + o.labW, y1: bt, x2: o.x + o.labW, y2: bt + BOX_H * o.cells.length, stroke: st, 'stroke-width': 1, 'stroke-opacity': 0.7 }))
          g.push(el('rect', { x: o.x, y: bt, width: o.boxW, height: BOX_H * o.cells.length, rx: 5, fill: 'none', stroke: st, 'stroke-width': 1.4, 'stroke-dasharray': dash }))
          o.cells.forEach((c, k) => { if (hl.has(`${o.id}#${k}`)) { const r = cellRect(o, k); g.push(el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, fill: 'none', stroke: theme.highlight, 'stroke-width': 2.4 })) } })
          ob(o.x, bt, o.boxW, BOX_H * o.cells.length)
          const yy = bt + BOX_H * o.cells.length
          if (showAddr) { g.push(mono(addrText(o), o.x, yy + 11, theme, { anchor: 'start', size: 10.5, fill: theme.muted })); ob(o.x, yy + 2, monoW(addrText(o), 10.5), ADDR_H - 3) }
        }
      }
      if (!o.cells && showAddr) { const yy = o.y + NAME_H + BOX_H; g.push(mono(addrText(o), o.x, yy + 11, theme, { anchor: 'start', size: 10.5, fill: theme.muted })); ob(o.x, yy + 2, monoW(addrText(o), 10.5), ADDR_H - 3) }
      parts.push(el('g', {}, g))
    }

    // Frames, region labels, and code (drawn under the objects).
    for (const b of boxes) under.push(el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 6, fill: theme.muted, 'fill-opacity': 0.06, stroke: theme.faint, 'stroke-width': 1 }))
    for (const fr of frames) {
      const b = fr.box, isHl = hlFrames.has(fr.id)
      under.push(el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 6, fill: theme.muted, 'fill-opacity': 0.06, stroke: isHl ? theme.highlight : theme.faint, 'stroke-width': isHl ? 2 : 1 }))
      under.push(mono(fr.name, b.x + 10, b.y + 17, theme, { anchor: 'start', size: 12, fill: theme.fg, weight: 600 }))
      ob(b.x + 10, b.y + 5, monoW(fr.name, 12), 14)
    }
    for (const l of labels) { under.push(sans(l.s, l.x, l.y + 12, theme, { anchor: 'start', size: 11, fill: theme.muted })); ob(l.x, l.y, sansW(l.s, 11), 14) }
    if (code.length) {
      code.forEach((s, i) => {
        const yy = codeY + i * LH
        if (line === i + 1) {
          under.push(el('rect', { x: codeX, y: yy, width: codeW, height: LH, rx: 3, fill: color('teal'), 'fill-opacity': 0.18 }))
          under.push(el('path', { d: `M${codeX + 3} ${yy + 5}L${codeX + 10} ${yy + LH / 2}L${codeX + 3} ${yy + LH - 5}Z`, fill: color('teal') }))
        }
        under.push(mono(String(i + 1), codeX + 12 + numW - 10, yy + LH / 2, theme, { anchor: 'end', size: 11, fill: theme.faint, middle: true }))
        under.push(mono(s, codeX + 12 + numW, yy + LH / 2, theme, { anchor: 'start', size: 12, fill: theme.fg, middle: true }))
      })
      ob(codeX, codeY, codeW, code.length * LH)
    }

    // 8. Route arrows: out of a pointer's right edge, into the target's left edge
    // (or up into a cell of a horizontal array from the strip below it).
    let bottom = Math.max(MARGIN, ...objs.filter((o) => o.y !== undefined).map((o) => o.y + o.h), ...frames.map((f) => f.box.y + f.box.h), ...boxes.map((b) => b.y + b.h), code.length ? codeY + code.length * LH : 0)
    const arrows = []
    for (const l of links) {
      if (!l.t) continue
      const s = l.src, sr = cellRect(s, l.cell)
      const from = { x: s.x + s.boxW, y: sr.y + BOX_H / 2 }
      const t = l.t.o
      let to, end
      if (t.cells && t.dir === 'h' && l.t.cell > 0) { const r = cellRect(t, l.t.cell); end = { x: r.x + r.w / 2, y: r.y + BOX_H }; to = { x: end.x, y: end.y + 14 + 6 * l.lane, dir: 'rlu' } }
      else { const r = cellRect(t, t.cells && t.dir === 'v' ? l.t.cell ?? 0 : 0); end = { x: t.x, y: r.y + BOX_H / 2 }; to = { x: t.x - 11, y: end.y, dir: 'r' } }
      arrows.push({ l, from, stub: { x: from.x + 11, y: from.y }, to, end })
    }
    const lanes = { xs: [], ys: [bottom + 14, MARGIN - 6] }
    for (const [a, b] of gutters) for (let gx = a + 12; gx < b - 8; gx += 9) lanes.xs.push(gx)
    if (code.length && hasLeft) for (let gx = codeX + codeW + 8; gx < leftX - 4; gx += 8) lanes.xs.push(gx)
    lanes.xs.push(right + 14)
    const router = new Router(obstacles, lanes, arrows.flatMap((a) => [a.stub, a.to]))
    arrows.sort((a, b) => Math.abs(a.from.y - a.end.y) - Math.abs(b.from.y - b.end.y))
    const defs = [marker(`${uid}-ap`, PTR), marker(`${uid}-aw`, WARN),
      el('pattern', { id: `${uid}-hatch`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, [el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: theme.faint, 'stroke-width': 1.3 })])]
    const arrowSvg = []
    let minY = 0, maxX = right
    for (const a of arrows) {
      const pts = router.route(a.stub, a.to, 'r', a.to.dir)
      const dead = a.l.t.o.freed
      const c = dead ? WARN : PTR
      let path
      if (pts) path = [[a.from.x, a.from.y], ...pts, [a.end.x, a.end.y]]
      else { path = [[a.from.x, a.from.y], [a.end.x, a.end.y]]; diag.note(a.l.src.path, `no clear route for the arrow to ${tgtName(a.l.t)}; drawn straight`) }
      for (const [px, py] of path) { bottom = Math.max(bottom, py); minY = Math.min(minY, py); maxX = Math.max(maxX, px) }
      arrowSvg.push(el('path', { d: roundedPath(path), fill: 'none', stroke: c, 'stroke-width': 1.6, 'stroke-dasharray': dead ? '5 3' : undefined, 'marker-end': `url(#${uid}-${dead ? 'aw' : 'ap'})` }))
      arrowSvg.push(el('circle', { cx: a.from.x, cy: a.from.y, r: 3.2, fill: c }))
    }
    // Dangling pointers with no target: a short dashed stub ending in "?".
    for (const l of links) if (l.p.kind === 'dangling') {
      const s = l.src, r = cellRect(s, l.cell), y0 = r.y + BOX_H / 2, x0 = s.x + s.boxW
      arrowSvg.push(el('path', { d: `M${x0} ${y0}L${x0 + 26} ${y0}`, stroke: WARN, 'stroke-width': 1.6, 'stroke-dasharray': '4 3', 'marker-end': `url(#${uid}-aw)` }))
      arrowSvg.push(sans('?', x0 + 34, y0, theme, { anchor: 'start', size: 14, fill: WARN, middle: true, weight: 700 }))
      maxX = Math.max(maxX, x0 + 44)
    }

    // 9. Size to content.
    const width = maxX + MARGIN, height = bottom + MARGIN - minY
    const body = el('g', { transform: minY < 0 ? `translate(0,${-minY})` : undefined }, [...under, ...parts, ...arrowSvg])

    // Summary for checking the picture against the code.
    const desc = links.map((l) => {
      const s = nameOf(l.src, l.cell)
      if (l.p.kind === 'null') return `${s} -> NULL`
      if (l.p.kind === 'dangling') return `${s} -> ? (DANGLING)`
      const t = tgtName(l.t)
      return `${s} -> ${t}${showAddr ? ` (${hex(targetAddr(l.t))})` : ''}${l.t.o.freed ? ' (DANGLING: freed)' : ''}`
    })
    const fdesc = [...frames].reverse().map((f) => `${f.id}(${f.vars.map((o) => o.id).join(', ')})`).join(' ')
    const sum = [
      `memory: stack ${fdesc || 'empty'}`,
      `heap ${heap.length ? heap.map((o) => `${o.id} ${o.type || `${o.cells?.length ?? 1} cells`}${o.freed ? ' (freed)' : ''}`).join(', ') : 'empty'}`,
      globals.length ? `globals ${globals.map((o) => o.id).join(', ')}` : '',
      `pointers: ${desc.join(', ') || 'none'}`,
      showAddr ? `addresses (${amode}, ${abi}): ${objs.map((o) => `${o.id} ${hex(o.addr)}`).join(', ')}` : '',
      line ? `line ${line}: ${code[line - 1] ?? '?'}` : '',
    ].filter(Boolean).join('; ')
    return { body, width, height, defs: defs.join(''), summary: sum, alt: 'memory diagram' }
  },
}
