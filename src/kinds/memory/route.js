// Orthogonal arrow routing around boxes: a sparse grid of candidate lines
// (just outside each obstacle, midway between obstacles, plus extra lanes),
// then Dijkstra with a cost for length, bends, and reuse of another arrow's
// segments, so arrows take separate lanes and never cross a box.

const M = 9 // distance of grid lines from an obstacle
const PAD = 3 // obstacles are inflated by this for the clearance test

class Heap {
  constructor() { this.a = [] }
  push(k, v) {
    const a = this.a; a.push([k, v]); let i = a.length - 1
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop()
    if (a.length) {
      a[0] = last; let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i
        if (l < a.length && a[l][0] < a[m][0]) m = l
        if (r < a.length && a[r][0] < a[m][0]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]; i = m
      }
    }
    return top
  }
  get size() { return this.a.length }
}

// Sorted candidate lines, merging ones closer than 1 px; port coordinates win so routes end exactly on them.
function uniq(v, ports) {
  const all = [...ports.map((x) => [x, 1]), ...v.map((x) => [x, 0])].sort((a, b) => a[0] - b[0])
  const out = []
  for (const [x, p] of all) {
    const last = out[out.length - 1]
    if (last && x - last[0] < 3 && !(p && last[1] && x !== last[0])) { if (p && !last[1]) out[out.length - 1] = [x, p] } else out.push([x, p])
  }
  return out.map((a) => a[0])
}

function gapMids(lo, hi) {
  // Midpoints of the free gaps along one axis, from obstacle intervals.
  const iv = lo.map((l, i) => [l, hi[i]]).sort((a, b) => a[0] - b[0])
  const out = []
  let end = -Infinity
  for (const [l, h] of iv) { if (l > end && end > -Infinity) out.push((end + l) / 2); end = Math.max(end, h) }
  return out
}

export class Router {
  /**
   * obstacles: [{ x, y, w, h }]; lanes: { xs: [], ys: [] } extra candidate lines;
   * ports: points every route will start or end at (added to the grid).
   */
  constructor(obstacles, { xs = [], ys = [] } = {}, ports = []) {
    this.obs = obstacles.map((o) => ({ l: o.x - PAD, r: o.x + o.w + PAD, t: o.y - PAD, b: o.y + o.h + PAD }))
    const X = [...xs, ...this.obs.flatMap((o) => [o.l - M + PAD, o.r + M - PAD]), ...gapMids(this.obs.map((o) => o.l), this.obs.map((o) => o.r))]
    const Y = [...ys, ...this.obs.flatMap((o) => [o.t - M + PAD, o.b + M - PAD]), ...gapMids(this.obs.map((o) => o.t), this.obs.map((o) => o.b))]
    this.xs = uniq(X, ports.map((p) => p.x)); this.ys = uniq(Y, ports.map((p) => p.y))
    this.used = new Map() // edge key -> count
    this.nodesUsed = new Set()
  }

  free(x, y) { return !this.obs.some((o) => x > o.l && x < o.r && y > o.t && y < o.b) }
  clearH(y, x1, x2) { const [a, b] = x1 < x2 ? [x1, x2] : [x2, x1]; return !this.obs.some((o) => y > o.t && y < o.b && b > o.l && a < o.r) }
  clearV(x, y1, y2) { const [a, b] = y1 < y2 ? [y1, y2] : [y2, y1]; return !this.obs.some((o) => x > o.l && x < o.r && b > o.t && a < o.b) }

