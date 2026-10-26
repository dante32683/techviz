// fbd: free-body and system diagrams for mechanics, statics, and E&M. Bodies
// (points, blocks, bars, disks, pulleys) are placed on a coarse unit grid, on a
// surface or incline, or hanging from a pulley; forces attach at named points
// with a direction and an optional magnitude. Ropes and springs route between
// bodies (over pulleys) and can add their tension; supports draw pins, rollers
// and fixed walls or their reactions; distributed loads, couples, angle arcs,
// axes, force components, a net force, and uniform E or B fields complete it.
// Several panels sit side by side, each with a caption. Each body's vector sum
// (and moment sum about a bar's start, given its span) comes back as a note.

import { el, pathD } from '../../svg.js'
import { color } from '../../theme.js'
import { compileFor } from '../../expr.js'
import { SpecError } from '../../diag.js'
import { labelSvg, measure } from '../../label.js'
import { V, dirOf, degOf, Canvas, insidePoly, circlePoly, arrow, hatched, spring, arcPoints, shortSweep } from './draw.js'
import { arrowCands, ringCands, extent, placeLabels, drawLabels, drawField } from './place.js'

const U = 56 // px per layout unit
const DEFAULT_LEN = 70, MAX_LEN = 92, MIN_LEN = 26
const BELOW = 40 // px under a ground line that labels keep clear of
const K3 = 0.5 * Math.SQRT1_2 // oblique depth: +z (out of the page) draws down-left at half length
const SCENE = ['body', 'bodies', 'forces', 'connections', 'supports', 'loads', 'moments', 'angles', 'dims', 'surface', 'field', 'axes', 'net']
const TYPES = ['point', 'block', 'bar', 'disk', 'pulley']
const NAMED = {
  center: [0, 0], top: [0, 1], bottom: [0, -1], left: [-1, 0], right: [1, 0],
  'top-left': [-1, 1], 'top-right': [1, 1], 'bottom-left': [-1, -1], 'bottom-right': [1, -1],
}
const WORDS = { up: [0, 1, 0], down: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0], in: [0, 0, -1], out: [0, 0, 1] }
const DIR_HELP = 'dir is up, down, left, right, in, out, normal, uphill, downhill, an angle in degrees (counterclockwise from +x), {"rel": degrees from the body\'s own axis}, or a vector [x, y] or [x, y, z]'

const val = (v, env, path) => {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return compileFor(v, Object.keys(env)).fn(env)
  throw new SpecError(path, `expected a number or expression, got ${JSON.stringify(v)}`)
}
const unit3 = (v) => { const l = Math.hypot(...v); return l ? v.map((x) => x / l) : v }
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const toMath = (s) => [s[0], -s[1], 0]
/** Screen direction of a 3D math vector (oblique projection), and its projected length factor. */
const project = (v) => [v[0] - K3 * v[2], -(v[1] - K3 * v[2])]
const r4 = (x, scale = 1) => (Math.abs(x) < 1e-9 * Math.max(1, scale) ? 0 : +x.toPrecision(4))

function describe(v) {
  for (const [name, u] of Object.entries(WORDS)) if (u[0] * v[0] + u[1] * v[1] + u[2] * v[2] > 0.9999) return name
  if (Math.abs(v[2]) < 1e-9) return `${r4(((Math.atan2(v[1], v[0]) * 180) / Math.PI + 360) % 360)}°`
  return `(${v.map((x) => r4(x)).join(', ')})`
}

// ---- Bodies -----------------------------------------------------------------

function makeBody(b, i, path, env) {
  if (!b || typeof b !== 'object') throw new SpecError(path, 'a body is an object like {"type": "block", "label": "m"}')
  const type = b.type ?? 'block'
  if (!TYPES.includes(type)) throw new SpecError(`${path}.type`, `type is one of ${TYPES.join(', ')}`)
  const o = { id: b.id ?? (i === 0 ? 'body' : `body${i + 1}`), type, label: b.label, src: b, path, ang: b.angle !== undefined ? val(b.angle, env, `${path}.angle`) : 0 }
  if (type === 'block') { o.w = val(b.w ?? 1.3, env, `${path}.w`) * U; o.h = val(b.h ?? 0.9, env, `${path}.h`) * U }
  else if (type === 'bar') { o.w = val(b.length ?? 4, env, `${path}.length`) * U; o.h = 10 }
  else if (type === 'disk' || type === 'pulley') { o.r = val(b.r ?? (type === 'disk' ? 0.6 : 0.3), env, `${path}.r`) * U; o.w = o.h = 2 * o.r }
  else { o.r = 4; o.w = o.h = 8 }
  return o
}

const ex = (b) => dirOf(b.ang)
const ey = (b) => dirOf(b.ang + 90)
const loc = (b, u, v) => V.add(V.add(b.c, V.mul(ex(b), u)), V.mul(ey(b), v))

function outline(b) {
  if (b.type === 'block' || b.type === 'bar') return [loc(b, -b.w / 2, -b.h / 2), loc(b, b.w / 2, -b.h / 2), loc(b, b.w / 2, b.h / 2), loc(b, -b.w / 2, b.h / 2)]
  return circlePoly(b.c, b.type === 'point' ? 4 : b.r, b.type === 'point' ? 8 : 28)
}

/** A named point on a body: { p, t (fraction along a bar), n (outward normal, if any) }. */
function anchor(b, at, path) {
  if (at === undefined || at === null || at === 'center' || b.type === 'point') return { p: b.c, t: 0.5 }
  if (b.type === 'bar') {
    let t
    if (typeof at === 'number') t = at
    else if (/^\s*-?\d*\.?\d+\s*$/.test(at)) t = parseFloat(at)
    else if (at === 'start' || at === 'left') t = 0
    else if (at === 'end' || at === 'right') t = 1
    else if (at === 'top' || at === 'bottom') return { p: loc(b, 0, at === 'top' ? b.h / 2 : -b.h / 2), t: 0.5, n: at === 'top' ? ey(b) : V.mul(ey(b), -1) }
    else throw new SpecError(path, 'on a bar, at is center, start, end, top, bottom, or a fraction 0 to 1 along it')
    if (!(t >= 0 && t <= 1)) throw new SpecError(path, 'a fraction along a bar runs from 0 (start) to 1 (end)')
    return { p: loc(b, -b.w / 2 + t * b.w, 0), t, n: t === 0 ? V.mul(ex(b), -1) : t === 1 ? ex(b) : undefined }
  }
  const k = NAMED[at]
  if (!k) throw new SpecError(path, `at is one of ${Object.keys(NAMED).join(', ')}`)
  const d = V.unit(V.add(V.mul(ex(b), k[0]), V.mul(ey(b), k[1])))
  if (b.type === 'disk' || b.type === 'pulley') return { p: V.add(b.c, V.mul(d, b.r)), n: d, t: 0.5 }
  return { p: loc(b, (k[0] * b.w) / 2, (k[1] * b.h) / 2), n: d, t: 0.5 }
}

// ---- One panel: resolve the scene ---------------------------------------------

