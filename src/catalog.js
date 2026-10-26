// The spec reference Claude reads (the techviz mod's catalog tool serves it through the CLI):
// docs/catalog.md, the shared part, with the list of kinds filled in from each kind's
// catalog.md title line ("# fbd: free-body ..."), then the pages asked for.

import { readFileSync } from 'node:fs'
import { KINDS } from './kinds/registry.js'

const root = new URL('../', import.meta.url)
const page = (kind) => readFileSync(new URL(`src/kinds/${kind}/catalog.md`, root), 'utf8').trim()

/** Every kind with the one-line summary from its catalog title. */
export function kindList() {
  return Object.keys(KINDS).map((kind) => {
    const m = /^# (\S+): (.+)$/m.exec(page(kind).split('\n')[0])
    return { kind, summary: m && m[1] === kind ? m[2] : '' }
  })
}

/** The overview, then each named kind's page; `widgetUrl` fills the widget script tag. */
export function catalogText(kinds = [], widgetUrl) {
  const list = kindList().map((k) => `- \`${k.kind}\`: ${k.summary}.`).join('\n')
  let overview = readFileSync(new URL('docs/catalog.md', root), 'utf8').trim().replace('{{KINDS}}', list)
  if (widgetUrl) overview = overview.replaceAll('{{WIDGET_URL}}', widgetUrl)
  const pages = kinds.map((k) => (KINDS[k] ? page(k) : `(no kind "${k}"; kinds: ${Object.keys(KINDS).join(', ')})`))
  return [overview, ...pages].join('\n\n---\n\n')
}
