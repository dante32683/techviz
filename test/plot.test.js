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
