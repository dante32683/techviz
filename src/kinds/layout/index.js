// layout: byte-level layouts. Three modes, one per spec:
//   struct: field offsets and padding on a byte ruler (C rules for an ABI),
//           optionally with the padding-minimal field order below it;
//   bytes:  a multi-byte value's bytes at increasing addresses, little- and/or big-endian;
//   map:    an address map (a vertical bar of regions, high addresses at the top).

import { el } from '../../svg.js'
import { labelSvg, measure } from '../../label.js'
import { color } from '../../theme.js'
import { SpecError } from '../../diag.js'
import { structLayout, bestOrder, ABI_NAMES, parseAddr, fmtSize } from '../../ctype.js'

const raw = (s) => [{ text: String(s), shift: 0 }]
const monoW = (s, size) => String(s).length * size * 0.55
const sansW = (s, size) => measure(raw(s), size)
const mono = (s, x, y, theme, o = {}) => labelSvg(raw(String(s).replace(/ /g, ' ')), x, y, theme, { mono: true, ...o })
const sans = (s, x, y, theme, o = {}) => labelSvg(raw(s), x, y, theme, o)
const M = 14
const marker = (id, fill) => el('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto' }, [el('path', { d: 'M0 0L10 5L0 10z', fill })])
const hatch = (uid, theme) => el('pattern', { id: `${uid}-hatch`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, [el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: theme.faint, 'stroke-width': 1.3 })])

// ---- struct ----

