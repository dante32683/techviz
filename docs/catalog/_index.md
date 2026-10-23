# techviz specs

A visual is one JSON spec: `{"v": 1, "kind": "<kind>", ...}`. The renderer does the
layout; write what the diagram shows, never coordinates in pixels.

Kinds (call the catalog with a kind for its fields):
- `circuit`: schematics in IEC symbols, turtle placement, nets checked.
- `memory`: stack, heap, globals, pointers, arrays, code traces.
- `layout`: struct padding and offsets, endianness, address maps.
- `wave`: timing diagrams (WaveJSON), register bitfields, pipeline charts.
- `fsm`: Moore and Mealy state machines; any directed graph via DOT.
- `plot`: functions, parametric curves, data, marks, slope fields with solutions.

Shared fields:
- `params`: named constants for expressions, each `{"value", "min", "max", "step", "unit", "label"}`.
  A static render uses `value`; the widget draws a slider per param.
- `steps`: stages shown one at a time: `{"label", "set": {id: {fields}}, "add": {collection: [items]},
  "remove": [ids], "highlight": [ids]}`, applied cumulatively. A static render shows the last step
  unless `step` (0-based) is given; the widget starts at the first with back and next buttons.
- `size`: `[width, height]` in px where the kind allows it; defaults fit the content.
- Labels use light TeX without dollar signs: `R_{1}`, `V_{in}`, `10\,k\Omega`, `\tau`, `i^{2}`, `\text{max}`.
  One- or two-letter quantities turn italic; a unit after a number stays upright (`12 V`).
- Expressions: `+ - * / ^`, parentheses, implicit multiplication (`2x`), `sin cos tan exp ln log10
  sqrt abs min max step atan2`, `pi`, `e`, params by name. JSON strings need `\\` for one backslash.

Rules: labels only inside a diagram (no titles, captions, or sentences: explain in the chat). One
visual per answer unless asked. Read the returned summary and diagnostics and fix the spec when the
picture or its computed facts (nets, pointers, offsets) disagree with what you meant.

Static (default): `mcp__techviz__visual` with `spec` renders a PNG inline in the chat, in the app's
theme. `theme: "paper"` and `out` give a white version saved for documents.

Interactive (sliders or steps that teach something): call `show_widget` with exactly this, the
spec as one line of JSON, and nothing else:
```html
<div data-techviz-placeholder style="padding:1rem 0;color:var(--text-secondary)">Loading diagram…</div>
<script type="application/json" data-techviz>{"v":1,"kind":"plot",...}</script>
<script src="{{WIDGET_URL}}"></script>
```
Several specs may share one widget (repeat the first two lines; one script tag at the end). If no
kind fits, a hand-written SVG or HTML widget is the fallback: flat, CSS variables for colors
(`--text-primary`, `--text-secondary`, `--border`, `--bg-accent`), transparent background, no titles.
