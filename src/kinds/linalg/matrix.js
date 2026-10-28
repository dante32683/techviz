// Matrix algebra for linalg, exact over the rationals (num.js): products, the determinant, the
// inverse, row reduction with every operation recorded (Lay's forward phase to echelon form, then
// the backward phase to RREF), solution sets in parametric vector form, bases for Col A and Nul A,
// the characteristic polynomial, eigenvalues (rational roots exactly, a leftover quadratic's as
// surds or a ± bi, numeric beyond that), eigenvectors, and least squares by the normal equations.

import * as N from './num.js'

const { Q, ZERO, ONE, add, sub, mul, div, neg, isZero, isOne, toF, eq, isQ, fmt, coef } = N

export const clone = (M) => M.map((r) => r.slice())
export const zeros = (n) => Array.from({ length: n }, () => ZERO)
export const identity = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? ONE : ZERO)))
export const transpose = (M) => M[0].map((_, j) => M.map((r) => r[j]))
export const dot = (u, v) => u.reduce((s, a, k) => add(s, mul(a, v[k])), ZERO)
export const matMul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, a, k) => add(s, mul(a, B[k][j])), ZERO)))
export const matVec = (A, v) => A.map((r) => dot(r, v))
export const vadd = (u, v) => u.map((a, k) => add(a, v[k]))
export const vsub = (u, v) => u.map((a, k) => sub(a, v[k]))
export const vscale = (c, v) => v.map((a) => mul(c, a))
export const isZeroVec = (v) => v.every(isZero)
export const vecEq = (u, v) => u.length === v.length && u.every((a, k) => eq(a, v[k]))
export const matEq = (A, B) => A.length === B.length && A.every((r, i) => vecEq(r, B[i]))
export const col = (M, j) => M.map((r) => r[j])
export const trace = (A) => A.reduce((s, r, i) => add(s, r[i]), ZERO)
export const allExact = (M) => M.every((r) => r.every(isQ))

export function det(A) {
  const M = clone(A), n = M.length
  let d = ONE
  for (let c = 0; c < n; c++) {
    let p = c
    while (p < n && isZero(M[p][c])) p++
    if (p === n) return ZERO
    if (p !== c) { [M[p], M[c]] = [M[c], M[p]]; d = neg(d) }
    d = mul(d, M[c][c])
    for (let i = c + 1; i < n; i++) {
      if (isZero(M[i][c])) continue
      const k = div(M[i][c], M[c][c])
      M[i] = M[i].map((x, j) => sub(x, mul(k, M[c][j])))
    }
  }
  return d
}

// Row operations: swap R_i and R_j; scale R_i by k; add k·R_j to R_i; or R_i ← a·R_i + b·R_j
// (a hand step that isn't elementary but keeps the row space).
export function applyOp(M, op) {
  const out = clone(M)
  if (op.type === 'swap') [out[op.i], out[op.j]] = [out[op.j], out[op.i]]
  else if (op.type === 'scale') out[op.i] = M[op.i].map((x) => mul(op.k, x))
  else if (op.type === 'add') out[op.i] = M[op.i].map((x, c) => add(x, mul(op.k, M[op.j][c])))
  else if (op.type === 'comb') out[op.i] = M[op.i].map((x, c) => add(mul(op.a, x), mul(op.b, M[op.j][c])))
  return out
}

const R = (i) => `R_{${i + 1}}`
const SUBS = '₀₁₂₃₄₅₆₇₈₉'
const Ru = (i) => 'R' + String(i + 1).replace(/\d/g, (d) => SUBS[d])

/** An op in label TeX: R_{2} \leftarrow R_{2} − 2R_{1}. */
export function opTex(op) {
  if (op.type === 'swap') return `${R(op.i)} ↔ ${R(op.j)}`
  if (op.type === 'scale') return `${R(op.i)} ← ${coef(op.k, R(op.i))}`
  if (op.type === 'add') return `${R(op.i)} ← ${R(op.i)}${coef(op.k, R(op.j), false)}`
  return `${R(op.i)} ← ${coef(op.a, R(op.i))}${coef(op.b, R(op.j), false)}`
}
/** The same in plain text: R₂ ← R₂ − 2R₁. */
export const opText = (op) => opTex(op).replace(/R_\{(\d+)\}/g, (_, d) => Ru(d - 1))

/**
 * Row reduce M (Lay §1.2): the forward phase takes each pivot column left to right, swaps a
 * nonzero entry up when the pivot spot holds 0, and clears the entries below it; the backward
 * phase takes the pivots right to left, scales each to 1, and clears the entries above it.
 * Returns {R, pivots: [[row, col]], steps}; each step is {ops, M, pivots, changed, phase}.
 */
