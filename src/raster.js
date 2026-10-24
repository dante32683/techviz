// SVG to PNG for Node, with the system fonts (Segoe UI, Cambria Math, Consolas on Windows)
// plus any TTF or OTF files in the user's techviz fonts folder (%LOCALAPPDATA%\techviz\fonts
// on Windows, ~/.local/share/techviz/fonts elsewhere) or the folders in TECHVIZ_FONT_DIRS.
// That is where fonts that can't ship with techviz go, such as the app's Anthropic Sans.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

function fontDirs() {
  const base = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'techviz', 'fonts') : join(homedir(), '.local', 'share', 'techviz', 'fonts')
  const extra = (process.env.TECHVIZ_FONT_DIRS ?? '').split(delimiter).filter(Boolean)
  return [base, ...extra].filter((d) => existsSync(d))
}

// resvg ignores CSS variables, so host-theme colors fall back to their defaults.
const unvar = (svg) => svg.replace(/var\(--[\w-]+,\s*([^()]*(?:\([^()]*\))?[^()]*)\)/g, (_, fb) => fb.trim())

export function svgToPng(svg, { scale = 2 } = {}) {
  const r = new Resvg(unvar(svg), {
    fitTo: { mode: 'zoom', value: scale },
    font: { loadSystemFonts: true, fontDirs: fontDirs(), defaultFontFamily: 'Segoe UI' },
    shapeRendering: 2, textRendering: 1,
  })
  const img = r.render()
  return { png: img.asPng(), width: img.width, height: img.height }
}
