# chain: RF signal chains and instrument block diagrams: levels in dBm, Friis NF, noise floor, SNR, sensitivity, IIP3, compression, mixer image plans, VNA and spectrum analyzer presets

Blocks run left to right, wrapping to a new row when long, each node labeled with its level in dBm.
A table under them gives each stage's G and NF and, under each wire, the totals to that node: ΣG,
ΣNF (Friis), and the noise floor N = −174 dBm/Hz + 10 log10(B) + ΣG + ΣNF. The footer gives the
cascade NF, SNR, sensitivity, IIP3, compression warnings, and each mixer's image. Amounts are
numbers or strings with units: `"-90 dBm"`, `"2 dB"`, `"2.44 GHz"`, `"1 MHz"`.

- `input`: the level at the first node (dBm); or give the source or antenna a `level`.
- `f`: the input frequency (checks filter passbands, gives each mixer's IF and image).
- `bw`: the noise bandwidth (Hz): adds N, the SNR, and the input noise floor (MDS).
  `snr`: the SNR you need (dB), for the sensitivity: −174 + 10 log10(B) + NF + SNR.
- `table`: true (default, except with a preset), false, or rows from `G`, `NF`, `G_cum`, `NF_cum`,
  `N`, `P`. `plan: true`: each mixer's RF, LO, IF, image, and the filters ahead of it on an axis.
- `highlight`: block ids, shaded. `expect`: below.

## blocks
`{type, id, label, note}` plus the type's fields. `gain` or `loss` in dB (loss positive); a passive
part's NF is its loss. `note`: a few words under the block (what it sets). Types:
- `source`, `antenna`: start the chain (first block only), with an optional `level` (dBm).
- `amp`: `gain` (needed), `nf`. `cable`, `atten`: `loss` (needed). `switch`: `loss` (0).
- `filter`: `loss` (0) and a band, `pass: [lo, hi]`, `below` (low-pass), or `above` (high-pass);
  `stop`: its rejection outside the band (dB). A signal outside the band warns.
- `mixer`: `loss` (conversion loss, default 7) or `gain`, `nf` (default the loss); `lo` (Hz), or
  `if` with `inject: "low"` (default) or `"high"`; `sweep: true` marks a swept LO. The LO comes in
  from below. IF = |RF − LO|; image = 2 LO − RF, rejected when it falls outside a filter ahead.
- `coupler`: `coupling` (20 dB), `loss` (through), `samples: "forward"` (default) or `"reflected"`
  (the wave sent back by the first block downstream with `rl`, its return loss in dB), `branch`.
- `splitter`: `loss` (3 dB per output), `branch`. A `branch` is a list of blocks hung below.
- `detector`, `adc`, `receiver`, `display`: end the chain; levels after one aren't computed.
- `port`: a connector on the line (`label: "port 1"`). `block`: a box; `gain`/`loss` optional.
Limits in dBm, checked at every block, branches too: `p1db` (output), `ip1db` and `max` (input)
warn when passed. `oip3` or `iip3` give the cascade IIP3 (1/IIP3 = Σ G_before/IIP3_i, in mW).

## preset
`"sa"`: a swept superheterodyne spectrum analyzer: atten, lpf, mixer (swept LO, IF 3.9 GHz),
ifamp, rbw, log, det, vbw, display; `bw` is its RBW, so the input noise floor is its DANL. `"vna"`:
a 2-port VNA's forward path: source, split (R below), coupler (A below, reflected), port1, dut
(loss 3, rl 15), port2, B. `blocks` then patch the preset's blocks by id: `[{"id": "atten", "loss": 20}]`.

## expect
Cascade totals `gain`, `nf`, `out`, `snr`, `sensitivity`, `mds`, `iip3`, `oip3`, `sfdr`; or a block
id with `level` (its output; a sink's input), `in`, `gain` and `nf` (from the input to its output),
`noise`, and a mixer's `lo`, `if`, `image`. Each wrong value warns with the right one (0.1 dB; 0.5%).

## Examples

Receiver front end; put the BPF ahead of the LNA and the NF rises by about the filter's loss.
```json
{"v":1,"kind":"chain","input":"-90 dBm","f":"2.44 GHz","bw":"1 MHz","snr":10,
 "blocks":[{"type":"antenna","label":"ANT"},{"id":"lna","type":"amp","label":"LNA","gain":20,"nf":1.5,"p1db":10},
  {"type":"filter","label":"BPF","loss":2,"pass":["2.4 GHz","2.4835 GHz"],"stop":40},
  {"id":"mix","type":"mixer","label":"MIX","loss":7,"lo":"2.37 GHz"},{"type":"amp","label":"IF amp","gain":30,"nf":4}],
 "expect":{"nf":2.05,"mix":{"image":"2.30 GHz"}}}
```
A 20 dB pad keeps a +20 dBm signal under the tinySA's +6 dBm maximum input.
```json
{"v":1,"kind":"chain","input":"+20 dBm","table":false,
 "blocks":[{"type":"source","label":"DUT"},{"type":"atten","label":"pad","loss":20},
  {"type":"display","label":"tinySA","max":"+6 dBm","note":"max +6 dBm"}]}
```
FM image plan: high-side LO; the 88 to 108 MHz preselector rejects the image at 119.4 MHz.
```json
{"v":1,"kind":"chain","f":"98 MHz","plan":true,"table":false,
 "blocks":[{"type":"antenna"},{"type":"filter","pass":["88 MHz","108 MHz"],"loss":1,"stop":30},
  {"type":"amp","gain":15,"nf":3},{"type":"mixer","lo":"108.7 MHz","loss":6}]}
```
```json
{"v":1,"kind":"chain","preset":"vna"}
```
