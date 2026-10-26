// Checks every kind in the registry the same way, so a new kind is tested as soon as it's
// registered: its folder has a catalog page and examples, every example renders cleanly in
// every theme and step, the catalog's examples still render, and the README and the browser
// bundle know about it. Kind-specific facts go in src/kinds/<kind>/<kind>.test.js.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { renderAsync, KINDS } from '../src/index.js'
import { kindList } from '../src/catalog.js'

const root = new URL('../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const THEMES = ['paper', 'dark', 'light', 'host']

for (const kind of Object.keys(KINDS)) {
  const dir = `src/kinds/${kind}/`

  test(`${kind}: folder has index.js, catalog.md (title, at most 70 lines), and 3 to 6 examples`, () => {
    for (const f of ['index.js', 'catalog.md', 'examples']) assert.ok(existsSync(new URL(dir + f, root)), `${dir}${f} is missing`)
    const cat = read(`${dir}catalog.md`)
    assert.match(cat.split('\n')[0], new RegExp(`^# ${kind}: \\S`), 'the first line is "# <kind>: <one-line summary>"')
    assert.ok(cat.trimEnd().split('\n').length <= 70, 'catalog.md is at most 70 lines')
    const n = readdirSync(new URL(`${dir}examples/`, root)).filter((f) => f.endsWith('.json')).length
    assert.ok(n >= 3 && n <= 6, `${n} examples; keep 3 to 6`)
  })

  for (const f of readdirSync(new URL(`${dir}examples/`, root)).filter((f) => f.endsWith('.json'))) {
    const spec = JSON.parse(read(`${dir}examples/${f}`))
    const steps = spec.steps?.length ? [...spec.steps.keys()] : [undefined]
    for (const theme of THEMES) {
      test(`${kind}/${f} renders cleanly in ${theme}`, async () => {
        for (const step of steps) {
          const r = await renderAsync(spec, { theme, step, uid: 't' })
          assert.ok(r.svg, `${step ?? ''} ${r.text}`)
          assert.deepEqual(r.diagnostics.filter((d) => d.level !== 'note'), [], `step ${step}`)
          assert.ok(r.summary, 'a summary line')
          // The widget's host theme uses CSS variables, which only work in style attributes.
          if (theme === 'host') assert.doesNotMatch(r.svg, /(fill|stroke|color)="var\(/)
        }
      })
    }
  }

  test(`${kind}: the catalog's JSON examples render without errors`, async () => {
    const blocks = [...read(`${dir}catalog.md`).matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]))
    assert.ok(blocks.length >= 2, 'the catalog shows at least two examples')
    for (const spec of blocks) {
      const r = await renderAsync(spec, { theme: 'paper' })
      assert.ok(r.svg, `${JSON.stringify(spec).slice(0, 80)}: ${r.text}`)
    }
  })

  test(`${kind}: listed in the README and built into dist/techviz.js`, () => {
    assert.match(read('README.md'), new RegExp(`\\| \`${kind}\` \\|`), 'add a row to the README kinds table')
    assert.ok(read('dist/techviz.js').includes(`kind:"${kind}"`), 'run npm run build')
  })
}

test('the catalog overview lists every kind with its summary', () => {
  for (const { kind, summary } of kindList()) assert.ok(summary, `${kind} has no summary in its catalog title`)
})
