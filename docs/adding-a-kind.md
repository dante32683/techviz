# Adding a kind

A kind is one folder, `src/kinds/<kind>/`, plus one line in `src/kinds/registry.js`.
Everything else (the catalog the Claude mod serves, the kind list in the overview and in the
mod's tools, the generic tests, the browser bundle) picks it up from there. `fbd` (free-body
diagrams, `src/kinds/fbd/`) is the worked reference: read it alongside this page.

## Checklist

1. **Folder.** Create `src/kinds/<kind>/` with:
   - `index.js`: the renderer (contract below). Helpers go beside it (`fbd/draw.js`,
     `fbd/place.js`) and import shared modules as `../../svg.js`, `../../label.js`, and so on.
   - `catalog.md`: the spec reference Claude reads. First line exactly
     `# <kind>: <one-line summary>` (the summary becomes the kind's line in the overview), at
     most 70 lines, fields first with defaults stated, then at least two ```` ```json ````
     examples of complete specs. Write it for an LLM: terse and exact.
   - `examples/*.json`: 3 to 6 complete specs covering the kind's main uses.
   - `<kind>.test.js`: node:test checks of computed facts (the summary line, diagnostics for
     bad input). Load examples with `new URL(`examples/${f}`, import.meta.url)`.
2. **Register.** In `src/kinds/registry.js`, import `./<kind>/index.js` and add it to the list.
3. **README.** Add a row to the kinds table in `README.md`.
4. **Check by eye.** Render every example in both app themes and read the PNGs:
   ```bash
   node src/cli.js render src/kinds/<kind>/examples/<name>.json --out out --theme dark
   node src/cli.js render src/kinds/<kind>/examples/<name>.json --out out --theme light
   ```
   Look for labels on lines or on each other, clipped edges, wrong directions, and unreadable
   colors. Fix and re-render until they're clean.
5. **Test and build.** `npm test`, then `npm run build` (rebuilds `dist/techviz.js`, the
   widget bundle). `test/kinds.test.js` checks every registered kind automatically: the folder
   layout, the catalog title and length, every example rendering in all four themes and every
   step with no errors or warnings, the catalog's JSON examples rendering, the README row, and
   the kind in the bundle. Its failure messages say what's missing.
6. **Commit.** One commit for the kind. Pushing and tagging a release (below) only when asked.

Nothing else needs editing: the techviz mod asks the CLI for the kind list (`node src/cli.js
kinds`) and the catalog text (`node src/cli.js catalog <kind>`), and techviz-panel loads
`src/index.js` from disk. Run `node src/cli.js catalog <kind>` to see what Claude will read.

## The renderer contract

`index.js` default-exports:

```js
export default {
  kind: 'fbd',
  fields: ['panels', 'body', 'forces', ...], // top-level spec keys it reads (others warn)
  collections: ['forces', ...],              // arrays of items with "id" that steps can set/add/remove
  async prepare(spec) {},                    // optional: load an engine once (WASM etc.), cache it
  render(spec, ctx) {                        // synchronous; called after prepare()
    // ctx: { theme, diag, env, uid }
    return { body, width, height, defs, summary, alt }
  },
}
```

- `spec` has the current step applied (`applySteps` in `src/index.js`); `spec.highlight`
  lists ids to emphasize. `env` holds param values for expressions: evaluate numbers through
  `compileFor` in `src/expr.js` (fbd's `val`), never `eval` or `new Function`.
- `body` is SVG markup without the outer `<svg>`; `defs` goes in `<defs>`. Prefix every id
  with `ctx.uid` (several diagrams share one page). Size the canvas to the content with a
  12-16 px margin; fbd computes a bounding box of everything drawn and translates.
- `summary`: one line Claude reads to check the result: counts and computed facts (nets,
  offsets, force sums). Make it catch mistakes. `ctx.diag.note(path, msg)` adds a fact.
- Errors: throw `new SpecError(path, message)` for anything that stops the render;
  `ctx.diag.warn(path, msg)` for suspicious but drawable input. Paths look like
  `panels[1].forces[2].dir`; messages say what to write instead.
- Layout is declarative: specs never hold pixel coordinates. Use words, named points, a
  coarse unit grid, or automatic placement (fbd: bodies on a surface, `at: "end"`, `dir: "uphill"`).

## Drawing rules

- Colors only from `ctx.theme` roles (`fg`, `muted`, `faint`, `grid`, `bg`, `halo`,
  `positive`, `negative`, `highlight`) and `color(name|index)` from `src/theme.js`. Four
  themes must read well: `paper` (white, documents), `dark` (#191919, the app's dark chat),
  `light` (the app's light chat), `host` (CSS variables in the chat widget; build elements
  with `el()` from `src/svg.js`, which moves `var()` colors into `style`). Tinted fills: a
  palette color at `fill-opacity` 0.15-0.25.
- Text through `labelSvg` and `measure` from `src/label.js` (light TeX: `F_{B}`, `mg\sin\theta`,
  `10\,k\Omega`). Code and addresses use `{ mono: true }`.
- Labels only inside a diagram: no titles or sentences (short panel captions are the exception).
- Labels never overlap lines or each other. The simple way that works: record every stroke
  as sample points, then give each label a short list of candidate spots and take the one
  covering the fewest points and no earlier label. `src/kinds/fbd/place.js` does this in about
  60 lines (`placeLabels`); warn when a label has no clear spot.
- Check the PNGs, not just the tests: most layout bugs only show in the picture.

## Releasing

The widget loads `dist/techviz.js` from jsDelivr at the newest git tag (the techviz mod reads
it with `git describe --tags`). To release, after `npm test` and `npm run build`: bump the
version in the README's widget snippet, commit, `git push origin main`, then tag the commit
(`git tag vX.Y.Z`, minor for a new kind, patch for fixes) and `git push origin vX.Y.Z`.
Confirm `https://cdn.jsdelivr.net/gh/dante32683/techviz@vX.Y.Z/dist/techviz.js` matches the
local bundle. Releases are Dante's call: ask before pushing or tagging.
