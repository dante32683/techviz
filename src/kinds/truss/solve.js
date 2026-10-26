// The truss model and its solution. build() reads joints, members, supports and loads from the
// spec (coordinates in length units, y up); solve() runs the method of joints as one linear
// system: two equations (ΣFx = 0, ΣFy = 0) per joint, unknowns the member forces (tension
// positive) and the support reactions. findSection() looks for one straight cut line that
// crosses exactly the members a method-of-sections problem names.

import { compileFor } from '../../expr.js'
import { SpecError } from '../../diag.js'

const WORDS = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] }
const DIR_HELP = 'dir is up, down, left, right, or an angle in degrees counterclockwise from +x'

export const val = (v, env, path) => {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return compileFor(v, Object.keys(env)).fn(env)
  throw new SpecError(path, `expected a number or expression, got ${JSON.stringify(v)}`)
}

/** A direction word or angle as a math unit vector (x right, y up). */
export function direction(d, env, path) {
  if (typeof d === 'string' && WORDS[d]) return WORDS[d]
  let deg
  try { deg = val(d, env, path) } catch { throw new SpecError(path, DIR_HELP) }
  if (!Number.isFinite(deg)) throw new SpecError(path, DIR_HELP)
  const r = (deg * Math.PI) / 180
  return [Math.cos(r), Math.sin(r)]
}

/** 3 significant figures; anything below `tiny` is 0. */
export const fmt = (x, tiny = 0) => (Math.abs(x) <= tiny ? '0' : String(+x.toPrecision(3)))

