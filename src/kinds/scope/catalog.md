# scope: instrument screens computed from signals: oscilloscope (trigger, cursors, auto measurements, math, XY, FFT), spectrum analyzer, eye diagram

`mode`: `time` (default, an oscilloscope), `spectrum` (a swept analyzer), or `eye`. Amounts are a
number (SI), a param expression, or a string with a unit: `"2 V"`, `"200 us"`, `"1 kHz"`, `"10 MSa/s"`.
`divs`: `[cols, rows]`, default `[10, 8]` (`[10, 10]` in spectrum); a Siglent SDS1202X-E is `[14, 8]`.

## time

- `timebase`: `"200 us"` per division, or `{div, pos}`: `pos` (s) moves the view later and the
  trigger mark (▼) left. Times are from the trigger.
- `channels`: list of `{id: "CH1", label, signal, vdiv: "2 V", offset (V, moves the trace up),
  coupling: DC | AC (drops the mean) | GND, probe: 1 | 10 (the menu), tip (the probe's own switch;
  default probe), bwl: true (20 MHz limit), comp: over | under | edge gain (10X probe trimmer)}`.
  The tag on the left marks each channel's 0 V. Give ids to change a channel in `steps` (`set`).
- `signal`: one term or a list summed. Terms take `vpp` (default 2) or `amp`, `offset`, `phase` (°):
  `{type: sine | square | triangle, f}` (square: `duty`, `rise` 10-90%); `{type: "pulse", f, width,
  rise}` (0 to vpp); `{type: "rc", f, tau, across: C | R}` (a square through RC: charge, discharge);
  `{type: "ring", f, fr, zeta}` (a square ringing at fr); `{type: "am", f, fm, m}`; `{type: "fm", f,
  fm, beta}`; `{type: "noise", rms}`; `{type: "dc", v}`; `{expr: "2*sin(2*pi*50*t)"}` (t in s); or
  `{points: [[t, v], ...], period}` (sampled, linear between points; repeats with period).
- `bandwidth` (200 MHz), `rate` (1 GSa/s), `mem` (14 Mpts): samples at min(rate, mem / screen time).
  Under 2f the trace aliases; few samples show as dots. A single-pole bandwidth: t_r = 0.35/BW.
- `trigger`: `{source (first channel), level (default 50%), slope: rise | fall | either, mode:
  auto | normal, sweeps: 4}`. No crossing: auto overlays unaligned sweeps; normal draws nothing.
- `measure`: readouts for each channel, default `["Vpp", "freq"]`, from Vpp, Vmax, Vmin, Ampl, Vrms,
  Mean, freq, period, rise, fall, duty, phase, delay (against the first channel; + lags). Clipped: `>`.
- `cursors`: `{x: [t1, t2] | "period", y: [v1, v2] | "peaks", source}` read ΔT, 1/ΔT, and ΔV.
  `math`: `{op: "CH1-CH2" (or + or *), vdiv, offset, label}`, drawn and measured as M.
- `xy: true` (or `["M", "CH2"]`, x then y) draws one against the other on rows × rows divisions;
  the summary gives the Lissajous phase from sin φ = y₀/y_max.
- `fft: {source, window: hann | rect | hamming | blackman | flattop, center, span, ref, dbdiv}`: an
  FFT screen (dBV rms) under the trace.

Teaching cases are settings: a low `mem` or `rate` (aliasing), `bwl` (slow edges), a small `vdiv`
(clipping), a `level` outside the signal (untriggered), `comp`, `probe` ≠ `tip`, AC coupling.

## spectrum

- `center` + `span`, or `start` + `stop`; `ref` (top line, default 0 dBm); `dbdiv` (10).
- `rbw` (default about span/100), `vbw` (default rbw; smaller smooths the noise), `nf` (dB, 24):
  the noise floor is −174 dBm/Hz + 10 log₁₀(RBW) + NF. Lines closer than RBW merge.
- `signals`: `{f, dBm, label}` (a tone or spur); `{type: "harmonics", f, dBm, n, drop}` (dB per
  harmonic, 10) or `levels: [dBm, ...]`; `{type: "am", f, fm, m, dBm}`; `{type: "fm", f, fm, beta, dBm}`.
- `markers`: `{peak: 1}` (1 = highest), `{f}`, either with `delta: 1` (read against marker 1).

## eye

- `bitrate`, `prbs` (7, 9, 11, 15, 23, 31), `bits` (200), `vpp` (1 V), `rise` (10-90%, default
  0.3 UI), `jitter` (rms s), `noise` (rms V), `vdiv` (auto). Two UI across, the eye centered.
- `mask: {w: 0.5, h: "0.3 V"}`: a hexagon w UI wide; hits turn it red. The summary gives eye height
  (μ₁ − 3σ₁) − (μ₀ + 3σ₀), width UI − 6σ of the crossings, and mask hits.

## Examples

PHYS 42 Lab 10: ε on CH1; V_sense across 16.2 Ω (in series with 100 Ω) on CH2; cursors on a period.
```json
{"v":1,"kind":"scope","divs":[14,8],"timebase":"200 us","cursors":{"x":"period","y":"peaks"},
 "channels":[{"id":"CH1","label":"\\varepsilon","vdiv":"2 V","signal":{"type":"sine","f":"1 kHz","vpp":4}},
  {"id":"CH2","label":"V_{sense}","vdiv":"200 mV","signal":{"type":"sine","f":"1 kHz","vpp":"4*16.2/116.2"}}]}
```

```json
{"v":1,"kind":"scope","mode":"spectrum","start":"0 Hz","stop":"500 MHz","rbw":"1 MHz",
 "signals":[{"type":"harmonics","f":"100 MHz","dBm":-10,"n":4,"drop":15},{"f":"163 MHz","dBm":-70,"label":"spur"}],
 "markers":[{"peak":1},{"peak":2,"delta":1}]}
```

```json
{"v":1,"kind":"scope","mode":"eye","bitrate":"1 Gb/s","rise":"300 ps","jitter":"15 ps","noise":"20 mV","mask":{"w":0.5,"h":"0.4 V"}}
```