function resolve(scene, pp, env, diag) {
  const raw = scene.bodies ?? (scene.body ? [scene.body] : [{ type: 'point' }])
  if (!Array.isArray(raw) || !raw.length) throw new SpecError(`${pp}bodies`, 'bodies is a non-empty list')
  const bodies = raw.map((b, i) => makeBody(b, i, scene.bodies ? `${pp}bodies[${i}]` : `${pp}body`, env))
  const byId = new Map()
  for (const b of bodies) { if (byId.has(b.id)) throw new SpecError(b.path, `two bodies have the id "${b.id}"`); byId.set(b.id, b) }
  const body = (id, path) => {
    if (id === undefined) return bodies[0]
    const b = byId.get(id)
    if (!b) throw new SpecError(path, `no body "${id}"; bodies: ${[...byId.keys()].join(', ')}`)
    return b
  }

  // Bodies with "at" go where they say, in layout units (y up).
  for (const b of bodies) {
    const at = b.src.at
    if (Array.isArray(at)) b.c = [val(at[0], env, `${b.path}.at[0]`) * U, -val(at[1], env, `${b.path}.at[1]`) * U]
    else if (at !== undefined && at !== 'edge') throw new SpecError(`${b.path}.at`, 'at is [x, y] in layout units (about one block width each, y up), or "edge" for a pulley at the surface edge')
  }

  // The surface (ground or incline) and the bodies resting on it, in order along it.
  let surf = null
  if (scene.surface) {
    const s = scene.surface === true ? {} : scene.surface
    const ang = val(s.angle ?? 0, env, `${pp}surface.angle`)
    if (Math.abs(ang) >= 90) throw new SpecError(`${pp}surface.angle`, 'an incline angle is between -90 and 90 degrees (positive rises to the right)')
    if (s.edge !== undefined && !['left', 'right'].includes(s.edge)) throw new SpecError(`${pp}surface.edge`, 'edge is "left" or "right"')
    surf = { ang, t: dirOf(ang), n: dirOf(ang + 90), label: s.label, edge: s.edge, path: `${pp}surface` }
    const onS = bodies.filter((b) => !b.src.at && !b.src.hang && b.src.on !== false && (b.type === 'block' || b.type === 'disk'))
    let s0 = -2 * U, s1 = 2 * U
    if (onS.length) {
      let pos = 0
      onS.forEach((b, i) => {
        if (i) pos += b.w / 2 + val(b.src.gap ?? 1.1, env, `${b.path}.gap`) * U
        b.ang = ang
        b.c = V.add(V.mul(surf.t, pos), V.mul(surf.n, b.h / 2))
        b.s = pos
        pos += b.w / 2
      })
      const first = onS[0], last = onS[onS.length - 1]
      const margin = ang === 0 ? 0.9 : 1.8
      s0 = first.s - first.w / 2 - (s.edge === 'left' ? 0.35 : margin) * U
      s1 = last.s + last.w / 2 + (s.edge === 'right' ? 0.35 : margin) * U
      // A steep incline gets a longer slope above the body, to leave room for component labels.
      const steep = Math.max(0, Math.min(1, (Math.abs(ang) - 35) / 20)) * U
      if (ang > 0 && s.edge !== 'right') s1 += steep
      if (ang < 0 && s.edge !== 'left') s0 -= steep
      // On an incline, run the wedge far enough downhill that a full-length weight arrow and
      // its label end above the base line (up to 4 units past the body).
      if (ang !== 0) {
        const sin = Math.abs(Math.sin((ang * Math.PI) / 180)), cos = Math.cos((ang * Math.PI) / 180)
        const run = (b) => Math.min(b.w / 2 + 4 * U, Math.max(0, (MAX_LEN + 34 - (b.h / 2) * cos) / sin))
        if (ang > 0) s0 = Math.min(s0, ...onS.map((b) => b.s - run(b)))
        else s1 = Math.max(s1, ...onS.map((b) => b.s + run(b)))
      }
      surf.ends = { left: first, right: last }
    }
    surf.A = V.mul(surf.t, s0)
    surf.B = V.mul(surf.t, s1)
  }

  // A pulley at the surface edge sits just past the corner, its top level with the rope.
  for (const b of bodies.filter((b) => b.src.at === 'edge')) {
    if (b.type !== 'pulley') throw new SpecError(`${b.path}.at`, 'only a pulley goes at "edge"')
    if (!surf?.edge) throw new SpecError(`${b.path}.at`, 'at "edge" needs a surface with edge: "left" or "right"')
    const right = surf.edge === 'right', corner = right ? surf.B : surf.A
    const near = surf.ends?.[surf.edge]
    const ropeH = near ? near.h / 2 : b.r
    b.c = V.add(V.add(corner, V.mul(surf.t, (right ? 1 : -1) * (b.r + 6))), V.mul(surf.n, ropeH - b.r))
    b.corner = corner
  }

  // Bodies hanging from a pulley: below its left or right side.
  for (const b of bodies.filter((b) => b.src.hang)) {
    const p = body(b.src.hang, `${b.path}.hang`)
    if (!p.c) throw new SpecError(`${b.path}.hang`, `place "${p.id}" first`)
    const side = b.src.side ?? (p.src.at === 'edge' ? surf.edge : 'right')
    if (!['left', 'right'].includes(side)) throw new SpecError(`${b.path}.side`, 'side is "left" or "right"')
    const drop = val(b.src.drop ?? 1.6, env, `${b.path}.drop`) * U
    b.c = [p.c[0] + (side === 'right' ? 1 : -1) * (p.r ?? 0), p.c[1] + drop + b.h / 2]
  }

  // Everything else in a row to the right.
  let x = Math.max(-Infinity, ...bodies.filter((b) => b.c).map((b) => b.c[0] + b.w / 2))
  for (const b of bodies.filter((b) => !b.c)) {
    if (x === -Infinity) { b.c = [0, 0]; x = b.w / 2; continue }
    b.c = [x + 1.4 * U + b.w / 2, 0]
    x = b.c[0] + b.w / 2
  }
  return { bodies, byId, body, surf }
}

/** "A.right" -> { body, p, t }. A bare anchor name means the first body. */
function endpoint(ref, sc, path) {
  if (typeof ref !== 'string') throw new SpecError(path, 'an end is "body.anchor", like "A.right" or "beam.0.5"')
  const dot = ref.indexOf('.')
  let id = dot < 0 ? ref : ref.slice(0, dot), at = dot < 0 ? undefined : ref.slice(dot + 1)
  if (!sc.byId.has(id) && (NAMED[ref] || ['start', 'end'].includes(ref) || /^[\d.]+$/.test(ref))) { id = undefined; at = ref }
  const b = sc.body(id, path)
  return { body: b, ...anchor(b, at, path) }
}

/** Direction of a force as a 3D math unit vector (x right, y up, z out of the page). */
function direction(d, b, surf, env, path) {
  if (typeof d === 'string') {
    if (WORDS[d]) return WORDS[d]
    if (d === 'normal') return toMath(ey(b))
    if (d === 'uphill' || d === 'downhill') {
      if (!surf || surf.ang === 0) throw new SpecError(path, `${d} needs an inclined surface ("surface": {"angle": 30})`)
      const up = surf.ang > 0 ? surf.t : V.mul(surf.t, -1)
      return toMath(d === 'uphill' ? up : V.mul(up, -1))
    }
    try { d = val(d, env, path) } catch { throw new SpecError(path, DIR_HELP) }
  }
  if (typeof d === 'number') return toMath(dirOf(d))
  if (Array.isArray(d) && (d.length === 2 || d.length === 3)) {
    const v = d.map((x, k) => val(x, env, `${path}[${k}]`))
    if (v.length === 2) v.push(0)
    if (Math.hypot(...v) < 1e-12) throw new SpecError(path, 'a direction vector cannot be zero')
    return unit3(v)
  }
  if (d && typeof d === 'object' && d.rel !== undefined) return toMath(dirOf(b.ang + val(d.rel, env, `${path}.rel`)))
  throw new SpecError(path, DIR_HELP)
}

// ---- One panel: forces and other loads, before drawing ------------------------------

