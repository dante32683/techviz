// The board model for breadboard: hole names, where each hole sits, and which
// holes are wired together inside the board (a column of five in each half, and
// each power rail along its length). Rows a to e sit above the center channel,
// f to j below; rails t+ and t- run along the top, b- and b+ along the bottom.
// Rail holes line up with the columns, but every 6th position is a gap between
// groups of five, as on real boards.

import { SpecError } from '../../diag.js'

export const P = 18 // hole pitch in px (0.1 in)
const ROWS = 'abcdefghij'
export const RAILS = ['t+', 't-', 'b-', 'b+'] // top to bottom

/** Rows and rails a board shows: all of them, or with `half: "top"` rows a-e and the top rails. */
export const rowsOf = (half) => (half === 'top' ? 'abcde' : ROWS)
export const railsOf = (half) => (half === 'top' ? ['t+', 't-'] : RAILS)

export function boardGeometry(cols, half) {
  const X0 = 1.8 * P // column 1, from the board's left edge
  const y = {}
  y['t+'] = 0.9 * P
  y['t-'] = y['t+'] + P
  y.nums = y['t-'] + 1.05 * P
  y.a = y['t-'] + 2.1 * P
  for (let i = 1; i < 5; i++) y[ROWS[i]] = y.a + i * P
  y.f = y.e + 3 * P // 0.3 in across the channel, where a DIP chip straddles it
  for (let i = 6; i < 10; i++) y[ROWS[i]] = y.f + (i - 5) * P
  y.nums2 = y.j + 1.05 * P
  y['b-'] = y.j + 2.1 * P
  y['b+'] = y['b-'] + P
  const W = X0 * 2 + (cols - 1) * P
  // A top-half board ends just past the channel, which marks where the rest would be.
  const H = half === 'top' ? y.e + 2.4 * P : y['b+'] + 0.9 * P
  return { cols, half, X0, y, W, H, x: (c) => X0 + (c - 1) * P }
}

export const isRailGap = (c) => c % 6 === 0

/**
 * Parse a hole name: "a12" (row a, column 12) or "t-3" (top minus rail, column 3).
 * Returns { name, col, row?, rail?, strip }. Throws a SpecError naming the fix.
 */
export function parseHole(name, cols, path, half) {
  if (typeof name !== 'string') throw new SpecError(path, 'a hole is a string like "a12" (row a, column 12) or "t-3" (rail)')
  const s = name.trim()
  let m = /^([a-j])(\d+)$/.exec(s)
  if (m) {
    const col = +m[2]
    if (col < 1 || col > cols) throw new SpecError(path, `"${s}": the board has columns 1 to ${cols}`)
    if (!rowsOf(half).includes(m[1])) throw new SpecError(path, `"${s}": a "half": "top" board has rows a-e only; drop "half" to use rows f-j`)
    return { name: s, col, row: m[1], strip: `${col}${m[1] <= 'e' ? 'a-e' : 'f-j'}` }
  }
  m = /^([tb])([+-])(\d+)$/.exec(s)
  if (m) {
    const col = +m[3], rail = m[1] + m[2]
    if (col < 1 || col > cols) throw new SpecError(path, `"${s}": the board has columns 1 to ${cols}`)
    if (!railsOf(half).includes(rail)) throw new SpecError(path, `"${s}": a "half": "top" board has the top rails t+ and t- only; drop "half" to use the bottom rails`)
    if (isRailGap(col)) throw new SpecError(path, `"${s}": rails have no hole at column ${col} (a gap between groups of five); use ${rail}${col - 1} or ${rail}${col + 1}`)
    return { name: s, col, rail, strip: rail }
  }
  if (/^[A-J]\d+$/.test(s)) throw new SpecError(path, `"${s}": write rows in lowercase, like "${s.toLowerCase()}"`)
  throw new SpecError(path, `"${s}" is not a hole; use a row a-j and a column ("a12"), or a rail t+, t-, b-, b+ and a column ("t-3")`)
}

export const holeXY = (g, h) => [g.x(h.col), g.y[h.rail ?? h.row]]

/** Every hole on the board, for drawing. */
export function* allHoles(cols, half) {
  for (let c = 1; c <= cols; c++) {
    for (const r of rowsOf(half)) yield { col: c, row: r }
    if (!isRailGap(c)) for (const rail of railsOf(half)) yield { col: c, rail }
  }
}

/** Union-find over strip keys. */
export class Nets {
  constructor() { this.parent = new Map() }
  find(k) {
    if (!this.parent.has(k)) this.parent.set(k, k)
    let r = k
    while (this.parent.get(r) !== r) r = this.parent.get(r)
    this.parent.set(k, r)
    return r
  }
  join(a, b) { this.parent.set(this.find(a), this.find(b)) }
}

/** Strip keys sorted for the summary: columns by number (top half first), then rails. */
export function stripOrder(a, b) {
  const key = (s) => (RAILS.includes(s) ? 1e4 + RAILS.indexOf(s) : parseInt(s) * 2 + (s.endsWith('f-j') ? 1 : 0))
  return key(a) - key(b)
}
