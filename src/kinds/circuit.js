// circuit: not written yet.
import { SpecError } from '../diag.js'

export default {
  kind: 'circuit',
  fields: [],
  collections: [],
  render() { throw new SpecError('kind', 'circuit is not implemented yet') },
}
