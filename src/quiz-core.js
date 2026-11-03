// Pure helpers for the quiz widget (src/quiz.js), kept apart so node tests can load them.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Light inline markup for question text: `code`, **bold**, and $math$ / $$math$$ left
 * for KaTeX's auto-render (which skips <code>). HTML in the text is escaped.
 */
export function inline(src) {
  return String(src ?? '')
    .split(/(`[^`]*`)/)
    .map((part) => {
      if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) return `<code>${esc(part.slice(1, -1))}</code>`
      return esc(part).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    })
    .join('')
}

export const letter = (i) => String.fromCharCode(97 + i)

/** Checks a quiz spec; returns a list of problems (empty when it is fine). */
export function check(spec) {
  const out = []
  if (!spec || typeof spec !== 'object') return ['the quiz is not a JSON object']
  if (!Array.isArray(spec.questions) || !spec.questions.length) out.push('questions: give at least one question')
  ;(spec.questions || []).forEach((q, i) => {
    const n = i + 1
    if (!q || typeof q.q !== 'string' || !q.q.trim()) out.push(`question ${n}: q (the question text) is missing`)
    if (q && q.choices !== undefined && (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 8)) out.push(`question ${n}: choices needs 2 to 8 entries`)
    if (q && q.code !== undefined && typeof q.code !== 'string') out.push(`question ${n}: code must be a string`)
  })
  return out
}

/** The message sent back to the chat: one line per question, then the time taken. */
export function formatAnswers(spec, answers, seconds) {
  const head = `${spec.title || 'Quiz'}${spec.id ? ` [${spec.id}]` : ''}: my answers`
  const time = seconds == null ? '' : ` (${Math.floor(seconds / 60)} min ${seconds % 60} s)`
  const lines = spec.questions.map((q, i) => {
    const a = answers[i] || {}
    let v = (a.value ?? '').toString().trim()
    if (!v) v = '(blank)'
    else if (q.choices) v = letter(Number(v))
    else v = v.replace(/\s*\n\s*/g, ' / ')
    return `${i + 1}: ${v}${a.guess ? ' (guess)' : ''}`
  })
  return `${head}${time}\n${lines.join('\n')}`
}