function renderStruct(spec, { theme, uid }) {
  const st = spec.struct
  if (!st || !Array.isArray(st.fields) || !st.fields.length) throw new SpecError('struct.fields', 'give the fields as [{"name": "c", "type": "char"}, ...]')
  const abi = spec.abi ?? 'lp64'
  if (!ABI_NAMES.includes(abi)) throw new SpecError('abi', `unknown abi "${abi}"; use ${ABI_NAMES.join(', ')}`)
  const packed = !!(st.packed ?? spec.packed)
  st.fields.forEach((f, i) => { if (!f || typeof f.type !== 'string' && !Array.isArray(f.fields)) throw new SpecError(`struct.fields[${i}]`, 'each field needs "name" and "type" (or nested "fields")') })
  const lay = (fields) => {
    try { return structLayout(fields, abi, packed, 'struct.fields') } catch (e) { throw new SpecError(e.message.split(':')[0], e.message.slice(e.message.indexOf(':') + 2)) }
  }
  const name = st.name ? `struct ${st.name}` : 'struct'
  const views = [{ title: name, fields: st.fields, L: lay(st.fields) }]
  if (spec.reorder) {
    const best = bestOrder(st.fields, abi, packed)
    views.push({ title: `${name}, reordered`, fields: best, L: lay(best) })
  }
  const maxSize = Math.max(...views.map((v) => v.L.size))
  const row = spec.row ?? (typeof abi === 'string' && /32/.test(abi) ? 4 : 8)
  if (!(Number.isInteger(row) && row > 0)) throw new SpecError('row', 'row is the number of bytes per ruler row, like 8')
  const BW = Math.max(26, Math.min(44, Math.floor(360 / row))), RH = 44, RG = 6
  const offW = monoW(`+${Math.max(0, Math.ceil(maxSize / row) - 1) * row}`, 11) + 10
  const x0 = M + offW
  const parts = []
  let y = M
  let width = x0 + row * BW
  const colorOf = (f) => color(f.tint, st.fields.indexOf(f))
  const hl = new Set(spec.highlight ?? [])
  for (const v of views) {
    // Label line: struct name, then sizeof and alignof.
    const facts = `sizeof ${v.L.size} · alignof ${v.L.align}${packed ? ' · packed' : ''}`
    parts.push(mono(v.title, x0, y + 12, theme, { anchor: 'start', size: 12 }))
    parts.push(mono(facts, x0 + monoW(v.title, 12) + 14, y + 12, theme, { anchor: 'start', size: 11, fill: theme.muted }))
    width = Math.max(width, x0 + monoW(v.title, 12) + 14 + monoW(facts, 11))
    y += 20
    for (let b = 0; b < row; b++) parts.push(mono(b, x0 + b * BW + BW / 2, y + 9, theme, { size: 10, fill: theme.faint }))
    y += 14
    const rows = Math.max(1, Math.ceil(v.L.size / row))
    const rowY = (r) => y + r * (RH + RG)
    for (let r = 0; r < rows; r++) parts.push(mono(`+${r * row}`, x0 - 8, rowY(r) + RH / 2, theme, { anchor: 'end', size: 11, fill: theme.muted, middle: true }))
    // Spans split at row ends.
    const spans = [
      ...v.L.fields.map((f) => ({ off: f.offset, size: f.size, f: v.fields[f.index], name: f.name, type: f.type })),
      ...v.L.pads.map((p) => ({ off: p.offset, size: p.size, pad: true })),
    ]
    for (const s of spans) {
      const segs = []
      for (let a = s.off; a < s.off + s.size; ) {
        const r = Math.floor(a / row), end = Math.min(s.off + s.size, (r + 1) * row)
        segs.push({ r, b0: a - r * row, n: end - a })
        a = end
      }
      const big = segs.reduce((m, g) => (g.n > m.n ? g : m), segs[0])
      for (const g of segs) {
        const sx = x0 + g.b0 * BW, sy = rowY(g.r), sw = g.n * BW
        if (s.pad) {
          parts.push(el('rect', { x: sx + 1, y: sy + 1, width: sw - 2, height: RH - 2, fill: `url(#${uid}-hatch)`, stroke: theme.faint, 'stroke-width': 1, rx: 3 }))
          if (g === big && sw >= 24) parts.push(sans('pad', sx + sw / 2, sy + RH / 2, theme, { size: 10.5, fill: theme.muted, middle: true }))
          continue
        }
        const c = colorOf(s.f), isHl = hl.has(s.name)
        parts.push(el('rect', { x: sx + 1, y: sy + 1, width: sw - 2, height: RH - 2, rx: 3, fill: c, 'fill-opacity': 0.2, stroke: isHl ? theme.highlight : c, 'stroke-width': isHl ? 2.4 : 1.4 }))
        for (let k = 1; k < g.n; k++) parts.push(el('line', { x1: sx + k * BW, y1: sy + RH - 7, x2: sx + k * BW, y2: sy + RH - 1, stroke: c, 'stroke-opacity': 0.6 }))
        let ns = 12
        if (g !== big) {
          // A continuation of a field that wraps rows: the name only, if it fits.
          while (ns > 9 && monoW(s.name, ns) > sw - 6) ns--
          if (monoW(s.name, ns) <= sw - 6) parts.push(mono(s.name, sx + sw / 2, sy + RH / 2, theme, { size: ns, middle: true, fill: theme.muted }))
          continue
        }
        while (ns > 8 && monoW(s.name, ns) > sw - 6) ns--
        const showType = monoW(s.type, 10) <= sw - 6
        parts.push(mono(s.name, sx + sw / 2, sy + (showType ? 18 : RH / 2 + 4), theme, { size: ns }))
        if (showType) parts.push(mono(s.type, sx + sw / 2, sy + 33, theme, { size: 10, fill: theme.muted }))
      }
    }
    y = rowY(rows) - RG + 20
  }
  const height = y - 20 + M
  const facts = (v) => `${v.L.fields.map((f) => `${f.name} @${f.offset} (${f.size})`).join(', ')}; padding ${v.L.pads.map((p) => `${p.size} @${p.offset}${p.tail ? ' tail' : ''}`).join(', ') || 'none'} = ${v.L.pads.reduce((a, p) => a + p.size, 0)} bytes; sizeof ${v.L.size}, alignof ${v.L.align}`
  let summary = `layout ${name} (${abi}${packed ? ', packed' : ''}): ${facts(views[0])}`
  if (views[1]) summary += `; reordered (${views[1].fields.map((f) => f.name).join(', ')}): ${facts(views[1])}; saves ${views[0].L.size - views[1].L.size} bytes`
  return { body: el('g', {}, parts), width: width + M, height, defs: hatch(uid, theme), summary, alt: `${name} layout` }
}

// ---- bytes ----

