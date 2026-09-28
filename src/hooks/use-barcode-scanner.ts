import { useEffect, useRef, useCallback } from 'react'

/** Onde a leitura aconteceu, para a tela desfazer o que o leitor digitou no campo. */
export interface LeituraInfo {
  /** Campo que estava com o foco quando a leitura comecou (null = fora de campo). */
  alvo: HTMLElement | null
  /** Valor do campo ANTES da leitura (so quando a leitura caiu dentro de um campo). */
  valorAntes: string | null
}

interface BarcodeScannerOptions {
  onScan: (barcode: string, info: LeituraInfo) => void
  enabled?: boolean
  minLength?: number
  /** ms máximo entre caracteres para ser considerado scanner (padrão: 40ms) */
  maxGap?: number
  /**
   * Também reconhece a leitura quando o foco está num campo comum (lote,
   * quantidade...). Sem isso, a leitura feita com o foco no campo virava o
   * texto do campo: código de 8 dígitos na quantidade = 12 milhões de unidades
   * (Entrada por Leitor). A tela recebe `info.valorAntes` para desfazer o que
   * o leitor digitou. Padrão false (as outras telas seguem como eram).
   */
  capturarNosCampos?: boolean
}

/**
 * Detecta input de leitores de código de barras BT/USB HID.
 * Scanners emitem caracteres em rajada (<40ms entre teclas) e finalizam com Enter.
 * Humanos digitam mais devagar (>80ms entre teclas) — o hook ignora digitação normal.
 *
 * Por padrão só intercede quando NENHUM input/textarea comum está focado
 * (a menos que seja um input com data-barcode-input="true"). Com
 * `capturarNosCampos`, reconhece a rajada também dentro dos campos.
 */
export function useBarcodeScanner({
  onScan,
  enabled = true,
  minLength = 4,
  maxGap = 40,
  capturarNosCampos = false,
}: BarcodeScannerOptions) {
  const bufferRef = useRef('')
  const lastKeyTimeRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inicioRef = useRef<LeituraInfo>({ alvo: null, valorAntes: null })
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return

      const target = e.target as HTMLElement
      const tagName = target.tagName.toLowerCase()
      const isScanInput = target.getAttribute('data-barcode-input') === 'true'
      const dentroDeCampo =
        (tagName === 'input' || tagName === 'textarea' || target.isContentEditable) && !isScanInput

      // Ignora digitação em inputs comuns para não interferir
      if (dentroDeCampo && !capturarNosCampos) return

      const now = Date.now()
      const gap = now - lastKeyTimeRef.current
      lastKeyTimeRef.current = now

      // Gap grande = nova sequência; reseta buffer
      if (gap > maxGap && bufferRef.current.length > 0) {
        bufferRef.current = ''
      }

      if (e.key === 'Enter') {
        const barcode = bufferRef.current.trim()
        // Dentro de campo, so conta como leitura se o Enter veio colado na
        // rajada (o leitor manda na hora; quem digita e aperta Enter demora).
        const rajada = !dentroDeCampo || gap <= maxGap * 2
        if (barcode.length >= minLength && rajada) {
          e.preventDefault()
          if (dentroDeCampo) e.stopPropagation()
          const info = inicioRef.current
          onScanRef.current(barcode, info)
        }
        bufferRef.current = ''
        inicioRef.current = { alvo: null, valorAntes: null }
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        return
      }

      if (e.key.length === 1) {
        if (bufferRef.current === '') {
          // Primeira tecla da sequencia: guarda onde estava e o valor de antes
          // (no keydown o campo ainda nao recebeu a tecla).
          inicioRef.current = {
            alvo: dentroDeCampo ? target : null,
            valorAntes: dentroDeCampo ? ((target as HTMLInputElement).value ?? '') : null,
          }
        }
        bufferRef.current += e.key

        // Auto-reset após 500ms de inatividade (evita acúmulo de lixo)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          bufferRef.current = ''
        }, 500)
      }
    },
    [enabled, maxGap, minLength, capturarNosCampos],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [handleKeyDown])
}