export function build(spec, env, diag) {
  const J = spec.joints
  if (!J || typeof J !== 'object' || Array.isArray(J) || !Object.keys(J).length) {
    throw new SpecError('joints', 'joints is an object of name: [x, y] in length units (y up), like {"A": [0, 0], "B": [3, 0]}')
  }
  const joints = new Map()
  for (const [name, p] of Object.entries(J)) {
    const path = `joints.${name}`
    if (!Array.isArray(p) || p.length !== 2) throw new SpecError(path, 'a joint is [x, y] in length units (y up)')
    const x = val(p[0], env, `${path}[0]`), y = val(p[1], env, `${path}[1]`)
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new SpecError(path, 'joint coordinates must be finite numbers')
    joints.set(name, { name, x, y, path, used: false })
  }
  const list = [...joints.values()]
  const size = Math.max(Math.max(...list.map((j) => j.x)) - Math.min(...list.map((j) => j.x)), Math.max(...list.map((j) => j.y)) - Math.min(...list.map((j) => j.y)), 1e-9)
  const known = `joints: ${[...joints.keys()].join(', ')}`
  const joint = (n, path) => {
    const j = joints.get(n)
    if (!j) throw new SpecError(path, `no joint "${n}"; ${known}`)
    return j
  }
  // A member string is two joint names run together: "AB", or "L0U1" with longer names.
  const split = (s, path) => {
    const ways = []
    for (let k = 1; k < s.length; k++) if (joints.has(s.slice(0, k)) && joints.has(s.slice(k))) ways.push([s.slice(0, k), s.slice(k)])
    if (ways.length === 1) return ways[0]
    if (ways.length > 1) throw new SpecError(path, `"${s}" splits into joint names more than one way; write ["${ways[0][0]}", "${ways[0][1]}"]`)
    if (s.length === 2) { joint(s[0], path); joint(s[1], path) }
    throw new SpecError(path, `"${s}" is not two joint names run together (${known}); write ["J1", "J2"]`)
  }

  if (!Array.isArray(spec.members) || !spec.members.length) throw new SpecError('members', 'members is a list like ["AB", "BC"], or [["J1", "J2"], ...] for longer joint names')
  const members = [], seen = new Map()
  spec.members.forEach((m, i) => {
    const path = `members[${i}]`
    let ends, id, text
    if (typeof m === 'string') { ends = split(m, path); text = m }
    else if (Array.isArray(m)) ends = m
    else if (m && typeof m === 'object') {
      id = m.id
      if (typeof m.ends === 'string') { ends = split(m.ends, `${path}.ends`); text = m.ends }
      else ends = m.ends
    }
    if (!Array.isArray(ends) || ends.length !== 2) throw new SpecError(path, 'a member is "AB", ["J1", "J2"], or {"id": "m1", "ends": "AB"}')
    const [a, b] = ends.map((n, k) => joint(n, Array.isArray(m) ? `${path}[${k}]` : path))
    const name = id ?? text ?? (a.name.length === 1 && b.name.length === 1 ? `${a.name}${b.name}` : `${a.name}-${b.name}`)
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    if (L < 1e-9 * size) { diag.warn(path, `${name} has zero length (both ends at one point); left out`); return }
    const key = [a.name, b.name].sort().join('\u0000')
    if (seen.has(key)) { diag.warn(path, `${name} repeats ${seen.get(key)}; left out`); return }
    seen.set(key, path)
    a.used = b.used = true
    members.push({ a, b, name, id, path, L, u: [(b.x - a.x) / L, (b.y - a.y) / L] })
  })
  for (const j of list) if (!j.used) diag.warn(j.path, `joint ${j.name} has no members; it is left out of the solution`)

  if (spec.supports !== undefined && !Array.isArray(spec.supports)) throw new SpecError('supports', 'supports is a list like [{"at": "A", "type": "pin"}]')
  const supports = (spec.supports ?? []).map((s, i) => {
    const path = `supports[${i}]`
    if (!s || typeof s !== 'object') throw new SpecError(path, 'a support is {"at": "A", "type": "pin"} or {"at": "C", "type": "roller", "dir": "up"}')
    const type = s.type ?? 'pin'
    if (!['pin', 'roller'].includes(type)) throw new SpecError(`${path}.type`, 'type is pin (two reactions) or roller (one, along dir)')
    const j = joint(s.at, `${path}.at`)
    const n = s.dir === undefined ? [0, 1] : direction(s.dir, env, `${path}.dir`)
    let reactions
    if (type === 'pin') reactions = [{ name: `${j.name}_{x}`, d: [1, 0] }, { name: `${j.name}_{y}`, d: [0, 1] }]
    else if (Math.abs(n[1]) > 0.9999) reactions = [{ name: `${j.name}_{y}`, d: [0, 1] }]
    else if (Math.abs(n[0]) > 0.9999) reactions = [{ name: `${j.name}_{x}`, d: [1, 0] }]
    else reactions = [{ name: `${j.name}_{n}`, d: n, angle: ((Math.atan2(n[1], n[0]) * 180) / Math.PI + 360) % 360 }]
    return { type, j, n, reactions, id: s.id, path }
  })

  if (spec.loads !== undefined && !Array.isArray(spec.loads)) throw new SpecError('loads', 'loads is a list like [{"at": "D", "mag": 10, "dir": "down"}]')
  const loads = (spec.loads ?? []).map((l, i) => {
    const path = `loads[${i}]`
    if (!l || typeof l !== 'object') throw new SpecError(path, 'a load is {"at": "D", "mag": 10, "dir": "down"}')
    const j = joint(l.at, `${path}.at`)
    if (l.mag === undefined) throw new SpecError(`${path}.mag`, 'give mag, the load\'s size (a number or expression)')
    let mag = val(l.mag, env, `${path}.mag`)
    let d = direction(l.dir ?? 'down', env, `${path}.dir`)
    if (mag < 0) { mag = -mag; d = [-d[0], -d[1]] }
    return { j, mag, d, label: l.label, id: l.id, path }
  })
  return { joints, members, supports, loads, size }
}

/** Gaussian elimination with partial pivoting; null when singular. */
function gauss(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-9) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c]
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
    x[r] = s / M[r][r]
  }
  return x
}

/**
 * Method of joints. Returns { m, r, j, status } with status determinate, unstable (m + r < 2j),
 * indeterminate (m + r > 2j), or singular; when determinate, each member gets F (tension
 * positive) and each reaction a value (along its d).
 */
