# bfield: magnetism: B of wires, loops, and solenoids, Ampère paths, charged particles in B and E, induction and Lenz's law, torque on loops, forces between wires

Positions are problem coordinates in `unit` (default `m`; also cm, mm), y up, z out of the page;
never pixels. B is computed from the sources (SI, superposed). Amounts: a number (SI), an expression
of `params`, or a string with its unit: `"2 A"`, `"50 mT"`, `"3e6 m/s"`, `"1.67e-27 kg"`, `"-e"`,
`"24 kV/m"`, `"10 Ω"`, `"2 T/s"`, `"20 rev/s"` (prefixes n μ u m k M). Directions: up, down, left,
right, or degrees CCW from +x.

- `sources`: each `{id, type, label, color}`; currents take `I` (negative reverses it) and `dIdt`
  (A/s, or increasing|decreasing):
  - `wire`: a long straight current through the page at `at`, `dir`: out (⊙, default) | in (⊗).
  - `segment`: a wire in the page `from` → `to` (the current's way), finite (Biot–Savart);
    `infinite: true` extends it both ways.
  - `loop`: `at`, `r` (circle) or `w`, `h` (rectangle), `N` turns; face-on with `dir`: ccw (default)
    | cw seen from +z, or edge-on with `normal: degrees` (a ⊙/⊗ pair, μ along the normal; a
    rectangle's `w` is drawn, `h` runs into the page). In an outside B the summary gives τ = μ × B,
    and edge-on it draws θ, the side forces (rectangles), and the turning sense.
  - `solenoid`: cut along its axis: `at` (center), `length`, `r`, `N` or `n` (turns/m), `dir` (the
    way B points inside, default right): rows of ⊙ and ⊗.
  - `cylinder`: a thick wire through the page, radius `r`, `I` spread evenly, `dir` out|in.
  - `region`: uniform fields over `box: [[x0, y0], [x1, y1]]`, `circle: {at, r}`, or (neither) the
    whole view: `B` + `dir` (in, out, or a direction; filled with ⊗/⊙ or arrows), `dBdt` (T/s, or
    increasing|decreasing); `E` + `Edir` (up|down|left|right; a box only, drawn as ± plates).
- `B`: `"arrows"` (default with currents and no B region: a grid, ⊙/⊗ where B leaves the page),
  `"lines"` (field lines around wires, edge-on loops, and solenoids), or `"none"`.
- `points`: `{"P": [x, y]}` or `{"P": {"at": [x, y], "B": true}}` to draw B there (`B_{P}`).
- `forces: true` draws each wire's force from the other sources (per length on long wires).
- `paths`: dashed Ampère / Faraday loops `{at, r}` or `{box}`, `dir` ccw|cw, `label`.
- `particles`: `{id, type: proton|electron|positron|alpha|deuteron (or q, m), at, v, dir, label,
  arrows, turns}`; `v` is a speed with `dir`, or `[vx, vy, vz]`. The path is traced through every
  field: a circle, an arc that leaves a region, straight through balanced E and B, or, with B in the
  page, a helix seen side-on with its pitch dimensioned. `arrows` (default the start or entry) puts
  v, F_{B}, and F_{E} at start, entry, exit, end, or a fraction 0 to 1 of the path; `turns` (2) caps
  open paths.
- `induction`: conducting loops `{id, shape: rect (w, h) | circle (r) | rails, at, N, R, label}`.
  What changes: the sources' `dBdt` / `dIdt`; `v` + `dir` (moving; `dir` alone gives directions
  only); `omega` (rad/s, rev/s) with `theta` (the normal's tilt from +z, turning about the vertical
  axis); `dAdt` (m²/s, or growing|shrinking). `rails`: a bar of length `l` centered at `at`, sliding
  `dir` at `v`, with the resistor `back` (1.6 l) behind it. Draws I_ind on the loop (Lenz), B_ind at
  its center, v, and on rails the force on the bar and its + and − ends.
- `highlight`: source or loop ids drawn thicker.

Summary: each source (center B, μ = NIA, μ₀nI); |B| at points with each source's share; F/L between
long parallel wires (attract or repel); torques; per path I_enc, ∮B·dl, and with changing flux dΦ/dt
and the induced E; per particle r, T, f, the circling sense, pitch, E/B, entry and exit; per loop Φ,
dΦ/dt, emf, I, "I_ind clockwise as viewed from +z", B_ind, and the bar's force and power. Check them.

## Examples
Two long wires, opposite currents: field lines, B at the midpoint, the force on each:
```json
{"v":1,"kind":"bfield","unit":"cm","sources":[{"id":"1","type":"wire","at":[-4,0],"I":"4 A"},
 {"id":"2","type":"wire","at":[4,0],"I":"6 A","dir":"in"}],"points":{"P":{"at":[0,0],"B":true}},"B":"lines","forces":true}
```
Proton in 0.5 T into the page: the full circle, v and F_B at the start and halfway:
```json
{"v":1,"kind":"bfield","unit":"cm","sources":[{"type":"region","B":"0.5 T","dir":"in"}],
 "particles":[{"type":"proton","at":[0,-6.26],"v":"3e6 m/s","dir":"right","arrows":["start",0.5]}]}
```
Bar sliding right on rails in 0.8 T out of the page (emf = Bℓv = 0.6 V, I clockwise):
```json
{"v":1,"kind":"bfield","sources":[{"type":"region","B":"0.8 T","dir":"out"}],
 "induction":[{"shape":"rails","at":[0.15,0],"l":0.25,"v":"3 m/s","dir":"right","R":"2 Ω","back":0.35}]}
```
50-turn coil in a growing field (A-03), with Faraday paths inside and outside the field:
```json
{"v":1,"kind":"bfield","unit":"cm","sources":[{"type":"region","B":"0.1 T","dir":"out","dBdt":"2 T/s","circle":{"at":[0,0],"r":6}}],
 "induction":[{"shape":"circle","at":[0,0],"r":4,"N":50,"R":"10 Ω"}],"paths":[{"at":[0,0],"r":2},{"at":[0,0],"r":10}]}
```
