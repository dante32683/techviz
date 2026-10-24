// Themes map semantic roles to colors. "paper" is for documents: white
// background, black lines (PHYS 42 lab style: red plus, blue minus). "dark" and
// "light" are for inline PNGs in the Claude desktop app and match its look: its
// neutral greys, its tint colors and its Anthropic Sans font, falling back to
// Segoe UI where that font isn't installed. "host" is for the chat widget: the
// app's CSS variables, so it follows light and dark mode live.

// The app's tint colors (its Context panel and status fills): mid-tones that
// read on both light and dark backgrounds.
const PALETTE = {
  blue: '#338CED', teal: '#00A888', coral: '#E76624', purple: '#785EE8',
  amber: '#D28E05', green: '#10A122', pink: '#CE447D', red: '#DC3C3D', gray: '#878787',
}
const ORDER = ['blue', 'coral', 'teal', 'purple', 'amber', 'green', 'pink']

const APP_FONT = 'Anthropic Sans, Segoe UI, Arial, sans-serif'
const APP_MONO = 'Anthropic Mono, Consolas, Menlo, monospace'
const MATH_FONT = 'Cambria, Cambria Math, Times New Roman, serif'

export const THEMES = {
  paper: {
    name: 'paper', bg: '#ffffff', halo: '#ffffff', fg: '#111111', muted: '#5f5e5a', faint: '#b4b2a9', grid: '#e4e2da',
    font: 'Segoe UI, Arial, sans-serif', math: MATH_FONT,
    mono: 'Consolas, Menlo, monospace', size: 13,
    positive: '#d62828', negative: '#1d5fd6', highlight: '#E24B4A',
  },
  // The desktop app's dark chat: its #191919 background, so the image blends
  // in, and its white-alpha text levels flattened onto it.
  dark: {
    name: 'dark', bg: '#191919', halo: '#191919', fg: '#EFEFEF', muted: '#9C9C9C', faint: '#757575', grid: '#303030',
    font: APP_FONT, math: MATH_FONT, mono: APP_MONO, size: 13,
    positive: '#F17778', negative: '#6AABF1', highlight: '#F17778',
  },
  // The desktop app's light chat: white, with its black-alpha text levels.
  light: {
    name: 'light', bg: '#ffffff', halo: '#ffffff', fg: '#1A1A1A', muted: '#666666', faint: '#888888', grid: '#E6E6E6',
    font: APP_FONT, math: MATH_FONT, mono: APP_MONO, size: 13,
    positive: '#DC3C3D', negative: '#257DE0', highlight: '#DC3C3D',
  },
  host: {
    name: 'host', bg: null, halo: 'var(--halo, none)', fg: 'var(--text-primary, #222)', muted: 'var(--text-secondary, #666)',
    faint: 'var(--text-muted, #999)', grid: 'var(--border, #ddd)',
    font: 'var(--font-sans, sans-serif)', math: MATH_FONT,
    mono: 'var(--font-mono, monospace)', size: 13,
    positive: '#DC3C3D', negative: '#338CED', highlight: '#DC3C3D',
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
