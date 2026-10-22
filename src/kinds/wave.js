// wave: not written yet.
import { SpecError } from '../diag.js'

export default {
  kind: 'wave',
  fields: [],
  collections: [],
  render() { throw new SpecError('kind', 'wave is not implemented yet') },
}
