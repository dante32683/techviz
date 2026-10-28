// The computed facts about a matrix that every linalg mode reports: det, the inverse, trace, the
// characteristic polynomial in Lay's form det(A − λI), eigenvalues with multiplicities and
// eigenspace bases (or the rotation-scaling of a complex pair), rank, nullity, pivot columns,
// bases for Col A and Nul A, and the RREF. expect checks against the same object.

import * as N from './num.js'
import * as M from './matrix.js'

const { fmt, vecText, matText } = N

export function analyze(A) {
  const F = { A, m: A.length, n: A[0].length, square: A.length === A[0].length, ...M.spaces(A) }
  if (F.square) {
    F.det = M.det(A); F.inverse = M.inverse(A); F.trace = M.trace(A)
    const ev = M.eigenvalues(A)
    F.poly = ev.poly
    F.lay = F.n % 2 ? ev.poly.map(N.neg) : ev.poly // det(A − λI) = (−1)ⁿ det(λI − A)
    F.eig = ev.values.map((e) => ({ ...e, vectors: M.eigenvectors(A, e) }))
    const cx = F.eig.find((e) => e.kind === 'cx' || e.kind === 'fc')
    if (cx && F.n === 2) F.rot = M.rotationScaling(A, cx)
  }
  return F
}

/** r = |λ| as text: "√5 ≈ 2.236" or "2". */
export function modText(r2) {
  const s = N.sqrtQ(r2)
  if (s) return s.r === 1n ? fmt(s.c) : `${N.surdText(s.c, s.r)} ≈ ${fmt(N.surdF(s.c, s.r))}`
  return fmt(Math.sqrt(N.toF(r2)))
}

export function eigLine(e) {
  const t = M.eigText(e)
  if (e.kind === 'cx' || e.kind === 'fc') return `λ = ${t} (complex, no real eigenvectors)`
  const approx = e.kind === 'surd' ? ` ≈ ${M.eigFloats(e).map(fmt).join(', ')}` : e.kind === 'f' ? ' (numeric)' : ''
  const mult = e.mult > 1 ? ` (multiplicity ${e.mult})` : ''
  const vs = e.vectors.flat()
  const basis = e.kind === 'surd' ? `eigenvectors ≈ ${e.vectors.map((b) => b.map(vecText).join(', ')).join(' and ')}` : `eigenspace basis ${vs.map(vecText).join(', ')}`
  const defect = e.kind === 'q' && vs.length < e.mult ? ` (defective: ${vs.length} independent eigenvector${vs.length > 1 ? 's' : ''} for multiplicity ${e.mult})` : ''
  return `λ = ${t}${approx}${mult}: ${basis}${defect}`
}

/** The facts as summary clauses. */
export function factText(F, name = 'A') {
  const out = [`${name} = ${matText(F.A)} (${F.m}×${F.n})`]
  if (F.square) {
    out.push(`det ${name} = ${fmt(F.det)}`)
    out.push(F.inverse ? `${name}⁻¹ = ${matText(F.inverse)}` : `${name} is singular (det 0, no inverse)`)
    out.push(`trace ${fmt(F.trace)}`, `det(${name} − λI) = ${M.polyText(F.lay)}`)
    for (const e of F.eig) out.push(eigLine(e))
    if (F.rot) out.push(`as a rotation-scaling (A = PCP⁻¹): r = |λ| = ${modText(F.rot.r2)}, φ = ${fmt(F.rot.phi)}°, C = ${matText(F.rot.C)}, P = ${matText(F.rot.P)}`)
  }
  out.push(`rank ${F.rank}, nullity ${F.nullity}`, `pivot columns ${F.pivotCols.map((j) => j + 1).join(', ') || 'none'}`)
  out.push(`Col ${name} basis ${F.col.map(vecText).join(', ') || '{0}'}`, F.nul.length ? `Nul ${name} basis ${F.nul.map(vecText).join(', ')}` : `Nul ${name} = {0}`)
  out.push(`RREF ${matText(F.R)}`)
  return out
}
