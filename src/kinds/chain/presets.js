// Instrument presets, built from ordinary blocks. A spec with "preset" starts from these blocks;
// its own "blocks" patch them by id ({"id": "atten", "loss": 20}).

export const PRESETS = {
  // A swept superheterodyne spectrum analyzer (Keysight AN 150, figure 2-1): the input attenuator,
  // a low-pass filter against the image, the mixer and its swept LO, IF gain, the IF filter that
  // sets the RBW, the log amp, the envelope detector, the video filter (VBW), and the display.
  sa: {
    blocks: [
      { id: 'atten', type: 'atten', loss: 10, label: 'atten', note: 'sets the mixer level' },
      { id: 'lpf', type: 'filter', loss: 0.5, below: '3 GHz', label: 'LPF', note: 'blocks the image' },
      { id: 'mixer', type: 'mixer', loss: 7, if: '3.9 GHz', inject: 'high', sweep: true, label: 'mixer', note: 'LO sweep sets the span' },
      { id: 'ifamp', type: 'amp', gain: 20, nf: 8, label: 'IF gain', note: 'sets the ref level' },
      { id: 'rbw', type: 'filter', loss: 1, label: 'RBW', note: 'resolution and noise floor' },
      { id: 'log', type: 'block', label: 'log', note: 'dB scale' },
      { id: 'det', type: 'detector', label: 'detector', note: 'envelope' },
      { id: 'vbw', type: 'filter', below: '1 kHz', label: 'VBW', note: 'smooths the noise' },
      { id: 'display', type: 'display', label: 'display', note: 'level vs f' },
    ],
  },
  // A 2-port VNA's forward path (a transmission/reflection test set): the source, a splitter to the
  // reference receiver R, a directional coupler whose coupled arm takes the reflected wave to A,
  // ports 1 and 2 around the DUT, and B receiving the transmitted wave.
  vna: {
    input: '0 dBm',
    caption: 'S_{11} from A/R, S_{21} from B/R',
    blocks: [
      { id: 'source', type: 'source', label: 'source', note: 'sweeps f' },
      { id: 'split', type: 'splitter', loss: 6, label: 'splitter', branch: [{ id: 'R', type: 'receiver', label: 'R', note: 'incident a_{1}' }] },
      { id: 'coupler', type: 'coupler', coupling: 20, loss: 1, samples: 'reflected', label: 'coupler', branch: [{ id: 'A', type: 'receiver', label: 'A', note: 'reflected b_{1}' }] },
      { id: 'port1', type: 'port', label: 'port 1' },
      { id: 'dut', type: 'block', label: 'DUT', loss: 3, rl: 15 },
      { id: 'port2', type: 'port', label: 'port 2' },
      { id: 'B', type: 'receiver', label: 'B', note: 'transmitted b_{2}' },
    ],
  },
}
