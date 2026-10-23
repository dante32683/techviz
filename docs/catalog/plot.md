# plot: functions, data, marks, slope fields

- `x`, `y`: axes `{label, unit?, range: [min, max], log?}`. `x.range` is required; `y.range`
  defaults to fit the curves. The title reads `label (unit)`; `log: true` needs a positive range.
- `series`: list, each one of:
  - `{y: "expr in x", domain?: [a, b], samples?}`: a function; breaks at asymptotes.
  - `{points: [[x, y], ...], connect?}`: data drawn as dots (`connect: true` joins them).
  - `{x: "expr in t", y: "expr in t", t: [t0, t1]}`: a parametric curve.
  - Shared: `id`, `label` (drawn at the right end of the curve; no legend), `color` (a
    palette name: blue, coral, teal, purple, amber, green, pink, red, gray), `style`
    (`dashed`, `dotted`, or `dots`), `width`.
- `marks`: list, each one of:
  - `{x: value}` or `{y: value}`: a dashed reference line, with an optional `label`.
  - `{point: [x, y], label?, guides?}`: a dot; `guides: true` adds dashed lines to the axes.
  - `{segment: [[x1, y1], [x2, y2]]}` or `{arrow: ...}`, with an optional `label`.
  - `{text: "label", at: [x, y], anchor?}`.
  - Values may be expressions of params (`"tau"`, `"5*(1-exp(-1))"`).
- `slopefield: {dydx: "expr in x and y", density?: 21, color?}` draws short slope segments.
  - `isoclines: [0, 1]` or `[{value, label}]`: dashed curves where dy/dx equals the value.
  - `solutions: [{from: [x0, y0], label?, color?}]`: RK4 curves through the point, both ways.
- `grid: false` hides the grid. `highlight: [series ids]` thickens those curves.
- `size`: default `[560, 330]`; use a squarer size when x and y share units (circles, fields).

Use params with sliders for "what does τ do" questions; use `steps` to add curves or marks one
at a time. Summary: the plotted ranges and the series and mark counts.

## Examples

```json
{"v":1,"kind":"plot","x":{"label":"t","unit":"ms","range":[0,5]},"y":{"label":"v_{C}","unit":"V","range":[0,5.5]},
 "params":{"tau":{"value":1,"min":0.2,"max":3,"step":0.1,"unit":"ms","label":"\\tau"}},
 "series":[{"y":"5*(1-exp(-x/tau))","label":"charging"},{"y":"5*exp(-x/tau)","label":"discharging","style":"dashed"}],
 "marks":[{"x":"tau","label":"t = \\tau"},{"point":["tau","5*(1-exp(-1))"],"label":"63\\%","guides":true}]}
```

```json
{"v":1,"kind":"plot","x":{"label":"x","range":[-3,3]},"y":{"label":"y","range":[-3,3]},"size":[460,420],
 "slopefield":{"dydx":"x - y"},"isoclines":[0,1],"solutions":[{"from":[0,1],"label":"y(0)=1"}]}
```

```json
{"v":1,"kind":"plot","x":{"label":"f","unit":"Hz","range":[10,100000],"log":true},
 "y":{"label":"|H|","range":[0.001,1.2],"log":true},
 "params":{"fc":{"value":1000,"min":100,"max":10000,"unit":"Hz","label":"f_{c}"}},
 "series":[{"y":"1/sqrt(1+(x/fc)^2)","label":"RC low-pass"}],"marks":[{"x":"fc","label":"f_{c}"}]}
```
