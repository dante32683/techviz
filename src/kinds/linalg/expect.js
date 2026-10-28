// expect: the values a spec's author believes, checked against the computed ones. Each wrong one
// is a warning that names it and gives the right value (with a hint for the usual slips: a
// flipped det sign, the transpose or adjugate for the inverse); the summary counts them. Exact
// values compare exactly; a decimal or an irrational value compares to 0.1%.

import { SpecError } from '../../diag.js'
import * as N from './num.js'
import * as M from './matrix.js'
import { readMatrix, readVector } from './read.js'

const { fmt, vecText, matText, toF } = N

const KEYS = {
  all: ['det', 'inverse', 'trace', 'rank', 'nullity', 'pivots', 'rref', 'col', 'nul', 'eigenvalues', 'eigenvectors'],
  transform: ['matrix'],
  rref: ['x', 'solutions', 'free'],
  vectors: ['c', 'dot', 'angle', 'proj', 'perp'],
  lsq: ['fit', 'xhat', 'error'],
}

const same = (got, want) => {
  if (N.isQ(got) && N.isQ(want)) return N.eq(got, want)
  const g = toF(got), w = toF(want)
  return Math.abs(g - w) <= Math.max(1e-3 * Math.abs(w), 1e-3)
}
const sameVec = (u, v) => u.length === v.length && u.every((x, k) => same(x, v[k]))
const sameMat = (A, B) => A.length === B.length && A.every((r, i) => sameVec(r, B[i]))
const rankOf = (cols) => (cols.length ? M.spaces(M.transpose(cols)).rank : 0)

// An eigenvalue as written: 3, "5/2", "sqrt(13)", "1+2i", "-1-2i", "1 ± 2i" or "1+-2i" (the
// pair), or [re, im].
function readEig(v, env, path) {
  if (Array.isArray(v)) return [readVector(v, env, path, 2).map(toF)]
  const s = String(v).replace(/\s+/g, '').replace(/−/g, '-')
  const m = /^([+-]?[^+\-±]*?)(\+-|±|\+|-)([^+\-±]*)i$/.exec(s)
  if (typeof v === 'string' && m && /i$/.test(s)) {
    const re = m[1] ? toF(N.parseNum(m[1], env, path)) : 0, im = toF(N.parseNum(m[3] || '1', env, path))
    return m[2] === '±' || m[2] === '+-' ? [[re, im], [re, -im]] : [[re, m[2] === '-' ? -im : im]]
  }
  if (typeof v === 'string' && /^[+-]?[\d.]*i$/.test(s)) { const im = s === 'i' || s === '+i' ? 1 : s === '-i' ? -1 : parseFloat(s); return [[0, im]] }
  return [toF(N.parseNum(v, env, path))]
}
const eigKey = (x) => (Array.isArray(x) ? x : [x, 0])

