// Boolean algebra shared by logic and kmap: an expression parser (H&H notation: AB + C',
// ~A, !A, A ^ B, A ⊕ B), truth tables, Quine-McCluskey prime implicants with an exact
// minimum cover, and SOP and POS text. Variable order is the order given; the first
// variable is the minterm index's most significant bit (m5 of A, B, C is A B' C).

import { SpecError } from '../../diag.js'

// --- Parsing -------------------------------------------------------------------------

const OPS = { '+': 'or', '|': 'or', '∨': 'or', '*': 'and', '&': 'and', '·': 'and', '∧': 'and', '^': 'xor', '⊕': 'xor' }

/**
 * Tokens of an expression. With `names` (known variables), an identifier is the longest known
 * name at that spot; otherwise a letter plus lowercase letters, digits, and _ (A, Cin, S0, x_1),
 * so AB is A·B.
 */
function tokenize(src, names, path) {
  const s = String(src)
  const known = [...(names ?? [])].sort((a, b) => b.length - a.length)
  const out = []
  for (let i = 0; i < s.length;) {
    const c = s[i]
    if (/\s/.test(c)) { i++; continue }
    if ('()'.includes(c)) { out.push({ t: c }); i++; continue }
    if ('~!¬'.includes(c)) { out.push({ t: 'not' }); i++; continue }
    if (c === "'" || c === '’' || c === '′') { out.push({ t: 'prime' }); i++; continue }
    if (OPS[c]) { out.push({ t: 'op', op: OPS[c] }); i++; continue }
    if (c === '0' || c === '1') { if (/[0-9]/.test(s[i + 1] ?? '')) throw new SpecError(path, `"${s.slice(i, i + 2)}…" isn't 0 or 1; only single-bit constants go in an expression`); out.push({ t: 'const', v: Number(c) }); i++; continue }
    if (/[A-Za-z_]/.test(c)) {
      const hit = known.find((n) => s.startsWith(n, i))
      const name = hit ?? /^[A-Za-z_][a-z0-9_]*/.exec(s.slice(i))[0]
      out.push({ t: 'var', name }); i += name.length; continue
    }
    throw new SpecError(path, `unexpected "${c}" in "${s}"; use AND as AB, A*B or A&B, OR as A + B, XOR as A ^ B, NOT as A', ~A or !A`)
  }
  return out
}

/** Parse to an AST: {op: 'var', name} | {op: 'const', v} | {op: 'not', a} | {op: 'and'|'or'|'xor', args}. */
export function parseExpr(src, { names, path = 'expr' } = {}) {
  const toks = tokenize(src, names, path)
  let i = 0
  const peek = () => toks[i]
  const fail = (msg) => { throw new SpecError(path, `${msg} in "${src}"`) }
  const nary = (op, args) => (args.length === 1 ? args[0] : { op, args })
  function orExpr() {
    const args = [xorExpr()]
    while (peek()?.t === 'op' && peek().op === 'or') { i++; args.push(xorExpr()) }
    return nary('or', args)
  }
  function xorExpr() {
    const args = [andExpr()]
    while (peek()?.t === 'op' && peek().op === 'xor') { i++; args.push(andExpr()) }
    return nary('xor', args)
  }
  function andExpr() {
    const args = [unary()]
    for (;;) {
      const t = peek()
      if (t?.t === 'op' && t.op === 'and') { i++; args.push(unary()); continue }
      // Juxtaposition is AND: AB, A(B + C), (A + B)C, A'B.
      if (t && (t.t === 'var' || t.t === 'const' || t.t === '(' || t.t === 'not')) { args.push(unary()); continue }
      break
    }
    return nary('and', args)
  }
  function unary() {
    const t = peek()
    if (!t) fail('the expression ends early')
    let node
    if (t.t === 'not') { i++; node = { op: 'not', a: unary() }; return postfix(node) }
    if (t.t === 'var') { i++; node = { op: 'var', name: t.name } }
    else if (t.t === 'const') { i++; node = { op: 'const', v: t.v } }
    else if (t.t === '(') {
      i++; node = orExpr()
      if (peek()?.t !== ')') fail('a "(" has no matching ")"')
      i++
    } else fail(`"${t.t === 'op' ? t.op : t.t}" is out of place`)
    return postfix(node)
  }
  function postfix(node) {
    while (peek()?.t === 'prime') { i++; node = { op: 'not', a: node } }
    return node
  }
  if (!toks.length) fail('empty expression')
  const ast = orExpr()
  if (i < toks.length) fail(`"${toks[i].t === 'op' ? toks[i].op : toks[i].name ?? toks[i].t}" is out of place`)
  return ast
}

