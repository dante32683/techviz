import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { renderAsync } from '../src/index.js'

for (const f of readdirSync('examples').filter((f) => f.startsWith('plot-'))) {
  for (const theme of ['paper', 'dark', 'host']) {
    test(`${f} renders in ${theme}`, async () => {
      const r = await renderAsync(JSON.parse(readFileSync(`examples/${f}`, 'utf8')), { theme })
      assert.ok(r.svg, r.text)
      assert.equal(r.diagnostics.filter((d) => d.level === 'error').length, 0)
    })
  }
}

test('unknown variable is reported', async () => {
  const r = await renderAsync({ v: 1, kind: 'plot', x: { range: [0, 1] }, series: [{ y: 'k*x' }] })
  assert.equal(r.svg, null)
  assert.match(r.text, /unknown variable k/)
})

// The Desktop widget host grows an SVG's viewBox to its children's getBBox(), which ignores
// clip-path, so geometry past the frame shows as blank space. Curves must stay inside.
const sf = (dydx, isoclines) => ({
  v: 1, kind: 'plot', x: { label: 'x', range: [-3, 3] }, y: { label: 'y', range: [-3, 3] }, size: [460, 420],
  slopefield: { dydx, density: 15 }, ...(isoclines && { isoclines }),
  solutions: [{ from: [0, 1.5] }, { from: [0, 0.5] }, { from: [0, -0.5] }, { from: [-2, -2.5] }, { from: [-2, 0.5] }],
})
for (const [name, spec] of [
  ['slope field with isocline', sf('y - x', [{ value: 1, label: 'y = x + 1' }])],
  ['slope field with parabola isocline', sf('0.2x^2 + y', [{ value: 0 }])],
  ['slope field without isoclines', sf('x')],
  ['steep series', { v: 1, kind: 'plot', x: { range: [-3, 3] }, y: { range: [-2, 2] }, series: [{ y: 'exp(x)' }, { y: '-x^3' }, { points: [[0, 0], [1, 9], [2, -9]], connect: true }] }],
]) {
  test(`${name}: geometry stays inside the viewBox`, async () => {
    const r = await renderAsync(spec, { theme: 'paper' })
    assert.ok(r.svg, r.text)
    const [, , W, H] = r.svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number)
    const pts = []
    for (const [, d] of r.svg.matchAll(/ d="([^"]+)"/g)) for (const [, x, y] of d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) pts.push([+x, +y])
    for (const [, x, y] of r.svg.matchAll(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)"/g)) pts.push([+x, +y])
    assert.ok(pts.length > 0)
    for (const [x, y] of pts) assert.ok(x >= 0 && x <= W && y >= 0 && y <= H, `point ${x},${y} is outside 0 0 ${W} ${H}`)
  })
}

test('clipPolyline splits a curve where it leaves and re-enters', async () => {
  const { clipPolyline } = await import('../src/geom.js')
  const parts = clipPolyline([[0, 0], [2, 0], [2, 5], [4, 5], [4, 1], [6, 1]], [0, 5, 0, 2])
  assert.deepEqual(parts, [[[0, 0], [2, 0], [2, 2]], [[4, 2], [4, 1], [5, 1]]])
})
