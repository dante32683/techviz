// Turn a WaveDrom onml tree (['tag', {attrs}, ...children]) into themed SVG
// markup: skin classes and fixed colors become theme roles, ids get the uid
// prefix, unused skin bricks are dropped, and the white background goes.
// Wave strokes use currentColor so one lane can be recolored for highlight.

import { el, esc } from '../../svg.js'
import { color } from '../../theme.js'

const isAttrs = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const split = (n) => (isAttrs(n[1]) ? [n[0], n[1], n.slice(2)] : [n[0], {}, n.slice(1)])

function parseStyle(s) {
  const o = {}
  for (const d of String(s ?? '').split(';')) {
    const i = d.indexOf(':')
    if (i > 0) o[d.slice(0, i).trim()] = d.slice(i + 1).trim()
  }
  return o
}

const WHITE = /^(#fff|#ffffff|white)$/i
const BLACK = /^(#000|#000000|black)$/i
const BLUE = /^(#0041c4|#00f|#0000ff|blue)$/i
const GRAY = /^#888(888)?$/i

// WaveDrom data colors 3-9 and bit-field types 2-7, as palette tints.
const WAVE_TINT = { s8: 'amber', s9: 'coral', s10: 'blue', s11: 'teal', s12: 'green', s13: 'purple', s14: 'pink' }
const REG_TINT = { '#ff0000': 'red', '#aaff00': 'green', '#00ffd5': 'teal', '#ffbf00': 'amber', '#00ff19': 'purple', '#006aff': 'blue' }
const HEAD = { h1: 2.2, h2: 1.8, h3: 1.4, h4: 1.15, h5: 1, h6: 0.8 }

function classAttrs(cls, theme) {
  const out = {}
  for (const c of String(cls).split(/\s+/)) {
    if (c === 's1') Object.assign(out, { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.25, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
    else if (c === 's2') Object.assign(out, { fill: 'none', stroke: theme.muted, 'stroke-width': 0.6 })
    else if (c === 's3') Object.assign(out, { fill: 'none', stroke: 'currentColor', 'stroke-width': 1, 'stroke-dasharray': '1,3', 'stroke-linecap': 'round' })
    else if (c === 's4') Object.assign(out, { fill: 'none', stroke: 'currentColor', 'stroke-width': 1 })
    else if (c === 's5') Object.assign(out, { fill: theme.bg ?? 'none', stroke: 'none' })
    else if (c === 's6') Object.assign(out, { fill: 'currentColor', stroke: 'none' })
    else if (c === 's7') Object.assign(out, { fill: 'none', stroke: 'none' })
    else if (WAVE_TINT[c]) Object.assign(out, { fill: color(WAVE_TINT[c]), 'fill-opacity': 0.22, stroke: 'none' })
    else if (c === 's15') Object.assign(out, { fill: theme.muted, stroke: 'none' })
    else if (c === 's16') Object.assign(out, { fill: 'none', stroke: theme.muted, 'stroke-width': 1 })
    else if (c === 'info') out.fill = theme.fg
    else if (c === 'muted') out.fill = theme.muted
    else if (c === 'warning') out.fill = color('amber')
    else if (c === 'error') out.fill = color('red')
    else if (c === 'success') out.fill = color('green')
    else if (HEAD[c]) Object.assign(out, { 'font-size': Math.round(theme.size * HEAD[c]), 'font-weight': 'bold' })
  }
  return out
}

/**
 * @param root onml tree from wavedrom.renderAny
 * @param opts { theme, uid, highlight: Set of signal names, pad }
 * @returns { body, defs, width, height }
 */
export function restyle(root, { theme, uid, highlight = new Set(), pad = 10 }) {
  const [, rootAttrs, kids] = split(root)
  const H = Number(rootAttrs.height)
  let W = Number(rootAttrs.width)
  // Timing diagrams end at the last cycle mark (lanes offset + last gmark x).
  const lanes = find(root, (n) => /^lanes_/.test(split(n)[1].id ?? ''))
  const marks = lanes && find(lanes, (n) => /^gmarks_/.test(split(n)[1].id ?? ''))
  if (marks) {
    const xs = all(marks, (n) => n[0] === 'line').map((n) => Number(split(n)[1].x1)).filter(Number.isFinite)
    const off = /translate\(([\d.]+)/.exec(split(lanes)[1].transform ?? '')
    if (xs.length && off) W = Math.min(W, Number(off[1]) + Math.max(...xs) + 1)
  }
  const W0 = Number(rootAttrs.width)
  const ref = (id) => `${uid}-${id}`
  const fixUrl = (v) => String(v).replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${ref(id)})`)

  // References outside <defs>, so only used bricks and markers are kept.
  const used = new Set()
  const collect = (n) => {
    if (!Array.isArray(n)) return
    const [tag, a, ch] = split(n)
    if (tag === 'defs') return
    for (const v of Object.values(a)) {
      const s = String(v)
      if (s.startsWith('#') && (a['xlink:href'] === v || a.href === v)) used.add(s.slice(1))
      for (const m of s.matchAll(/url\(#([^)]+)\)/g)) used.add(m[1])
    }
    ch.forEach(collect)
  }
  kids.forEach(collect)

  const paint = (prop, v, tag) => {
    if (v === undefined) return undefined
    const s = String(v).trim()
    if (s === 'none' || s.startsWith('url(')) return s
    if (BLACK.test(s)) return tag === 'text' || tag === 'tspan' ? theme.fg : 'currentColor'
    if (WHITE.test(s)) return prop === 'fill' ? theme.bg ?? 'none' : theme.fg
    if (BLUE.test(s)) return theme.muted
    if (GRAY.test(s)) return theme.faint
    if (REG_TINT[s.toLowerCase()]) return color(REG_TINT[s.toLowerCase()])
    return theme.muted
  }

  const conv = (n, inDefs, ctx) => {
    if (!Array.isArray(n)) return esc(n)
    const [tag, a0, ch] = split(n)
    if (tag === 'style' || tag === 'title') return ''
    const style = parseStyle(a0.style)
    // The full-size white background rectangle.
    if (tag === 'rect' && !a0.x && !a0.y && Number(a0.width) === W0 && Number(a0.height) === H && WHITE.test(style.fill ?? a0.fill ?? '')) return ''
    const a = {}
    for (const [k, v] of Object.entries(a0)) {
      if (k === 'style' || k === 'class' || k === 'fill' || k === 'stroke' || k === 'xmlns' || k === 'xmlns:xlink' || k === 'field' || k === 'overflow') continue
      if (k === 'id') { if (inDefs) a.id = ref(v); continue }
      if (k === 'xlink:href' || k === 'href') { a.href = '#' + ref(String(v).replace(/^#/, '')); continue }
      a[k] = v
    }
    if (a0.class) Object.assign(a, classAttrs(a0.class, theme))
    for (const [k, v] of Object.entries(style)) {
      if (k === 'fill' || k === 'stroke') continue
      if (['stroke-width', 'stroke-dasharray', 'fill-opacity', 'stroke-linecap', 'stroke-linejoin', 'font-size', 'font-weight', 'marker-end', 'marker-start', 'marker-mid'].includes(k)) a[k] = k.startsWith('marker') ? fixUrl(v) : v.replace(/px$/, '')
    }
    for (const p of ['fill', 'stroke']) {
      if (style[p] !== undefined) a[p] = paint(p, style[p], tag)
      else if (a[p] === undefined && a0[p] !== undefined) a[p] = paint(p, a0[p], tag)
    }
    if (a['fill-opacity'] !== undefined && style.fill && REG_TINT[String(style.fill).toLowerCase()]) a['fill-opacity'] = 0.2
    if (tag === 'rect' && a.fill === undefined && a['fill-opacity'] !== undefined) a.fill = 'none'
    if (tag === 'text' && a['font-size'] !== undefined && Number(a['font-size']) < theme.size - 1) a['font-size'] = theme.size - 1
    if (tag === 'g' && a['font-family']) a['font-family'] = theme.font
    if (tag === 'g' && a['font-size'] && !a0.class) a['font-size'] = theme.size

    let next = ctx
    if (tag === 'g' && typeof a0.id === 'string' && /^wavelane_\d+_\d+$/.test(a0.id)) {
      const name = textOf(ch.find((c) => Array.isArray(c) && c[0] === 'text'))
      if (highlight.has(name.trim())) { a.color = theme.highlight; next = { ...ctx, hl: true } }
    }
    if (next.hl && tag === 'text' && a0.class === 'info') { a.fill = theme.highlight; a['font-weight'] = 'bold' }

    if (tag === 'defs') {
      const keep = ch.filter((c) => Array.isArray(c) && used.has(split(c)[1].id))
      return keep.length ? keep.map((c) => conv(c, true, next)).join('') : ''
    }
    if (tag === 'svg') return ch.map((c) => conv(c, inDefs, next)).join('')
    return el(tag, a, ch.map((c) => conv(c, inDefs, next)))
  }

  const defs = []
  const body = []
  for (const c of kids) {
    if (Array.isArray(c) && c[0] === 'defs') defs.push(conv(c, true, {}))
    else body.push(conv(c, false, {}))
  }
  // WaveDrom's own <svg> clipped lanes that run past hbounds; keep that.
  defs.push(el('clipPath', { id: ref('clip') }, [el('rect', { x: 0, y: 0, width: W, height: H })]))
  return {
    body: el('g', { transform: `translate(${pad},${pad})`, color: theme.fg, fill: theme.fg, 'font-family': theme.font, 'font-size': theme.size }, [el('g', { 'clip-path': `url(#${ref('clip')})` }, body)]),
    defs: defs.join(''),
    width: W + 2 * pad,
    height: H + 2 * pad,
  }
}

function textOf(n) {
  if (n === undefined || n === null) return ''
  if (!Array.isArray(n)) return String(n)
  return split(n)[2].map(textOf).join('')
}

function all(n, pred, out = []) {
  if (!Array.isArray(n)) return out
  if (pred(n)) out.push(n)
  for (const c of split(n)[2]) all(c, pred, out)
  return out
}
const find = (n, pred) => all(n, pred)[0]
