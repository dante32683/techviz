// layout: not written yet.
import { SpecError } from '../diag.js'

export default {
  kind: 'layout',
  fields: [],
  collections: [],
  render() { throw new SpecError('kind', 'layout is not implemented yet') },
}
