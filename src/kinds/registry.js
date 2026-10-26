// Every kind, by name. A kind is a folder in src/kinds/ (see docs/adding-a-kind.md);
// adding one is one import here and its name in the list.
import plot from './plot/index.js'
import circuit from './circuit/index.js'
import memory from './memory/index.js'
import layout from './layout/index.js'
import wave from './wave/index.js'
import fsm from './fsm/index.js'
import fbd from './fbd/index.js'
import breadboard from './breadboard/index.js'

export const KINDS = Object.fromEntries([plot, circuit, memory, layout, wave, fsm, fbd, breadboard].map((k) => [k.kind, k]))
