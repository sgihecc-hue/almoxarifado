-- =============================================================================
-- CONFERENCIA DE MATERIAL DA SATELITE TERREO com limite e trava
-- (auditoria de 28/09/2026 — achado M7)
--
-- confirmar_recebimento_material nao conferia nada: nao olhava o status do
-- pedido, nao travava a linha (duas abas creditavam duas vezes), nao limitava
-- o recebido ao fornecido e nao gravava movimento. Dados: 54 itens recebidos
-- acima do fornecido (+79.520 un). Ex.: gaze "pacote com 10" fornecido 400,
-- recebido 40.000 (fator 100 em vez de 10). A conversao e legitima — o almox
-- fornece caixa/pacote e a satelite conta unidade (luva: 30 cx -> 3.000 un) —
-- mas era livre e invisivel.
--
-- AGORA:
--   * cada item do pedido e conferido UMA vez (indice unico em
--     material_receipts.request_item_id + checagem com a linha travada);
--   * pedido travado (FOR UPDATE), tem de ser de material, ja entregue pelo
--     almox (delivered/completed) e do setor dono do estoque que recebe;
--   * o fator de conversao e EXPLICITO (fator_conversao, 1 a 1000; padrao 1) e
--     recebido <= fornecido x fator. A tela mostra "400 PCT x 10 = 4.000 UN" e
--     pede confirmacao quando o fator nao e 1;
--   * a entrada vira movimento (stock_movements SOLICITACAO/in no local), como
--     a entrada do satelite da farmacia; o gatilho fn_apply_stock_movement
--     credita item_stocks do local (antes: upsert direto, sem historico).
-- NAO corrige os 54 recebimentos ja lancados acima do fornecido (decisao do dono).
-- =============================================================================

alter table public.material_receipts
  add column if not exists fator_conversao integer not null default 1,
  add column if not exists quantidade_fornecida integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'material_receipts_fator_conversao_check') then
    alter table public.material_receipts
      add constraint material_receipts_fator_conversao_check check (fator_conversao between 1 and 1000);
  end if;
end $$;
create unique index if not exists material_receipts_request_item_unico
  on public.material_receipts (request_item_id) where request_item_id is not null;

-- Grava so pela RPC (a policy de INSERT deixava marcar item como recebido sem
-- creditar estoque nenhum).
drop policy if exists material_receipts_insert on public.material_receipts;

