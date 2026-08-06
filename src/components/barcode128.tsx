import { useMemo } from 'react'
import { code128 } from '@/lib/barcode/code128'

interface Barcode128Props {
  value: string
  height?: number       // altura das barras (px)
  moduleWidth?: number  // largura do módulo mais fino (px)
  showText?: boolean    // mostra o código em texto embaixo
  className?: string
}

// Desenha o código de barras Code 128 em SVG (escala bem na impressão).
export function Barcode128({
  value, height = 44, moduleWidth = 1.4, showText = true, className,
}: Barcode128Props) {
  const modules = useMemo(() => code128(value), [value])
  const quiet = 10 * moduleWidth // zona de silêncio (margem) obrigatória
  const barsWidth = modules.reduce((s, w) => s + w, 0) * moduleWidth
  const totalW = barsWidth + quiet * 2

  // Constrói os retângulos pretos (módulos alternam barra/espaço, começa em barra).
  const rects: { x: number; w: number }[] = []
  let x = quiet
  modules.forEach((w, i) => {
    const width = w * moduleWidth
    if (i % 2 === 0) rects.push({ x, w: width }) // índice par = barra
    x += width
  })

  return (
    <div className={className} style={{ display: 'inline-block', textAlign: 'center' }}>
      <svg width={totalW} height={height} viewBox={`0 0 ${totalW} ${height}`} shapeRendering="crispEdges">
        <rect x={0} y={0} width={totalW} height={height} fill="#fff" />
        {rects.map((r, i) => (
          <rect key={i} x={r.x} y={0} width={r.w} height={height} fill="#000" />
        ))}
      </svg>
      {showText && (
        <div style={{ fontFamily: 'monospace', fontSize: 10, letterSpacing: 0.5, marginTop: 1, wordBreak: 'break-all' }}>
          {value}
        </div>
      )}
    </div>
  )
}
