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

/**
 * Módulo "natural" de um setor, usado só como ATALHO de entrada: quem é
 * lotado numa farmácia (CAF/Satélites) entra na Farmácia e quem é do
 * Almoxarifado entra no Almoxarifado, sem passar pela tela de escolha.
 *
 * A regra é ESTRITA de propósito: setor administrativo (Supervisão
 * Administrativa, TI, etc.) devolve null e continua vendo o seletor, porque
 * essas pessoas transitam nos dois módulos.
 *
 * Isto NÃO restringe acesso — gestor/admin continuam podendo trocar de módulo
 * pelo botão da sidebar.
 */
export function moduloDoSetor(
  departmentName: string | null | undefined,
): 'farmacia' | 'almoxarifado' | null {
  if (!departmentName) return null
  const d = departmentName.trim().toLowerCase()
  if (d === 'almoxarifado') return 'almoxarifado'
  // "caf (central de abastecimento farmaceutico)" e os satélites
  // ("Farmácia Satélite 1º Andar"...). Casamos por "farm" pra não depender do
  // acento de "Farmácia" — nenhum outro setor começa com esse prefixo.
  if (d.startsWith('caf') || d.startsWith('farm')) return 'farmacia'
  return null
}
