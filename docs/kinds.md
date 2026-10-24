# Writing a kind

A kind is one module in `src/kinds/<kind>.js` exporting a default object:

```js
export default {
  kind: 'circuit',
  fields: ['parts', 'nodes', ...],     // top-level spec keys it reads (others warn)
  collections: ['parts'],              // arrays of items with "id" that steps can set/add/remove
  async prepare(spec) {},              // optional: load an engine once (WASM etc.), cache it module-level
  render(spec, ctx) {                  // synchronous; called after prepare()
    // ctx: { theme, diag, env, uid }
    return { body, width, height, defs, summary, alt }
  },
}
```

- `spec` is the user's JSON with the current step applied (see `applySteps` in
  `src/index.js`); `spec.highlight` lists ids to emphasize in the current step.
- `env` holds param values for expressions (`compile` / `value` in `src/expr.js`).
- `body` is SVG markup without the outer `<svg>`; `defs` goes in `<defs>`.
  Prefix every id with `ctx.uid` (several diagrams share one page).
- `summary`: one line Claude reads to check the result (counts, computed
  facts such as nets, offsets, or sizes). Make it useful for catching mistakes.
- Errors: throw `new SpecError(path, message)` for anything that stops the
  render; `ctx.diag.warn(path, msg)` for suspicious but drawable input. Paths
  look like `parts[2].dir`. Messages say what to write instead.
- Never `eval` or `new Function`; expressions go through `src/expr.js`.

## Drawing rules

- Colors only from `ctx.theme` roles (`fg`, `muted`, `faint`, `grid`, `bg`,
  `positive`, `negative`, `highlight`) and `color(name|index)` from
  `src/theme.js`. Four themes must all read well: `paper` (white, documents),
  `dark` (#191919, the Claude app's dark chat), `light` (white, the app's light
  chat), `host` (CSS variables in the chat widget). `dark` and `light` use the
  app's Anthropic Sans when it is in the techviz fonts folder (`src/raster.js`).
  Tinted fills: a palette color with `fill-opacity` 0.15-0.25, so they work on
  light and dark.
- Text through `labelSvg` and `measure` from `src/label.js` (TeX-like labels:
  `R_{1}`, `10\,k\Omega`, `\tau`). Code and addresses use `{ mono: true }`.
- No titles, captions, or explanatory sentences inside a diagram: labels only.
  Explanations go in the chat text.
- Lay out so labels never overlap lines or each other; size the canvas to the
  content with a small margin (12-16 px).
- `src/kinds/plot.js` is the reference implementation.

## Checking a kind

```bash
node src/cli.js render examples/<kind>-<name>.json --out out --theme dark
node src/cli.js render examples/<kind>-<name>.json --out out --theme paper
npm test
```

Look at the PNGs. Each kind keeps 3-6 example specs in `examples/` covering
its main uses, a `test/<kind>.test.js` (node:test) that renders every example
in all three themes without errors and checks a few computed facts, and a
`docs/catalog/<kind>.md`: the spec reference Claude reads, at most 70 lines,
fields first, then two short examples. Write it for an LLM: terse, exact,
defaults stated.
