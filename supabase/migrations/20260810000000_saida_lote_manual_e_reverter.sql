-- =====================================================================
-- Farmácia — Saída avulsa: (1) permitir DIGITAR o lote (lote que já não
-- existe mais → cria o lote e debita, podendo ficar negativo/FA5); e
-- (2) reverter/cancelar uma saída, devolvendo ao lote/estoque de origem.
-- Só afeta o ramo de FARMÁCIA. Almoxarifado (warehouse) fica idêntico.
-- =====================================================================

-- ---- registrar_saida_lote (8-arg, a que o frontend usa) ----
-- Novidades: cada item pode trazer batch_number/expiry_date. Se vier lote
-- manual (sem expiry_tracking_id, mas com número), acha-ou-cria o lote no
-- local e debita. Farmácia permite saldo negativo do lote (FA5).
CREATE OR REPLACE FUNCTION public.registrar_saida_lote(
  p_item_type text, p_reason text, p_items jsonb,
  p_reason_detail text DEFAULT NULL::text, p_notes text DEFAULT NULL::text,
  p_location_code text DEFAULT NULL::text,
  p_destino_tipo text DEFAULT NULL::text, p_destino_nome text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_role text; v_code text; v_loc uuid; it jsonb;
  v_item uuid; v_qty integer; v_lot uuid; v_newqty integer; v_cur integer; v_mtype text;
  v_batch text; v_val date;
  v_count integer := 0; v_total_qty integer := 0;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  if p_item_type not in ('pharmacy','warehouse') then raise exception 'item_type invalido: %', p_item_type; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Saida sem itens.'; end if;
  if coalesce(btrim(coalesce(p_reason,'')),'') = '' then raise exception 'Motivo da saida e obrigatorio.'; end if;

  select role into v_role from public.users where id = v_uid;
  if coalesce(v_role,'') not in ('administrador','gestor','atendente','pharmacist','admin','manager','warehouse_manager') then
    raise exception 'Sem permissao para registrar saida.';
  end if;

  v_code := coalesce(nullif(btrim(coalesce(p_location_code,'')),''),
                     case when p_item_type='pharmacy' then 'CAF' else 'ALMOX' end);
  select id into v_loc from public.stock_locations where code = v_code;
  if v_loc is null then raise exception 'Local % nao encontrado.', v_code; end if;

  v_mtype := case when p_reason = 'transferencia' then 'TRANSFERENCIA' else 'SAIDA_AVULSA' end;

  for it in select value from jsonb_array_elements(p_items)
  loop
    v_item := (it->>'item_id')::uuid;
    v_qty  := (it->>'quantity')::integer;
    v_lot  := nullif(it->>'expiry_tracking_id','')::uuid;
    v_batch:= nullif(btrim(coalesce(it->>'batch_number','')),'');
    v_val  := nullif(it->>'expiry_date','')::date;
    if v_item is null then raise exception 'Linha sem item.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade invalida em uma das linhas.'; end if;

    if p_item_type = 'pharmacy' then
      -- Lote manual: sem id mas com número → acha ou cria o lote NESTE local.
      if v_lot is null and v_batch is not null then
        select id into v_lot from public.expiry_tracking
          where item_id = v_item and location_id = v_loc and batch_number = v_batch
          order by expiry_date nulls last limit 1;
        if v_lot is null then
          insert into public.expiry_tracking(item_id, batch_number, expiry_date,
            initial_quantity, current_quantity, location_id, created_by)
          values (v_item, v_batch, v_val, 0, 0, v_loc, v_uid)
          returning id into v_lot;
        end if;
      end if;

      insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
        source_location_id, reason, reason_detail, destino_tipo, destino_nome, expiry_tracking_id, performed_by, notes)
      values (v_item, 'pharmacy', v_mtype, 'out', v_qty, v_loc, p_reason, p_reason_detail,
        p_destino_tipo, p_destino_nome, v_lot, v_uid, p_notes);

      if v_lot is not null then
        update public.expiry_tracking set current_quantity = current_quantity - v_qty
          where id = v_lot and location_id = v_loc returning current_quantity into v_newqty;
        if not found then raise exception 'Lote informado nao pertence ao estoque % (isolamento por local).', v_code; end if;
        -- FA5: farmácia permite o lote ficar negativo (lote já consumido/nao lançado). Sem bloqueio.
      end if;
    else
      select current_stock into v_cur from public.warehouse_items where id = v_item for update;
      if v_cur is null then raise exception 'Item de almoxarifado nao encontrado.'; end if;
      if v_cur < v_qty then raise exception 'Saldo insuficiente no almoxarifado para um dos itens.'; end if;
      update public.warehouse_items set current_stock = current_stock - v_qty, updated_at = now() where id = v_item;
    end if;

    v_count := v_count + 1; v_total_qty := v_total_qty + v_qty;
  end loop;

  return jsonb_build_object('itens', v_count, 'quantidade_total', v_total_qty, 'local', v_code, 'motivo', p_reason);
end $function$;


-- ---- farmacia_reverter_saida: cancela uma saída avulsa e devolve ao estoque ----
CREATE OR REPLACE FUNCTION public.farmacia_reverter_saida(p_movement_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  m record;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  select role into v_role from public.users where id = v_uid;
  if coalesce(v_role,'') not in ('administrador','gestor','atendente','pharmacist','admin','manager') then
    raise exception 'Sem permissao para reverter saida.';
  end if;

  select * into m from public.stock_movements where id = p_movement_id;
  if not found then raise exception 'Saida nao encontrada.'; end if;
  if m.item_type <> 'pharmacy' then raise exception 'Reversao disponivel apenas para saidas de farmacia.'; end if;
  if m.direction <> 'out' or m.movement_type not in ('SAIDA_AVULSA','TRANSFERENCIA') then
    raise exception 'So e possivel reverter saidas avulsas.';
  end if;
  if exists (select 1 from public.stock_movements where linked_movement_id = p_movement_id) then
    raise exception 'Esta saida ja foi revertida.';
  end if;

  -- Movimento de compensacao (entrada) → o trigger credita item_stocks no local de origem.
  insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
    target_location_id, reason, reason_detail, expiry_tracking_id, linked_movement_id, performed_by, notes)
  values (m.item_id, 'pharmacy', 'DEVOLUCAO_INT', 'in', m.quantity,
    m.source_location_id, null, 'Estorno de saida avulsa', m.expiry_tracking_id, m.id, v_uid,
    'Reversao da saida ' || p_movement_id::text);

  -- Devolve ao lote de origem (se ainda existe). item_stocks já foi creditado pelo trigger.
  if m.expiry_tracking_id is not null then
    update public.expiry_tracking set current_quantity = current_quantity + m.quantity
      where id = m.expiry_tracking_id;
  end if;

  -- Mantem o saldo global do item coerente com a soma dos locais.
  update public.pharmacy_items p
    set current_stock = coalesce((select sum(quantity) from public.item_stocks s
                                  where s.item_id = p.id and s.item_type = 'pharmacy'), 0),
        updated_at = now()
  where p.id = m.item_id;

  return jsonb_build_object('ok', true, 'item_id', m.item_id, 'quantidade', m.quantity);
end $function$;

GRANT EXECUTE ON FUNCTION public.farmacia_reverter_saida(uuid) TO authenticated;
