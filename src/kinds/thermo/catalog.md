# thermo: ideal-gas thermodynamics with the energy bookkeeping computed: P-V and T-S diagrams of processes and cycles (Carnot, Otto, Diesel, Brayton, Stirling, any loop) with W, Q, ΔE_int, ΔS, e against Carnot, and COP; engine and refrigerator energy flows; heating curves; Maxwell–Boltzmann speeds

Convention: OpenStax University Physics Vol. 2: ΔE_int = Q − W, W the work done by the gas
(positive on expansion), Q positive into the gas; engines and refrigerators use amounts Q_h, Q_c,
W ≥ 0: e = W/Q_h, K_R = Q_c/W, K_P = Q_h/W, e_C = 1 − T_c/T_h. R = 8.314 J/mol·K. Amounts are
numbers (SI: Pa, m³, K, J, kg) or strings with units: "1.0 atm", "101 kPa", "22.4 L", "500 cm^3",
"27 °C", "1.5 kJ", "2.0 kW", "0.50 kg". `expect` checks values to 1%, like `{"W_AB": "1.57 kJ",
"e": 0.40}` (bare numbers: P and V in the axis units, energy J, T kelvin); a miss warns with the
value and the likely slip (sign of W or Q, C_p for C_V, °C for K, L·atm, log₁₀, K_R for K_P, …).

- `mode`: `pv` (default), `ts`, `flow`, `heating`, or `speeds`.
- `gas`: monatomic (default, C_V = 3/2 R), diatomic (5/2 R), polyatomic (3R), a name (He, Ar, N2, O2,
  H2, air), or {"gamma": 1.3}. `n`: moles; found from any state with P, V, and T.

## pv and ts
- `states`: [{"id": "A", "P": …, "V": …, "T": …}], any two of P, V, T (ids default A, B, …), or one
  when a leg into the state fixes the rest (V after an adiabatic leg gives P and T).
- `legs`: [{"from": "A", "to": "B", "process": "isothermal"}]: isobaric, isochoric, isothermal,
  adiabatic (PV^γ), or line (straight; both ends known). `from` defaults to the last leg's `to`.
  Legs closing a loop are a cycle: clockwise an engine, counterclockwise a refrigerator.
- `cycle`, instead of states and legs (states A–D, or `names`; `"reverse": true` runs it backward):
  - carnot: Th, Tc, V [V_A, V_B] (the hot isotherm); stirling: Th, Tc, V [V_min, V_max]; with n or P.
  - otto: r = V_max/V_min, V (max, at A), two of P, T at A (or n), and Tmax or Qin.
  - diesel: r, rc = V_C/V_B, V, P, T. brayton: rp = P_max/P_min, P (min), V or T at A, Tmax.
  - rectangle: P [low, high], V [low, high], clockwise from A at bottom left. triangle: the same
    ranges, A→B isochoric up, B→C a straight line down to (V high, P low), C→A isobaric.
- `isotherms`: true (through the hottest and coldest states) or ["300 K", "600 K"], dotted.
- `units`: {"P": "atm", "V": "L"} for the axes (default: the units written). `table`: true (states
  and legs), "states", "legs", or false. `entropy`: true adds ΔS (on in ts). `processes`: false
  drops the process names. `highlight`: leg ids ("AB") or state ids.
- Draws legs red for Q > 0, blue for Q < 0, plain for Q = 0, an arrow on each, the work shaded
  (the loop, or under each curve; green W > 0, purple W < 0), the state and leg tables, Q_in, Q_out,
  e = W/Q_in against 1 − T_c/T_h of the extreme T; backward, K_R = Q_in/|W|, K_P = Q_out/|W| (Carnot
  limits only when all heat enters colder than it leaves). ts: T against S − S_A; area = Q_net = W.
- Keys: W_AB, Q_AB, dE_AB (ΔE_int), dS_AB, P_B, V_B, T_B, W, Q, Qin, Qout, Qh, Qc, e, eC, KR, KP, Th, Tc, n.

## flow
- `device`: engine (default), refrigerator, or heat pump. Two of `Qh`, `Qc`, `W` (J, or all W for
  power), or one and `e` (engine) or `K` (its COP). `Th`, `Tc` add the Carnot limit and warn when
  it's beaten (the second law). Or a P-V `cycle` (or states and legs): its Q_in, Q_out, W.
- Arrow widths scale with each amount. Keys: Qh, Qc, W, e, eC, K, KC, Th, Tc.

## heating
- `substance`: "water" (default: c 2090, 4186, 2020 J/kg·K; L_f 334, L_v 2256 kJ/kg) or {"Tm", "Tb",
  "c": [solid, liquid, gas], "Lf", "Lv", "names"}. `m`, `from`, and `to` or `Q` (the heat added; it
  may stop partway through melting). `end`: "liquid" or "gas" when `to` is on a plateau.
- Keys: Q (total), Q_1, Q_2, … (each stretch), Tf.

## speeds
- `gas`: a named gas or {"M": "28 g/mol"}; `T`: one or a list (or several gases at one T). Marks
  v_p = √(2RT/M), v̄ = √(8RT/πM), v_rms = √(3RT/M). Keys: vp, vavg, vrms.

## Examples
Isothermal against adiabatic expansion from one state; a rectangular cycle run backward.
```json
{"v":1,"kind":"thermo","n":1,"states":[{"id":"A","P":"1.00 atm","V":"22.4 L"},{"id":"B","V":"44.8 L"},{"id":"C","V":"44.8 L"}],"legs":[{"from":"A","to":"B","process":"isothermal"},{"from":"A","to":"C","process":"adiabatic"}],"expect":{"W_AB":"1.57 kJ","T_C":172}}
```
```json
{"v":1,"kind":"thermo","n":0.1,"cycle":{"type":"rectangle","P":["1.0 atm","3.0 atm"],"V":["1.0 L","3.0 L"],"reverse":true},"expect":{"KR":3.5}}
```
A Diesel cycle with isotherms; a heat engine's energy flow; N₂ speeds at three temperatures.
```json
{"v":1,"kind":"thermo","gas":"diatomic","cycle":{"type":"diesel","r":10,"rc":2,"V":"1.0 L","P":"100 kPa","T":"300 K"},"isotherms":true}
```
```json
{"v":1,"kind":"thermo","mode":"flow","Th":"600 K","Tc":"300 K","Qh":"2.0 kJ","e":0.30}
```
```json
{"v":1,"kind":"thermo","mode":"speeds","gas":"N2","T":["100 K","300 K","1000 K"]}
```
