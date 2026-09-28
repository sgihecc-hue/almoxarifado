// =====================================================================
// Adicionar Estoque (aberto pelo detalhe do item)
//
// Ate 28/09/2026 este dialogo gravava do navegador: no almox inseria em
// stock_entries e depois fazia current_stock = (valor lido ao ABRIR a tela) +
// quantidade — qualquer saida registrada no meio era apagada — sem rodada,
// sem trava e sem local; na farmacia chamava registrar_entrada_estoque (sem
// rodada nem local). A validade vinha preenchida com hoje+365.
//
// Agora grava pelas MESMAS RPCs da Nova Entrada, numa transacao so:
//   material     -> registrar_entrada_nf (local ALMOX)
//   medicamento  -> registrar_entrada_farmacia (local CAF)
// com rodada (duplo clique/reenvio nao soma de novo), aviso de entrada
// parecida e validade VAZIA por padrao.
// =====================================================================

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Package2, FileText, Building2, AlertCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { hojeLocal, lerQuantidade, erroQuantidade } from '@/lib/utils/seguro'
import {
  novaRodadaId, useTravaEnvio, lerAvisoEntrada, descreverParecida, avisoValidade, type EntradaParecida,
} from '@/lib/utils/entradas'
import type { Item } from '@/lib/services/items'