function collect(scene, sc, pp, env, diag) {
  const forces = []
  const add = (f) => { forces.push(f); return f }
  const points = new Map() // force and support ids -> where they act, for dimension lines
  const magOf = (m, path) => (m === undefined || m === null ? null : val(m, env, path))

  const user = scene.forces ?? []
  if (!Array.isArray(user)) throw new SpecError(`${pp}forces`, 'forces is a list')
  const pending = []
  user.forEach((f, i) => {
    const path = `${pp}forces[${i}]`
    if (!f || typeof f !== 'object') throw new SpecError(path, 'a force is an object like {"dir": "down", "label": "mg"}')
    const b = sc.body(f.on, `${path}.on`)
    const a = anchor(b, f.at, `${path}.at`)
    let mag = magOf(f.mag, `${path}.mag`)
    const rec = { src: f, id: f.id, label: f.label, body: b, at: a.p, t: a.t, mag, color: f.color, push: !!f.push, vector: !!f.vector,
      components: f.components, dashed: f.style === 'dashed', path, kind: 'force' }
    if (f.cross) pending.push([rec, f])
    else {
      if (f.dir === undefined) throw new SpecError(`${path}.dir`, `give a direction: ${DIR_HELP}`)
      rec.v = direction(f.dir, b, sc.surf, env, `${path}.dir`)
      if (mag !== null && mag < 0) { rec.v = rec.v.map((x) => -x); rec.mag = -mag }
    }
    if (f.label === undefined) diag.warn(`${path}.label`, 'a force without a label; add "label" (like "mg" or "F_{N}")')
    if (f.id !== undefined) points.set(f.id, { body: b, t: a.t })
    add(rec)
  })
  // Vectors from a cross product: F = sign (a × b), as in F = q v × B.
  for (const [rec, f] of pending) {
    const path = rec.path
    if (!Array.isArray(f.cross) || f.cross.length !== 2) throw new SpecError(`${path}.cross`, 'cross is ["a id", "b id"] for a × b')
    const [a, b] = f.cross.map((id) => forces.find((g) => g.id === id && g.v))
    if (!a || !b) throw new SpecError(`${path}.cross`, 'cross names two earlier forces or vectors by id (each with a dir)')
    const sign = f.sign === '-' || f.sign === -1 ? -1 : 1
    const c = cross3(a.v.map((x) => x * (a.mag ?? 1)), b.v.map((x) => x * (b.mag ?? 1))).map((x) => x * sign)
    if (Math.hypot(...c) < 1e-12) throw new SpecError(`${path}.cross`, `${a.id} and ${b.id} are parallel, so the cross product is zero: leave this force out`)
    rec.v = unit3(c)
    if (rec.mag === null && a.mag !== null && b.mag !== null) rec.mag = Math.hypot(...c)
    rec.crossOf = `${sign < 0 ? '−' : ''}${a.id}×${b.id}`
  }

  // Ropes, springs and rods, with the tension (or spring force) they put on each body.
  const links = []
  ;(scene.connections ?? []).forEach((cn, i) => {
    const path = `${pp}connections[${i}]`
    const type = cn.type ?? 'rope'
    if (!['rope', 'spring', 'rod'].includes(type)) throw new SpecError(`${path}.type`, 'type is rope, spring, or rod')
    const a = endpoint(cn.from, sc, `${path}.from`)
    const over = (cn.over ?? []).map((id, k) => {
      const p = sc.body(id, `${path}.over[${k}]`)
      if (p.type !== 'pulley' && p.type !== 'disk') throw new SpecError(`${path}.over[${k}]`, `"${id}" is not a pulley`)
      return p
    })
    if (over.length && type !== 'rope') throw new SpecError(`${path}.over`, 'only a rope goes over a pulley')
    let end
    if (cn.end !== undefined && !['mount', 'free'].includes(cn.end)) throw new SpecError(`${path}.end`, 'end is "mount" (a hatched wall or ceiling, the default) or "free" (a loose end, such as a hand pulling)')
    if (cn.to !== undefined) end = endpoint(cn.to, sc, `${path}.to`)
    else {
      const d = project(direction(cn.dir ?? 'up', a.body, sc.surf, env, `${path}.dir`))
      end = { p: V.add(a.p, V.mul(V.unit(d), val(cn.length ?? 1.5, env, `${path}.length`) * U)), mount: cn.end !== 'free' }
    }
    const pts = [a.p]
    over.forEach((p, k) => pts.push(...wrap(p, pts[pts.length - 1], k + 1 < over.length ? over[k + 1].c : end.p)))
    pts.push(end.p)
    links.push({ type, pts, end, label: cn.label, path })
    const F = cn.tension ?? cn.force
    if (F !== undefined) {
      const spec = typeof F === 'object' && !Array.isArray(F) ? F : { labels: F }
      const labels = Array.isArray(spec.labels) ? spec.labels : [spec.labels ?? spec.label, spec.labels ?? spec.label]
      const mag = magOf(spec.mag, `${path}.tension.mag`)
      const ends = [[a, pts[1]], ...(end.body ? [[end, pts[pts.length - 2]]] : [])]
      ends.forEach(([e, next], k) => {
        let s = V.unit(V.sub(next, e.p))
        if (spec.push) s = V.mul(s, -1)
        // reach: the rope's first straight run, so the arrow stops short of a mount, pulley or
        // body; a straight rope to a free end leaves the arrow to scale.
        const loose = cn.end === 'free' && pts.length === 2
        add({ label: labels[k], body: e.body, at: e.p, t: e.t, v: toMath(s), mag, kind: 'tension', path, reach: spec.push || loose ? null : V.len(V.sub(next, e.p)) })
      })
    }
  })

  // Supports: the symbol, or (reactions: true) the reaction forces in its place.
  const symbols = [], moments = []
  ;(scene.supports ?? []).forEach((s, i) => {
    const path = `${pp}supports[${i}]`
    const type = s.type ?? 'pin'
    if (!['pin', 'roller', 'fixed'].includes(type)) throw new SpecError(`${path}.type`, 'type is pin, roller, or fixed')
    const b = sc.body(s.on, `${path}.on`)
    const a = anchor(b, s.at ?? (b.type === 'bar' ? (i === 0 ? 'start' : 'end') : 'bottom'), `${path}.at`)
    // u points from the support into the body.
    let u
    if (s.dir !== undefined) u = V.unit(project(direction(s.dir, b, sc.surf, env, `${path}.dir`)))
    else if (type === 'fixed') u = b.type === 'bar' ? V.mul(ex(b), a.t < 0.5 ? 1 : -1) : ey(b)
    else u = ey(b)
    const p = b.type === 'bar' && type !== 'fixed' ? V.sub(a.p, V.mul(u, b.h / 2)) : a.p
    const id = s.id ?? String.fromCharCode(65 + i)
    points.set(id, { body: b, t: a.t })
    if (!s.reactions) { symbols.push({ type, p, u, path }); return }
    const tangent = ex(b)
    const labels = s.labels ?? [`${id}_{x}`, `${id}_{y}`, `M_{${id}}`]
    const mags = s.mags ?? []
    const both = type !== 'roller'
    if (both) add({ label: labels[0], body: b, at: p, t: a.t, v: toMath(tangent), mag: magOf(mags[0], `${path}.mags[0]`), auto: true, kind: 'reaction', path })
    add({ label: both ? labels[1] : s.labels?.[0] ?? `${id}_{y}`, body: b, at: p, t: a.t, v: toMath(both ? ey(b) : u), mag: magOf(both ? mags[1] : mags[0], `${path}.mags`), auto: true, kind: 'reaction', path })
    if (type === 'fixed') moments.push({ label: labels[2], body: b, p: a.p, t: a.t, ccw: true, mag: magOf(mags[2], `${path}.mags[2]`), path })
  })

  // Applied couples.
  ;(scene.moments ?? []).forEach((m, i) => {
    const path = `${pp}moments[${i}]`
    const b = sc.body(m.on, `${path}.on`)
    const a = anchor(b, m.at, `${path}.at`)
    if (m.dir !== undefined && !['ccw', 'cw'].includes(m.dir)) throw new SpecError(`${path}.dir`, 'dir is "ccw" or "cw"')
    moments.push({ label: m.label, body: b, p: a.p, t: a.t, ccw: m.dir !== 'cw', mag: magOf(m.mag, `${path}.mag`), path })
  })

  // Distributed loads on bars: uniform (w) or linear ([w1, w2]); the resultant counts in the sums.
  const loads = []
  ;(scene.loads ?? []).forEach((ld, i) => {
    const path = `${pp}loads[${i}]`
    const b = sc.body(ld.on, `${path}.on`)
    if (b.type !== 'bar') throw new SpecError(`${path}.on`, 'a distributed load goes on a bar')
    const from = val(ld.from ?? 0, env, `${path}.from`), to = val(ld.to ?? 1, env, `${path}.to`)
    if (!(from >= 0 && to <= 1 && to > from)) throw new SpecError(path, 'from and to are fractions along the bar with 0 <= from < to <= 1')
    const w = Array.isArray(ld.w) ? ld.w.map((x, k) => val(x, env, `${path}.w[${k}]`)) : [val(ld.w ?? 1, env, `${path}.w`), val(ld.w ?? 1, env, `${path}.w`)]
    if (w[0] < 0 || w[1] < 0 || w[0] + w[1] === 0) throw new SpecError(`${path}.w`, 'w is a positive intensity, or [start, end] for a linear load')
    const tc = from + ((to - from) * (w[0] + 2 * w[1])) / (3 * (w[0] + w[1]))
    const rec = { b, from, to, w, tc, label: ld.label, resultant: ld.resultant, color: ld.color, path }
    rec.force = { label: typeof ld.resultant === 'string' ? ld.resultant : ld.resultant ? 'W' : undefined, body: b, at: loc(b, -b.w / 2 + tc * b.w, b.h / 2), t: tc,
      v: toMath(V.mul(ey(b), -1)), mag: magOf(ld.mag, `${path}.mag`), kind: 'load', hidden: !ld.resultant, dashed: true, path }
    add(rec.force)
    loads.push(rec)
  })
  return { forces, links, symbols, moments, loads, points }
}

