# wave: timing diagrams (WaveJSON), register bitfields, pipeline charts

One of three modes per spec: `signal` (WaveJSON timing), `reg` (bitfield), or `pipeline`.

## signal (WaveDrom WaveJSON)

- `signal`: list of `{name, wave, data?, period?, phase?, node?, id?}`; `{}` is a blank row;
  `["group", sig, ...]` groups rows under a bracket label.
- `wave`, one character per cycle: `p n` clocks (`P N` with edge arrows), `0 1`, `l h` / `L H`
  (sharp edges), `x` unknown, `z` high-Z, `u d` pull up/down, `=` and `2`-`9` data (3-9 tinted),
  `.` hold, `|` gap. Each character spans `period` cycles (default 1).
- `data`: labels for the `=`/`2`-`9` slots in order (list or space-separated string).
- `phase`: shift left by that many cycles; `0.5` puts changes mid-cycle (data launched on one
  edge and sampled on the next).
- `node`: letters under cycles (`".a..b"`); `edge`: `["a~>b label", "a-|>b"]` arcs between them.
  Lowercase node letters are drawn; uppercase are hidden. Edge labels are plain text.
- `config`: `hscale` (whole number, cycle width ×), `hbounds: [start, end]` crops cycles.
- `head`/`foot`: `{tick: 0}` or `{tock: 1}` number cycles. `text` titles are dropped (warning).
- Labels and data are plain text (WaveDrom), not TeX.
- `highlight`: signal ids; that lane and its name draw in the highlight color.

Checks: unknown wave characters (error); data count vs slots, lanes shorter than the longest,
edge letters missing from `node` (warnings). Summary: cycle count, then each signal's value at
the start of every cycle, run-length coded: `q=[x×2, 0×2, 1×2, 2×2]`, clocks as `clk=clock(p)`.

## reg (bitfield, WaveDrom/bit-field)

- `reg`: fields LSB first: `{bits, name?, attr?, type?}`. `attr` prints under the field (a
  binary string like `"0110011"` is checked against `bits`); `type` 2-7 tints the field.
- `config`: `bits` (total; checked), `lanes` (rows), `hspace` (width px), `compact`, `vflip`.
- Summary lists fields MSB first: `[31:25] funct7=0000000, ...`.

## pipeline (drawn by techviz)

- `pipeline`: rows `{instr, id?, stall?, flush?, start?}`, in program order.
- `stages`: default `["IF","ID","EX","MEM","WB"]`.
- `stall`: extra cycles held in a stage, `{"ID": 1}`; a bare number holds in the second stage.
  Instructions behind a stall wait automatically (one instruction per stage, in order).
  Held cycles draw dashed.
- `flush: "ID"`: the row stops after that stage (squashed by a branch).
- `start`: cycle (from 1) the row enters the first stage; default one after the row above.
- `forward`: `[{from: "lw.MEM", to: "add.EX", id?}]`, arrows from the end of the producer's
  stage to the consumer's. A forward whose value isn't ready in time warns (add a stall).
- `cycle`: shade one cycle column; later cells fade (use in `steps` to walk the clock).
- `highlight`: row or forward ids.
- Summary: cycles, stall cycles, each row's stage cycles (`add: IF2 ID3-4(stall 1) EX5 ...`),
  and each forward's cycles.

## Examples

```json
{"v":1,"kind":"wave","signal":[
  {"name":"clk","wave":"p......."},
  {"name":"rst","wave":"10......"},
  {"name":"q","wave":"x.=.=.=.","data":["0","1","2"]}]}
```

```json
{"v":1,"kind":"wave",
 "pipeline":[{"id":"lw","instr":"lw  x1, 0(x2)"},{"id":"add","instr":"add x3, x1, x4","stall":1}],
 "forward":[{"from":"lw.MEM","to":"add.EX"}]}
```