export function reduce(M0, { maxCol = M0[0].length } = {}) {
  let M = clone(M0)
  const m = M.length, n = M[0].length
  const steps = [{ ops: [], M: clone(M), pivots: [], changed: [], phase: 'start' }]
  const piv = []
  const push = (ops, phase) => steps.push({ ops, M: clone(M), pivots: piv.map((p) => p.slice()), changed: [...new Set(ops.flatMap((o) => (o.type === 'swap' ? [o.i, o.j] : [o.i])))], phase })
  let r = 0
  for (let c = 0; c < Math.min(n, maxCol) && r < m; c++) {
    let p = r
    while (p < m && isZero(M[p][c])) p++
    if (p === m) continue
    if (p !== r) { const op = { type: 'swap', i: r, j: p }; M = applyOp(M, op); push([op], 'forward') }
    piv.push([r, c])
    const ops = []
    for (let i = r + 1; i < m; i++) {
      if (isZero(M[i][c])) continue
      const op = { type: 'add', i, j: r, k: neg(div(M[i][c], M[r][c])) }
      M = applyOp(M, op); M[i][c] = ZERO; ops.push(op)
    }
    if (ops.length) push(ops, 'forward')
    r++
  }
  // Echelon form shows every pivot position, the last one included (it may need no step).
  const echelon = steps.length - 1
  steps[echelon].pivots = piv.map((p) => p.slice())
  for (let t = piv.length - 1; t >= 0; t--) {
    const [r, c] = piv[t]
    if (!isOne(M[r][c])) { const op = { type: 'scale', i: r, k: div(ONE, M[r][c]) }; M = applyOp(M, op); M[r][c] = ONE; push([op], 'backward') }
    const ops = []
    for (let i = 0; i < r; i++) {
      if (isZero(M[i][c])) continue
      const op = { type: 'add', i, j: r, k: neg(M[i][c]) }
      M = applyOp(M, op); M[i][c] = ZERO; ops.push(op)
    }
    if (ops.length) push(ops, 'backward')
  }
  steps[echelon].echelon = true
  return { R: M, pivots: piv, steps }
}

/** The leading entry of each nonzero row, if M is in echelon form; else null. */
export function leading(M) {
  const out = []
  let last = -1, zeroSeen = false
  for (const [i, row] of M.entries()) {
    const c = row.findIndex((x) => !isZero(x))
    if (c < 0) { zeroSeen = true; continue }
    if (zeroSeen || c <= last) return null
    out.push([i, c]); last = c
  }
  return out
}

/** Whether M is in reduced row echelon form. */
export function isRref(M) {
  const L = leading(M)
  return !!L && L.every(([i, c]) => isOne(M[i][c]) && M.every((r, k) => k === i || isZero(r[c])))
}

/**
 * The solution set from an RREF R whose first n columns are the variables (one more column is
 * the right side, if any): consistency, free variables, a particular solution p (free variables
 * 0), and one direction per free variable, so x = p + Σ x_j v_j (parametric vector form).
 */
export function solution(R, n, pivots) {
  const aug = R[0].length > n
  const consistent = !(aug && pivots.some(([, c]) => c === n))
  const pc = pivots.filter(([, c]) => c < n)
  const isPiv = new Set(pc.map(([, c]) => c))
  const free = [...Array(n).keys()].filter((j) => !isPiv.has(j))
  const p = zeros(n)
  if (aug) for (const [r, c] of pc) p[c] = R[r][n]
  const basis = free.map((j) => { const v = zeros(n); v[j] = ONE; for (const [r, c] of pc) v[c] = neg(R[r][j]); return v })
  return { consistent, free, p, basis, pivotCols: pc.map(([, c]) => c) }
}

/** Rank, nullity, pivot columns, the RREF, and bases for Col A (pivot columns of A) and Nul A. */
export function spaces(A) {
  const { R, pivots } = reduce(A)
  const s = solution(R, A[0].length, pivots)
  return { R, pivots, pivotCols: s.pivotCols, rank: s.pivotCols.length, nullity: s.free.length, col: s.pivotCols.map((j) => col(A, j)), nul: s.basis, free: s.free }
}

export function inverse(A) {
  const n = A.length
  const I = identity(n)
  const { R, pivots } = reduce(A.map((r, i) => [...r, ...I[i]]), { maxCol: n })
  if (pivots.length < n) return null
  return R.map((r) => r.slice(n))
}