/** The rope's path around a pulley from `prev` to `next`: tangent in, arc, tangent out. */
function wrap(p, prev, next) {
  const C = p.c, r = p.r
  let w = V.unit(V.sub(C, V.mid(prev, next)))
  if (!V.len(w)) w = [0, -1]
  const tangent = (P) => {
    const d = V.sub(P, C), D = V.len(d)
    if (D <= r + 0.5) return V.add(C, V.mul(w, r))
    const base = Math.atan2(d[1], d[0]), a = Math.acos(r / D)
    const c1 = V.add(C, V.mul([Math.cos(base + a), Math.sin(base + a)], r)), c2 = V.add(C, V.mul([Math.cos(base - a), Math.sin(base - a)], r))
    return V.dot(V.sub(c1, C), w) >= V.dot(V.sub(c2, C), w) ? c1 : c2
  }
  const t1 = tangent(prev), t2 = tangent(next)
  const a1 = Math.atan2(t1[1] - C[1], t1[0] - C[0]), a2 = Math.atan2(t2[1] - C[1], t2[0] - C[0])
  let s = a2 - a1
  while (s <= -Math.PI) s += 2 * Math.PI
  while (s > Math.PI) s -= 2 * Math.PI
  const alt = s - Math.sign(s || 1) * 2 * Math.PI
  const midDot = (sw) => V.dot([Math.cos(a1 + sw / 2), Math.sin(a1 + sw / 2)], w)
  const sweep = midDot(s) >= midDot(alt) ? s : alt
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / 0.2))
  return Array.from({ length: n + 1 }, (_, k) => V.add(C, V.mul([Math.cos(a1 + (sweep * k) / n), Math.sin(a1 + (sweep * k) / n)], r)))
}

// ---- One panel: draw ------------------------------------------------------------

