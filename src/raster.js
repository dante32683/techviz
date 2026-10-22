// SVG to PNG for Node, with the system fonts (Segoe UI, Cambria Math, Consolas on Windows).
import { Resvg } from '@resvg/resvg-js'

export function svgToPng(svg, { scale = 2 } = {}) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' },
    shapeRendering: 2, textRendering: 1,
  })
  const img = r.render()
  return { png: img.asPng(), width: img.width, height: img.height }
}
