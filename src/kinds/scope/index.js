// scope: instrument screens computed from signals. An oscilloscope (time mode: channels with
// probes, coupling, and bandwidth; a trigger; automatic measurements read from the sampled
// record; cursors, math, XY, and an FFT pane; the settings that go wrong are teaching cases),
// a swept spectrum analyzer (RBW, VBW, the noise floor, markers), and an eye diagram (a PRBS
// with rise time, jitter, and noise; eye height, width, and mask hits).

import { SpecError } from '../../diag.js'
import { renderTime, divs } from './time.js'
import { renderSpectrum } from './spectrum.js'
import { renderEye } from './eye.js'

export default {
  kind: 'scope',
  fields: [
    'mode', 'divs', 'highlight', 'seed',
    'timebase', 'channels', 'bandwidth', 'rate', 'mem', 'trigger', 'measure', 'cursors', 'math', 'xy', 'fft',
    'center', 'span', 'start', 'stop', 'ref', 'dbdiv', 'rbw', 'vbw', 'nf', 'signals', 'markers',
    'bitrate', 'prbs', 'bits', 'vpp', 'offset', 'rise', 'jitter', 'noise', 'vdiv', 'mask',
  ],
  collections: ['channels', 'signals', 'markers'],
  render(spec, ctx) {
    const mode = spec.mode ?? 'time'
    if (mode === 'time') return renderTime(spec, ctx)
    if (mode === 'spectrum') return renderSpectrum(spec, ctx, divs)
    if (mode === 'eye') return renderEye(spec, ctx, divs)
    throw new SpecError('mode', 'mode is time (default), spectrum, or eye')
  },
}