/** Variable names in order of first appearance. */
export function exprVars(ast, out = []) {
  if (ast.op === 'var') { if (!out.includes(ast.name)) out.push(ast.name) }
  else if (ast.op === 'not') exprVars(ast.a, out)
  else if (ast.args) for (const a of ast.args) exprVars(a, out)
  return out
}

/** Evaluate with env: name -> 0 | 1. */
export function evalExpr(ast, env) {
  switch (ast.op) {
    case 'var': return env[ast.name] ? 1 : 0
    case 'const': return ast.v
    case 'not': return evalExpr(ast.a, env) ? 0 : 1
    case 'and': return ast.args.every((a) => evalExpr(a, env)) ? 1 : 0
    case 'or': return ast.args.some((a) => evalExpr(a, env)) ? 1 : 0
    default: return ast.args.reduce((s, a) => s ^ evalExpr(a, env), 0)
  }
}

/** Minterm list of an expression over `vars` (first var is the MSB). */
export function mintermsOf(ast, vars) {
  const n = vars.length, out = []
  for (let m = 0; m < 1 << n; m++) {
    const env = {}
    vars.forEach((v, k) => { env[v] = (m >> (n - 1 - k)) & 1 })
    if (evalExpr(ast, env)) out.push(m)
  }
  return out
}

// --- Minimization --------------------------------------------------------------------

const popcount = (x) => { let c = 0; while (x) { c += x & 1; x >>>= 1 } return c }

/**
 * Prime implicants of the function with these minterms and don't-cares. An implicant is
 * {value, mask}: mask bits are the eliminated variables; covers(m) when (m & ~mask) === value.
 */
export function primeImplicants(ones, dcs, n) {
  let cur = new Map()
  for (const m of [...ones, ...dcs]) cur.set(`${m}/0`, { value: m, mask: 0, used: false })
  const primes = []
  while (cur.size) {
    const next = new Map()
    const list = [...cur.values()]
    const byMask = new Map()
    for (const t of list) { if (!byMask.has(t.mask)) byMask.set(t.mask, []); byMask.get(t.mask).push(t) }
    for (const group of byMask.values()) {
      for (let a = 0; a < group.length; a++) for (let b = a + 1; b < group.length; b++) {
        const d = group[a].value ^ group[b].value
        if (popcount(d) !== 1) continue
        group[a].used = group[b].used = true
        const t = { value: group[a].value & ~d, mask: group[a].mask | d, used: false }
        next.set(`${t.value}/${t.mask}`, t)
      }
    }
    for (const t of list) if (!t.used) primes.push({ value: t.value, mask: t.mask })
    cur = next
  }
  // Drop implicants made only of don't-cares: they never help a cover.
  const ones_ = new Set(ones)
  return primes.filter((p) => cubeMinterms(p, n).some((m) => ones_.has(m)))
}

export const covers = (p, m) => (m & ~p.mask) === p.value
export const literalCount = (p, n) => n - popcount(p.mask)

export function cubeMinterms(p, n) {
  const out = []
  for (let m = 0; m < 1 << n; m++) if (covers(p, m)) out.push(m)
  return out
}

/**
 * A minimum cover: fewest implicants, then fewest literals. Essential primes first, then an
 * exact branch and bound over the rest (with a node budget; greedy past it).
 * Returns { primes, essential, cover, exact }.
 */
