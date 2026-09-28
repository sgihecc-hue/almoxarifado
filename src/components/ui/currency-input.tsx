import * as React from 'react'
import { cn } from '@/lib/utils'

interface CurrencyInputProps {
  value: number | undefined | null
  onChange: (value: number | undefined) => void
  placeholder?: string
  className?: string
  id?: string
  disabled?: boolean
  autoFocus?: boolean
  showPrefix?: boolean
}

function formatBRL(n: number): string {
  // Ate 4 casas: preco unitario de material as vezes tem centavo fracionado
  // (0,0345). Sempre pelo menos 2.
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

/**
 * Le um valor em reais digitado do jeito normal: "0,9", "1.234,56", "1,5",
 * "12". Vazio ou invalido -> undefined.
 *
 * Antes o campo lia so os digitos como centavos: "0,9" virava 0,09 e "1,5"
 * virava 0,15 — preco gravado 10x menor sem ninguem perceber.
 */
export function lerValorMonetario(texto: string | number | null | undefined): number | undefined {
  if (texto === null || texto === undefined) return undefined
  if (typeof texto === 'number') return Number.isFinite(texto) ? texto : undefined
  let t = texto.trim().replace(/\s/g, '').replace(/^R\$/i, '')
  if (t === '') return undefined
  if (t.includes(',')) {
    // Formato brasileiro: ponto e milhar, virgula e decimal.
    t = t.replace(/\./g, '').replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    // "1.234" ou "1.234.567": milhar sem decimais.
    t = t.replace(/\./g, '')
  }
  // Sobra "1.5" (ponto decimal) ou so digitos.
  if (!/^\d*\.?\d*$/.test(t) || t === '.') return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ value, onChange, placeholder = '0,00', className, id, disabled, autoFocus, showPrefix = true }, ref) => {
    const valido = value !== undefined && value !== null && !isNaN(value as number)
    const [texto, setTexto] = React.useState<string>(valido ? formatBRL(value as number) : '')
    const focado = React.useRef(false)

    // Valor mudou por fora (reset do formulario, outro item): mostra o novo.
    // Enquanto a pessoa digita, so troca o texto se ele nao representar mais
    // o valor (senao "0," viraria "0,00" no meio da digitacao).
    React.useEffect(() => {
      const atual = lerValorMonetario(texto)
      const novo = valido ? (value as number) : undefined
      if (focado.current && atual === novo) return
      setTexto(novo === undefined ? '' : formatBRL(novo))
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const bruto = e.target.value.replace(/[^\d.,]/g, '')
      setTexto(bruto)
      onChange(lerValorMonetario(bruto))
    }

    const input = (
      <input
        ref={ref}
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        disabled={disabled}
        autoFocus={autoFocus}
        value={texto}
        onChange={handleChange}
        onFocus={() => { focado.current = true }}
        onBlur={() => {
          focado.current = false
          const n = lerValorMonetario(texto)
          setTexto(n === undefined ? '' : formatBRL(n))
        }}
        placeholder={placeholder}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          showPrefix && 'pl-9',
          className
        )}
      />
    )

    if (!showPrefix) return input

    return (
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500 pointer-events-none">
          R$
        </span>
        {input}
      </div>
    )
  }
)
CurrencyInput.displayName = 'CurrencyInput'