export function checkExpect(exp, S, env, diag) {
  if (exp === undefined) return ''
  if (!exp || typeof exp !== 'object' || Array.isArray(exp)) throw new SpecError('expect', 'expect is an object of values, like {"det": -2, "rank": 2}')
  const allowed = [...KEYS.all, ...(KEYS[S.mode] ?? [])]
  let n = 0
  const wrong = []
  const miss = (path, msg) => { wrong.push(msg); diag.warn(path, msg) }
  const F = S.F
  const need = (key, ok, why) => { if (!ok) throw new SpecError(`expect.${key}`, why) }
  // A decimal the author wrote (0.333, "0.7071") is a rounded value, so it compares to 0.1%.
  const isDec = (v) => (typeof v === 'number' && !Number.isInteger(v)) || (typeof v === 'string' && /\d\.\d|\de-/i.test(v))
  const soft = (v, x) => (isDec(v) ? toF(x) : x)
  const num = (v, path) => soft(v, N.parseNum(v, env, path))
  const vec = (v, path, dim) => readVector(v, env, path, dim).map((x, k) => soft(v[k], x))
  const mat = (v, path) => readMatrix(v, env, path).map((r, i) => r.map((x, j) => soft(v[i][j], x)))
  const norm = (v) => Math.hypot(...v.map(toF))
  for (const [key, want] of Object.entries(exp)) {
    const path = `expect.${key}`
    if (!allowed.includes(key)) throw new SpecError(path, `${S.mode} mode checks ${allowed.join(', ')}`)
    n++
    if (['det', 'inverse', 'trace', 'eigenvalues', 'eigenvectors'].includes(key)) need(key, F?.square, `${key} needs a square matrix`)
    if (key === 'det') {
      const w = num(want, path)
      if (!same(F.det, w)) miss(path, `det ${S.name} is ${fmt(F.det)}, not ${fmt(w)}${same(N.neg(F.det), w) && !N.isZero(w) ? ' (the sign is flipped: each row swap changes it, and cofactor signs alternate)' : ''}`)
    } else if (key === 'trace') {
      const w = num(want, path)
      if (!same(F.trace, w)) miss(path, `trace ${S.name} is ${fmt(F.trace)}, not ${fmt(w)}`)
    } else if (key === 'inverse') {
      if (want === null || want === 'none') { if (F.inverse) miss(path, `${S.name} is invertible (det ${fmt(F.det)}): ${S.name}⁻¹ = ${matText(F.inverse)}`); continue }
      const w = mat(want, path)
      if (!F.inverse) { miss(path, `${S.name} is singular (det 0), so it has no inverse`); continue }
      if (!sameMat(F.inverse, w)) {
        const adj = F.inverse.map((r) => r.map((x) => N.mul(F.det, x)))
        const hint = sameMat(M.transpose(F.inverse), w) ? ' (that is its transpose)' : sameMat(adj, w) ? ` (that is the adjugate; divide it by det ${S.name} = ${fmt(F.det)})` : sameMat(M.transpose(F.A), w) ? ` (that is ${S.name}ᵀ)` : ''
        miss(path, `${S.name}⁻¹ is ${matText(F.inverse)}, not ${matText(w)}${hint}`)
      }
    } else if (key === 'rank' || key === 'nullity') {
      if (F[key] !== Number(want)) miss(path, `${key} is ${F[key]}, not ${want}${key === 'nullity' ? ` (nullity = number of columns − rank = ${F.n} − ${F.rank})` : ''}`)
    } else if (key === 'pivots') {
      const got = F.pivotCols.map((j) => j + 1)
      if (!Array.isArray(want) || want.join() !== got.join()) miss(path, `the pivot columns are ${got.join(', ') || 'none'}, not ${[].concat(want).join(', ')}`)
    } else if (key === 'rref') {
      // With b, the RREF of [A | b] (the steps' end) or of A alone both count.
      const w = mat(want, path), R = S.R ?? F.R
      if (!sameMat(R, w) && !sameMat(F.R, w)) miss(path, `the RREF${S.aug ? ` of ${S.aug}` : ''} is ${matText(R)}, not ${matText(w)}${M.isRref(w) ? '' : ' (which is not in reduced echelon form)'}`)
    } else if (key === 'col' || key === 'nul') {
      if (!Array.isArray(want)) throw new SpecError(path, `${key} is a list of basis vectors, like [[1, 0, 2]]`)
      const vs = want.map((v, k) => vec(v, `${path}[${k}]`, key === 'col' ? F.m : F.n))
      const dimWant = key === 'col' ? F.rank : F.nullity, sp = `${key === 'col' ? 'Col' : 'Nul'} ${S.name}`
      // Exact inputs test exactly; a float matrix or a rounded vector tests to 0.1% of its size.
      const exact = (v) => M.allExact(F.A) && v.every(N.isQ), normA = norm(F.A.flat())
      const inNul = (v) => (exact(v) ? M.isZeroVec(M.matVec(F.A, v)) : norm(M.matVec(F.A, v)) <= 1e-3 * normA * norm(v))
      const inCol = (v) => (exact(v) ? rankOf([...F.A[0].map((_, j) => M.col(F.A, j)), v]) === F.rank : norm(M.leastSquares(F.A, v).e) <= 1e-3 * norm(v))
      const bad = vs.findIndex((v) => !(key === 'col' ? inCol(v) : inNul(v)))
      if (bad >= 0) miss(`${path}[${bad}]`, `${vecText(vs[bad])} is not in ${sp}${key === 'nul' ? `: ${S.name}x = ${vecText(M.matVec(F.A, vs[bad]))}` : ''}`)
      else if (vs.length !== dimWant) miss(path, `${sp} has dimension ${dimWant}, so a basis has ${dimWant} vector${dimWant === 1 ? '' : 's'}, not ${vs.length}; one is ${(key === 'col' ? F.col : F.nul).map(vecText).join(', ') || 'the empty set'}`)
      else if (rankOf(vs) < vs.length) miss(path, `those vectors are linearly dependent, so they are not a basis of ${sp}`)
    } else if (key === 'eigenvalues') {
      if (!Array.isArray(want)) throw new SpecError(path, 'eigenvalues is a list, like [3, 1] or ["1+2i", "1-2i"]')
      const got = F.eig.flatMap((e) => M.eigFloats(e).flatMap((x) => (Array.isArray(x) ? [x, [x[0], -x[1]]] : [x])).flatMap((x) => Array(e.mult).fill(x)))
      const ws = want.flatMap((v, k) => readEig(v, env, `${path}[${k}]`))
      const near = (a, b) => { const [ar, ai] = eigKey(a), [br, bi] = eigKey(b); return Math.abs(ar - br) <= Math.max(1e-3, 1e-3 * Math.abs(br)) && Math.abs(ai - bi) <= Math.max(1e-3, 1e-3 * Math.abs(bi)) }
      // One to one with multiplicity, or each distinct value listed once.
      const match = (as, bs) => { const left = bs.slice(); return as.length === bs.length && as.every((a) => { const k = left.findIndex((b) => near(a, b)); return k >= 0 && left.splice(k, 1) }) }
      const distinct = (xs) => xs.filter((x, k) => xs.findIndex((y) => near(x, y)) === k)
      if (!match(ws, got) && !(distinct(ws).length === ws.length && match(ws, distinct(got)))) miss(path, `the eigenvalues are ${F.eig.map((e) => M.eigText(e) + (e.mult > 1 ? ` (×${e.mult})` : '')).join(', ')}, not ${want.join(', ')}`)
    } else if (key === 'eigenvectors') {
      if (!Array.isArray(want)) throw new SpecError(path, 'eigenvectors is a list of vectors, like [[1, 1], [1, -1]]')
      want.forEach((v, k) => {
        const x = vec(v, `${path}[${k}]`, F.n), Ax = M.matVec(F.A, x)
        const i = x.findIndex((t) => !N.isZero(t))
        if (i < 0) { miss(`${path}[${k}]`, 'the zero vector is never an eigenvector'); return }
        const lam = N.div(Ax[i], x[i])
        if (!sameVec(Ax, M.vscale(lam, x))) miss(`${path}[${k}]`, `${vecText(x)} is not an eigenvector: ${S.name}x = ${vecText(Ax)}, not a multiple of x`)
      })
    } else if (key === 'matrix') {
      const w = mat(want, path)
      if (!sameMat(S.T, w)) miss(path, `the matrix of the whole map is ${S.Tname} = ${matText(S.T)}, not ${matText(w)}`)
    } else if (['x', 'solutions', 'free'].includes(key) && !S.b) {
      throw new SpecError(path, `${key} checks a system Ax = b; give "b" as a vector`)
    } else if (key === 'x') {
      const x = vec(want, path, F.n)
      if (!S.sol.consistent) miss(path, 'the system is inconsistent, so it has no solution')
      else if (!sameVec(M.matVec(F.A, x), S.b)) miss(path, `${vecText(x)} is not a solution: Ax = ${vecText(M.matVec(F.A, x))}, not b = ${vecText(S.b)}; one solution is ${vecText(S.sol.p)}`)
    } else if (key === 'solutions') {
      const got = !S.sol.consistent ? 'none' : S.sol.free.length ? 'infinite' : 'one'
      const w = { unique: 'one', 1: 'one', infinitely: 'infinite', many: 'infinite', no: 'none', 0: 'none' }[String(want).split(' ')[0]] ?? String(want)
      if (w !== got) miss(path, `the system has ${got === 'none' ? 'no solution' : got === 'one' ? 'exactly one solution' : 'infinitely many solutions'}, not "${want}"`)
    } else if (key === 'free') {
      const got = S.sol.free.map((j) => j + 1)
      if (!Array.isArray(want) || want.join() !== got.join()) miss(path, `the free variables are ${got.map((j) => `x${j}`).join(', ') || 'none'}, not ${[].concat(want).join(', ')}`)
    } else if (key === 'c') {
      const cb = S.combos.find((c) => c.target) ?? S.combos[0]
      need(key, cb, 'c checks the coefficients of a combo; add "combo"')
      const c = vec(want, path, cb.of.length)
      const sum = cb.of.reduce((s, o, k) => M.vadd(s, M.vscale(c[k], o.v)), M.zeros(cb.of[0].v.length))
      const goal = cb.target ?? cb.result
      if (cb.target && !cb.consistent) miss(path, `${cb.label} is not in the span, so no weights reach it`)
      else if (cb.unique ? !sameVec(c, cb.c) : !sameVec(sum, goal)) miss(path, `those weights give ${vecText(sum)}, not ${vecText(goal)}; the weights are ${cb.c.map(fmt).join(', ')}`)
    } else if (['dot', 'angle', 'proj', 'perp'].includes(key)) {
      const P = key === 'angle' || key === 'dot' ? S.angle ?? S.proj : S.proj
      need(key, P, `${key} needs ${key === 'proj' || key === 'perp' ? '"project"' : '"angle" or "project"'}`)
      need(key, key === 'proj' || key === 'perp' || P.dot !== undefined, `${key} needs "angle", or "project" onto one vector`)
      if (key === 'dot') { const w = num(want, path); if (!same(P.dot, w)) miss(path, `${P.dotName} = ${fmt(P.dot)}, not ${fmt(w)}`) }
      else if (key === 'angle') { const w = toF(N.parseNum(want, env, path)); if (Math.abs(P.theta - w) > 0.05) miss(path, `the angle is ${fmt(P.theta)}°, not ${fmt(w)}°`) }
      else { const w = vec(want, path, P.yhat.length), got = key === 'proj' ? P.yhat : P.z; if (!sameVec(got, w)) miss(path, `${key === 'proj' ? 'ŷ' : 'z = y − ŷ'} is ${vecText(got)}, not ${vecText(w)}`) }
    } else if (key === 'fit' || key === 'xhat') {
      need(key, S.lsq, `${key} needs least squares`)
      const w = vec(want, path, S.lsq.xhat.length)
      if (S.lsq.free.length) { if (!sameVec(M.matVec(S.lsq.AtA, w), S.lsq.Atb)) miss(path, `${vecText(w)} does not solve the normal equations; one least-squares solution is ${vecText(S.lsq.xhat)}`) }
      else if (!sameVec(S.lsq.xhat, w)) miss(path, `the least-squares ${key === 'fit' ? 'coefficients are' : 'solution is'} ${vecText(S.lsq.xhat)}, not ${vecText(w)}`)
    } else if (key === 'error') {
      need(key, S.lsq, 'error needs least squares')
      const w = toF(N.parseNum(want, env, path)), got = Math.sqrt(toF(S.lsq.ee))
      if (Math.abs(got - w) > Math.max(1e-3, 1e-3 * got)) miss(path, `the least-squares error ‖b − Ax̂‖ is ${fmt(got)}, not ${fmt(w)}${Math.abs(toF(S.lsq.ee) - w) < 1e-6 ? ' (that is its square)' : ''}`)
    }
  }
  return wrong.length ? `expect: ${wrong.length} of ${n} wrong: ${wrong.join('; ')}` : `expect: ${n} checked, all match`
}
