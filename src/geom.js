// Shared numeric helpers: ticks, contours, ODE integration, curve sampling.

/** Nice tick values covering [a, b], about `target` of them. */
export function ticks(a, b, target = 6) {
  if (!(b > a)) return [a]
  const raw = (b - a) / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => (b - a) / s <= target * 1.4) ?? 10 * mag
  const out = []
  for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return out
}

/** Decade ticks for a log axis. */
export function logTicks(a, b) {
  const out = []
  for (let k = Math.floor(Math.log10(a)); k <= Math.ceil(Math.log10(b)); k++) { const v = 10 ** k; if (v >= a * 0.999 && v <= b * 1.001) out.push(v) }
  return out
}

export function fmt(v) {
  if (v === 0) return '0'
  const a = Math.abs(v)
  let s
  if (a >= 1e5 || a < 1e-3) {
    const k = Math.floor(Math.log10(a)), m = v / 10 ** k
    s = (Math.abs(m - Math.round(m)) < 1e-9 ? String(Math.round(m)) : m.toPrecision(3).replace(/\.?0+$/, '')) + '×10^{' + k + '}'
    if (s.startsWith('1×')) s = s.slice(2)
  } else s = String(+v.toPrecision(6))
  return s.replace(/^-/, '−')
}

/** Contour lines of f(x, y) = level over a grid, as polylines in data coordinates. */
export function contours(f, [x0, x1, y0, y1], level, n = 80) {
  const nx = n, ny = Math.max(10, Math.round(n * (y1 - y0) / (x1 - x0)))
  const dx = (x1 - x0) / nx, dy = (y1 - y0) / ny
  const g = []
  for (let j = 0; j <= ny; j++) { const row = []; for (let i = 0; i <= nx; i++) row.push(f(x0 + i * dx, y0 + j * dy) - level); g.push(row) }
  const segs = []
  const lerp = (a, b, va, vb) => a + (b - a) * (va / (va - vb))
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = [g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i]]
    if (v.some((t) => !Number.isFinite(t) || Math.abs(t) > 1e12)) continue
    const X = x0 + i * dx, Y = y0 + j * dy
    const e = []
    if ((v[0] > 0) !== (v[1] > 0)) e.push([lerp(X, X + dx, v[0], v[1]), Y])
    if ((v[1] > 0) !== (v[2] > 0)) e.push([X + dx, lerp(Y, Y + dy, v[1], v[2])])
    if ((v[2] > 0) !== (v[3] > 0)) e.push([lerp(X, X + dx, v[3], v[2]), Y + dy])
    if ((v[3] > 0) !== (v[0] > 0)) e.push([X, lerp(Y, Y + dy, v[0], v[3])])
    if (e.length === 2) segs.push(e)
    else if (e.length === 4) { segs.push([e[0], e[1]]); segs.push([e[2], e[3]]) }
  }
  return joinSegments(segs, Math.min(dx, dy) * 0.01)
}

// Join contour segments into polylines.
function joinSegments(segs, eps) {
  const key = ([x, y]) => `${Math.round(x / eps)},${Math.round(y / eps)}`
  const ends = new Map()
  segs.forEach((s, i) => { for (const p of s) { const k = key(p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i) } })
  const used = new Set(), lines = []
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue
    used.add(i)
    const line = [...segs[i]]
    for (const dir of [1, -1]) {
      for (;;) {
        const tip = dir === 1 ? line[line.length - 1] : line[0]
        const next = (ends.get(key(tip)) ?? []).find((j) => !used.has(j))
        if (next === undefined) break
        used.add(next)
        const [a, b] = segs[next]
        const other = key(a) === key(tip) ? b : a
        if (dir === 1) line.push(other); else line.unshift(other)
      }
    }
    lines.push(line)
  }
  return lines
}

/** RK4 integration of dy/dx = f(x, y) from (x0, y0) in both directions, inside bounds. */
export function solveOde(f, [x0, y0], [xa, xb, ya, yb], steps = 600) {
  const h = (xb - xa) / steps
  const run = (sign) => {
    const out = []
    let x = x0, y = y0
    const span = (yb - ya) * 4
    for (let k = 0; k < steps * 2; k++) {
      const s = sign * h
      const k1 = f(x, y), k2 = f(x + s / 2, y + (s / 2) * k1), k3 = f(x + s / 2, y + (s / 2) * k2), k4 = f(x + s, y + s * k3)
      y += (s / 6) * (k1 + 2 * k2 + 2 * k3 + k4)
      x += s
      if (!Number.isFinite(y) || x < xa || x > xb || y < ya - span || y > yb + span) break
      out.push([x, y])
    }
    return out
  }
  return [...run(-1).reverse(), [x0, y0], ...run(1)]
}

/** Sample y = f(x) into polylines, breaking at non-finite values and jumps (asymptotes). */
export function sampleFn(f, [a, b], n, yspan, log = false) {
  const lines = []
  let cur = []
  let prev
  for (let i = 0; i <= n; i++) {
    const x = log ? a * Math.pow(b / a, i / n) : a + ((b - a) * i) / n
    let y
    try { y = f(x) } catch { y = NaN }
    if (!Number.isFinite(y) || (prev !== undefined && Math.abs(y - prev) > yspan * 3)) {
      if (cur.length > 1) lines.push(cur)
      cur = Number.isFinite(y) ? [[x, y]] : []
    } else cur.push([x, y])
    prev = Number.isFinite(y) ? y : undefined
  }
  if (cur.length > 1) lines.push(cur)
  return lines
}
