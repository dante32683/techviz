// Themes map semantic roles to colors. "paper" is for documents and light mode:
// white background, black lines (PHYS 42 lab style: red plus, blue minus).
// "dark" is for inline PNGs in a dark app. "host" is for the chat widget: the
// app's CSS variables, so it follows light and dark mode live.

// Mid-tone ramps that read on both light and dark backgrounds.
const PALETTE = {
  blue: '#378ADD', teal: '#1D9E75', coral: '#D85A30', purple: '#7F77DD',
  amber: '#BA7517', green: '#639922', pink: '#D4537E', red: '#E24B4A', gray: '#888780',
}
const ORDER = ['blue', 'coral', 'teal', 'purple', 'amber', 'green', 'pink']

export const THEMES = {
  paper: {
    name: 'paper', bg: '#ffffff', fg: '#111111', muted: '#5f5e5a', faint: '#b4b2a9', grid: '#e4e2da',
    font: 'Segoe UI, Arial, sans-serif', math: 'Cambria, Cambria Math, Times New Roman, serif',
    mono: 'Consolas, Menlo, monospace', size: 13,
    positive: '#d62828', negative: '#1d5fd6', highlight: '#E24B4A',
  },
  // Inline PNGs in a dark app. The background is the Desktop app's dark chat
  // color, so the image blends in and still reads in any viewer.
  dark: {
    name: 'dark', bg: '#151515', fg: '#ECEBE6', muted: '#A9A79F', faint: '#6F6D67', grid: '#2C2C2A',
    font: 'Segoe UI, Arial, sans-serif', math: 'Cambria, Cambria Math, Times New Roman, serif',
    mono: 'Consolas, Menlo, monospace', size: 13,
    positive: '#FF6B6B', negative: '#6EA8FF', highlight: '#FF6B6B',
  },
  host: {
    name: 'host', bg: null, fg: 'var(--text-primary, #222)', muted: 'var(--text-secondary, #666)',
    faint: 'var(--text-muted, #999)', grid: 'var(--border, #ddd)',
    font: 'var(--font-sans, sans-serif)', math: 'Cambria, Cambria Math, Times New Roman, serif',
    mono: 'var(--font-mono, monospace)', size: 13,
    positive: '#E24B4A', negative: '#378ADD', highlight: '#E24B4A',
  },
}

/** A named color ('teal'), a palette index, or a literal; categorical colors cycle through ORDER. */
export function color(c, i = 0) {
  if (typeof c === 'string' && PALETTE[c]) return PALETTE[c]
  if (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c)) return c
  return PALETTE[ORDER[((typeof c === 'number' ? c : i) % ORDER.length + ORDER.length) % ORDER.length]]
}

export const COLOR_NAMES = Object.keys(PALETTE)

export function getTheme(name = 'paper') {
  return THEMES[name] ?? THEMES.paper
}
