// Estoques de farmácia (stock_locations). IDs fixos do banco — fonte única para
// o seletor de módulo, o indicador do topo e as telas de estoque.
//
// Nota importante: o SAT_T fica visualmente no seletor da Farmácia (é onde a
// operação escolhe o estoque), MAS o inventário dele é de MATERIAIS/EQUIPAMENTOS
// médicos — os mesmos itens do Almoxarifado. Por isso `itemType='warehouse'` só
// nele. As telas que leem saldo/catálogo precisam respeitar esse tipo pra ler
// da tabela certa (warehouse_items vs pharmacy_items).
export interface PharmacyStock {
  id: string
  code: string
  label: string // curto, para chips/indicador
  name: string  // completo
  itemType: 'pharmacy' | 'warehouse'
}

export const PHARMACY_STOCKS: PharmacyStock[] = [
  { id: '42c3b239-c354-4b5b-a2eb-d42b7a9edc10', code: 'CAF',   label: 'CAF',         name: 'CAF — Central de Abastecimento Farmacêutico', itemType: 'pharmacy'  },
  { id: 'fa96acab-9065-44ee-aeae-b87c5af8110a', code: 'SAT_1', label: 'Satélite 1',  name: 'Farmácia Satélite 1º Andar',                    itemType: 'pharmacy'  },
  { id: 'cf2d0681-0cdd-48b4-9431-73c09e853048', code: 'SAT_2', label: 'Satélite 2',  name: 'Farmácia Satélite 2º Andar',                    itemType: 'pharmacy'  },
  { id: '6f3fdf99-829a-46bb-b354-19a44fa36324', code: 'SAT_T', label: 'Satélite T',  name: 'Farmácia Satélite Térreo',                      itemType: 'warehouse' },
]

// Setor "Farmácia Satélite Térreo" (departments). A Satélite Térreo atende os
// postos com MATERIAL (pedido type='warehouse' saindo do estoque SAT_T).
export const SAT_T_DEPARTMENT_ID = 'c224297a-7f88-4a0c-b3f7-26c2d44a1052'
export const SAT_T_STOCK_ID = '6f3fdf99-829a-46bb-b354-19a44fa36324'
// Estoque do Almoxarifado (stock_locations ALMOX). Movimento sem local e do almox.
export const ALMOX_STOCK_ID = 'ad02bf13-ab91-42e0-bfe7-b2e5bbb01e40'
// Filtro PostgREST "so o que e do estoque do almox": a Satelite Terreo usa o
// mesmo catalogo (item_type='warehouse'), mas as saidas dela sao da farmacia.
export const FILTRO_SO_ALMOX = `local_id.is.null,local_id.eq.${ALMOX_STOCK_ID}`

export function pharmacyStockById(id?: string | null): PharmacyStock | null {
  if (!id) return null
  return PHARMACY_STOCKS.find((s) => s.id === id) ?? null
}

/**
 * Confere se o nome de um departamento corresponde ao setor "dono" do
 * estoque — usado pra filtrar telas que operam em contexto do setor
 * (ex.: Confirmar Recebimento, onde quem confirma é o setor solicitante).
 *
 * Regras:
 * - Satélites (SAT_1/SAT_2/SAT_T): o nome do estoque bate exatamente com
 *   o nome do departamento ("Farmácia Satélite 1º Andar", etc).
 * - CAF: o departamento se chama "CAF (Central de abastecimento
 *   farmaceutico)" — casa pelo prefixo "caf".
 * Comparação normalizada (lowercase, trim), ignora diferenças de espaço.
 */
export function departmentBelongsToStock(departmentName: string | null | undefined, stock: PharmacyStock): boolean {
  if (!departmentName) return false
  const d = departmentName.trim().toLowerCase()
  const s = stock.name.trim().toLowerCase()
  if (d === s) return true
  if (stock.code === 'CAF' && d.startsWith('caf')) return true
  return false
}

// Soros da CAF que a Satelite Terreo tambem atende (cadastro MEDICAMENTO; Andressa 05/11).
export const SAT_T_SOROS = [
  '23cc6beb-2bd2-4ac7-b0ea-aeafad0d385b',
  'e21ddb46-676b-43f8-85d3-8cfc5591c6a5',
  '8c43bcab-b616-4371-86c1-cacca87a48f7',
  'cdbac859-29b4-4ed8-99cb-388cdfc17b87',
  'aaf9e895-118e-4879-8077-61a8e1f8777d',
  'a3a5c682-b744-43e3-9fcb-78759cb41b07',
  '9b96564d-5a47-4db3-bffc-7e686a5e93e1',
  '558ca4a4-6d65-4582-a304-529d51046f34',
  '84386ae0-0092-4001-8291-af5bc164c45c',
]
