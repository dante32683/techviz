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
import truss from './truss/index.js'
import field from './field/index.js'
import ds from './ds/index.js'
import graph from './graph/index.js'
import bfield from './bfield/index.js'
import scope from './scope/index.js'
import logic from './logic/index.js'
import kmap from './kmap/index.js'
import smith from './smith/index.js'
import ac from './ac/index.js'
import chain from './chain/index.js'
import optics from './optics/index.js'
import thermo from './thermo/index.js'
import linalg from './linalg/index.js'

export const KINDS = Object.fromEntries([plot, circuit, memory, layout, wave, fsm, fbd, breadboard, truss, field, ds, graph, bfield, scope, logic, kmap, smith, ac, chain, optics, thermo, linalg].map((k) => [k.kind, k]))

