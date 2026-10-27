# smith: Smith charts with Γ, VSWR, and return loss computed: loads, VSWR circles, line and L/C moves, L-section matches, S11 sweeps

The chart draws r and x circles at 0.2, 0.5, 1, 2, 5, labeled. Under it, readouts give each point's z,
Γ, and VSWR; the summary adds Z, y, Γ (rectangular and polar), return loss, and mismatch loss.
Amounts are numbers (SI), param expressions, or strings with units: `"2.4 GHz"`, `"10 nH"`, `"50 ohm"`.

- `z0`: reference impedance, Ω (default 50). `f`: frequency for component values and RLC loads.
- `admittance: true`: the g and b grid in blue. `standards: true`: the open, short, and load marks.
- `scales`: outer rings from `"wtg"` (wavelengths toward the generator), `"wtl"`, `"angle"` (∠Γ).
- `readout: false` hides the readouts. `highlight`: ids drawn heavier.

## points
`{id, label, vswr: true (its |Γ| circle), color}` and one of: `Z: "40 + j30"` or `[R, X]` (Ω); `z`
(normalized); `Y: [G, B]` (S); `y`; `gamma: [re, im]` or `{mag, ang}` (°); or a load model at `f`:
`{R, L, C}` in series (`parallel: true` for parallel), or `{R, f0, Q}` (RLC resonant at f0).

## circles
`{vswr: 2}`, `{gamma: 0.333}`, or `{rl: 10}` (dB): a constant-|Γ| circle; `pass: true` shades
inside (a spec limit). `{r: 1}`, `{x: 0.5}`, `{g: 1}`, `{b: -1}` emphasize a grid circle.

## moves
Chained: each starts where the last ended (`from`: a point or move id). With moves and no `steps`,
the widget steps through them one at a time. Each draws an arc with an arrowhead and its value.
- `{line: 0.125}`: a lossless line in wavelengths, clockwise `toward: "generator"` (default) or
  `"load"`; or in meters `"24.7 mm"` with `vf` (0.66 for PE coax) at `f`. `zc` (Ω): a line of
  another impedance. `{line: true, to: "r=1" | "g=1" | "max" | "min"}` finds the shortest line.
- `{series: "L" | "C", value: "10 nH"}` moves z along its r circle; `{shunt: "L" | "C", value}`
  moves y along its g circle. Instead of `value`: `x` (series) or `b` (shunt), the normalized
  change, or `to`: series `"g=1"`, shunt `"r=1"`, or `"match"` (the element is found). Values
  need `f`; with `x`, `b`, or `to` the value is computed at `f`.
- `{quarter: 70.7}`: a λ/4 transformer of that Ω; `quarter: true` matches a real Z with √(Z₀R).
`to: "r=1"` and `"g=1"` draw their target circle dashed. A wrong-way `to` errors with the fix.

`match: true` (or `{from, f}`): every L-section match from the first point to the center, with
L and C values at `f` (Pozar §5.1: shunt-first needs g ≤ 1, series-first needs r ≤ 1).

## sweeps
S11 over frequency, as a curve with an arrow at the stop end, the best match ringed, and the band
inside `limit` (a VSWR, drawn as a pass circle) thickened with ticks at its edges.
- Data: `data: [[f, a, b], ...]` with `unit` (Hz, kHz, MHz, GHz) and `format`: `ri` (re, im),
  `ma` (|S11|, °), or `db` (dB, °), as in a Touchstone .s1p.
- A model: `{R, L, C}` or `{R, f0, Q}` (an antenna near resonance: series RLC) with `start`,
  `stop` (or `center`, `span`) and `n` (201). `line: "0.5 m"` and `vf`: a cable to the load.
- `markers: ["2.4 GHz", ...]`: numbered dots, read out with z and VSWR. `label` (S_{11}), `color`.

## expect
`{id: {quantity: value}}` checks computed values; each wrong one warns with the right value.
Points and moves: `Z`, `z`, `y`, `gamma` (|Γ| or [re, im]), `ang`, `vswr`, `rl`, `ml`; moves
also `value` and `d` (λ); sweeps `best` (f) and `band` ([lo, hi]); `match: ["1.84 pF", ...]`.

## Examples

L-section match of Z_L = 100 − j50 Ω at 500 MHz (Pozar Example 5.1 at 50 Ω), stepped.
```json
{"v":1,"kind":"smith","f":"500 MHz","admittance":true,
 "points":[{"id":"ZL","label":"Z_{L}","Z":"100 - j50"}],
 "moves":[{"shunt":"C","to":"r=1"},{"series":"L","to":"match"}],"match":true}
```

An antenna's S11 with the 2:1 band, and a load through λ/8 of line.
```json
{"v":1,"kind":"smith","sweeps":[{"R":36,"f0":"2.45 GHz","Q":8,"start":"2 GHz","stop":"3 GHz","limit":2,"markers":["2.4 GHz"]}]}
```
```json
{"v":1,"kind":"smith","points":[{"id":"ZL","Z":"30 + j40","vswr":true}],"moves":[{"line":0.125}]}
```