function drawPanel(scene, sc, col, pp, ctx, scale) {
  const { theme, diag, env, highlight } = ctx
  const fs = theme.size
  const cv = new Canvas()
  const labels = { first: [], forces: [], rest: [], last: [] }
  const tint = color('gray')
  const fgStroke = theme.fg
  const { forces, links, symbols, moments, loads } = col
  let ci = 0
  const nextColor = (c) => (ctx.mono ? theme.fg : color(c, ci++))

  // Surface or incline.
  const surf = sc.surf
  if (surf) {
    const down = V.mul(surf.n, -1)
    // Labels keep off the strip under the ground line: one there reads as cut off from its arrow.
    const below = (a, b) => { cv.fill([a, b, V.add(b, [0, BELOW]), V.add(a, [0, BELOW])], 'below', 0.9); cv.ground = [a, b] }
    if (surf.ang === 0) {
      hatched(cv, surf.A, surf.B, down, theme.muted)
      below(surf.A, surf.B)
      if (surf.edge) {
        const corner = surf.edge === 'right' ? surf.B : surf.A
        hatched(cv, corner, V.add(corner, [0, 1.3 * U]), [surf.edge === 'right' ? -1 : 1, 0], theme.muted)
      }
    } else {
      const low = surf.ang > 0 ? surf.A : surf.B, high = surf.ang > 0 ? surf.B : surf.A
      const C = [high[0], low[1]]
      cv.mid.push(el('path', { d: pathD([low, high, C], true), fill: tint, 'fill-opacity': 0.12, stroke: theme.muted, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }))
      cv.trace([low, high, C], 'surface', 1, true)
      const ext = 0.3 * U * Math.sign(C[0] - low[0])
      hatched(cv, V.add(low, [-ext, 0]), V.add(C, [ext, 0]), [0, 1], theme.muted)
      below(V.add(low, [-ext, 0]), V.add(C, [ext, 0]))
      const a1 = degOf(V.sub(C, low)), a2 = a1 + shortSweep(a1, degOf(V.sub(high, low)))
      const R = 0.75 * U
      const arc = arcPoints(low, R, a1, a2)
      cv.mid.push(el('path', { d: pathD(arc), fill: 'none', stroke: theme.muted, 'stroke-width': 1.2 }))
      cv.trace(arc, 'surface')
      if (surf.label) {
        const bis = dirOf((a1 + a2) / 2)
        const inner = dirOf((a1 + a2) / 2 + (a2 > a1 ? -8 : 8)), base = dirOf(a1 + (a2 - a1) * 0.2)
        // Placed after the forces, so an arrow's label near the base wins and this one moves out:
        // outside the arc, then along the base or the slope, then inside the arc.
        const cands = [bis, inner].flatMap((d) => [4, 12, 24].map((g) => (w, h) => V.add(low, V.mul(d, R + g + extent(d, w, h)))))
        const slope = dirOf(a1 + (a2 - a1) * 0.8)
        cands.push(...[base, slope].flatMap((d) => [6, 18].map((g) => (w, h) => V.add(low, V.mul(d, R + g + extent(d, w, h))))), (w, h) => {
          // Inside the arc: on the bisector, just far enough out to clear both sides.
          const half = Math.abs(a2 - a1) / 2, sin = Math.sin((half * Math.PI) / 180)
          const d = Math.max(...[a1 + 90, a2 + 90].map((a) => extent(dirOf(a), w, h) + 3)) / Math.max(sin, 0.05)
          return V.add(low, V.mul(bis, d))
        })
        labels.rest.push({ label: surf.label, size: fs, fill: theme.fg, cands })
      }
    }
  }

  // Ropes, springs and rods, under the bodies.
  for (const lk of links) {
    if (lk.type === 'spring') spring(cv, lk.pts[0], lk.pts[lk.pts.length - 1], fgStroke, 'link')
    else {
      cv.mid.push(el('path', { d: pathD(lk.pts), fill: 'none', stroke: fgStroke, 'stroke-width': lk.type === 'rod' ? 3 : 1.5, 'stroke-linejoin': 'round' }))
      cv.trace(lk.pts, 'link')
    }
    if (lk.end.mount) {
      const n = lk.pts.length, d = V.unit(V.sub(lk.pts[n - 1], lk.pts[n - 2])), side = V.perp(d), e = lk.pts[n - 1]
      hatched(cv, V.add(e, V.mul(side, 0.35 * U)), V.sub(e, V.mul(side, 0.35 * U)), d, theme.muted)
    }
    if (lk.label) {
      const k = Math.floor((lk.pts.length - 1) / 2), a = lk.pts[k], b = lk.pts[k + 1], m = V.mid(a, b), n = V.perp(V.unit(V.sub(b, a)))
      labels.rest.push({ label: lk.label, size: fs, fill: theme.fg, cands: [n, V.mul(n, -1)].map((s) => (w, h) => V.add(m, V.mul(s, 8 + extent(s, w, h)))) })
    }
  }

  // Bodies.
  for (const b of sc.bodies) {
    const poly = outline(b)
    if (b.type === 'point') cv.mid.push(el('circle', { cx: b.c[0], cy: b.c[1], r: 4, fill: fgStroke }))
    else if (b.type === 'disk' || b.type === 'pulley') {
      cv.mid.push(el('circle', { cx: b.c[0], cy: b.c[1], r: b.r, fill: tint, 'fill-opacity': b.type === 'disk' ? 0.2 : 0.12, stroke: fgStroke, 'stroke-width': 1.5 }))
      if (b.type === 'pulley') {
        cv.mid.push(el('circle', { cx: b.c[0], cy: b.c[1], r: 2.6, fill: fgStroke }))
        const mount = b.corner ? null : b.src.mount ?? 'up'
        if (b.corner) {
          cv.mid.push(el('line', { x1: b.c[0], y1: b.c[1], x2: b.corner[0], y2: b.corner[1], stroke: theme.muted, 'stroke-width': 2.5 }))
          cv.trace([b.c, b.corner], 'mount')
        } else if (mount !== 'none') {
          if (!WORDS[mount] || mount === 'in' || mount === 'out') throw new SpecError(`${b.path}.mount`, 'mount is up, down, left, right, or none')
          const d = project(WORDS[mount]), e = V.add(b.c, V.mul(d, b.r + 0.45 * U))
          cv.mid.push(el('line', { x1: b.c[0], y1: b.c[1], x2: e[0], y2: e[1], stroke: theme.muted, 'stroke-width': 2.5 }))
          cv.trace([b.c, e], 'mount')
          const side = V.perp(d)
          hatched(cv, V.add(e, V.mul(side, 0.35 * U)), V.sub(e, V.mul(side, 0.35 * U)), d, theme.muted)
        }
      }
    } else cv.mid.push(el('path', { d: pathD(poly, true), fill: tint, 'fill-opacity': b.type === 'bar' ? 0.35 : 0.2, stroke: fgStroke, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }))
    cv.trace(poly, `b:${b.id}`, 1, true)
    if (b.type === 'block' || b.type === 'disk') cv.fill(poly, `i:${b.id}`, 0.6)
    // A wire's current: a short arrow beside the bar, near its start.
    if (b.src.current !== undefined) {
      if (b.type !== 'bar') throw new SpecError(`${b.path}.current`, 'current goes on a bar (a wire)')
      const cur = typeof b.src.current === 'object' ? b.src.current : { dir: b.src.current }
      if (!['right', 'left'].includes(cur.dir)) throw new SpecError(`${b.path}.current`, 'current is "right" or "left" (along the bar from start to end is right)')
      const [t0, t1] = cur.dir === 'right' ? [0.08, 0.28] : [0.28, 0.08]
      const a = loc(b, -b.w / 2 + t0 * b.w, -b.h / 2 - 9), z = loc(b, -b.w / 2 + t1 * b.w, -b.h / 2 - 9)
      arrow(cv, a, z, theme.fg, { width: 1.4, head: 7, tag: 'current' })
      const d = V.mul(ey(b), -1)
      labels.rest.push({ label: cur.label ?? 'I', size: fs, fill: theme.fg, cands: [(w, h) => V.add(V.mid(a, z), V.mul(d, 4 + extent(d, w, h))), ...arrowCands(a, z)] })
    }
  }

  // Support symbols.
  for (const s of symbols) {
    const n = V.perp(s.u), stroke = fgStroke
    if (s.type === 'fixed') {
      hatched(cv, V.add(s.p, V.mul(n, 0.55 * U)), V.sub(s.p, V.mul(n, 0.55 * U)), V.mul(s.u, -1), stroke)
      continue
    }
    const h = (s.type === 'pin' ? 0.42 : 0.3) * U, base = V.sub(s.p, V.mul(s.u, h))
    const tri = [s.p, V.add(base, V.mul(n, 0.26 * U)), V.sub(base, V.mul(n, 0.26 * U))]
    cv.mid.push(el('path', { d: pathD(tri, true), fill: tint, 'fill-opacity': 0.2, stroke, 'stroke-width': 1.4, 'stroke-linejoin': 'round' }))
    cv.trace(tri, 'support', 1, true)
    cv.mid.push(el('circle', { cx: s.p[0], cy: s.p[1], r: 3, fill: theme.bg ?? 'none', stroke, 'stroke-width': 1.3 }))
    let ground = base
    if (s.type === 'roller') {
      for (const k of [-1, 1]) {
        const c = V.add(V.sub(base, V.mul(s.u, 4.5)), V.mul(n, k * 0.13 * U))
        cv.mid.push(el('circle', { cx: c[0], cy: c[1], r: 4, fill: 'none', stroke, 'stroke-width': 1.2 }))
        cv.trace(circlePoly(c, 4, 8), 'support', 1, true)
      }
      ground = V.sub(base, V.mul(s.u, 9))
    }
    hatched(cv, V.add(ground, V.mul(n, 0.45 * U)), V.sub(ground, V.mul(n, 0.45 * U)), V.mul(s.u, -1), stroke)
  }

  // Distributed loads: a row of arrows onto the bar under an envelope line.
  for (const ld of loads) {
    const b = ld.b, c = ctx.mono ? theme.fg : color(ld.color ?? 'purple')
    const n = Math.max(2, Math.round(((ld.to - ld.from) * b.w) / (0.4 * U)))
    const wmax = Math.max(...ld.w), Hmax = 0.8 * U, tops = []
    for (let k = 0; k <= n; k++) {
      const t = ld.from + ((ld.to - ld.from) * k) / n, wk = ld.w[0] + ((ld.w[1] - ld.w[0]) * k) / n
      const base = loc(b, -b.w / 2 + t * b.w, b.h / 2 + 1), top = V.add(base, V.mul(ey(b), (Hmax * wk) / wmax))
      tops.push(top)
      if ((Hmax * wk) / wmax > 8) arrow(cv, top, base, c, { width: 1.3, head: 7, tag: 'load' })
    }
    cv.front.push(el('path', { d: pathD(tops), fill: 'none', stroke: c, 'stroke-width': 1.5 }))
    cv.trace(tops, 'load')
    if (ld.label) {
      const m = tops[Math.round(n / 2)], up = ey(b)
      labels.rest.push({ label: ld.label, size: fs, fill: c, cands: [m, tops[Math.round(n * 0.25)], tops[Math.round(n * 0.75)]].map((p) => (w, h) => V.add(p, V.mul(up, 6 + extent(up, w, h)))) })
    }
    if (!ld.force.hidden) {
      const top = loc(b, -b.w / 2 + ld.tc * b.w, b.h / 2 + 1 + (Hmax * (ld.w[0] + (ld.w[1] - ld.w[0]) * ((ld.tc - ld.from) / (ld.to - ld.from)))) / wmax)
      const tip = V.add(top, V.mul(ey(b), 4)), tail = V.add(tip, V.mul(ey(b), 0.9 * U))
      arrow(cv, tail, tip, c, { dashed: true, tag: 'f:load' })
      if (ld.force.label) labels.forces.push({ label: ld.force.label, size: fs, fill: c, cands: arrowCands(tip, tail).slice(1), own: 'f:load' })
    }
  }

  // Force arrows: lengths from magnitude, tail at the point (or head, for a push), then fan
  // apart any that would lie on top of each other.
  const arrows = []
  forces.filter((f) => f.kind !== 'load').forEach((f, i) => {
    const sd0 = project(f.v), plen = V.len(sd0), sd = V.unit(sd0)
    const group = f.vector ? scale.vector : scale.force
    let L = f.mag !== null && group > 0 ? Math.max(MIN_LEN, (MAX_LEN * f.mag) / group) : DEFAULT_LEN
    if (f.mag !== null && group > 0 && (MAX_LEN * f.mag) / group < MIN_LEN) ctx.short.push(f.label ?? f.path)
    L *= Math.max(0.35, plen)
    if (f.mag !== null && f.reach && f.reach - 10 < L && L > MIN_LEN) ctx.cut.push(f.label ?? f.path)
    if (f.reach) L = Math.min(L, Math.max(MIN_LEN, f.reach - 10))
    let push = f.push, at = f.at
    // Reactions point at their support from outside the body when there's room.
    if (f.auto) push = !insidePoly(V.sub(at, V.mul(sd, Math.min(L / 2, 20))), grow(outline(f.body), f.body.c, 2))
    // On a bar, a force on its center line starts (or ends) at the bar's edge instead.
    if (f.body.type === 'bar' && f.kind === 'force' && !['top', 'bottom'].includes(f.src?.at)) {
      const across = Math.abs(V.dot(sd, ey(f.body)))
      if (across > 0.3) at = V.add(at, V.mul(sd, ((push ? -1 : 1) * f.body.h) / 2 / across))
    }
    const tail = push ? V.sub(at, V.mul(sd, L)) : at
    arrows.push({ f, sd, L, tail, tip: V.add(tail, V.mul(sd, L)), off: 0, tag: `f:${pp}${i}`, color: nextColor(f.color) })
  })
  const conflict = (a, b) => {
    if (V.dot(a.sd, b.sd) < Math.cos((20 * Math.PI) / 180)) return false
    const rel = V.sub(b.tail, a.tail)
    if (Math.abs(V.dot(rel, V.perp(a.sd))) > 11) return false
    const p0 = V.dot(rel, a.sd), p1 = p0 + b.L * V.dot(b.sd, a.sd)
    return Math.max(p0, p1) > 3 && Math.min(p0, p1) < a.L - 3
  }
  arrows.forEach((a, i) => {
    const base = a.tail
    for (const k of [0, 1, -1, 2, -2, 3, -3]) {
      const shift = V.mul(V.perp(a.sd), k * 15)
      a.tail = V.add(base, shift); a.tip = V.add(a.tail, V.mul(a.sd, a.L)); a.off = k
      const hit = arrows.slice(0, i).find((b) => conflict(b, a) || conflict(a, b))
      if (!hit) break
      a.root = hit.root ?? hit
    }
  })
  // Center each fanned group on its point, so a pair sits either side of it.
  const groups = new Map()
  for (const a of arrows) if (a.root) { if (!groups.has(a.root)) groups.set(a.root, [a.root]); groups.get(a.root).push(a) }
  for (const [root, members] of groups) {
    const mean = members.reduce((s, a) => s + a.off, 0) / members.length
    if (!mean) continue
    const shift = V.mul(V.perp(root.sd), -mean * 15)
    for (const a of members) { a.tail = V.add(a.tail, shift); a.tip = V.add(a.tip, shift) }
  }
  const drawn = new Map()
  for (const a of arrows) {
    const hl = a.f.id && highlight.has(a.f.id)
    arrow(cv, a.tail, a.tip, a.color, { width: hl ? 3 : 2.2, dashed: a.f.dashed, tag: a.tag })
    const vertex = a.f.push || (a.f.auto && V.len(V.sub(a.tip, a.f.at)) < 1) ? a.tip : a.tail
    const out = vertex === a.tip ? V.mul(a.sd, -1) : a.sd
    if (a.f.id) drawn.set(a.f.id, { vertex, d: out, L: a.L })
    if (a.f.label) labels.forces.push({ label: a.f.label, size: fs, fill: a.color, cands: [...arrowCands(a.tail, a.tip), ...outsideCands(a)], own: a.tag })
    // Components along the panel's axes, dashed, with dotted lines back to the tip.
    if (a.f.components) {
      const axAng = axesAngle(scene, sc, ctx.env, pp)
      const comps = Array.isArray(a.f.components) ? a.f.components : []
      ;[dirOf(axAng), dirOf(axAng + 90)].forEach((e, k) => {
        const len = V.dot(V.mul(a.sd, a.L), e)
        if (Math.abs(len) < 6) return
        const tip = V.add(a.tail, V.mul(e, len))
        arrow(cv, a.tail, tip, a.color, { width: 1.5, dashed: true, head: 8, tag: `${a.tag}.${k}` })
        cv.front.push(el('line', { x1: tip[0], y1: tip[1], x2: a.tip[0], y2: a.tip[1], stroke: theme.muted, 'stroke-width': 1, 'stroke-dasharray': '2 3' }))
        cv.trace([tip, a.tip], 'guide', 0.3)
        if (a.f.id) drawn.set(`${a.f.id}.${k ? 'y' : 'x'}`, { vertex: a.tail, d: V.unit(V.mul(e, len)), L: Math.abs(len) })
        if (comps[k]) labels.forces.push({ label: comps[k], size: fs - 1, fill: a.color, cands: arrowCands(a.tail, tip), own: `${a.tag}.${k}` })
      })
    }
  }

  // Couples: an arc arrow around the point.
  for (const m of moments) {
    const R = 0.42 * U, a1 = m.ccw ? 200 : 340, a2 = m.ccw ? 470 : 70
    const pts = arcPoints(m.p, R, a1, a2, 30)
    const c = nextColor(m.color)
    cv.front.push(el('path', { d: pathD(pts.slice(0, -2)), fill: 'none', stroke: c, 'stroke-width': 2 }))
    cv.trace(pts, 'f:moment')
    const end = pts[pts.length - 1], d = dirOf(a2 + (m.ccw ? 90 : -90)), n = V.perp(d), b0 = V.sub(end, V.mul(d, 9))
    cv.front.push(el('path', { d: pathD([end, V.add(b0, V.mul(n, 4)), V.sub(b0, V.mul(n, 4))], true), fill: c }))
    if (m.label) labels.forces.push({ label: m.label, size: fs, fill: c, cands: ringCands(m.p, R + 6, dirOf(m.ccw ? 45 : 135)), own: 'f:moment' })
  }

  // Net force on each body (needs every magnitude).
  const sums = sumsFor(sc, col, ctx)
  if (scene.net) {
    const net = scene.net === true ? {} : scene.net
    for (const s of sums) {
      if (!s.complete || s.zero) continue
      const sd0 = project(unit3(s.F)), L = Math.max(MIN_LEN, (MAX_LEN * Math.hypot(...s.F)) / (scale.force || 1)) * Math.max(0.35, V.len(sd0))
      const tip = V.add(s.body.c, V.mul(V.unit(sd0), L))
      arrow(cv, s.body.c, tip, theme.fg, { dashed: true, width: 2, tag: 'f:net' })
      labels.forces.push({ label: net.label ?? 'F_{net}', size: fs, fill: theme.fg, cands: arrowCands(s.body.c, tip), own: 'f:net' })
    }
  }

  // Axes through a body: 2D (optionally tilted) or a 3D oblique triad.
  if (scene.axes) {
    const ax = scene.axes === true ? {} : scene.axes === '3d' ? { '3d': true } : scene.axes
    if (typeof ax !== 'object') throw new SpecError(`${pp}axes`, 'axes is true, "3d", or {angle, labels, on}')
    const b = sc.body(ax.on, `${pp}axes.on`), o = b.c
    const reach = Math.max(1.4 * U, ...arrows.map((a) => Math.max(V.len(V.sub(a.tip, o)), V.len(V.sub(a.tail, o))) + 16))
    const dirs = ax['3d'] ? [[1, 0], [0, -1], V.unit(project([0, 0, 1]))] : [dirOf(axesAngle(scene, sc, env, pp)), dirOf(axesAngle(scene, sc, env, pp) + 90)]
    const names = ax.labels ?? (ax['3d'] ? ['x', 'y', 'z'] : ['x', 'y'])
    // A negative half ends at the farthest arrow along it, so labels past a component's tip stay clear.
    const back = (d) => Math.max(0.6 * U, ...arrows.flatMap((a) => [a.tail, a.tip]).map((p) => -V.dot(V.sub(p, o), d)))
    dirs.forEach((d, k) => {
      const len = k === 2 ? reach * 0.75 : reach
      const neg = ax['3d'] ? o : V.sub(o, V.mul(d, back(d))), pos = V.add(o, V.mul(d, len))
      const before = cv.obs.length
      arrow(cv, neg, pos, theme.faint, { width: 1, head: 7, layer: 'back' })
      for (let j = before; j < cv.obs.length; j++) { cv.obs[j][2] = 0.4; cv.obs[j][3] = 'axis' }
      if (names[k]) labels.last.push({ label: names[k], size: fs, fill: theme.muted, cands: arrowCands(neg, pos).slice(0, 3) })
    })
  }

  // Angle arcs between a force and a reference line or another force.
  ;(scene.angles ?? []).forEach((am, i) => {
    const path = `${pp}angles[${i}]`
    const A = drawn.get(am.force)
    if (!A) throw new SpecError(`${path}.force`, `no drawn force with id "${am.force}"; give the force an "id" (components are "id.x" and "id.y")`)
    let ref, refDrawn = false
    const closest = (cands) => cands.reduce((best, c) => (V.dot(c, A.d) > V.dot(best, A.d) ? c : best))
    if (am.from === 'horizontal' || am.from === undefined) ref = closest([[1, 0], [-1, 0]])
    else if (am.from === 'vertical') ref = closest([[0, 1], [0, -1]])
    else if (am.from === 'surface') { if (!surf) throw new SpecError(`${path}.from`, 'no surface in this panel'); ref = closest([surf.t, V.mul(surf.t, -1)]) }
    else if (typeof am.from === 'number') ref = dirOf(am.from)
    else if (drawn.has(am.from)) { ref = drawn.get(am.from).d; refDrawn = true }
    else throw new SpecError(`${path}.from`, 'from is horizontal, vertical, surface, an angle in degrees, or another force id')
    const R = am.r ? val(am.r, env, `${path}.r`) * U : Math.min(0.6 * U, 0.75 * A.L, refDrawn ? 0.75 * drawn.get(am.from).L : Infinity)
    const a1 = degOf(ref), a2 = a1 + shortSweep(a1, degOf(A.d))
    if (!refDrawn) {
      const e = V.add(A.vertex, V.mul(ref, R + 14))
      cv.front.push(el('line', { x1: A.vertex[0], y1: A.vertex[1], x2: e[0], y2: e[1], stroke: theme.muted, 'stroke-width': 1, 'stroke-dasharray': '3 3' }))
      cv.trace([A.vertex, e], 'guide', 0.5)
    }
    const arc = arcPoints(A.vertex, R, a1, a2)
    cv.front.push(el('path', { d: pathD(arc), fill: 'none', stroke: theme.muted, 'stroke-width': 1.2 }))
    cv.trace(arc, 'arc', 0.6)
    if (am.label) {
      const bis = dirOf((a1 + a2) / 2)
      labels.first.push({ label: am.label, size: fs, fill: theme.fg, cands: [4, 12, 22].map((g) => (w, h) => V.add(A.vertex, V.mul(bis, R + g + extent(bis, w, h)))) })
    }
  })

  drawDims(scene, sc, col, pp, cv, labels, ctx)

  // Body labels: inside a block or disk when there's room, else beside it.
  for (const b of sc.bodies) {
    if (!b.label) continue
    const cands = []
    if (b.type === 'block' || b.type === 'disk') {
      for (const [u, v] of [[0, 0], [0, 0.22], [0, -0.22], [-0.25, 0.22], [0.25, 0.22], [-0.25, -0.22], [0.25, -0.22]]) cands.push(loc(b, u * b.w, v * b.h))
    }
    const r = b.type === 'bar' ? b.h / 2 : b.type === 'point' ? 6 : b.h / 2
    if (b.type === 'bar') {
      for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) for (const s of [1, -1]) {
        const p = loc(b, -b.w / 2 + t * b.w, 0), d = V.mul(ey(b), s)
        cands.push((w, h) => V.add(p, V.mul(d, r + 5 + extent(d, w, h))))
      }
    } else cands.push(...ringCands(b.c, b.type === 'point' ? 9 : Math.max(b.w, b.h) / 2 + 4, [1, -1]))
    labels.rest.push({ label: b.label, size: fs, fill: theme.fg, cands, ignore: [`i:${b.id}`] })
  }

  const placed = placeLabels([...labels.first, ...labels.forces, ...labels.rest, ...labels.last], cv)
  drawLabels(placed, cv, theme)

  // Uniform field over the panel, with its label in the top-right corner.
  let bbox = boxOf(cv.ext)
  if (scene.field) {
    const fd = scene.field === true ? {} : scene.field
    const v = direction(fd.dir ?? 'in', sc.bodies[0], surf, env, `${pp}field.dir`)
    const field = Math.abs(v[2]) > 0.999 ? { into: v[2] < 0 } : { sd: V.unit(project(v)) }
    const region = [bbox[0] - 0.35 * U, bbox[1] - 0.3 * U - fs, bbox[2] + 0.35 * U, bbox[3] + 0.35 * U]
    const name = fd.label ?? fd.type ?? 'B'
    const w = measure(name, fs) + 2
    const corner = [region[2] - w - 4, region[1] + 2, region[2] - 4, region[1] + fs + 6]
    cv.front.push(labelSvg(name, (corner[0] + corner[2]) / 2, corner[3] - 4.5, theme, { fill: theme.muted }))
    const n = drawField(cv, [region[0], region[1] + fs + 6, region[2], region[3]], field, placed, corner, theme)
    ctx.fieldMarks += n
    bbox = region
  }
  return { cv, bbox, sums, placed, tips: arrows.map((a) => ({ label: a.f.label, tail: a.tail, tip: a.tip })) }
}

