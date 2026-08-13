-- S3: Transferência satélite → CAF na "Registrar Saída".
-- Antes, a RPC de saída de 8 params marcava movimento TRANSFERENCIA e gravava
-- destino_tipo/destino_nome, mas NÃO creditava o estoque de destino — o item
-- saía do satélite e não entrava em lugar nenhum.
-- Agora, quando o motivo é 'transferencia' E o destino é um estoque interno
-- (destino_tipo='estoque_interno', destino_nome=code do local, ex.: 'CAF'),
-- a função também CREDITA o destino: cria o movimento de entrada e espelha o
-- lote (número/validade) no estoque de destino. Isolamento por lote/local
-- mantido. Farmácia apenas (satélite → CAF).
create or replace function public.registrar_saida_lote(
  p_item_type text, p_reason text, p_items jsonb,
  p_reason_detail text default null, p_notes text default null,
  p_location_code text default null, p_destino_tipo text default null, p_destino_nome text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text; v_code text; v_loc uuid; it jsonb;
  v_item uuid; v_qty integer; v_lot uuid; v_newqty integer; v_cur integer; v_mtype text;
  v_batch text; v_val date;
  -- Destino interno (transferência que credita outro estoque).
  v_dest uuid; v_dlot uuid; v_dbatch text; v_dval date;
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

  -- Transferência para estoque interno: resolve o destino uma vez.
  if v_mtype = 'TRANSFERENCIA' and p_destino_tipo = 'estoque_interno' then
    select id into v_dest from public.stock_locations where code = btrim(p_destino_nome);
    if v_dest is null then raise exception 'Estoque de destino % nao encontrado.', p_destino_nome; end if;
    if v_dest = v_loc then raise exception 'Origem e destino nao podem ser o mesmo estoque.'; end if;
  end if;

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

      -- S3: crédito no destino interno (ex.: satélite → CAF). Espelha o lote.
      if v_dest is not null and v_lot is not null then
        select batch_number, expiry_date into v_dbatch, v_dval
          from public.expiry_tracking where id = v_lot;
        select id into v_dlot from public.expiry_tracking
          where item_id = v_item and location_id = v_dest
            and batch_number is not distinct from v_dbatch
          order by expiry_date nulls last limit 1;
        if v_dlot is null then
          insert into public.expiry_tracking(item_id, batch_number, expiry_date,
            initial_quantity, current_quantity, location_id, created_by)
          values (v_item, v_dbatch, v_dval, 0, 0, v_dest, v_uid)
          returning id into v_dlot;
        end if;
        insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
          target_location_id, reason, reason_detail, destino_tipo, destino_nome, expiry_tracking_id, performed_by, notes)
        values (v_item, 'pharmacy', 'TRANSFERENCIA', 'in', v_qty, v_dest, p_reason, p_reason_detail,
          p_destino_tipo, p_destino_nome, v_dlot, v_uid, p_notes);
        update public.expiry_tracking set current_quantity = current_quantity + v_qty
          where id = v_dlot;
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
