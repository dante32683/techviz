// Complex numbers ({re, im}) and real polynomials in s (coefficient arrays, ascending powers)
// with their roots, for impedances at one frequency and transfer functions over all of them.

export const cx = (re, im = 0) => ({ re, im })
export const add = (a, b) => cx(a.re + b.re, a.im + b.im)
export const sub = (a, b) => cx(a.re - b.re, a.im - b.im)
export const mul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re)
export const scale = (a, k) => cx(a.re * k, a.im * k)
export const abs = (a) => Math.hypot(a.re, a.im)
/** Angle in degrees, −180 to 180. */
export const arg = (a) => (Math.atan2(a.im, a.re) * 180) / Math.PI
export function div(a, b) {
  const d = b.re * b.re + b.im * b.im
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d)
}
export const inv = (a) => div(cx(1), a)
export const polar = (mag, deg) => cx(mag * Math.cos((deg * Math.PI) / 180), mag * Math.sin((deg * Math.PI) / 180))

// Polynomials: [c0, c1, c2, ...] for c0 + c1 s + c2 s² + ...
export function padd(a, b) {
  const out = Array.from({ length: Math.max(a.length, b.length) }, (_, k) => (a[k] ?? 0) + (b[k] ?? 0))
  return ptrim(out)
}
export function pmul(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0)
  a.forEach((x, i) => b.forEach((y, j) => { out[i + j] += x * y }))
  return ptrim(out)
}
export function ptrim(p) {
  let n = p.length
  while (n > 1 && p[n - 1] === 0) n--
  return p.slice(0, n)
}

/**
 * Roots of a real polynomial: [{re, im}, ...], with exact zeros at the origin kept as 0.
 * s is scaled so the coefficients are near 1 before Durand–Kerner; degree 1 and 2 are direct.
 */
export function roots(p) {
  p = ptrim(p)
  const out = []
  let k = 0
  while (k < p.length - 1 && p[k] === 0) { out.push(cx(0)); k++ }
  let q = p.slice(k)
  const n = q.length - 1
  if (n < 1) return out
  const sc = Math.abs(q[0] / q[n]) ** (1 / n) || 1
  q = q.map((c, i) => (c * sc ** i) / (q[n] * sc ** n))
  let z
  if (n === 1) z = [cx(-q[0])]
  else if (n === 2) {
    const b = q[1], c = q[0], d = b * b - 4 * c
    if (d >= 0) {
      const r1 = (-b - Math.sign(b || 1) * Math.sqrt(d)) / 2
      z = [cx(r1), cx(r1 ? c / r1 : 0)]
    } else z = [cx(-b / 2, Math.sqrt(-d) / 2), cx(-b / 2, -Math.sqrt(-d) / 2)]
  } else {
    z = Array.from({ length: n }, (_, i) => polar(1, (360 * i) / n + 23))
    const at = (x) => q.reduceRight((acc, c) => add(mul(acc, x), cx(c)), cx(0))
    for (let it = 0; it < 800; it++) {
      let moved = 0
      z = z.map((zi, i) => {
        let d = cx(1)
        z.forEach((zj, j) => { if (j !== i) d = mul(d, sub(zi, zj)) })
        const step = div(at(zi), d)
        moved = Math.max(moved, abs(step))
        return sub(zi, step)
      })
      if (moved < 1e-14) break
    }
    // Conjugate pairs come out a hair apart; snap tiny imaginary parts to zero.
    z = z.map((r) => (Math.abs(r.im) < 1e-9 * Math.max(1, abs(r)) ? cx(r.re) : r))
  }
  return [...out, ...z.map((r) => scale(r, sc))]
}
