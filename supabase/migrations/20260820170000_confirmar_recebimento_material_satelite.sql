-- Confirmação de recebimento de MATERIAL na Farmácia Satélite Térreo.
--
-- Quando o almoxarifado entrega um pedido pra Satélite Térreo, quem recebe
-- confere item a item e registra LOTE, VALIDADE e QUANTIDADE REAL que chegou.
-- Esse registro credita o estoque DO LOCAL (item_stocks + expiry_tracking) e
-- guarda o histórico em material_receipts.
--
-- ESCOPO — leia antes de mexer: este fluxo NÃO É o do almoxarifado. Nada aqui
-- escreve em warehouse_items (current_stock é o saldo do ALMOXARIFADO), nem em
-- requests, nem em request_items. A baixa do lado do almoxarifado é outro
-- fluxo, com outras funções; misturar os dois já causou zeragem de estoque no
-- passado. Aqui só se CREDITA o satélite e se REGISTRA o recebimento.
--
-- UNIDADE: almoxarifado trabalha em caixa/pacote, o satélite em unidade. Não
-- existe fator de conversão automático de propósito — embalagem de fornecedor
-- muda e o fator cadastrado passa a mentir. Quem recebe digita a quantidade
-- real na unidade dele, e a unidade do local fica em item_stocks.unit.

-- 1) Unidade por local. Nula = usa a unidade do catálogo (comportamento atual;
--    quem não preencher não vê diferença nenhuma).
ALTER TABLE public.item_stocks ADD COLUMN IF NOT EXISTS unit text;

COMMENT ON COLUMN item_stocks.unit IS
  'Unidade do item NAQUELE local (ex.: UN na Satelite Terreo enquanto o almox usa CX). Nula = cai na unidade do catalogo.';

-- 2) Histórico de recebimentos. Uma linha por item conferido.
CREATE TABLE IF NOT EXISTS public.material_receipts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid REFERENCES public.requests(id),
  request_item_id    uuid REFERENCES public.request_items(id),
  item_id            uuid NOT NULL REFERENCES public.warehouse_items(id),
  location_id        uuid NOT NULL REFERENCES public.stock_locations(id),
  quantity           integer NOT NULL CHECK (quantity > 0),
  unit               text,
  batch_number       text,
  expiry_date        date,
  expiry_tracking_id uuid REFERENCES public.expiry_tracking(id),
  received_by        uuid REFERENCES auth.users(id),
  received_at        timestamptz NOT NULL DEFAULT now(),
  notes              text
);

COMMENT ON TABLE public.material_receipts IS
  'Recebimento de material conferido pelo satelite (lote/validade/qtd real). Nao substitui a baixa do almoxarifado — e o registro do lado de quem recebe.';

CREATE INDEX IF NOT EXISTS idx_material_receipts_request
  ON public.material_receipts(request_id);
CREATE INDEX IF NOT EXISTS idx_material_receipts_location_data
  ON public.material_receipts(location_id, received_at DESC);

ALTER TABLE public.material_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "material_receipts_select" ON public.material_receipts;
CREATE POLICY "material_receipts_select" ON public.material_receipts
  FOR SELECT TO authenticated
  USING (true);

-- Mesmos papéis que já editam lote de material (ver almox_editar_lotes).
DROP POLICY IF EXISTS "material_receipts_insert" ON public.material_receipts;
CREATE POLICY "material_receipts_insert" ON public.material_receipts
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_user_role() IN ('administrador', 'gestor', 'atendente', 'pharmacist', 'admin', 'manager')
  );

-- 3) RPC que aplica a conferência inteira numa transação só.
--    p_items: [{ request_item_id, item_id, quantity, batch_number, expiry_date, unit }]
--    batch_number, expiry_date e unit são opcionais.
CREATE OR REPLACE FUNCTION public.confirmar_recebimento_material(
  p_request_id uuid,
  p_location_code text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_location_id uuid;
  it jsonb;
  v_item_id uuid;
  v_qty integer;
  v_batch text;
  v_expiry date;
  v_unit text;
  v_et_id uuid;
  v_count integer := 0;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;

  select role into v_role from public.users where id = v_uid;
  if coalesce(v_role,'') not in ('administrador','gestor','atendente','pharmacist','admin','manager') then
    raise exception 'Sem permissao para confirmar recebimento de material.';
  end if;

  -- O local vem pelo CODIGO (SAT_T, etc) — nunca chumbado aqui dentro.
  select id into v_location_id from public.stock_locations where code = p_location_code;
  if v_location_id is null then
    raise exception 'Local de estoque "%" nao encontrado.', p_location_code;
  end if;

  for it in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_item_id := nullif(it->>'item_id','')::uuid;
    v_qty     := coalesce(nullif(it->>'quantity','')::integer, 0);
    v_batch   := nullif(trim(coalesce(it->>'batch_number','')), '');
    v_expiry  := nullif(it->>'expiry_date','')::date;
    v_unit    := nullif(trim(coalesce(it->>'unit','')), '');
    v_et_id   := null;

    if v_item_id is null then
      raise exception 'Item invalido na conferencia (item_id ausente).';
    end if;
    if v_qty <= 0 then
      raise exception 'Quantidade recebida deve ser maior que zero (item %).', v_item_id;
    end if;

    -- Lote: se veio informado, soma no lote existente daquele LOCAL; se nao
    -- existir, cria. Sem lote informado, so o saldo do local e creditado.
    if v_batch is not null then
      select id into v_et_id
        from public.expiry_tracking
       where item_id = v_item_id
         and location_id = v_location_id
         and batch_number = v_batch
       limit 1;

      if v_et_id is null then
        insert into public.expiry_tracking(item_id, batch_number, expiry_date,
          initial_quantity, current_quantity, location_id, created_by)
        values (v_item_id, v_batch, v_expiry, v_qty, v_qty, v_location_id, v_uid)
        returning id into v_et_id;
      else
        update public.expiry_tracking
           set current_quantity = coalesce(current_quantity, 0) + v_qty,
               expiry_date = coalesce(v_expiry, expiry_date)
         where id = v_et_id;
      end if;
    end if;

    -- Credita o saldo DO LOCAL. A unidade so e gravada quando veio preenchida
    -- (coalesce mantem a que ja estava se o formulario nao mandar nada).
    insert into public.item_stocks(item_id, item_type, location_id, quantity, unit)
    values (v_item_id, 'warehouse', v_location_id, v_qty, v_unit)
    on conflict (item_id, item_type, location_id)
    do update set quantity = coalesce(item_stocks.quantity, 0) + excluded.quantity,
                  unit = coalesce(excluded.unit, item_stocks.unit),
                  updated_at = now();

    insert into public.material_receipts(request_id, request_item_id, item_id,
      location_id, quantity, unit, batch_number, expiry_date, expiry_tracking_id,
      received_by, notes)
    values (p_request_id, nullif(it->>'request_item_id','')::uuid, v_item_id,
      v_location_id, v_qty, v_unit, v_batch, v_expiry, v_et_id,
      v_uid, nullif(it->>'notes',''));

    v_count := v_count + 1;
  end loop;

  -- Fim. NAO ha update em warehouse_items, requests ou request_items — o saldo
  -- do almoxarifado e o ciclo de vida do pedido sao outro fluxo (ver topo).
  return jsonb_build_object('ok', true, 'request_id', p_request_id,
                            'location_id', v_location_id, 'itens', v_count);
end $$;

GRANT EXECUTE ON FUNCTION public.confirmar_recebimento_material(uuid, text, jsonb) TO authenticated;
