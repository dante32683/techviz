// A restricted math expression language for specs: numbers, variables, + - * / ^,
// parentheses, function calls, implicit multiplication (2x, 2(x+1)). Compiled
// to closures; nothing is ever evaluated as JavaScript.

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  atan2: Math.atan2, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp,
  ln: Math.log, log: Math.log, log10: Math.log10, log2: Math.log2, sqrt: Math.sqrt, cbrt: Math.cbrt,
  abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, min: Math.min, max: Math.max,
  pow: Math.pow, sign: Math.sign, hypot: Math.hypot,
  step: (x) => (x >= 0 ? 1 : 0), clamp: (x, a, b) => Math.min(Math.max(x, a), b),
  sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cot: (x) => 1 / Math.tan(x),
  deg: (x) => (x * 180) / Math.PI, rad: (x) => (x * Math.PI) / 180,
}
const CONSTS = { pi: Math.PI, e: Math.E, inf: Infinity }

export class ExprError extends Error {}

function tokenize(src) {
  const toks = []
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|[-+*/^(),]))/y
  let i = 0
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break
    re.lastIndex = i
    const m = re.exec(src)
    if (!m) throw new ExprError(`unexpected "${src.slice(i).trim()[0]}" at position ${i} in "${src}"`)
    i = re.lastIndex
    if (m[1] !== undefined) toks.push({ t: 'num', v: parseFloat(m[1]) })
    else if (m[2] !== undefined) toks.push({ t: 'id', v: m[2] })
    else toks.push({ t: 'op', v: m[3] === '**' ? '^' : m[3] })
  }
  return toks
}

export function compile(src) {
  const text = String(src)
  const toks = tokenize(text)
  let p = 0
  const vars = new Set()
  const peek = () => toks[p]
  const isOp = (v) => peek()?.t === 'op' && peek().v === v
  const expect = (v) => { if (!isOp(v)) throw new ExprError(`expected "${v}" in "${text}"`); p++ }
  const startsPrimary = () => { const t = peek(); return t && (t.t === 'num' || t.t === 'id' || (t.t === 'op' && t.v === '(')) }

  function primary() {
    const t = peek()
    if (!t) throw new ExprError(`"${text}" ends early`)
    if (t.t === 'num') { p++; const v = t.v; return () => v }
    if (t.t === 'id') {
      p++
      if (isOp('(')) {
        const f = FUNCS[t.v]
        if (!f) throw new ExprError(`unknown function ${t.v}() in "${text}"`)
        p++
        const args = []
        if (!isOp(')')) { args.push(additive()); while (isOp(',')) { p++; args.push(additive()) } }
        expect(')')
        return (env) => f(...args.map((a) => a(env)))
      }
      if (t.v in CONSTS) { const v = CONSTS[t.v]; return () => v }
      const name = t.v
      vars.add(name)
      return (env) => {
        const v = env[name]
        if (v === undefined) throw new ExprError(`unknown variable ${name} in "${text}"`)
        return v
      }
    }
    if (t.v === '(') { p++; const e = additive(); expect(')'); return e }
    throw new ExprError(`unexpected "${t.v}" in "${text}"`)
  }
  function power() {
    const base = primary()
    if (isOp('^')) { p++; const ex = unary(); return (env) => Math.pow(base(env), ex(env)) }
    return base
  }
  function unary() {
    if (isOp('-')) { p++; const a = unary(); return (env) => -a(env) }
    if (isOp('+')) { p++; return unary() }
    return power()
  }
  function term() {
    let a = unary()
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = toks[p++].v
        const b = unary(), l = a
        a = op === '*' ? (env) => l(env) * b(env) : (env) => l(env) / b(env)
      } else if (startsPrimary()) {
        const b = power(), l = a
        a = (env) => l(env) * b(env)
      } else return a
    }
  }
  function additive() {
    let a = term()
    while (isOp('+') || isOp('-')) {
      const op = toks[p++].v
      const b = term(), l = a
      a = op === '+' ? (env) => l(env) + b(env) : (env) => l(env) - b(env)
    }
    return a
  }
  if (!toks.length) throw new ExprError('empty expression')
  const fn = additive()
  if (p < toks.length) throw new ExprError(`unexpected "${toks[p].v}" in "${text}"`)
  return { fn, vars }
}

/** A number or an expression string evaluated with `env`. */
export function value(v, env = {}) {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return compile(v).fn(env)
  throw new ExprError(`expected a number or expression, got ${JSON.stringify(v)}`)
}

/**
 * Compile and check that every variable is in `allowed` (params plus the bound
 * variables). Throws ExprError naming the unknown ones, so a typo can't turn
 * into a silently empty curve.
 */
export function compileFor(src, allowed) {
  const c = compile(src)
  const unknown = [...c.vars].filter((v) => !allowed.includes(v))
  if (unknown.length) {
    throw new ExprError(`unknown variable${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')} in "${src}"; ` +
      `available: ${allowed.join(', ') || 'none'} (add a param for a constant)`)
  }
  return c
}