interface AddStockDialogProps {
  item: Item
  type: 'pharmacy' | 'warehouse'
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

// Mesmas opcoes das telas de Nova Entrada de cada modulo.
const TIPOS_ALMOX = ['Compra', 'Empréstimo', 'Doação', 'Consignado', 'Troca de validade'] as const
const TIPOS_FARMACIA = ['Compra', 'Empréstimo', 'Pagamento de empréstimo', 'Doação', 'Permuta', 'Consignado', 'Troca de validade', 'Inventário'] as const
const QTD_MAXIMA = 100000

function formatCNPJ(value: string) {
  const n = value.replace(/\D/g, '').slice(0, 14)
  return n
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

export function AddStockDialog({ item, type, open, onOpenChange, onSuccess }: AddStockDialogProps) {
  const navigate = useNavigate()
  const farmacia = type === 'pharmacy'
  const localCodigo = farmacia ? 'CAF' : 'ALMOX'
  const localNome = farmacia ? 'CAF' : 'Almoxarifado'
  const tipos: readonly string[] = farmacia ? TIPOS_FARMACIA : TIPOS_ALMOX

  const [tipo, setTipo] = useState<string>('Compra')
  const [nf, setNf] = useState('')
  const [nfPendente, setNfPendente] = useState(false)
  const [dataNf, setDataNf] = useState(hojeLocal())
  const [entrega, setEntrega] = useState(hojeLocal())
  const [afm, setAfm] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [fornecedor, setFornecedor] = useState('')
  const [qtd, setQtd] = useState('1')
  const [preco, setPreco] = useState<number | undefined>(undefined)
  const [lote, setLote] = useState('')
  // Validade VAZIA: antes vinha hoje+365 e ia gravada sem ninguem conferir.
  const [validade, setValidade] = useState('')
  const [obs, setObs] = useState('')

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [parecida, setParecida] = useState<EntradaParecida | null>(null)
  const [rodadaId, setRodadaId] = useState(novaRodadaId)
  const trava = useTravaEnvio()

  // Cada abertura do dialogo e uma entrada nova (rodada nova, campos limpos).
  useEffect(() => {
    if (!open) return
    setRodadaId(novaRodadaId())
    setTipo('Compra'); setNf(''); setNfPendente(false); setDataNf(hojeLocal()); setEntrega(hojeLocal())
    setAfm(''); setCnpj(''); setFornecedor(''); setQtd('1'); setPreco(undefined)
    setLote(''); setValidade(''); setObs(''); setErro(null); setParecida(null)
    trava.liberar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item.id])

  const isCompra = tipo === 'Compra'
  const isInventario = tipo === 'Inventário'
  const quantidade = lerQuantidade(qtd)
  const erroQtd = erroQuantidade(qtd) ?? ((quantidade ?? 0) > QTD_MAXIMA ? `Quantidade acima de ${QTD_MAXIMA.toLocaleString('pt-BR')}: confira.` : null)
  const totalLinha = (quantidade ?? 0) * (preco ?? 0)
  const aviso = avisoValidade(validade, entrega || dataNf || hojeLocal())

  function validar(): string | null {
    if (erroQtd) return erroQtd
    if (farmacia && (!lote.trim() || !validade)) return 'Medicamento precisa de lote e validade (rastreabilidade e FEFO).'
    if (!isInventario && !fornecedor.trim()) return 'Informe o fornecedor / origem.'
    if (isCompra && !nfPendente && (!nf.trim() || !dataNf)) return 'Para Compra, informe o número e a data da NF — ou marque "a NF ainda não chegou".'
    return null
  }

  async function salvar(confirmarParecida = false) {
    setErro(null)
    const msg = validar()
    if (msg) { setErro(msg); return }
    if (!trava.tentar()) return
    setParecida(null)
    setSalvando(true)
    let gravou = false
    try {
      const linha = {
        item_id: item.id,
        quantity: quantidade,
        unit_price: preco ?? 0,
        batch_number: lote.trim() || null,
        expiry_date: validade || null,
      }
      const comum = {
        p_invoice_number: nf.trim() || null,
        p_invoice_date: dataNf || null,
        p_afm_number: afm.trim() || null,
        p_supplier_cnpj: cnpj.trim() || null,
        p_supplier_name: fornecedor.trim() || null,
        p_items: [linha],
        p_acquisition_type: tipo,
        p_location_code: localCodigo,
        p_delivery_date: entrega || null,
        p_entry_group_id: rodadaId,
        p_confirmar_parecida: confirmarParecida,
        p_nf_pendente: isCompra && nfPendente,
      }
      const { error } = farmacia
        ? await supabase.rpc('registrar_entrada_farmacia', { ...comum, p_notes: obs.trim() || null })
        : await supabase.rpc('registrar_entrada_nf', { ...comum, p_item_type: 'warehouse' })
      if (error) throw error
      gravou = true
      onSuccess()
      onOpenChange(false)
    } catch (e) {
      const a = lerAvisoEntrada(e)
      if (a?.tipo === 'ja_registrada') {
        // O primeiro envio ja gravou (clique duplo/reenvio); nada somou de novo.
        gravou = true
        onSuccess()
        onOpenChange(false)
      } else if (a?.tipo === 'parecida') {
        setParecida(a.info)
      } else {
        console.error('Adicionar estoque:', e)
        setErro(getErrorMessage(e))
      }
    } finally {
      setSalvando(false)
      if (!gravou) trava.liberar()
    }
  }

  const rotaNovaEntrada = farmacia
    ? `/inventory/pharmacy/nf-entry?loc=CAF&item=${item.id}`
    : `/inventory/warehouse/nf-entry?loc=ALMOX&item=${item.id}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package2 className="w-5 h-5 text-primary-600" />
            Adicionar Estoque
          </DialogTitle>
          <div className="mt-2 p-3 bg-gray-50 rounded-lg text-sm text-gray-600 space-y-0.5">
            <p><span className="font-medium">Item:</span> {item.name}</p>
            <p><span className="font-medium">Código:</span> {item.code ?? '—'} · <span className="font-medium">Unidade:</span> {item.unit}</p>
            <p><span className="font-medium">Destino:</span> {localNome}</p>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Grava como a <strong>Nova Entrada</strong>. NF com vários itens ou entrada em outro estoque?{' '}
            <button type="button" className="underline text-primary-700" onClick={() => { onOpenChange(false); navigate(rotaNovaEntrada) }}>
              Abrir Nova Entrada
            </button>
          </p>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 border-b pb-2">
              <FileText className="w-4 h-4" /> Dados da entrada
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="as-tipo">Tipo de entrada *</Label>
                <select id="as-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}
                  className="mt-1 w-full h-9 rounded-md border border-input px-3 py-1 bg-white text-sm">
                  {tipos.map((t) => <option key={t} value={t}>{t === 'Inventário' ? 'Ajuste por inventário' : t}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="as-nf">Número da NF {isCompra && !nfPendente ? '*' : '(opcional)'}</Label>
                <Input id="as-nf" value={nf} onChange={(e) => setNf(e.target.value)} className="mt-1" placeholder="Ex: 123456" />
                {isCompra && (
                  <label className="flex items-start gap-2 mt-2 text-xs text-gray-600">
                    <input type="checkbox" checked={nfPendente} onChange={(e) => setNfPendente(e.target.checked)} className="mt-0.5" />
                    <span>A NF ainda não chegou — fica como <strong>NF pendente</strong> para completar depois em Entradas.</span>
                  </label>
                )}
              </div>
              <div>
                <Label htmlFor="as-dnf">Data de emissão da NF</Label>
                <Input id="as-dnf" type="date" value={dataNf} onChange={(e) => setDataNf(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="as-ent">Data de entrega</Label>
                <Input id="as-ent" type="date" value={entrega} onChange={(e) => setEntrega(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="as-afm">Número da AFM (opcional)</Label>
                <Input id="as-afm" value={afm} onChange={(e) => setAfm(e.target.value)} className="mt-1" />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 border-b pb-2">
              <Building2 className="w-4 h-4" /> Fornecedor
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="as-cnpj">CNPJ (opcional)</Label>
                <Input id="as-cnpj" value={cnpj} onChange={(e) => setCnpj(formatCNPJ(e.target.value))} placeholder="00.000.000/0000-00" maxLength={18} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="as-forn">{isInventario ? 'Fornecedor / Origem (opcional)' : 'Fornecedor / Origem *'}</Label>
                <Input id="as-forn" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} className="mt-1" />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 border-b pb-2">
              <Package2 className="w-4 h-4" /> Produto
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="as-qtd">Quantidade *</Label>
                <Input id="as-qtd" type="text" inputMode="numeric" value={qtd} onChange={(e) => setQtd(e.target.value)}
                  className={`mt-1 ${erroQtd ? 'border-red-400' : ''}`} />
                {erroQtd && <p className="text-xs text-red-600 mt-1">{erroQtd}</p>}
              </div>
              <div>
                <Label htmlFor="as-preco">Valor unitário</Label>
                <div className="mt-1"><CurrencyInput id="as-preco" value={preco} onChange={setPreco} /></div>
              </div>
              <div>
                <Label>Valor desta linha</Label>
                <div className="mt-1 h-9 px-3 py-2 bg-gray-100 rounded-md text-sm font-medium text-gray-700">
                  R$ {totalLinha.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div>
                <Label htmlFor="as-lote">Lote {farmacia ? '*' : '(opcional)'}</Label>
                <Input id="as-lote" value={lote} onChange={(e) => setLote(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="as-val">Validade {farmacia ? '*' : '(opcional)'}</Label>
                <Input id="as-val" type="date" value={validade} onChange={(e) => setValidade(e.target.value)} className="mt-1" />
                {aviso && <p className="text-xs text-amber-700 mt-1">{aviso}</p>}
              </div>
            </div>
            {farmacia && (
              <div>
                <Label htmlFor="as-obs">Observação (opcional)</Label>
                <textarea id="as-obs" value={obs} onChange={(e) => setObs(e.target.value)} rows={2}
                  className="w-full mt-1 rounded-md border border-input px-3 py-2 bg-white text-sm" />
              </div>
            )}
          </div>

          {parecida && (
            <div className="p-3 text-sm bg-amber-50 rounded-md border border-amber-300 space-y-2">
              <p className="text-amber-900 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span><strong>Esta entrada parece repetida.</strong> {descreverParecida(parecida)}</span>
              </p>
              <p className="text-xs text-amber-800">
                Se a nota só chegou agora para uma mercadoria que já entrou, não registre de novo: complete a entrada
                existente em Entradas.
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setParecida(null)}>Cancelar</Button>
                <Button type="button" size="sm" className="bg-amber-600 hover:bg-amber-700 text-white" disabled={salvando}
                  onClick={() => salvar(true)}>
                  É outra entrada — registrar mesmo assim
                </Button>
              </div>
            </div>
          )}

          {erro && (
            <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md border border-red-200">{erro}</div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="button" onClick={() => salvar()} disabled={salvando}>
              {salvando && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirmar Entrada
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