/** p(λ) = det(λI − A) by Faddeev–LeVerrier, ascending coefficients (the last is 1). */
export function charPoly(A) {
  const n = A.length, c = new Array(n + 1)
  c[n] = ONE
  let Mk = A.map((r) => r.map(() => ZERO))
  for (let k = 1; k <= n; k++) {
    Mk = matMul(A, Mk).map((r, i) => r.map((x, j) => (i === j ? add(x, c[n - k + 1]) : x)))
    c[n - k] = neg(div(trace(matMul(A, Mk)), Q(k)))
  }
  return c
}

const SUP = { 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶' }
/** "λ² − 4λ + 3" (plain) or "λ^{2} − 4λ + 3" (tex). */
export function polyText(c, x = 'λ', tex = false) {
  let s = ''
  for (let k = c.length - 1; k >= 0; k--) {
    if (isZero(c[k])) continue
    const pow = k === 0 ? '' : k === 1 ? x : tex ? `${x}^{${k}}` : `${x}${SUP[k] ?? `^${k}`}`
    const term = k === 0 ? fmt(N.abs(c[k])) : coef(N.abs(c[k]), pow)
    s += s ? (N.sign(c[k]) < 0 ? ' − ' : ' + ') + term : (N.sign(c[k]) < 0 ? '−' : '') + term
  }
  return s || '0'
}

const horner = (p, x) => p.reduceRight((s, a) => add(mul(s, x), a), ZERO)
function deflate(p, r) {
  // Ascending coefficients divided by (x − r).
  const d = p.slice().reverse(), q = [d[0]]
  for (let i = 1; i < d.length - 1; i++) q.push(add(d[i], mul(r, q[i - 1])))
  return q.reverse()
}
const blcm = (a, b) => { let x = a, y = b; while (y) [x, y] = [y, x % y]; return (a / x) * b }
function divisors(n) {
  const out = []
  for (let k = 1n; k * k <= n; k++) if (n % k === 0n) { out.push(k); if (k * k !== n) out.push(n / k) }
  return out
}

// Durand–Kerner: every root of a float polynomial (ascending coefficients) as [re, im].
function numericRoots(cf) {
  const c = cf.map(toF), n = c.length - 1
  const a = c.map((x) => x / c[n])
  const cm = (p, q) => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]]
  const cd = (p, q) => { const d = q[0] * q[0] + q[1] * q[1]; return [(p[0] * q[0] + p[1] * q[1]) / d, (p[1] * q[0] - p[0] * q[1]) / d] }
  let z = Array.from({ length: n }, (_, k) => { const r = Math.pow(0.4, k) ; return [Math.cos(0.9 * k + 0.4) * (1 + r), Math.sin(0.9 * k + 0.4) * (1 + r)] })
  for (let it = 0; it < 500; it++) {
    z = z.map((zi, i) => {
      let num = [1, 0]
      for (let k = n - 1; k >= 0; k--) num = [num[0] * zi[0] - num[1] * zi[1] + a[k], num[0] * zi[1] + num[1] * zi[0]]
      let den = [1, 0]
      z.forEach((zj, j) => { if (j !== i) den = cm(den, [zi[0] - zj[0], zi[1] - zj[1]]) })
      const d = cd(num, den)
      return [zi[0] - d[0], zi[1] - d[1]]
    })
  }
  return z
}

// Durand–Kerner spreads a k-fold root into k nearby ones (about eps^(1/k) apart), so each
// cluster becomes one root with multiplicity k. A cluster whose imaginary part is that noise is
// real, and Newton's method polishes it as a simple root of the (k − 1)th derivative.
const derivF = (c) => c.slice(1).map((x, i) => (i + 1) * x)
const evalF = (c, x) => c.reduceRight((s, a) => s * x + a, 0)
function polish(cf, x0, k) {
  let d = cf.map(toF)
  for (let q = 1; q < k; q++) d = derivF(d)
  const d1 = derivF(d)
  let x = x0
  for (let it = 0; it < 40; it++) {
    const f1 = evalF(d1, x)
    if (!f1) break
    const dx = evalF(d, x) / f1
    if (!Number.isFinite(dx)) break
    x -= dx
    if (Math.abs(dx) < 1e-15 * Math.max(1, Math.abs(x))) break
  }
  return Math.abs(x - x0) < 1e-3 * Math.max(1, Math.abs(x0)) ? x : x0
}
function floatRoots(cf, addRoot, out) {
  const groups = []
  for (const z of numericRoots(cf)) {
    const g = groups.find((h) => Math.hypot(h.re - z[0], h.im - z[1]) < 1e-4 * Math.max(1, Math.hypot(...z)))
    if (!g) { groups.push({ re: z[0], im: z[1], k: 1 }); continue }
    g.re = (g.re * g.k + z[0]) / (g.k + 1); g.im = (g.im * g.k + z[1]) / (g.k + 1); g.k++
  }
  for (const { re, im, k } of groups) {
    if (Math.abs(im) < 1e-6 * Math.max(1, Math.abs(re))) { const v = polish(cf, re, k); for (let q = 0; q < k; q++) addRoot({ kind: 'f', v }) }
    else if (im > 0) out.push({ kind: 'fc', re, im, mult: k })
  }
}