/**
 * Dimension lines along bars: each from one point to another (fractions, start, end, or a force
 * or support id), in rows below the bar (or above) past everything drawn there, with extension
 * lines, arrowheads at both ends and the label on the line. A numeric label is checked against
 * the bar's span.
 */
function drawDims(scene, sc, col, pp, cv, labels, ctx) {
  const { theme, env, diag } = ctx
  const list = scene.dims ?? []
  if (!Array.isArray(list)) throw new SpecError(`${pp}dims`, 'dims is a list like [{"from": "start", "to": 0.25, "label": "2 m"}]')
  const rows = new Map() // body id + side -> [[t0, t1, row], ...]
  const c = theme.muted, fs = theme.size
  list.forEach((dm, i) => {
    const path = `${pp}dims[${i}]`
    const b = sc.body(dm.on, `${path}.on`)
    if (b.type !== 'bar') throw new SpecError(`${path}.on`, 'a dimension line goes along a bar; give "on" the bar\'s id')
    const where = (ref, key) => {
      if (ref === undefined || ref === 'start') return key === 'from' || ref === 'start' ? 0 : 1
      if (ref === 'end') return 1
      if (typeof ref === 'number' || /^\s*\d*\.?\d+\s*$/.test(ref)) {
        const t = Number(ref)
        if (!(t >= 0 && t <= 1)) throw new SpecError(`${path}.${key}`, 'a fraction along the bar runs from 0 (start) to 1 (end)')
        return t
      }
      const pt = col.points.get(ref)
      if (!pt) throw new SpecError(`${path}.${key}`, `${key} is start, end, a fraction 0 to 1, or a force or support id${col.points.size ? ` (${[...col.points.keys()].join(', ')})` : ''}`)
      if (pt.body !== b) throw new SpecError(`${path}.${key}`, `"${ref}" acts on ${pt.body.id}, not on ${b.id}`)
      return pt.t
    }
    let t0 = where(dm.from, 'from'), t1 = where(dm.to ?? 'end', 'to')
    if (t1 < t0) [t0, t1] = [t1, t0]
    if (t1 - t0 < 1e-9) throw new SpecError(path, 'from and to are the same point')
    const side = dm.side ?? 'below'
    if (!['below', 'above'].includes(side)) throw new SpecError(`${path}.side`, 'side is "below" (default) or "above"')
    const span = b.src.span !== undefined ? val(b.src.span, env, `${b.path}.span`) : null
    let label = dm.label
    if (label === undefined) {
      if (span === null) diag.warn(`${path}.label`, 'give a label (like "2 m"), or a span on the bar to compute it')
      else label = `${r4((t1 - t0) * span)}${dm.unit ? ` ${dm.unit}` : ''}`
    } else if (span !== null) {
      const m = /^\s*(\d*\.?\d+)/.exec(String(label)), len = (t1 - t0) * span
      if (m && Math.abs(Number(m[1]) - len) > 0.01 * Math.max(Math.abs(len), 1e-9)) {
        diag.warn(`${path}.label`, `the label says ${m[1]} but the span gives ${r4(len)} (span ${r4(span)} × ${r4(t1 - t0)} of the bar)`)
      }
    }
    // Rows: a dimension that overlaps one already in a row moves to the next row out.
    const key = `${b.id}:${side}`
    if (!rows.has(key)) rows.set(key, [])
    const taken = rows.get(key)
    let row = 0
    while (taken.some(([a0, a1, r]) => r === row && t0 < a1 - 1e-9 && a0 < t1 - 1e-9)) row++
    taken.push([t0, t1, row])
    // Out from the bar past everything drawn on that side within the bar's length.
    const out = side === 'below' ? V.mul(ey(b), -1) : ey(b), along = ex(b)
    let clear = b.h / 2
    for (const p of cv.ext) {
      const rel = V.sub(p, b.c), u = V.dot(rel, along)
      if (u > -b.w / 2 - 12 && u < b.w / 2 + 12) clear = Math.max(clear, V.dot(rel, out))
    }
    if (!b.dimBase) b.dimBase = {}
    b.dimBase[side] ??= clear + fs + 12 // room for a label between the line and what it clears
    const off = b.dimBase[side] + row * (fs + 20)
    const P = (t) => loc(b, -b.w / 2 + t * b.w, 0)
    const p0 = V.add(P(t0), V.mul(out, off)), p1 = V.add(P(t1), V.mul(out, off))
    for (const t of [t0, t1]) {
      const a = V.add(P(t), V.mul(out, b.h / 2 + 4)), z = V.add(P(t), V.mul(out, off + 5))
      cv.back.push(el('line', { x1: a[0], y1: a[1], x2: z[0], y2: z[1], stroke: c, 'stroke-width': 0.8 }))
      cv.trace([V.add(P(t), V.mul(out, off - 4)), z], 'dim', 0.6)
      cv.ext.push(z)
    }
    const mid = V.mid(p0, p1)
    if (V.len(V.sub(p1, p0)) > 22) { arrow(cv, mid, p0, c, { width: 1, head: 7, tag: 'dim' }); arrow(cv, mid, p1, c, { width: 1, head: 7, tag: 'dim' }) }
    else { cv.front.push(el('line', { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1], stroke: c, 'stroke-width': 1 })); cv.trace([p0, p1], 'dim') }
    if (label !== undefined) {
      const n = V.mul(out, -1)
      const spots = [0.5, 0.35, 0.65].flatMap((f) => [n, out].map((s) => (w, h) => V.add(V.add(p0, V.mul(V.sub(p1, p0), f)), V.mul(s, 3 + extent(s, w, h)))))
      labels.rest.push({ label, size: fs, fill: theme.fg, cands: spots })
    }
    col.dimText ??= []
    col.dimText.push(`${b.id} ${r4(t0)}–${r4(t1)}${span !== null ? ` = ${r4((t1 - t0) * span)}` : ''}${label !== undefined ? ` "${label}"` : ''}`)
  })
}

