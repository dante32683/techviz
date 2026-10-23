// Draw Graphviz layout output (the JSON format: xdot draw ops per object) as
// themed SVG. Black strokes and text become theme.fg, white fills disappear,
// and any other color snaps to the nearest palette color, with fills as tints.

import { el, esc } from '../../svg.js'
import { color, COLOR_NAMES } from '../../theme.js'

const hex = (h) => { const m = /^#?([0-9a-f]{6})/i.exec(h); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null }
const NAMED = COLOR_NAMES.map((n) => ({ n, rgb: hex(color(n)) }))

function snap(c) {
  const rgb = hex(c)
  if (!rgb) return null
  let best = null, bd = Infinity
  for (const p of NAMED) {
    const d = p.rgb.reduce((s, v, i) => s + (v - rgb[i]) ** 2, 0)
    if (d < bd) { bd = d; best = p.n }
  }
  return color(best)
}

const isBlack = (c) => /^#0{6}(ff)?$/i.test(c) || c === 'black'
const isWhite = (c) => /^#f{6}(ff)?$/i.test(c) || c === 'white'
const transparent = (c) => /^#[0-9a-f]{6}00$/i.test(c) || c === 'transparent' || c === 'none'

/**
 * Turn draw ops into SVG strings.
 * opts: { theme, Y (y flip), role: 'node' | 'edge' | 'cluster' | 'graph', hl (bool),
 *         text(op, index) -> markup | undefined (custom label drawing) }
 */
export function drawOps(ops, { theme, Y, role, hl = false, text }) {
  const out = []
  let stroke = theme.fg, fill = null, style = [], font = { size: theme.size, face: '' }, ti = 0
  const lineColor = () => (hl ? theme.highlight : stroke)
  const sw = () => {
    const lw = style.find((s) => s.startsWith('setlinewidth('))
    const base = lw ? parseFloat(lw.slice(13)) : role === 'edge' ? 1.2 : 1.4
    return (style.includes('bold') ? base + 1 : base) + (hl ? 0.9 : 0)
  }
  const dash = () => (style.includes('dashed') ? '5 3' : style.includes('dotted') ? '1.5 3' : undefined)
  const pt = ([x, y]) => `${x.toFixed(1)},${Y(y).toFixed(1)}`
  const fillAttrs = (filled) => {
    if (!filled) return { fill: 'none' }
    if (role === 'edge') return { fill: lineColor() } // arrowheads
    if (hl) return { fill: theme.highlight, 'fill-opacity': 0.15 }
    if (!fill || transparent(fill) || isWhite(fill)) return { fill: 'none' }
    if (isBlack(fill)) return { fill: theme.fg }
    return { fill: snap(fill), 'fill-opacity': 0.2 }
  }
  const strokeAttrs = () => ({ stroke: lineColor(), 'stroke-width': sw(), 'stroke-dasharray': dash() })
  for (const op of ops ?? []) {
    switch (op.op) {
      case 'c': stroke = transparent(op.color) ? 'none' : isBlack(op.color) ? theme.fg : isWhite(op.color) ? theme.bg ?? 'none' : snap(op.color) ?? theme.fg; break
      case 'C': fill = op.color; break
      case 'S': if (/^(solid|dashed|dotted|bold|invis|setlinewidth\(.*\))$/.test(op.style)) style = op.style === 'solid' ? style.filter((s) => s.startsWith('setlinewidth(')) : [...style, op.style]; break
      case 'F': font = { size: op.size, face: op.face }; break
      case 'e': case 'E': {
        const [cx, cy, rx, ry] = op.rect
        out.push(el('ellipse', { cx: cx.toFixed(1), cy: Y(cy).toFixed(1), rx: rx.toFixed(1), ry: ry.toFixed(1), ...fillAttrs(op.op === 'E'), ...strokeAttrs() }))
        break
      }
      case 'p': case 'P':
        out.push(el('polygon', { points: op.points.map(pt).join(' '), ...fillAttrs(op.op === 'P'), ...strokeAttrs(), 'stroke-linejoin': 'round' }))
        break
      case 'L':
        out.push(el('polyline', { points: op.points.map(pt).join(' '), fill: 'none', ...strokeAttrs() }))
        break
      case 'b': case 'B': {
        const p = op.points
        let d = `M${pt(p[0])}`
        for (let i = 1; i + 2 < p.length; i += 3) d += `C${pt(p[i])} ${pt(p[i + 1])} ${pt(p[i + 2])}`
        out.push(el('path', { d, ...fillAttrs(op.op === 'B'), ...strokeAttrs(), 'stroke-linecap': 'round' }))
        break
      }
      case 'T': {
        const custom = text?.(op, ti++, font)
        if (custom !== undefined) { out.push(custom); break }
        const mono = /courier|mono|consolas/i.test(font.face)
        out.push(el('text', {
          x: op.pt[0].toFixed(1), y: Y(op.pt[1]).toFixed(1), 'text-anchor': op.align === 'l' ? 'start' : op.align === 'r' ? 'end' : 'middle',
          'font-size': Math.round(font.size * 10) / 10, 'font-family': mono ? theme.mono : undefined,
          'font-weight': /bold/i.test(font.face) ? 'bold' : undefined, 'font-style': /italic|oblique/i.test(font.face) ? 'italic' : undefined,
          fill: hl ? theme.highlight : stroke === 'none' ? theme.fg : stroke,
        }, esc(op.text)))
        break
      }
      default: break
    }
  }
  return style.includes('invis') ? [] : out
}

/**
 * Draw a whole layout. hooks: { nodeText(obj, op, i, font), edgeText(edge, op, i, font),
 * hlNode(obj), hlEdge(edge) }. Returns { body, width, height }.
 */
export function drawGraph(g, theme, hooks = {}, pad = 8) {
  const [, , bw, bh] = String(g.bb).split(',').map(Number)
  const Y = (y) => bh - y + pad
  const X0 = pad
  const parts = []
  const objects = g.objects ?? []
  const nSub = g._subgraph_cnt ?? 0
  // Clusters first (behind), then edges, then nodes.
  for (const o of objects.slice(0, nSub)) {
    if (!/^cluster/.test(o.name ?? '')) continue
    parts.push(...drawOps(o._draw_, { theme, Y, role: 'cluster' }), ...drawOps(o._ldraw_, { theme, Y, role: 'cluster' }))
  }
  for (const e of g.edges ?? []) {
    const hl = !!hooks.hlEdge?.(e)
    const t = (op, i, font) => hooks.edgeText?.(e, op, i, font, hl, Y)
    for (const key of ['_draw_', '_hdraw_', '_tdraw_']) parts.push(...drawOps(e[key], { theme, Y, role: 'edge', hl }))
    for (const key of ['_ldraw_', '_hldraw_', '_tldraw_', '_xldraw_']) parts.push(...drawOps(e[key], { theme, Y, role: 'edge', hl, text: key === '_ldraw_' ? t : undefined }))
  }
  for (const o of objects.slice(nSub)) {
    const hl = !!hooks.hlNode?.(o)
    const t = (op, i, font) => hooks.nodeText?.(o, op, i, font, hl, Y)
    parts.push(...drawOps(o._draw_, { theme, Y, role: 'node', hl }), ...drawOps(o._ldraw_, { theme, Y, role: 'node', hl, text: t }), ...drawOps(o._xldraw_, { theme, Y, role: 'node', hl }))
  }
  return { body: el('g', { transform: `translate(${X0},0)` }, parts), width: bw + 2 * pad, height: bh + 2 * pad }
}