  /**
   * Route from `from` (leaving in direction `dir0`: 'r' | 'l' | 'u' | 'd') to `to`,
   * arriving in one of the directions in `dir1` (a string like 'r' or 'rlu').
   * Returns the list of corner points, or null.
   */
  route(from, to, dir0 = 'r', dir1 = 'r') {
    const { xs, ys } = this
    const ix = (x) => xs.findIndex((v) => Math.abs(v - x) < 1e-6)
    const iy = (y) => ys.findIndex((v) => Math.abs(v - y) < 1e-6)
    const sx = ix(from.x), sy = iy(from.y), tx = ix(to.x), ty = iy(to.y)
    if (sx < 0 || sy < 0 || tx < 0 || ty < 0) return null
    const NX = xs.length
    const D = { r: [1, 0], l: [-1, 0], d: [0, 1], u: [0, -1] }
    const DIRS = ['r', 'l', 'd', 'u']
    const key = (i, j, d) => (j * NX + i) * 4 + d
    const dist = new Map(), prev = new Map()
    const h = new Heap()
    const s0 = key(sx, sy, DIRS.indexOf(dir0))
    dist.set(s0, 0); h.push(0, s0)
    const BEND = 34, REUSE = 900, CROSS = 14
    let goal = null
    while (h.size) {
      const [c, k] = h.pop()
      if (c > (dist.get(k) ?? Infinity)) continue
      const d = k % 4, node = (k - d) / 4, i = node % NX, j = (node - i) / NX
      if (i === tx && j === ty) {
        if (dir1.includes(DIRS[d])) { goal = k; break }
      }
      for (let nd = 0; nd < 4; nd++) {
        const [dx, dy] = D[DIRS[nd]]
        if (dx === -D[DIRS[d]][0] && dy === -D[DIRS[d]][1] && (dx || dy)) continue // no U-turns
        const ni = i + dx, nj = j + dy
        if (ni < 0 || nj < 0 || ni >= NX || nj >= ys.length) continue
        const x1 = xs[i], y1 = ys[j], x2 = xs[ni], y2 = ys[nj]
        const endHere = ni === tx && nj === ty
        if (!endHere && !this.free(x2, y2)) continue
        if (dx ? !this.clearH(y1, x1, x2) : !this.clearV(x1, y1, y2)) continue
        const ek = dx ? `h${j},${Math.min(i, ni)}` : `v${i},${Math.min(j, nj)}`
        let cost = Math.abs(x2 - x1) + Math.abs(y2 - y1) + (nd !== d ? BEND : 0)
        cost += (this.used.get(ek) ?? 0) * REUSE
        if (this.nodesUsed.has(nj * NX + ni) && !endHere) cost += CROSS
        const nk = key(ni, nj, nd), nc = c + cost
        if (nc < (dist.get(nk) ?? Infinity)) { dist.set(nk, nc); prev.set(nk, k); h.push(nc, nk) }
      }
    }
    if (goal === null) return null
    const pts = []
    for (let k = goal; k !== undefined; k = prev.get(k)) {
      const d = k % 4, node = (k - d) / 4, i = node % NX, j = (node - i) / NX
      pts.push([xs[i], ys[j], i, j])
    }
    pts.reverse()
    for (let n = 1; n < pts.length; n++) {
      const [, , i0, j0] = pts[n - 1], [, , i1, j1] = pts[n]
      const ek = j0 === j1 ? `h${j0},${Math.min(i0, i1)}` : `v${i0},${Math.min(j0, j1)}`
      this.used.set(ek, (this.used.get(ek) ?? 0) + 1)
      this.nodesUsed.add(j1 * NX + i1)
    }
    // Keep only the corners.
    const out = [pts[0]]
    for (let n = 1; n < pts.length - 1; n++) {
      const a = out[out.length - 1], b = pts[n], c = pts[n + 1]
      if (!((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1]))) out.push(b)
    }
    if (pts.length > 1) out.push(pts[pts.length - 1])
    return out.map(([x, y]) => [x, y])
  }
}

/** SVG path data for an orthogonal polyline with rounded corners. */
export function roundedPath(points, r = 7) {
  const f = (v) => +v.toFixed(1)
  points = points.filter((p, i, a) => i === 0 || i === a.length - 1 ||
    !((Math.abs(a[i - 1][0] - p[0]) < 0.01 && Math.abs(p[0] - a[i + 1][0]) < 0.01) || (Math.abs(a[i - 1][1] - p[1]) < 0.01 && Math.abs(p[1] - a[i + 1][1]) < 0.01)))
  if (points.length < 3) return points.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('')
  let d = `M${f(points[0][0])} ${f(points[0][1])}`
  for (let i = 1; i < points.length - 1; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i], [cx, cy] = points[i + 1]
    const l1 = Math.hypot(bx - ax, by - ay), l2 = Math.hypot(cx - bx, cy - by)
    const rr = Math.min(r, l1 / 2, l2 / 2)
    const p1 = [bx - ((bx - ax) / l1) * rr, by - ((by - ay) / l1) * rr]
    const p2 = [bx + ((cx - bx) / l2) * rr, by + ((cy - by) / l2) * rr]
    d += `L${f(p1[0])} ${f(p1[1])}Q${f(bx)} ${f(by)} ${f(p2[0])} ${f(p2[1])}`
  }
  const [lx, ly] = points[points.length - 1]
  return d + `L${f(lx)} ${f(ly)}`
}