export function solve(model) {
  const { members, supports, loads } = model
  const js = [...model.joints.values()].filter((j) => j.used)
  const reactions = supports.flatMap((s) => s.reactions.map((r) => ({ ...r, j: s.j })))
  const m = members.length, r = reactions.length, j = js.length
  const res = { m, r, j, reactions }
  if (m + r !== 2 * j) { res.status = m + r < 2 * j ? 'unstable' : 'indeterminate'; return res }
  const row = new Map(js.map((jt, k) => [jt, 2 * k]))
  const n = 2 * j
  const A = Array.from({ length: n }, () => new Array(n).fill(0)), b = new Array(n).fill(0)
  members.forEach((mb, c) => {
    const ra = row.get(mb.a), rb = row.get(mb.b)
    A[ra][c] += mb.u[0]; A[ra + 1][c] += mb.u[1]
    A[rb][c] -= mb.u[0]; A[rb + 1][c] -= mb.u[1]
  })
  reactions.forEach((re, k) => {
    const rr = row.get(re.j)
    if (rr === undefined) return
    A[rr][m + k] += re.d[0]; A[rr + 1][m + k] += re.d[1]
  })
  for (const l of loads) {
    const rr = row.get(l.j)
    if (rr === undefined) continue
    b[rr] -= l.mag * l.d[0]; b[rr + 1] -= l.mag * l.d[1]
  }
  const x = gauss(A, b)
  if (!x) { res.status = 'singular'; return res }
  res.status = 'determinate'
  members.forEach((mb, c) => { mb.F = x[c] })
  reactions.forEach((re, k) => { re.value = x[m + k] })
  return res
}

/** The member a section entry names: its name, its id, or its two joints in either order. */
export function memberNamed(members, s) {
  return members.find((mb) => mb.name === s || mb.id === s) ??
    members.find((mb) => s === `${mb.b.name}${mb.a.name}` || s === `${mb.a.name}${mb.b.name}` || s === `${mb.b.name}-${mb.a.name}`)
}

/**
 * A straight line (point p, unit direction d, in length units) that crosses exactly the members
 * in `cut` and passes clear of every joint, or null. Prefers lines that cross each member near
 * its middle, run steeply, and keep away from joints.
 */
export function findSection(model, cut) {
  const { members, size } = model
  const want = new Set(cut)
  const js = [...model.joints.values()].filter((j) => j.used)
  const at = (mb, f) => [mb.a.x + (mb.b.x - mb.a.x) * f, mb.a.y + (mb.b.y - mb.a.y) * f]
  const F = [0.2, 0.35, 0.5, 0.65, 0.8]
  const lines = []
  for (const m1 of cut) for (const f of F) {
    const p = at(m1, f)
    for (let k = 0; k < 36; k++) { const a = (k * 5 * Math.PI) / 180; lines.push([p, [Math.cos(a), Math.sin(a)]]) }
    for (const m2 of cut) if (m2 !== m1) for (const g of F) {
      const q = at(m2, g), dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy)
      if (L > 1e-9 * size) lines.push([p, [dx / L, dy / L]])
    }
  }
  const side = (j, p, d) => (j.x - p[0]) * d[1] - (j.y - p[1]) * d[0]
  let best = null
  for (const [p, d] of lines) {
    let minJ = Infinity
    for (const j of js) minJ = Math.min(minJ, Math.abs(side(j, p, d)))
    if (minJ < 0.03 * size) continue
    let ok = true, score = 0
    const hits = []
    for (const mb of members) {
      const sa = side(mb.a, p, d), sb = side(mb.b, p, d), crosses = sa * sb < 0
      if (crosses !== want.has(mb)) { ok = false; break }
      if (crosses) {
        const f = sa / (sa - sb)
        score += Math.abs(f - 0.5)
        hits.push(at(mb, f))
      }
    }
    if (!ok) continue
    score += 0.4 * Math.abs(d[0]) - 1.5 * Math.min(minJ / size, 0.15)
    if (!best || score < best.score - 1e-9) best = { p, d, score, hits }
  }
  return best
}
