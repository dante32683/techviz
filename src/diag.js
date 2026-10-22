// Diagnostics: errors stop a render, warnings and notes go back to the author.

export class Diag {
  constructor() { this.items = [] }
  error(path, msg) { this.items.push({ level: 'error', path, msg }) }
  warn(path, msg) { this.items.push({ level: 'warning', path, msg }) }
  note(path, msg) { this.items.push({ level: 'note', path, msg }) }
  get hasErrors() { return this.items.some((d) => d.level === 'error') }
  text() {
    return this.items.map((d) => `${d.level}${d.path ? ` at ${d.path}` : ''}: ${d.msg}`).join('\n')
  }
}

export class SpecError extends Error {
  constructor(path, msg) { super(msg); this.path = path }
}
