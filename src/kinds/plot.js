// plot: 2D graphs of functions, parametric curves, data points, reference marks,
// and slope fields with solution curves (dy/dx = f(x, y)).

import { el, pathD, arrowMarker } from '../svg.js'
import { labelSvg, measure } from '../label.js'
import { color } from '../theme.js'
import { compile, compileFor } from '../expr.js'
import { SpecError } from '../diag.js'
import { ticks, logTicks, fmt, contours, solveOde, sampleFn, clipPolyline } from '../geom.js'

const fn1 = (src, name, env) => { const { fn } = compileFor(src, [...Object.keys(env), name]); return (v) => fn({ ...env, [name]: v }) }
const fn2 = (src, env) => { const { fn } = compileFor(src, [...Object.keys(env), 'x', 'y']); return (x, y) => fn({ ...env, x, y }) }
const val = (v, env, path) => {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return compileFor(v, Object.keys(env)).fn(env)
  throw new SpecError(path, `expected a number or expression, got ${JSON.stringify(v)}`)
}

function axisTitle(ax, dflt) {
  if (!ax.label && !ax.unit) return dflt
  return ax.unit ? `${ax.label ?? ''} (\\text{${ax.unit}})`.trim() : ax.label
}

export default {
  kind: 'plot',
  fields: ['x', 'y', 'series', 'marks', 'slopefield', 'solutions', 'isoclines', 'grid', 'highlight', 'size'],
  collections: ['series', 'marks', 'solutions'],
  render(spec, { theme, diag, env, uid }) {
    const W = spec.size?.[0] ?? 560, H = spec.size?.[1] ?? 330
    const xa = spec.x ?? {}, ya = spec.y ?? {}
    if (!Array.isArray(xa.range) || xa.range.length !== 2) throw new SpecError('x.range', 'give the x range as [min, max]')
    const xr = xa.range.map((v, i) => val(v, env, `x.range[${i}]`))
    const xlog = !!xa.log, ylog = !!ya.log
    if (xlog && xr[0] <= 0) throw new SpecError('x.range', 'a log axis needs a positive range')
    const series = spec.series ?? []
    const marks = spec.marks ?? []

    // Sample everything in data space first, to find the y range when none is given.
    const xspanGuess = xr[1] - xr[0]
    const sampled = series.map((s, i) => {
      const path = `series[${i}]`
      try {
        if (s.points) {
          if (!Array.isArray(s.points)) throw new SpecError(`${path}.points`, 'points is a list of [x, y] pairs')
          return { s, lines: [s.points.map((p) => [val(p[0], env), val(p[1], env)])], dots: s.style === 'dots' || !s.style }
        }
        if (s.x !== undefined && s.y !== undefined && s.t) {
          const fx = fn1(s.x, 't', env), fy = fn1(s.y, 't', env)
          const [t0, t1] = s.t.map((v) => val(v, env))
          const n = s.samples ?? 400
          const line = []
          for (let k = 0; k <= n; k++) { const t = t0 + ((t1 - t0) * k) / n; line.push([fx(t), fy(t)]) }
          return { s, lines: [line.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))] }
        }
        if (typeof s.y === 'string' || typeof s.y === 'number') {
          const f = fn1(String(s.y), 'x', env)
          const dom = s.domain ? s.domain.map((v) => val(v, env)) : xr
          return { s, lines: sampleFn(f, dom, s.samples ?? 500, Infinity, xlog), f }
        }
        throw new SpecError(path, 'a series needs "y" (an expression in x), "points", or "x", "y" and "t" for a parametric curve')
      } catch (err) {
        if (err instanceof SpecError) throw err
        throw new SpecError(path, err.message)
      }
    })

    let yr
    if (Array.isArray(ya.range)) yr = ya.range.map((v, i) => val(v, env, `y.range[${i}]`))
    else {
      const ys = sampled.flatMap((d) => d.lines.flat().map((p) => p[1])).filter(Number.isFinite).sort((a, b) => a - b)
      if (!ys.length) yr = [-1, 1]
      else {
        const lo = ys[Math.floor(ys.length * 0.01)], hi = ys[Math.ceil(ys.length * 0.99) - 1]
        const pad = (hi - lo || 1) * 0.08
        yr = [lo >= 0 && lo - pad < 0 ? 0 : lo - pad, hi + pad]
      }
    }
    if (!(yr[1] > yr[0])) throw new SpecError('y.range', 'the y range must have max > min')
    if (!(xr[1] > xr[0])) throw new SpecError('x.range', 'the x range must have max > min')

    // Layout: room for tick labels and axis titles, and for direct labels at the right.
    const fs = theme.size
    const yTicks = ylog ? logTicks(...yr) : ticks(...yr, Math.max(3, Math.round(H / 60)))
    const xTicks = xlog ? logTicks(...xr) : ticks(...xr, Math.max(3, Math.round(W / 85)))
    const yTickW = Math.max(...yTicks.map((v) => measure(fmt(v), fs - 1)))
    const directLabels = sampled.filter((d) => d.s.label && !d.dots)
    const rightPad = Math.min(140, Math.max(16, ...directLabels.map((d) => measure(d.s.label) + 12)))
    const L = 18 + yTickW + (ya.label || ya.unit ? fs + 10 : 0), R = W - rightPad, T = 14, B = H - (xa.label || xa.unit ? 46 : 28)
    const X = (x) => (xlog ? L + ((Math.log10(x) - Math.log10(xr[0])) / (Math.log10(xr[1]) - Math.log10(xr[0]))) * (R - L) : L + ((x - xr[0]) / (xr[1] - xr[0])) * (R - L))
    const Y = (y) => (ylog ? B - ((Math.log10(y) - Math.log10(yr[0])) / (Math.log10(yr[1]) - Math.log10(yr[0]))) * (B - T) : B - ((y - yr[0]) / (yr[1] - yr[0])) * (B - T))
    const clipId = `${uid}-clip`
    // Curves are clipped to the plot area in the geometry, not only by clip-path: getBBox()
    // ignores clip-path, and the Desktop widget host grows an SVG's viewBox and height to its
    // children's boxes, so a solution curve running far below the frame left a tall blank gap.
    const curveD = (line) => clipPolyline(line.map(([x, y]) => [X(x), Y(y)]), [L, R, T, B]).map((p) => pathD(p)).join('')
    const inside = (x, y) => X(x) >= L - 0.5 && X(x) <= R + 0.5 && Y(y) >= T - 0.5 && Y(y) <= B + 0.5
    const curve = (line, attrs) => { const d = curveD(line); if (d) plotArea.push(el('path', { d, fill: 'none', ...attrs })) }
    const parts = []
    const defs = [el('clipPath', { id: clipId }, [el('rect', { x: L, y: T, width: R - L, height: B - T })]), arrowMarker(`${uid}-arr`, theme.fg)]

    // Grid and axes. Axes sit at zero when zero is in range, else at the frame edge.
    if (spec.grid !== false) {
      for (const v of xTicks) parts.push(el('line', { x1: X(v), y1: T, x2: X(v), y2: B, stroke: theme.grid, 'stroke-width': 1 }))
      for (const v of yTicks) parts.push(el('line', { x1: L, y1: Y(v), x2: R, y2: Y(v), stroke: theme.grid, 'stroke-width': 1 }))
    }
    const x0 = !xlog && xr[0] < 0 && xr[1] > 0 ? X(0) : L
    const y0 = !ylog && yr[0] < 0 && yr[1] > 0 ? Y(0) : B
    parts.push(el('line', { x1: L, y1: y0, x2: R, y2: y0, stroke: theme.muted, 'stroke-width': 1.2 }))
    parts.push(el('line', { x1: x0, y1: T, x2: x0, y2: B, stroke: theme.muted, 'stroke-width': 1.2 }))
    for (const v of xTicks) {
      parts.push(el('line', { x1: X(v), y1: y0, x2: X(v), y2: y0 + 4, stroke: theme.muted }))
      parts.push(labelSvg(fmt(v), X(v), B + 16, theme, { size: fs - 1, fill: theme.muted }))
    }
    for (const v of yTicks) {
      parts.push(el('line', { x1: x0 - 4, y1: Y(v), x2: x0, y2: Y(v), stroke: theme.muted }))
      parts.push(labelSvg(fmt(v), L - 7, Y(v), theme, { anchor: 'end', size: fs - 1, fill: theme.muted, middle: true }))
    }
    const xt = axisTitle(xa), yt = axisTitle(ya)
    if (xt) parts.push(labelSvg(xt, (L + R) / 2, H - 14, theme, { fill: theme.fg }))
    if (yt) parts.push(`<g transform="translate(${fs + 2},${(T + B) / 2}) rotate(-90)">${labelSvg(yt, 0, 0, theme, { fill: theme.fg })}</g>`)

    const plotArea = []
    const box = [xr[0], xr[1], yr[0], yr[1]]

    // Slope field: short equal-length segments of slope f(x, y).
    if (spec.slopefield) {
      const sf = spec.slopefield
      if (typeof sf.dydx !== 'string') throw new SpecError('slopefield.dydx', 'give dy/dx as an expression in x and y, like "x - y"')
      const f = fn2(sf.dydx, env)
      const n = sf.density ?? 21
      const sx = (R - L) / n, sy = (B - T) / Math.round((n * (B - T)) / (R - L))
      const len = Math.min(sx, sy) * 0.62
      for (let px = L + sx / 2; px < R; px += sx) for (let py = T + sy / 2; py < B; py += sy) {
        const x = xr[0] + ((px - L) / (R - L)) * (xr[1] - xr[0]), y = yr[0] + ((B - py) / (B - T)) * (yr[1] - yr[0])
        let m
        try { m = f(x, y) } catch { continue }
        if (!Number.isFinite(m)) continue
        // Slope in screen space accounts for the axis scales.
        const ang = Math.atan2(-m * (B - T) / (yr[1] - yr[0]), (R - L) / (xr[1] - xr[0]))
        const dx = (Math.cos(ang) * len) / 2, dy = (Math.sin(ang) * len) / 2
        plotArea.push(el('line', { x1: px - dx, y1: py - dy, x2: px + dx, y2: py + dy, stroke: sf.color ? color(sf.color) : theme.muted, 'stroke-width': 1.1, 'stroke-linecap': 'round' }))
      }
      for (const [i, iso] of (spec.isoclines ?? []).entries()) {
        const c = typeof iso === 'object' ? val(iso.value, env, `isoclines[${i}].value`) : val(iso, env, `isoclines[${i}]`)
        for (const line of contours(f, box, c, 90)) curve(line, { stroke: color('amber'), 'stroke-width': 1.3, 'stroke-dasharray': '5 4' })
        const lab = typeof iso === 'object' && iso.label ? iso.label : `m = ${fmt(c)}`
        const lines = contours(f, box, c, 90)
        const longest = lines.sort((a, b) => b.length - a.length)[0]
        if (longest) { const p = longest[Math.floor(longest.length * 0.8)]; parts.push(labelSvg(lab, X(p[0]) + 4, Y(p[1]) - 5, theme, { anchor: 'start', size: fs - 1, fill: color('amber') })) }
      }
      for (const [i, s] of (spec.solutions ?? []).entries()) {
        if (!Array.isArray(s.from)) throw new SpecError(`solutions[${i}].from`, 'give the initial point as [x0, y0]')
        const from = s.from.map((v) => val(v, env))
        const line = solveOde(f, from, box)
        const c = color(s.color, i)
        curve(line, { stroke: c, 'stroke-width': 2.2 })
        if (inside(...from)) plotArea.push(el('circle', { cx: X(from[0]), cy: Y(from[1]), r: 3.5, fill: c }))
        if (s.label) parts.push(labelSvg(s.label, X(from[0]) + 6, Y(from[1]) - 6, theme, { anchor: 'start', fill: c }))
      }
    } else if (spec.solutions?.length) diag.warn('solutions', 'solutions need a slopefield with dydx')

    // Series.
    const hl = new Set(spec.highlight ?? [])
    const ends = []
    sampled.forEach((d, i) => {
      const c = color(d.s.color, i)
      const w = (d.s.width ?? 2.2) + (hl.has(d.s.id) ? 1.5 : 0)
      const dash = d.s.style === 'dashed' ? '6 4' : d.s.style === 'dotted' ? '2 3' : undefined
      if (d.dots) {
        for (const [x, y] of d.lines[0]) if (inside(x, y)) plotArea.push(el('circle', { cx: X(x), cy: Y(y), r: 3.4, fill: c }))
        if (d.s.connect) curve(d.lines[0], { stroke: c, 'stroke-width': 1.4 })
      } else for (const line of d.lines) curve(line, { stroke: c, 'stroke-width': w, 'stroke-dasharray': dash, 'stroke-linejoin': 'round' })
      if (d.s.label) {
        // Direct label at the last visible point.
        const vis = d.lines.flat().filter(([x, y]) => x >= xr[0] && x <= xr[1] && y >= yr[0] && y <= yr[1])
        const p = vis[vis.length - 1]
        if (p) ends.push({ y: Y(p[1]), x: d.dots ? X(p[0]) + 8 : R + 6, label: d.s.label, c })
        else diag.warn(`series[${i}]`, 'the curve is outside the plotted range')
      }
    })
    ends.sort((a, b) => a.y - b.y)
    for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < fs + 2) ends[k].y = ends[k - 1].y + fs + 2
    for (const e of ends) parts.push(labelSvg(e.label, e.x, e.y, theme, { anchor: 'start', fill: e.c, middle: true }))

    // Marks: reference lines, points, segments, arrows and free text.
    marks.forEach((m, i) => {
      const path = `marks[${i}]`
      const c = m.color ? color(m.color) : theme.muted
      const lab = m.label
      if (m.x !== undefined && m.y === undefined && !m.point) {
        const x = val(m.x, env, `${path}.x`)
        plotArea.push(el('line', { x1: X(x), y1: T, x2: X(x), y2: B, stroke: c, 'stroke-width': 1.2, 'stroke-dasharray': '5 4' }))
        if (lab) parts.push(labelSvg(lab, X(x) + 5, T + fs + 2, theme, { anchor: 'start', fill: m.color ? c : theme.fg }))
      } else if (m.y !== undefined && m.x === undefined && !m.point) {
        const y = val(m.y, env, `${path}.y`)
        plotArea.push(el('line', { x1: L, y1: Y(y), x2: R, y2: Y(y), stroke: c, 'stroke-width': 1.2, 'stroke-dasharray': '5 4' }))
        if (lab) parts.push(labelSvg(lab, L + 6, Y(y) - 5, theme, { anchor: 'start', fill: m.color ? c : theme.fg }))
      } else if (m.point) {
        const [x, y] = m.point.map((v, k) => val(v, env, `${path}.point[${k}]`))
        if (m.guides) {
          plotArea.push(el('line', { x1: X(x), y1: Y(y), x2: X(x), y2: y0, stroke: theme.muted, 'stroke-dasharray': '3 3' }))
          plotArea.push(el('line', { x1: X(x), y1: Y(y), x2: x0, y2: Y(y), stroke: theme.muted, 'stroke-dasharray': '3 3' }))
        }
        plotArea.push(el('circle', { cx: X(x), cy: Y(y), r: 4, fill: m.color ? c : theme.fg }))
        if (lab) parts.push(labelSvg(lab, X(x) + 7, Y(y) - 7, theme, { anchor: 'start', fill: theme.fg }))
      } else if (m.segment || m.arrow) {
        const [[a, b], [cc, dd]] = (m.segment ?? m.arrow).map((p) => p.map((v) => val(v, env)))
        plotArea.push(el('line', { x1: X(a), y1: Y(b), x2: X(cc), y2: Y(dd), stroke: m.color ? c : theme.fg, 'stroke-width': 1.6, 'marker-end': m.arrow ? `url(#${uid}-arr)` : undefined }))
        if (lab) parts.push(labelSvg(lab, (X(a) + X(cc)) / 2 + 6, (Y(b) + Y(dd)) / 2 - 6, theme, { anchor: 'start' }))
      } else if (m.text && m.at) {
        const [x, y] = m.at.map((v) => val(v, env))
        parts.push(labelSvg(m.text, X(x), Y(y), theme, { anchor: m.anchor ?? 'middle', fill: m.color ? c : theme.fg }))
      } else diag.warn(path, 'a mark needs x, y, point, segment, arrow, or text with at')
    })

    const body = el('g', {}, [...parts.slice(0, 0), ...parts.filter((p, k) => k < 0), el('g', { 'clip-path': `url(#${clipId})` }, plotArea), ...parts])
    const summary = `plot: x ${fmt(xr[0])} to ${fmt(xr[1])}, y ${fmt(yr[0])} to ${fmt(yr[1])}${ya.range ? '' : ' (auto)'}; ${series.length} series, ${marks.length} marks${spec.slopefield ? ', slope field' : ''}`
    return { body, width: W, height: H, defs: defs.join(''), summary, alt: 'plot' }
  },
}
