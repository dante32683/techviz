// Minimal SVG string builder. Every attribute and text value is escaped.

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const num = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '')) : v)

// CSS variables aren't reliable in presentation attributes, so a fill or stroke
// that names one moves into the style attribute.
const STYLE_ABLE = new Set(['fill', 'stroke', 'stop-color', 'color', 'font-family'])

export function attrs(a = {}) {
  let out = ''
  let style = a.style ?? ''
  for (const [k, v] of Object.entries(a)) {
    if (k === 'style' || v === undefined || v === null || v === false) continue
    if (STYLE_ABLE.has(k) && typeof v === 'string' && v.includes('var(')) style += `${k}:${v};`
    else out += ` ${k}="${esc(num(v))}"`
  }
  return style ? out + ` style="${esc(style)}"` : out
}

/** el('line', {x1, y1}) or el('g', {}, [children...]); children are strings already built. */
export function el(tag, a, children) {
  const kids = Array.isArray(children) ? children.filter(Boolean).join('') : children
  return kids === undefined || kids === '' ? `<${tag}${attrs(a)}/>` : `<${tag}${attrs(a)}>${kids}</${tag}>`
}

export const pts = (list) => list.map(([x, y]) => `${num(x)},${num(y)}`).join(' ')

/** Path data from points: M first, L the rest. */
export const pathD = (list, close = false) =>
  list.map(([x, y], i) => `${i ? 'L' : 'M'}${num(x)} ${num(y)}`).join('') + (close ? 'Z' : '')

/** An arrowhead marker definition, id-scoped so several diagrams on one page don't clash. */
export function arrowMarker(id, color) {
  return el('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
    [el('path', { d: 'M0 0L10 5L0 10z', fill: color })])
}

export function doc(width, height, body, theme, { alt = '', defs = '' } = {}) {
  const bg = theme.bg ? el('rect', { width, height, fill: theme.bg }) : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(width)} ${num(height)}" width="${num(width)}" height="${num(height)}" role="img" font-size="${theme.size}"${attrs({ 'font-family': theme.font })}>` +
    (alt ? `<title>${esc(alt)}</title>` : '') + (defs ? `<defs>${defs}</defs>` : '') + bg + body + '</svg>'
}