/**
 * Eigenvalues of A with their algebraic multiplicities. Each is {kind, mult, ...}:
 * 'q' {v} a rational; 'surd' {a, c, r} the pair a ± c√r; 'cx' {a, c, r} the pair a ± c√r·i;
 * 'f' {v} or 'fc' {re, im} (numeric, for floats or an irreducible cubic and up).
 */
export function eigenvalues(A) {
  const p = charPoly(A)
  const out = []
  const addRoot = (r) => { const e = out.find((o) => o.kind === r.kind && (r.kind === 'q' ? eq(o.v, r.v) : r.kind === 'f' ? Math.abs(o.v - r.v) < 1e-7 : false)); if (e) e.mult++; else out.push({ ...r, mult: 1 }) }
  if (!p.every(isQ)) {
    floatRoots(p, addRoot, out)
    return { poly: p, values: out }
  }
  let rest = p.slice()
  while (rest.length > 1 && isZero(rest[0])) { addRoot({ kind: 'q', v: ZERO }); rest = rest.slice(1) }
  const L = rest.reduce((l, x) => blcm(l, x.d), 1n)
  const ints = rest.map((x) => x.n * (L / x.d))
  const a0 = ints[0] < 0n ? -ints[0] : ints[0], an = ints[ints.length - 1] < 0n ? -ints[ints.length - 1] : ints[ints.length - 1]
  if (rest.length > 2 && a0 <= 10n ** 10n && an <= 10n ** 10n) {
    const cands = []
    for (const pp of divisors(a0)) for (const qq of divisors(an)) for (const s of [1n, -1n]) cands.push(Q(s * pp, qq))
    for (const r of cands) while (rest.length > 1 && isZero(horner(rest, r))) { addRoot({ kind: 'q', v: r }); rest = deflate(rest, r) }
  }
  if (rest.length === 2) addRoot({ kind: 'q', v: neg(div(rest[0], rest[1])) })
  else if (rest.length === 3) {
    const [c0, c1, c2] = rest
    const a = neg(div(c1, mul(Q(2), c2)))
    const disc = sub(mul(c1, c1), mul(Q(4), mul(c2, c0)))
    const s = N.sqrtQ(N.abs(disc))
    const cc = N.abs(div(s.c, mul(Q(2), c2)))
    if (s.r === 1n && N.sign(disc) >= 0) { addRoot({ kind: 'q', v: add(a, cc) }); addRoot({ kind: 'q', v: sub(a, cc) }) }
    else out.push({ kind: N.sign(disc) > 0 ? 'surd' : 'cx', a, c: cc, r: s.r, mult: 1 })
  } else if (rest.length > 3) floatRoots(rest, addRoot, out)
  return { poly: p, values: out }
}

/** An eigenvalue (or the pair) as text: "3", "(5 ± √13)/2", "1 ± 2i", "1 ± i√3". */
export function eigText(e) {
  if (e.kind === 'q') return fmt(e.v)
  if (e.kind === 'f') return fmt(e.v)
  if (e.kind === 'fc') return `${fmt(e.re)} ± ${fmt(e.im)}i`
  // a ± c√r over a common denominator.
  const d = blcm(e.a.d, e.c.d), an = e.a.n * (d / e.a.d), cn = e.c.n * (d / e.c.d)
  const rt = e.r === 1n ? '' : `√${e.r}`
  const cpart = e.kind === 'cx' ? `${cn === 1n ? '' : cn}${rt ? (cn === 1n ? 'i' + rt : 'i' + rt) : 'i'}` : `${cn === 1n && rt ? '' : cn}${rt}`
  const body = an === 0n ? `±${cpart}` : `${an < 0n ? '−' : ''}${an < 0n ? -an : an} ± ${cpart}`
  return d === 1n ? body : `(${body})/${d}`
}

/** Float values of an eigenvalue record: the real ones, or [re, im] pairs for a complex pair. */
export function eigFloats(e) {
  if (e.kind === 'q') return [toF(e.v)]
  if (e.kind === 'f') return [e.v]
  if (e.kind === 'surd') { const s = N.surdF(e.c, e.r); return [toF(e.a) + s, toF(e.a) - s] }
  if (e.kind === 'cx') return [[toF(e.a), N.surdF(e.c, e.r)]]
  return [[e.re, e.im]]
}

