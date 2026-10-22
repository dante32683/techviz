// memory: not written yet.
import { SpecError } from '../diag.js'

export default {
  kind: 'memory',
  fields: [],
  collections: [],
  render() { throw new SpecError('kind', 'memory is not implemented yet') },
}
