// fsm: not written yet.
import { SpecError } from '../diag.js'

export default {
  kind: 'fsm',
  fields: [],
  collections: [],
  render() { throw new SpecError('kind', 'fsm is not implemented yet') },
}