function renderBytes(spec, { theme }) {
  const b = spec.bytes
  if (!b || b.value === undefined) throw new SpecError('bytes.value', 'give the value, like "0x12345678"')
  let bytes, shownVal
  const type = b.type
  if (type === 'float' || type === 'double') {
    const n = Number(b.value)
    if (!Number.isFinite(n)) throw new SpecError('bytes.value', `a ${type} value is a number, like 1.5`)
    const dv = new DataView(new ArrayBuffer(type === 'float' ? 4 : 8))
    type === 'float' ? dv.setFloat32(0, n) : dv.setFloat64(0, n)
    bytes = [...new Uint8Array(dv.buffer)]
    shownVal = `${n}${type === 'float' ? 'f' : ''} = 0x${bytes.map((x) => x.toString(16).padStart(2, '0')).join('')}`
  } else {
    let v
    try { v = BigInt(typeof b.value === 'number' ? Math.trunc(b.value) : String(b.value).trim()) } catch { throw new SpecError('bytes.value', 'give an integer, like "0x12345678" or 305419896 (or set "type": "float")') }
    const digits = (v < 0n ? -v : v).toString(16).length
    const size = b.size ?? [1, 2, 4, 8].find((n) => n * 2 >= digits) ?? Math.ceil(digits / 2)
    if (!(Number.isInteger(size) && size >= 1 && size <= 16)) throw new SpecError('bytes.size', 'size is 1-16 bytes')
    const mod = 1n << BigInt(size * 8)
    if (v >= mod || v < -(mod >> 1n)) throw new SpecError('bytes.value', `${b.value} doesn't fit in ${size} bytes`)
    const u = ((v % mod) + mod) % mod
    bytes = []
    for (let k = size - 1; k >= 0; k--) bytes.push(Number((u >> BigInt(k * 8)) & 0xffn))
    shownVal = typeof b.value === 'string' && /^0x/i.test(b.value) ? b.value : `${b.value} = 0x${u.toString(16).padStart(size * 2, '0')}`
  }
  const endian = b.endian ?? 'both'
  if (!['little', 'big', 'both'].includes(endian)) throw new SpecError('bytes.endian', 'use "little", "big", or "both"')
  const base = parseAddr(b.addr ?? '0x1000')
  if (base === null) throw new SpecError('bytes.addr', 'give the first address as hex, like "0x1000"')
  const n = bytes.length
  const rows = endian === 'both' ? ['little', 'big'] : [endian]
  const rowName = { little: 'little-endian', big: 'big-endian' }
  const labW = Math.max(...rows.map((r) => sansW(rowName[r], 12))) + 16
  const BW = 46, BH = 32
  const x0 = M + labW
  const parts = []
  const head = `${b.name ? `${type ? type + ' ' : ''}${b.name} = ` : ''}${shownVal}`
  parts.push(mono(head, x0, M + 12, theme, { anchor: 'start', size: 12 }))
  let y = M + 26
  const addrW = Math.max(...bytes.map((_, k) => monoW('0x' + (base + BigInt(k)).toString(16), 10)))
  const step = addrW + 4 > BW ? 2 : 1
  for (let k = 0; k < n; k += step) parts.push(mono('0x' + (base + BigInt(k)).toString(16), x0 + k * BW + BW / 2, y + 9, theme, { size: 10, fill: theme.muted }))
  y += 16
  for (const r of rows) {
    parts.push(sans(rowName[r], x0 - 10, y + BH / 2, theme, { anchor: 'end', size: 12, fill: theme.muted, middle: true }))
    for (let k = 0; k < n; k++) {
      const sig = r === 'big' ? k : n - 1 - k // index from the most significant byte
      const c = color(sig)
      const bx = x0 + k * BW
      parts.push(el('rect', { x: bx + 1, y: y + 1, width: BW - 2, height: BH - 2, rx: 3, fill: c, 'fill-opacity': 0.2, stroke: c, 'stroke-width': 1.4 }))
      parts.push(mono(bytes[sig].toString(16).padStart(2, '0'), bx + BW / 2, y + BH / 2, theme, { size: 13, middle: true }))
      if (sig === 0 || sig === n - 1) parts.push(sans(sig === 0 ? 'MSB' : 'LSB', bx + BW / 2, y + BH + 12, theme, { size: 10, fill: theme.muted }))
    }
    y += BH + 26
  }
  const hx = (list) => list.map((x) => x.toString(16).padStart(2, '0')).join(' ')
  const lo = '0x' + base.toString(16), hi = '0x' + (base + BigInt(n - 1)).toString(16)
  const summary = `layout bytes ${shownVal} (${n} bytes) at ${lo}..${hi}: ${rows.map((r) => `${rowName[r]} ${hx(r === 'big' ? bytes : [...bytes].reverse())}`).join('; ')}`
  const width = Math.max(x0 + n * BW, x0 + monoW(head, 12)) + M
  return { body: el('g', {}, parts), width, height: y - 12 + M, summary, alt: `bytes of ${shownVal}` }
}

// ---- map ----

