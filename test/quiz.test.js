import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inline, check, formatAnswers } from '../src/quiz-core.js'

test('inline escapes HTML and keeps math for KaTeX', () => {
  assert.equal(inline('a < b and $x^2$'), 'a &lt; b and $x^2$')
  assert.equal(inline('use `a[i] < n` **now**'), 'use <code>a[i] &lt; n</code> <strong>now</strong>')
})

test('check reports missing text and bad choices', () => {
  assert.deepEqual(check({ questions: [{ q: 'ok' }] }), [])
  assert.equal(check({ questions: [] }).length, 1)
  assert.match(check({ questions: [{ q: 'x', choices: ['only one'] }] })[0], /2 to 8/)
})

test('formatAnswers writes letters, blanks, guesses, and time', () => {
  const spec = { title: 'RQ', id: 'rq-1', questions: [{ q: 'a', choices: ['x', 'y'] }, { q: 'b' }, { q: 'c' }] }
  const msg = formatAnswers(spec, [{ value: 1, guess: true }, { value: ' 15 cm ' }, {}], 125)
  assert.equal(msg, 'RQ [rq-1]: my answers (2 min 5 s)\n1: b (guess)\n2: 15 cm\n3: (blank)')
})
