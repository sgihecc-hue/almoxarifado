// =====================================================================
// Dispensacao de MATERIAL (satelite de material, ex.: Satelite Terreo).
//
// Medicamento e material gravam em lugares diferentes: o medicamento cria
// registro em pharmacy_dispensations; o material passa pela RPC
// criar_saida_material, que grava so em stock_movements. Nao da para unificar
// na tabela de dispensacao porque pharmacy_dispensation_items tem FK para
// pharmacy_items — o banco recusaria o item de material.
//
// Este modulo le os movimentos e devolve no MESMO formato PharmacyDispensation
// que as telas ja usam, para a lista e o historico nao precisarem saber da
// diferenca. Fica aqui, e nao dentro de uma tela, porque as duas usam.
// =====================================================================
import { supabase } from '@/lib/supabase'
import type { PharmacyDispensation } from '@/lib/types/dispensation'


// =====================================================================
// Histórico de MATERIAL (estoques com itemType='warehouse', ex.: Satélite
// Térreo). A saída de material passa pela RPC criar_saida_material, que
// grava só no livro-razão (stock_movements) — não existe registro em
// pharmacy_dispensations (a FK de pharmacy_dispensation_items aponta para
// pharmacy_items e recusaria item de material). Então reconstruímos as
// "dispensações" a partir dos movimentos: cada operação vira N linhas com o
// MESMO performed_at + destino_nome + performed_by, e é isso que agrupamos.
// O resultado usa o mesmo formato PharmacyDispensation da tela, com o SETOR
// de destino ocupando o lugar do paciente.
// =====================================================================
export async function loadMaterialDispensations(
  locationId: string,
  filters: { dateFrom?: string; dateTo?: string; search?: string },
): Promise<PharmacyDispensation[]> {
  let query = supabase
    .from('stock_movements')
    .select('id, quantity, performed_at, performed_by, item_id, expiry_tracking_id, destino_nome, notes')
    .eq('item_type', 'warehouse')
    .eq('direction', 'out')
    .eq('movement_type', 'SAIDA_AVULSA')
    .eq('source_location_id', locationId)
    .order('performed_at', { ascending: false })
    .limit(1000)

  if (filters.dateFrom) query = query.gte('performed_at', `${filters.dateFrom}T00:00:00`)
  if (filters.dateTo) query = query.lte('performed_at', `${filters.dateTo}T23:59:59`)

  const { data, error } = await query
  if (error) throw error
  const movs = (data || []) as any[]
  if (movs.length === 0) return []

  // Nomes de item, lote/validade e usuário vêm de tabelas satélites.
  const itemIds = [...new Set(movs.map((m) => m.item_id).filter(Boolean))]
  const lotIds = [...new Set(movs.map((m) => m.expiry_tracking_id).filter(Boolean))]
  const userIds = [...new Set(movs.map((m) => m.performed_by).filter(Boolean))]

  const [items, lotes, users] = await Promise.all([
    itemIds.length
      ? supabase.from('warehouse_items').select('id, name, code, unit').in('id', itemIds)
      : Promise.resolve({ data: [] as any[] }),
    lotIds.length
      ? supabase.from('expiry_tracking').select('id, batch_number, expiry_date').in('id', lotIds)
      : Promise.resolve({ data: [] as any[] }),
    userIds.length
      ? supabase.from('users').select('id, full_name').in('id', userIds)
      : Promise.resolve({ data: [] as any[] }),
  ])
  const itemMap = new Map((items.data || []).map((x: any) => [x.id, x]))
  const lotMap = new Map((lotes.data || []).map((x: any) => [x.id, x]))
  const userMap = new Map((users.data || []).map((x: any) => [x.id, x.full_name]))

  // Agrupa por operação: mesmo instante + mesmo setor de destino + mesmo usuário.
  const groups = new Map<string, PharmacyDispensation>()
  for (const m of movs) {
    const setor = m.destino_nome || '—'
    const key = `${m.performed_at}|${setor}|${m.performed_by ?? ''}`
    let g = groups.get(key)
    if (!g) {
      g = {
        id: key,
        // Numeração só para exibição — material não tem sequência própria;
        // preenchida depois, do mais recente para o mais antigo.
        dispensation_number: 0,
        tipo: 'requisicao',
        patient_name: setor,
        medical_record_number: null,
        prescribing_doctor: null,
        sector: setor,
        notes: m.notes ?? undefined,
        status: 'completed',
        created_by: m.performed_by ?? '',
        created_by_name: userMap.get(m.performed_by) || 'Desconhecido',
        created_at: m.performed_at,
        items: [],
      }
      groups.set(key, g)
    }
    const lot = m.expiry_tracking_id ? lotMap.get(m.expiry_tracking_id) : null
    g.items.push({
      id: m.id,
      item_id: m.item_id,
      item_name: itemMap.get(m.item_id)?.name || '(item removido)',
      item_code: itemMap.get(m.item_id)?.code || '',
      item_unit: itemMap.get(m.item_id)?.unit || 'UN',
      quantity: m.quantity,
      expiry_tracking_id: m.expiry_tracking_id ?? null,
      batch_number: lot?.batch_number ?? null,
      expiry_date: lot?.expiry_date ?? null,
    })
  }

  let results = [...groups.values()]
  results.forEach((d, i) => { d.dispensation_number = results.length - i })

  // Busca client-side, igual ao caminho de medicamento: setor, responsável
  // ou nome/código de qualquer item da operação.
  const q = filters.search?.trim().toLowerCase()
  if (q) {
    results = results.filter(
      (d) =>
        (d.sector || '').toLowerCase().includes(q) ||
        (d.created_by_name || '').toLowerCase().includes(q) ||
        d.items.some(
          (i) =>
            i.item_name.toLowerCase().includes(q) ||
            (i.item_code || '').toLowerCase().includes(q),
        ),
    )
  }

  return results
}

// =====================================================================
// Carrega UMA dispensacao de material a partir da chave sintetica que
// loadMaterialDispensations monta (`performed_at|setor|usuario`). A tela de
// detalhe recebe esse valor na URL; como nao ha registro em
// pharmacy_dispensations, ela precisa vir por aqui.
// =====================================================================
export function isMaterialDispensationId(id: string): boolean {
  // A chave sintetica sempre tem as duas barras verticais; um UUID nunca tem.
  return id.includes('|')
}

export async function loadMaterialDispensationById(
  locationId: string,
  id: string,
): Promise<PharmacyDispensation | null> {
  const [performedAt] = id.split('|')
  if (!performedAt) return null
  // Busca pelo instante exato e depois casa a chave inteira — assim o setor e
  // o usuario tambem batem, sem depender de escapar caractere na consulta.
  const todas = await loadMaterialDispensations(locationId, {
    dateFrom: performedAt.slice(0, 10),
    dateTo: performedAt.slice(0, 10),
  })
  return todas.find((d) => d.id === id) ?? null
}