export function minimize(ones, dcs, n) {
  const primes = primeImplicants(ones, dcs, n)
  const essential = []
  for (const m of ones) {
    const who = primes.filter((p) => covers(p, m))
    if (who.length === 1 && !essential.includes(who[0])) essential.push(who[0])
  }
  const left = ones.filter((m) => !essential.some((p) => covers(p, m)))
  const rest = primes.filter((p) => !essential.includes(p))
  let best = null, budget = 200000, exact = true
  const cost = (set) => [set.length, set.reduce((s, p) => s + literalCount(p, n), 0)]
  const better = (a, b) => !b || a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])
  function search(uncovered, chosen) {
    if (--budget < 0) { exact = false; return }
    if (!uncovered.length) { if (better(cost(chosen), best && cost(best))) best = [...chosen]; return }
    if (best && chosen.length + 1 > best.length) return
    // Branch on the minterm with the fewest covering primes.
    let pick = null, opts = null
    for (const m of uncovered) {
      const c = rest.filter((p) => covers(p, m))
      if (!opts || c.length < opts.length) { pick = m; opts = c }
    }
    opts.sort((a, b) => b.mask - a.mask || popcount(b.mask) - popcount(a.mask))
    for (const p of opts) search(uncovered.filter((m) => !covers(p, m)), [...chosen, p])
  }
  search(left, [])
  if (!best) { // budget ran out before any cover: greedy
    best = []
    let un = [...left]
    while (un.length) {
      const p = rest.reduce((a, b) => (un.filter((m) => covers(b, m)).length > un.filter((m) => covers(a, m)).length ? b : a))
      best.push(p); un = un.filter((m) => !covers(p, m))
    }
  }
  const order = termOrder(n)
  return { primes: primes.sort(order), essential: essential.sort(order), cover: [...essential, ...best].sort(order), exact }
}

/** Sort implicants in reading order: by the first variable they use, complemented first (A'B + AC + BC). */
export const termOrder = (n) => (a, b) => {
  for (let k = n - 1; k >= 0; k--) {
    const bit = 1 << k, ca = !(a.mask & bit), cb = !(b.mask & bit)
    if (ca !== cb) return ca ? -1 : 1
    if (ca && (a.value & bit) !== (b.value & bit)) return (a.value & bit) ? 1 : -1
  }
  return 0
}

// --- Text ----------------------------------------------------------------------------

/** Literals of an implicant: [{name, neg}] in variable order. */
export function literals(p, vars) {
  const n = vars.length, out = []
  vars.forEach((v, k) => {
    const bit = 1 << (n - 1 - k)
    if (!(p.mask & bit)) out.push({ name: v, neg: !(p.value & bit) })
  })
  return out
}

const prime = (name) => `${name}'`
export const termText = (p, vars) => literals(p, vars).map((l) => (l.neg ? prime(l.name) : l.name)).join('') || '1'
/** The sum term for an implicant of F' (POS): A B' covers zeros, so the factor is (A' + B). */
export const sumText = (p, vars) => { const l = literals(p, vars); return l.length ? `(${l.map((x) => (x.neg ? x.name : prime(x.name))).join(' + ')})` : '0' }

export function sopText(cover, vars, ones) {
  if (!ones.length) return '0'
  return cover.map((p) => termText(p, vars)).join(' + ')
}

export function posText(cover, vars, zeros) {
  if (!zeros.length) return '1'
  return cover.map((p) => sumText(p, vars)).join('')
}

/** Expression text from an AST, for summaries. */
export function exprText(ast) {
  const wrap = (a, parent) => (a.args && (a.op !== parent) && (parent === 'and' || parent === 'not' || (parent === 'xor' && a.op === 'or')) ? `(${exprText(a)})` : exprText(a))
  switch (ast.op) {
    case 'var': return ast.name
    case 'const': return String(ast.v)
    case 'not': return ast.a.op === 'var' ? prime(ast.a.name) : `(${exprText(ast.a)})'`
    case 'and': return ast.args.map((a) => wrap(a, 'and')).join('')
    case 'or': return ast.args.map((a) => wrap(a, 'or')).join(' + ')
    default: return ast.args.map((a) => wrap(a, 'xor')).join(' ⊕ ')
  }
}

/** Σm and Σd text. */
export const sigma = (ones, dcs = []) => `Σm(${ones.join(',')})${dcs.length ? ` + d(${dcs.join(',')})` : ''}`