function renderMap(spec, { theme, diag, uid }) {
  const m = spec.map
  if (!m || !Array.isArray(m.regions) || !m.regions.length) throw new SpecError('map.regions', 'give regions as [{"name": "text", "from": "0x00010000", "to": "0x0001FFFF"}, ...]')
  const regs = m.regions.map((r, i) => {
    const path = `map.regions[${i}]`
    const from = parseAddr(r.from)
    if (from === null) throw new SpecError(`${path}.from`, 'give the start address as hex, like "0x10000000"')
    let to
    if (r.to !== undefined) { to = parseAddr(r.to); if (to === null) throw new SpecError(`${path}.to`, 'give the last address (inclusive) as hex, like "0x1000FFFF"') }
    else if (r.size !== undefined) { const s = parseAddr(r.size); if (s === null || s === 0n) throw new SpecError(`${path}.size`, 'give a size like "64K", "1M", or "0x1000"'); to = from + s - 1n }
    else throw new SpecError(path, 'give "to" (the last address, inclusive) or "size"')
    if (to < from) throw new SpecError(`${path}.to`, '"to" is below "from"')
    return { name: r.name ?? '', from, to, tint: r.tint, grows: r.grows, i, path }
  }).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
  for (let k = 1; k < regs.length; k++) if (regs[k].from <= regs[k - 1].to) throw new SpecError(regs[k].path, `overlaps ${regs[k - 1].name || 'the region below it'}`)
  const lowTop = m.low === 'top'
  // Bands from low to high: regions and the gaps between them.
  const bands = []
  regs.forEach((r, k) => {
    if (k && r.from > regs[k - 1].to + 1n) bands.push({ gap: true, from: regs[k - 1].to + 1n, to: r.from - 1n })
    bands.push(r)
  })
  const span = (b) => Number(b.to - b.from + 1n)
  const spans = regs.map(span)
  let scale = m.scale ?? 'auto'
  if (!['auto', 'uniform', 'linear'].includes(scale)) throw new SpecError('map.scale', 'use "auto", "uniform", or "linear"')
  if (scale === 'auto') scale = Math.max(...spans) / Math.min(...spans) > 12 ? 'uniform' : 'linear'
  const RH = 46, GH = 24
  if (scale === 'uniform') for (const b of bands) b.h = b.gap ? GH : RH
  else {
    const total = Math.min(460, 70 * regs.length)
    const sum = bands.reduce((a, b) => a + span(b), 0)
    for (const b of bands) b.h = Math.max(b.gap ? 14 : 26, (span(b) / sum) * total)
  }
  const wide = bands.some((b) => b.to > 0xffffffffn)
  const fmtA = (a) => '0x' + a.toString(16).toUpperCase().padStart(wide ? 16 : 8, '0')
  const addrW = monoW(fmtA(0n), 11)
  const BX = M + addrW + 12, BWID = Math.max(170, ...regs.map((r) => sansW(r.name, 13) + 40))
  // y of each band: high addresses at the top unless low is "top".
  let y = M + 6
  const order = lowTop ? bands : [...bands].reverse()
  for (const b of order) { b.y = y; y += b.h }
  const barBottom = y
  const parts = [], labels = []
  for (const b of order) {
    if (b.gap) {
      parts.push(el('rect', { x: BX, y: b.y, width: BWID, height: b.h, fill: `url(#${uid}-hatch)`, 'fill-opacity': 0.6 }))
      parts.push(el('line', { x1: BX, y1: b.y, x2: BX, y2: b.y + b.h, stroke: theme.faint, 'stroke-dasharray': '3 3' }))
      parts.push(el('line', { x1: BX + BWID, y1: b.y, x2: BX + BWID, y2: b.y + b.h, stroke: theme.faint, 'stroke-dasharray': '3 3' }))
      continue
    }
    const c = color(b.tint, b.i), isHl = (spec.highlight ?? []).includes(b.name)
    parts.push(el('rect', { x: BX, y: b.y, width: BWID, height: b.h, fill: c, 'fill-opacity': 0.2, stroke: isHl ? theme.highlight : c, 'stroke-width': isHl ? 2.4 : 1.4 }))
    const two = b.h >= 38
    parts.push(sans(b.name, BX + BWID / 2, b.y + b.h / 2 + (two ? -7 : 0), theme, { size: 13, middle: true }))
    if (two) parts.push(mono(fmtSize(b.to - b.from + 1n), BX + BWID / 2, b.y + b.h / 2 + 10, theme, { size: 10.5, fill: theme.muted, middle: true }))
    if (b.grows === 'up' || b.grows === 'down') {
      const ax = BX + BWID - 14, len = Math.min(18, b.h - 12)
      const [ya, yb] = (b.grows === 'up') !== lowTop ? [b.y + 6 + len, b.y + 6] : [b.y + b.h - 6 - len, b.y + b.h - 6]
      parts.push(el('line', { x1: ax, y1: ya, x2: ax, y2: yb, stroke: theme.muted, 'stroke-width': 1.6, 'marker-end': `url(#${uid}-ar)` }))
    } else if (b.grows !== undefined) diag.warn(`${b.path}.grows`, 'use "up" or "down"')
  }
  // Boundary addresses: every region's start at its low edge; its end at the high edge when no region starts right above it.
  const lowEdge = (b) => (lowTop ? b.y : b.y + b.h), highEdge = (b) => (lowTop ? b.y + b.h : b.y)
  bands.forEach((b, k) => {
    if (b.gap) return
    labels.push({ y: lowEdge(b), s: fmtA(b.from) })
    const next = bands[k + 1]
    if (!next || next.gap) labels.push({ y: highEdge(b), s: fmtA(b.to) })
  })
  for (const l of labels) {
    parts.push(el('line', { x1: BX - 6, y1: l.y, x2: BX, y2: l.y, stroke: theme.muted }))
    parts.push(mono(l.s, BX - 9, l.y, theme, { anchor: 'end', size: 11, fill: theme.muted, middle: true }))
  }
  // Marks: named addresses (sp, gp, a pointer) as arrows from the right.
  let right = BX + BWID
  const marks = (m.marks ?? []).map((k, i) => {
    const a = parseAddr(k.at)
    if (a === null) throw new SpecError(`map.marks[${i}].at`, 'give the address as hex')
    const b = bands.find((x) => a >= x.from && a <= x.to)
    if (!b) { diag.warn(`map.marks[${i}].at`, `${k.at} is outside every region`); return null }
    const f = Number(a - b.from) / span(b)
    return { name: k.name ?? '', a, y: lowTop ? b.y + f * b.h : b.y + b.h - f * b.h }
  }).filter(Boolean).sort((p, q) => p.y - q.y)
  for (let k = 1; k < marks.length; k++) if (marks[k].y - marks[k - 1].y < 16) marks[k].ly = (marks[k - 1].ly ?? marks[k - 1].y) + 16
  for (const k of marks) {
    const ly = k.ly ?? k.y
    parts.push(el('path', { d: `M${BX + BWID + 40} ${ly}L${BX + BWID + 22} ${ly}L${BX + BWID + 4} ${k.y}`, fill: 'none', stroke: theme.fg, 'stroke-width': 1.4, 'marker-end': `url(#${uid}-am)` }))
    const t = `${k.name} = ${fmtA(k.a)}`
    parts.push(mono(t, BX + BWID + 46, ly, theme, { anchor: 'start', size: 11.5, middle: true }))
    right = Math.max(right, BX + BWID + 46 + monoW(t, 11.5))
  }
  const defs = hatch(uid, theme) + marker(`${uid}-am`, theme.fg)
  const arrowDefs = el('marker', { id: `${uid}-ar`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto' }, [el('path', { d: 'M0 0L10 5L0 10z', fill: theme.muted })])
  const summary = `layout map (${lowTop ? 'low addresses at the top' : 'high addresses at the top'}, ${scale} scale): ` +
    bands.map((b) => b.gap ? `gap ${fmtA(b.from)}-${fmtA(b.to)}` : `${b.name} ${fmtA(b.from)}-${fmtA(b.to)} (${fmtSize(b.to - b.from + 1n)})`).join(', ') +
    (marks.length ? `; marks ${marks.map((k) => `${k.name} ${fmtA(k.a)}`).join(', ')}` : '')
  return { body: el('g', {}, parts), width: right + M, height: barBottom + M, defs: defs + arrowDefs, summary, alt: 'memory map' }
}

export default {
  kind: 'layout',
  fields: ['struct', 'bytes', 'map', 'abi', 'reorder', 'row', 'packed', 'highlight'],
  collections: [],
  render(spec, ctx) {
    const modes = ['struct', 'bytes', 'map'].filter((k) => spec[k] !== undefined)
    if (modes.length !== 1) throw new SpecError(modes.length ? modes[1] : 'struct', 'give exactly one of "struct", "bytes", or "map"')
    if (modes[0] === 'struct') return renderStruct(spec, ctx)
    if (modes[0] === 'bytes') return renderBytes(spec, ctx)
    return renderMap(spec, ctx)
  },
}