function axesAngle(scene, sc, env, pp) {
  const ax = scene.axes && typeof scene.axes === 'object' ? scene.axes : {}
  if (ax.angle === 'surface') return sc.surf?.ang ?? 0
  if (ax.angle !== undefined) return val(ax.angle, env, `${pp}axes.angle`)
  return sc.surf && sc.bodies[0].s !== undefined ? sc.surf.ang : 0
}

/**
 * Label spots for an arrow that ends inside its body (a short friction arrow along a block's
 * bottom): just past the body's edge along the arrow, either side of its line.
 */
function outsideCands(a) {
  const b = a.f.body
  if (b.type !== 'block' && b.type !== 'disk') return []
  const poly = grow(outline(b), b.c, 2)
  if (!insidePoly(V.sub(a.tip, V.mul(a.sd, 1)), poly)) return []
  let s = 0
  while (s < 400 && insidePoly(V.add(a.tail, V.mul(a.sd, s)), poly)) s += 2
  const n = V.perp(a.sd)
  return [n, V.mul(n, -1)].map((side) => (w, h) => V.add(V.add(a.tail, V.mul(a.sd, s + 3 + extent(a.sd, w, h))), V.mul(side, 3 + extent(side, w, h))))
}

/** A polygon pushed out from c by d px (enough for convex body outlines). */
const grow = (poly, c, d) => poly.map((p) => V.add(p, V.mul(V.unit(V.sub(p, c)), d)))