create or replace function public.confirmar_recebimento_material(p_request_id uuid, p_location_code text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_location_id uuid;
  v_req public.requests%rowtype;
  v_dept text;
  v_dono uuid;
  it jsonb;
  v_ri uuid;
  v_item_id uuid;
  v_txt text;
  v_qty integer;
  v_fator integer;
  v_forn integer;
  v_batch text;
  v_expiry date;
  v_unit text;
  v_et_id uuid;
  v_count integer := 0;
  r record;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;

  select role into v_role from public.users where id = v_uid;
  if coalesce(v_role,'') not in ('administrador','gestor','atendente','pharmacist','admin','manager') then
    raise exception 'Sem permissao para confirmar recebimento de material.';
  end if;

  select id into v_location_id from public.stock_locations where code = p_location_code;
  if v_location_id is null then
    raise exception 'Local de estoque "%" nao encontrado.', p_location_code;
  end if;

  select * into v_req from public.requests where id = p_request_id for update;
  if v_req.id is null then raise exception 'Pedido nao encontrado.'; end if;
  if v_req.type <> 'warehouse' then raise exception 'Este pedido nao e de material.'; end if;
  if v_req.status not in ('delivered', 'completed') then
    raise exception 'O almoxarifado ainda nao entregou este pedido (agora esta %).', public.fn_status_rotulo(v_req.status);
  end if;

  -- O pedido tem de ser do setor dono do estoque que recebe (mesma regra da
  -- tela: departmentBelongsToStock e a entrada em satelite da farmacia).
  select lower(name) into v_dept from public.departments where id = v_req.department_id;
  v_dono := null;
  if coalesce(v_dept, '') ~* 'sat.?lite' then
    if v_dept ~* 't.rreo' then select id into v_dono from public.stock_locations where code = 'SAT_T';
    elsif v_dept ~ '1' then select id into v_dono from public.stock_locations where code = 'SAT_1';
    elsif v_dept ~ '2' then select id into v_dono from public.stock_locations where code = 'SAT_2';
    end if;
  end if;
  if v_dono is distinct from v_location_id then
    raise exception 'Este pedido nao e do setor dono do estoque %.', p_location_code;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Nenhum item conferido.';
  end if;

  for it in select value from jsonb_array_elements(p_items)
  loop
    v_ri      := nullif(it->>'request_item_id','')::uuid;
    v_item_id := nullif(it->>'item_id','')::uuid;
    v_batch   := nullif(trim(coalesce(it->>'batch_number','')), '');
    v_expiry  := nullif(it->>'expiry_date','')::date;
    v_unit    := nullif(trim(coalesce(it->>'unit','')), '');
    v_et_id   := null;

    if v_ri is null then raise exception 'Item da conferencia sem identificacao do pedido.'; end if;

    select ri.id, ri.warehouse_item_id, ri.item_name, ri.supplied_quantity, ri.approved_quantity, ri.quantity,
           w.unit as unidade_almox
      into r
      from public.request_items ri
      join public.warehouse_items w on w.id = ri.warehouse_item_id
     where ri.id = v_ri and ri.request_id = p_request_id
     for update of ri;
    if not found then raise exception 'Item nao pertence a este pedido.'; end if;
    if v_item_id is not null and v_item_id is distinct from r.warehouse_item_id then
      raise exception 'Item da conferencia nao confere com o item do pedido.';
    end if;
    v_item_id := r.warehouse_item_id;

    if exists (select 1 from public.material_receipts where request_item_id = v_ri) then
      raise exception 'O item "%" ja foi conferido. Recarregue a pagina.', r.item_name;
    end if;

    v_txt := btrim(coalesce(it->>'quantity', ''));
    if v_txt !~ '^\d+$' then
      raise exception 'Quantidade recebida invalida em "%": use numero inteiro.', r.item_name;
    end if;
    v_qty := v_txt::integer;
    if v_qty <= 0 then
      raise exception 'Quantidade recebida deve ser maior que zero ("%").', r.item_name;
    end if;

    v_txt := btrim(coalesce(it->>'fator', '1'));
    if v_txt !~ '^\d+$' then raise exception 'Fator de conversao invalido em "%".', r.item_name; end if;
    v_fator := v_txt::integer;
    if v_fator < 1 or v_fator > 1000 then
      raise exception 'Fator de conversao de "%" deve ser de 1 a 1000.', r.item_name;
    end if;

    -- O que o almoxarifado declarou ter entregue (o mesmo numero que a tela
    -- mostra como "almox. informou").
    v_forn := coalesce(r.supplied_quantity, r.approved_quantity, r.quantity);
    if coalesce(v_forn, 0) <= 0 then
      raise exception 'O almoxarifado nao forneceu "%": nao ha o que receber.', r.item_name;
    end if;
    if v_qty > v_forn * v_fator then
      raise exception 'Recebido de "%" (%) maior que o fornecido pelo almoxarifado (% % x % = %). Confira a contagem ou o fator de conversao.',
        r.item_name, v_qty, v_forn, coalesce(r.unidade_almox, 'UN'), v_fator, v_forn * v_fator;
    end if;

    -- Lote: se veio informado, soma no lote existente daquele LOCAL; se nao
    -- existir, cria. Sem lote informado, so o saldo do local e creditado.
    if v_batch is not null then
      select id into v_et_id
        from public.expiry_tracking
       where item_id = v_item_id
         and location_id = v_location_id
         and batch_number = v_batch
       limit 1
       for update;

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

    -- Entrada no saldo DO LOCAL via movimento (fn_apply_stock_movement credita
    -- item_stocks). Nao mexe em warehouse_items: a baixa do almoxarifado ja
    -- aconteceu na entrega.
    insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
      target_location_id, request_id, performed_by, notes, expiry_tracking_id)
    values (v_item_id, 'warehouse', 'SOLICITACAO', 'in', v_qty, v_location_id, p_request_id, v_uid,
      'Recebimento do almoxarifado (pedido ' || v_req.request_number || ')'
        || case when v_fator <> 1 then ' - ' || v_forn || ' x ' || v_fator else '' end,
      v_et_id);

    if v_unit is not null then
      update public.item_stocks set unit = v_unit
       where item_id = v_item_id and item_type = 'warehouse' and location_id = v_location_id;
    end if;

    insert into public.material_receipts(request_id, request_item_id, item_id,
      location_id, quantity, unit, batch_number, expiry_date, expiry_tracking_id,
      received_by, notes, fator_conversao, quantidade_fornecida)
    values (p_request_id, v_ri, v_item_id,
      v_location_id, v_qty, v_unit, v_batch, v_expiry, v_et_id,
      v_uid, nullif(it->>'notes',''), v_fator, v_forn);

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'request_id', p_request_id,
                            'location_id', v_location_id, 'itens', v_count);
end $function$;
revoke execute on function public.confirmar_recebimento_material(uuid, text, jsonb) from public, anon;
grant execute on function public.confirmar_recebimento_material(uuid, text, jsonb) to authenticated;
