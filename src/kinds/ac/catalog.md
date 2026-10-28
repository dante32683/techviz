# ac: AC steady state from R, L, C values: phasor diagrams, impedance triangles, Bode plots with asymptotes, resonance curves, every value computed and checked

Amounts are numbers (SI), param expressions, or strings with units: `"30 ohm"` (or `Ω`), `"80 mH"`,
`"20 uF"`, `"60 Hz"`, `"377 rad/s"`, `"90 V"`. The drawing shows 3 figures; the summary shows 4.

- `mode`: `phasor` (default), `impedance`, `bode`, or `resonance`.
- `parts`: `{"R": "30 ohm", "L": "80 mH", "C": "20 uF"}`; the first letter is the type (R1, L2, Cx).
- `circuit`: `series` (default) or `parallel` (all parts, in order), or an expression: `+` is series,
  `||` parallel (binds tighter), with parentheses: `"R1 + (L || C)"`.
- `V`, `f`: the source amplitude and frequency. `rms`: true (default: V and every computed V and I
  are rms) or false (peak). φ is the source voltage's phase minus the current's (+: inductive).
- `expect`: values to check, like `{"Z": "106.8 ohm", "phi": -73.68, "I": 0.8429, "V_C": "111.8 V"}`.
  Keys: w, XL, XC, X, Z, phi (°), I, V_R, I_C (any part), pf, P, f0, Q, BW, f1, f2, fc. Each must be
  within 1% (φ 0.5°); a miss warns with the computed value and says when it's the peak (or rms)
  value, has the wrong sign, is in radians, or is twice the average power. `values: false` drops
  the numbers from the labels; `highlight: ["C"]` thickens a part's phasor.

## phasor

A series circuit takes the current as the horizontal reference; a parallel one, the voltage. Every
part must be in series or every part in parallel.
- `sum`: `chain` (default: the parts' phasors head to tail, so V_L and V_C run side by side and
  visibly cancel) or `origin` (each from the origin, with the net V_L − V_C dashed).
- `wave: true` draws v(t) and i(t) to the right, each starting at its phasor's vertical projection.

## impedance

Each series term's Z (R, jX_L, −jX_C) from the origin, the total |Z|, the dashed net X, and φ; a
parallel one gets the Y plane (G = 1/R, B_C = ωC, B_L = 1/ωL, |Y|, ∠Y). `plane: "Z" | "Y"`; `sum: "chain"`.

## bode

|H| in dB and the phase against log f: the exact curve over dashed straight-line asymptotes, each
corner (dotted, with the exact phase there), the −3 dB points (two are joined: the bandwidth), and
every asymptote's slope (±20 dB/dec per pole or zero). H comes from either:
- a divider: `out` names the series terms taken as output, `"C"` or `"L + C"`, and H = Z_out/Z_total.
  RC low-pass `"R + C"`, out C; high-pass out R; RL low-pass `"L + R"`, out R; band-pass
  `"R + L + C"`, out R; notch, out `"L + C"`; tank `"R + (L || C)"`, out `"L || C"`. Or
- `poles` and `zeros`: Hz, 0 for one at the origin, `{f, Q}` or `{f, zeta}` for a complex pair;
  `gain` is K in K (jω)^n ∏(1 + jω/ω_z)/∏(1 + jω/ω_p), a number or `"40 dB"`.
- `range: [f_lo, f_hi]` (default 1.5 decades past the outer corners); `phase: false` drops the phase;
  `sweep: {"R": [...]}` overlays a curve per value (marks belong to the first).

## resonance

A series RLC's I (or a parallel RLC's |Z|) against f: f₀ = 1/(2π√LC) dashed, the half-power points
joined (Δf), and Q = f₀/Δf. `sweep: {"R": ["10 ohm", "40 ohm"]}` overlays one curve per value (any
part), labeled with it. `y`: `I`, `Z`, or `P` (average power); `range`; `log: true`. V defaults to 1 V.

Summary: ω, X_L, X_C, Z (rectangular, polar, each step), φ with lead or lag, I, each part's V and I,
pf, P; f₀, Q, BW, f₁, f₂ for an RLC; poles, zeros, slopes, and −3 dB points; the expect results.

## Examples
PHYS 42 Late AC practice B, problem 2: series RLC on 90.0 V rms at 60.0 Hz, checked against the key.
```json
{"v":1,"kind":"ac","parts":{"R":"30 ohm","L":"0.0800 H","C":"20 uF"},"V":"90 V","f":"60 Hz",
 "expect":{"Z":"106.8 ohm","I":"0.8429 A","phi":-73.68,"V_C":"111.8 V"}}
```

```json
{"v":1,"kind":"ac","mode":"bode","parts":{"R":"1 kohm","C":"100 nF"},"circuit":"R + C","out":"C"}
```

```json
{"v":1,"kind":"ac","mode":"resonance","parts":{"R":"10 ohm","L":"10 mH","C":"1 uF"},"sweep":{"R":["10 ohm","40 ohm"]}}
```
Notch: the output across L and C of a series RLC.
```json
{"v":1,"kind":"ac","mode":"bode","parts":{"R":"100 ohm","L":"10 mH","C":"1 uF"},"out":"L + C"}
```