function boxOf(points) {
  if (!points.length) return [0, 0, 1, 1]
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** ΣF on each body that has forces (3D math components), and ΣM about a bar's start when it has a span. */
function sumsFor(sc, col, ctx) {
  const out = []
  for (const b of sc.bodies) {
    const fs = col.forces.filter((f) => f.body === b && !f.vector)
    const ms = col.moments.filter((m) => m.body === b)
    if (!fs.length) continue
    const complete = fs.every((f) => f.mag !== null)
    const any = fs.some((f) => f.mag !== null)
    const F = [0, 0, 0]
    for (const f of fs) if (f.mag !== null) for (let k = 0; k < 3; k++) F[k] += f.v[k] * f.mag
    const big = Math.max(...fs.map((f) => f.mag ?? 0))
    const zero = Math.hypot(...F) < 1e-6 * Math.max(1, big)
    const s = { body: b, F: F.map((x) => r4(x, big)), complete, any, zero, count: fs.length }
    if (b.type === 'bar' && b.src.span !== undefined && complete && ms.every((m) => m.mag !== null)) {
      const span = val(b.src.span, ctx.env, `${b.path}.span`), e = toMath(ex(b))
      let M = 0
      for (const f of fs) {
        // Lever arm from the bar's start to where the force acts, along the bar.
        const t = f.t ?? 0.5
        const r = [e[0] * t * span, e[1] * t * span]
        M += r[0] * f.v[1] * f.mag - r[1] * f.v[0] * f.mag
      }
      for (const m of ms) M += (m.ccw ? 1 : -1) * m.mag
      s.M = r4(M, big * span)
    }
    out.push(s)
  }
  return out
}

function forceText(f) {
  return `${f.label ?? (f.kind === 'load' ? 'distributed load' : '?')}${f.crossOf ? ` = ${f.crossOf}` : ''} ${describe(f.v)}${f.mag !== null ? ` ${r4(f.mag)}` : ''}`
}

export default {
  kind: 'fbd',
  fields: ['panels', ...SCENE, 'caption', 'unit', 'mono', 'highlight'],
  collections: ['panels', 'bodies', 'forces', 'connections', 'supports', 'loads', 'moments', 'angles', 'dims'],
  render(spec, { theme, diag, env, uid }) {
    const base = {}
    for (const k of SCENE) if (spec[k] !== undefined) base[k] = spec[k]
    if (spec.panels !== undefined && !Array.isArray(spec.panels)) throw new SpecError('panels', 'panels is a list of scenes, each with an optional caption')
    const panels = spec.panels ? spec.panels.map((p, i) => ({ scene: { ...base, ...p }, pp: `panels[${i}].`, caption: p.caption })) : [{ scene: base, pp: '', caption: spec.caption }]
    const ctx = { theme, diag, env, highlight: new Set(spec.highlight ?? []), mono: !!spec.mono, short: [], cut: [], fieldMarks: 0 }
    const unit = spec.unit ? ` ${spec.unit}` : ''

    // Resolve every panel first so arrow lengths share one scale across panels.
    const resolved = panels.map((p) => {
      const sc = resolve(p.scene, p.pp, env, diag)
      return { ...p, sc, col: collect(p.scene, sc, p.pp, env, diag) }
    })
    const all = resolved.flatMap((r) => r.col.forces)
    const scale = {
      force: Math.max(0, ...all.filter((f) => !f.vector && f.mag !== null).map((f) => f.mag)),
      vector: Math.max(0, ...all.filter((f) => f.vector && f.mag !== null).map((f) => f.mag)),
    }

    const fs = theme.size
    const drawnPanels = resolved.map((r) => ({ ...r, ...drawPanel(r.scene, r.sc, r.col, r.pp, ctx, scale) }))
    const GAP = 30, M = 14
    const capH = drawnPanels.some((p) => p.caption) ? fs + 12 : 0
    const H = Math.max(...drawnPanels.map((p) => p.bbox[3] - p.bbox[1]))
    let x = M
    const groups = [], layout = []
    for (const p of drawnPanels) {
      const [x0, y0, x1, y1] = p.bbox
      const w = Math.max(x1 - x0, p.caption ? measure(p.caption, fs) : 0)
      const dx = x + (w - (x1 - x0)) / 2 - x0, dy = M + (H - (y1 - y0)) / 2 - y0
      // Where things ended up in the SVG, for tests of the layout.
      const at = (q) => [q[0] + dx, q[1] + dy]
      layout.push({ labels: p.placed.map((q) => ({ label: q.label, box: [...at(q.box), ...at(q.box.slice(2))], backed: q.inner >= 1 })),
        ground: p.cv.ground?.map(at), arrows: p.tips.map((a) => ({ label: a.label, tail: at(a.tail), tip: at(a.tip) })) })
      const kids = [...p.cv.back, ...p.cv.mid, ...p.cv.front]
      groups.push(el('g', { transform: `translate(${dx.toFixed(1)},${dy.toFixed(1)})` }, kids))
      if (p.caption) groups.push(labelSvg(p.caption, x + w / 2, M + H + capH - 2, theme, { fill: theme.fg }))
      x += w + GAP
    }
    const W = x - GAP + M, Ht = M + H + capH + M

    // Summary and notes: each body's forces and their sums.
    const lines = drawnPanels.map((p, i) => {
      const parts = []
      for (const s of p.sums) {
        const fl = p.col.forces.filter((f) => f.body === s.body && !f.vector).map(forceText)
        let sum = ''
        if (s.complete) {
          const comps = Math.abs(s.F[2]) > 0 ? s.F : s.F.slice(0, 2)
          sum = s.zero ? `; ΣF = 0${unit} (balanced)` : `; ΣF = (${comps.join(', ')})${unit}, |ΣF| = ${r4(Math.hypot(...s.F))}${unit} ${describe(unit3(s.F))}`
          diag.note(`${p.pp}forces`, `${s.body.label ?? s.body.id}: ${sum.slice(2)}${s.M !== undefined ? `, ΣM about the start = ${s.M}` : ''}`)
        } else if (s.any) sum = `; ΣF not summed (${s.count - p.col.forces.filter((f) => f.body === s.body && !f.vector && f.mag !== null).length} without mag)`
        if (s.M !== undefined) sum += `; ΣM(start) = ${s.M}`
        parts.push(`${s.body.id} (${s.body.type}): ${fl.join(', ')}${sum}`)
      }
      const vecs = p.col.forces.filter((f) => f.vector).map(forceText)
      if (vecs.length) parts.push(`vectors: ${vecs.join(', ')}`)
      for (const ld of p.col.loads) parts.push(`load on ${ld.b.id} from ${r4(ld.from)} to ${r4(ld.to)}, resultant at ${r4(ld.tc)} of the length`)
      if (p.col.dimText) parts.push(`dims: ${p.col.dimText.join(', ')}`)
      const crowded = p.placed.filter((q) => q.hard).map((q) => q.label)
      if (crowded.length) diag.warn(`${p.pp}forces`, `no clear spot for ${crowded.join(', ')}; the label sits on a backing box. Spread the forces or bodies out`)
      return `${drawnPanels.length > 1 ? `[${i + 1}${p.caption ? ` ${p.caption}` : ''}] ` : ''}${parts.join('; ')}`
    })
    if (ctx.short.length) diag.note('forces', `drawn at the minimum length, longer than to scale: ${ctx.short.join(', ')}`)
    if (ctx.cut.length) diag.note('connections', `drawn shorter than to scale to end before the rope's mount or pulley: ${ctx.cut.join(', ')}`)
    const summary = `fbd: ${drawnPanels.length} panel${drawnPanels.length > 1 ? 's' : ''}; ${lines.join(' | ')}${ctx.fieldMarks ? '; field drawn' : ''}`
    return { body: el('g', {}, groups), width: W, height: Ht, summary, alt: 'free-body diagram', layout }
  },
}
