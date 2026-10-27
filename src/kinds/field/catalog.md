# field: electric fields and potentials: point charges, line charges, rods, charged planes, parallel plates, equipotentials, d∥ splits

Positions are problem coordinates in `unit` (default `m`; also cm, mm), y up; never pixels.
E and V are computed from the sources (SI, superposed); angles are degrees CCW from +x.

- `sources`: each `{id, type, label, color}` plus:
  - `point`: `at` [x, y], `q` (C). `line`: infinite line charge, `at`, `lambda` (C/m); seen
    end-on (a dot) unless `angle` (it then lies in the page). `segment`: finite rod, `from`, `to`,
    `lambda`. `plane`: infinite sheet seen edge-on through `at` (default [0, 0]) running along
    `angle` (default 0), `sigma` (C/m²): E = σ/2ε₀ away from it. `plates`: a parallel-plate pair
    centered on `at`, `gap`, `sigma` (the + plate's), `dir` (E between them, from + to −:
    up|down (default)|left|right|degrees): σ/ε₀ between, 0 outside.
  - Amounts: a number (SI), an expression of `params`, or a string with its unit: `"2 nC"`,
    `"-3 μC"`, `"5 nC/m"`, `"55.5 pC/m^2"` (prefixes p n u μ m k). Default label is the signed
    value; `label: false` hides it (plates: `["+σ", "−σ"]`).
- `points`: `{"A": [x, y], "B": {"at": [x, y], "E": true}}`: dots with names; `E: true` draws
  E there (`E_{A}`). Coordinates can be expressions (`[1, "1 + 4.5"]`).
- `view`: `{"x": [min, max], "y": [min, max]}`; default fits the points and sources.
- `E`: `"arrows"` (default: a grid of short arrows along E, fainter where weaker), `"lines"`
  (field lines from + charges, ending on − ones), or `"none"`.
- `equipotentials`: `true` (6 levels) or `{through: ["A", "B"], values: [V...], count, labels}`:
  dashed contours. `through` lines are labeled `V_{A}` (`labels: false` hides); `values` are
  volts relative to `ref`; `count` spaces levels evenly over the view; `labels: true` writes values.
- `displacements`: `{from: "A", to: "B", label, split, labels}`: an arrow A→B (label defaults
  to its length). It splits (`split: false` to skip) into a dashed leg along E at A, labeled
  `d_{\parallel} = 3.18 m`, then the leg across E to B, labeled `\Delta V = 0`, with a right-angle
  mark; `labels: [along, across]` replaces them (false hides one).
- `angles`: `{at, from, to, label}`: an arc at point `at` between two of: `"E"` (E there), a
  point pair `"AB"` (A→B), a source id (its line), horizontal, vertical, up, down, left, right,
  or degrees. Lines take the side giving the smaller angle. Label defaults to the degrees.
- `dims`: `{from, to, label, side: left|right}`: a dimension line between two points, or from a
  point to a source id (the perpendicular distance); a plates id alone dimensions the gap.
- `ref`: a point name where V = 0. Without it V = 0 at infinity for points and segments, on a
  lone plane, midway between lone plates; otherwise only differences are given.
- `highlight`: source or displacement ids drawn thicker.

Summary: each source (with σ/2ε₀ or σ/ε₀), every point's |E| and direction (and V with a
reference), V differences between consecutive points and each displacement's ends, each
split's d∥, d⊥ and −E d∥ (uniform E), dims. Check ΔV and E against your answer.

## Examples
Tilted plane (55.5 pC/m², upper left to lower right), B 4.50 m above A, with the d∥ split:
```json
{"v":1,"kind":"field","sources":[{"type":"plane","angle":-45,"sigma":"55.5 pC/m^2"}],
 "points":{"A":[2,1],"B":[2,5.5]},"view":{"x":[-2.5,4.5],"y":[-2.5,6.5]},
 "equipotentials":{"through":["A","B"]},"displacements":[{"from":"A","to":"B","label":"4.50 m"}],
 "angles":[{"at":"A","from":"E","to":"AB"}]}
```
Dipole with field lines and equipotentials; E drawn at the midpoint:
```json
{"v":1,"kind":"field","unit":"cm","sources":[{"type":"point","at":[-2,0],"q":"2 nC"},{"type":"point","at":[2,0],"q":"-2 nC"}],
 "points":{"P":{"at":[0,0],"E":true}},"view":{"x":[-5,5],"y":[-4,4]},"E":"lines","equipotentials":{"count":6}}
```
Parallel plates 4 mm apart, a path from A to B, and the gap dimensioned:
```json
{"v":1,"kind":"field","unit":"mm","sources":[{"id":"C","type":"plates","gap":4,"dir":"down","sigma":"8.85 nC/m^2"}],
 "points":{"A":[-2,1.5],"B":[1.5,-1.5]},"view":{"x":[-4,4],"y":[-3.5,3.5]},"equipotentials":{"count":4},
 "displacements":[{"from":"A","to":"B"}],"dims":[{"from":"C","label":"4.00 mm"}]}
```