/** A vector scaled to integers with no common factor (for display); floats scale to a largest entry of 1. */
export function tidy(v) {
  if (v.every(isQ)) {
    const L = v.reduce((l, x) => blcm(l, x.d), 1n)
    const ints = v.map((x) => x.n * (L / x.d))
    let g = 0n
    for (const x of ints) { let a = x < 0n ? -x : x, b = g; while (b) [a, b] = [b, a % b]; g = a }
    return ints.map((x) => Q(x, g || 1n))
  }
  const f = v.map(toF), big = f.reduce((m, x) => (Math.abs(x) > Math.abs(m) ? x : m), 0)
  return f.map((x) => N.snap(x / big) ?? x / big)
}

// Null space of a float matrix by elimination with partial pivoting. A − λI can be all noise
// (A = λI), so the pivot tolerance comes from the size of A, not of the shifted matrix.
function nullFloat(M, scale, tol = 1e-7) {
  const A = M.map((r) => r.map(toF)), m = A.length, n = A[0].length
  const piv = []
  let r = 0
  for (let c = 0; c < n && r < m; c++) {
    let p = r
    for (let i = r + 1; i < m; i++) if (Math.abs(A[i][c]) > Math.abs(A[p][c])) p = i
    if (Math.abs(A[p][c]) < tol * scale) continue
    ;[A[p], A[r]] = [A[r], A[p]]
    const k = A[r][c]
    A[r] = A[r].map((x) => x / k)
    for (let i = 0; i < m; i++) if (i !== r) { const f = A[i][c]; A[i] = A[i].map((x, j) => x - f * A[r][j]) }
    piv.push([r, c]); r++
  }
  const pc = new Set(piv.map(([, c]) => c))
  return [...Array(n).keys()].filter((j) => !pc.has(j)).map((j) => { const v = new Array(n).fill(0); v[j] = 1; for (const [r, c] of piv) v[c] = -A[r][j]; return v })
}

/** Eigenvectors (a basis of each real eigenspace), tidied. */
export function eigenvectors(A, e) {
  const n = A.length
  const shift = (lam) => A.map((r, i) => r.map((x, j) => (i === j ? sub(x, lam) : x)))
  const scale = Math.max(1e-300, ...A.flat().map((x) => Math.abs(toF(x))))
  if (e.kind === 'q' && allExact(A)) return [spaces(shift(e.v)).nul.map(tidy)]
  if (e.kind === 'q' || e.kind === 'f') return [nullFloat(shift(e.v), scale).map(tidy)]
  if (e.kind === 'surd') return eigFloats(e).map((lam) => nullFloat(shift(lam), scale).map(tidy))
  return [[]]
}

/**
 * A 2×2 with complex eigenvalues as a rotation-scaling (Lay §5.5): for λ = a − bi with b > 0,
 * C = [[a, −b], [b, a]], r = |λ|, φ = the angle of (a, b), and P = [Re v, Im v] for the
 * eigenvector v = (q, λ − p) of λ, so A = PCP⁻¹. b is exact when it is rational.
 */
export function rotationScaling(A, e) {
  const [[p, q]] = A
  const a = e.kind === 'cx' ? e.a : e.re
  const b = e.kind === 'cx' ? (e.r === 1n ? e.c : N.surdF(e.c, e.r)) : e.im
  const C = [[a, neg(b)], [b, a]]
  const P = [[q, ZERO], [sub(a, p), neg(b)]]
  const r2 = add(mul(a, a), mul(b, b))
  const phi = (Math.atan2(toF(b), toF(a)) * 180) / Math.PI
  return { C, P, r2, phi }
}

/**
 * Least squares (Lay §6.5): the normal equations AᵀA x = Aᵀb, their solution x̂ (with free
 * directions when AᵀA is singular), the projection b̂ = Ax̂, the residual b − Ax̂, and ‖b − Ax̂‖².
 */
export function leastSquares(A, b) {
  const At = transpose(A), AtA = matMul(At, A), Atb = matVec(At, b)
  const n = A[0].length
  const { R, pivots } = reduce(AtA.map((r, i) => [...r, Atb[i]]))
  const s = solution(R, n, pivots)
  const xhat = s.p, bhat = matVec(A, xhat), e = vsub(b, bhat)
  return { AtA, Atb, xhat, free: s.free, basis: s.basis, bhat, e, ee: dot(e, e) }
}
