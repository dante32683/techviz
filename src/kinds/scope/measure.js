// Automatic measurements, computed from a sampled record the way a scope does: top and base
// from the histogram, crossings of the middle level with hysteresis, 10-90% edges, and
// whole-cycle mean and rms.

/**
 * v: samples (V), dt: sample spacing (s). Times in the result are from the first sample.
 * `lim`: the ADC limits [lo, hi]; a sample at either marks the record clipped.
 */
export function measure(v, dt, lim) {
  const n = v.length
  let vmax = -Infinity, vmin = Infinity
  for (const x of v) { if (x > vmax) vmax = x; if (x < vmin) vmin = x }
  const clipHi = lim ? v.some((x) => x >= lim[1] - 1e-12) : false, clipLo = lim ? v.some((x) => x <= lim[0] + 1e-12) : false
  const out = { n, dt, vmax, vmin, vpp: vmax - vmin, clipHi, clipLo, clipped: clipHi || clipLo, rising: [], falling: [] }
  if (!n) return out
  const [top, base, flat] = topBase(v, vmin, vmax)
  Object.assign(out, { top, base, ampl: top - base, flat })
  const ampl = top - base
  const mid = (top + base) / 2, hys = ampl * 0.1
  // Middle-level crossings, linearly interpolated, with ±10% hysteresis against noise.
  let state = 0, lastBelow = -1, lastAbove = -1
  const at = (k) => (k + 1 < n && v[k + 1] !== v[k] ? k + (mid - v[k]) / (v[k + 1] - v[k]) : k) * dt
  if (ampl > 0) for (let i = 0; i < n; i++) {
    if (v[i] < mid) lastBelow = i; else lastAbove = i
    if (v[i] > mid + hys && state !== 1) { if (state === -1 && lastBelow >= 0) out.rising.push(at(lastBelow)); state = 1 }
    else if (v[i] < mid - hys && state !== -1) { if (state === 1 && lastAbove >= 0) out.falling.push(at(lastAbove)); state = -1 }
  }
  const { rising: R, falling: F } = out
  if (R.length >= 2) out.period = (R[R.length - 1] - R[0]) / (R.length - 1)
  else if (F.length >= 2) out.period = (F[F.length - 1] - F[0]) / (F.length - 1)
  if (out.period) out.freq = 1 / out.period
  // Mean and rms over whole cycles when there are any, else over the record.
  let i0 = 0, i1 = n
  if (R.length >= 2) { i0 = Math.ceil(R[0] / dt); i1 = Math.ceil(R[R.length - 1] / dt) }
  let s = 0, s2 = 0
  for (let i = i0; i < i1; i++) { s += v[i]; s2 += v[i] * v[i] }
  out.mean = s / (i1 - i0); out.rms = Math.sqrt(s2 / (i1 - i0))
  // 10-90% edges, each searched only between its neighboring crossings.
  const lo = base + 0.1 * ampl, hi = base + 0.9 * ampl
  const cross = (k, level) => (k + (level - v[k]) / (v[k + 1] - v[k])) * dt
  const edge = (t, up, before, after) => {
    const c = Math.floor(t / dt), a = Math.max(0, Math.ceil(before / dt)), b = Math.min(n - 1, Math.floor(after / dt))
    const [from, to] = up ? [lo, hi] : [hi, lo]
    let i = c
    while (i > a && (up ? v[i] > from : v[i] < from)) i--
    if (up ? v[i] > from : v[i] < from) return null
    let j = c + 1
    while (j < b && (up ? v[j] < to : v[j] > to)) j++
    if (j >= n || (up ? v[j] < to : v[j] > to)) return null
    return cross(j - 1, to) - cross(i, from)
  }
  const edges = (list, other, up) => list.map((t) => {
    const before = Math.max(0, ...other.filter((x) => x < t)), after = Math.min((n - 1) * dt, ...other.filter((x) => x > t))
    return edge(t, up, before, after)
  }).filter((x) => x !== null && x > 0)
  const avg = (a) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : undefined)
  out.rise = avg(edges(R, F, true)); out.fall = avg(edges(F, R, false))
  // Fewer than about two samples across an edge: the reading is the sample spacing, not the edge.
  out.riseLimited = out.rise !== undefined && out.rise < 1.5 * dt
  out.fallLimited = out.fall !== undefined && out.fall < 1.5 * dt
  const widths = R.map((r) => { const f = F.find((x) => x > r); return f === undefined ? null : f - r }).filter((x) => x !== null)
  if (out.period && widths.length) { out.pwidth = avg(widths); out.duty = out.pwidth / out.period }
  return out
}

/**
 * Top and base: the most common level in each half of the histogram when it stands out (a
 * square's flat tops), else the max and min (a sine's or triangle's peaks).
 */
function topBase(v, vmin, vmax) {
  const span = vmax - vmin
  if (!(span > 0)) return [vmax, vmin, false]
  const B = 100, counts = new Array(B).fill(0), sums = new Array(B).fill(0)
  for (const x of v) { const k = Math.min(B - 1, Math.floor(((x - vmin) / span) * B)); counts[k]++; sums[k] += x }
  const level = (from, to, dflt) => {
    let k = from
    for (let i = from; i < to; i++) if (counts[i] > counts[k]) k = i
    const avg = v.length / B
    // A plateau holds well over the average share; a sine's peak bins only about six times it.
    if (counts[k] < avg * 8) return [dflt, false]
    let c = 0, s = 0
    for (let i = Math.max(from, k - 2); i <= Math.min(to - 1, k + 2); i++) { c += counts[i]; s += sums[i] }
    return [s / c, true]
  }
  const [top, ft] = level(B / 2, B, vmax), [base, fb] = level(0, B / 2, vmin)
  return [top, base, ft && fb]
}

/** Delay and phase of b against a: b's rising crossing nearest a's first; positive means b lags. */
export function phaseOf(a, b) {
  if (!a.rising.length || !b.rising.length || !a.period) return null
  const ta = a.rising[0]
  let tb = b.rising[0]
  for (const t of b.rising) if (Math.abs(t - ta) < Math.abs(tb - ta)) tb = t
  const delay = tb - ta
  let phase = (360 * delay) / a.period
  phase = ((((phase + 180) % 360) + 360) % 360) - 180
  if (phase === -180) phase = 180
  return { delay, phase }
}
