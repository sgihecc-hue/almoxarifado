-- Isolamento de estoque na saída avulsa (registrar_saida_lote).
--
-- Bug: o ramo de FARMÁCIA debitava item_stocks no local certo (source_location_id
-- = v_loc), mas decrementava o lote (expiry_tracking) passado SEM checar se o lote
-- pertence àquele local. Como a tela de Registrar Saída listava lotes de todas as
-- farmácias, dava pra escolher um lote do CAF numa saída do Satélite — o saldo caía
-- no satélite mas o lote baixava no CAF (divergência item_stocks × expiry_tracking).
--
-- Correção: só decrementa o lote se `location_id = v_loc`. Não encontrando, erro.
-- Ramo de ALMOXARIFADO permanece IDÊNTICO (nenhum impacto no almox).
--
-- Aplico as DUAS sobrecargas existentes (6-arg legada e 8-arg usada pelo frontend).

-- ---- Sobrecarga 8-arg (a que o frontend chama) ----
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
  v_role text;
  v_code text;
  v_loc uuid;
  it jsonb;
  v_item uuid;
  v_qty integer;
  v_lot uuid;
  v_newqty integer;
  v_cur integer;
  v_mtype text;
  v_count integer := 0;
  v_total_qty integer := 0;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  if p_item_type not in ('pharmacy','warehouse') then raise exception 'item_type invalido: %', p_item_type; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Saida sem itens.'; end if;
  if coalesce(btrim(coalesce(p_reason,'')),'') = '' then raise exception 'Motivo da saida e obrigatorio.'; end if;

  select role into v_role from public.users where id = v_uid;
  if coalesce(v_role,'') not in ('administrador','gestor','atendente','admin','manager','pharmacist','warehouse_manager') then
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
    if v_item is null then raise exception 'Linha sem item.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade invalida em uma das linhas.'; end if;

    if p_item_type = 'pharmacy' then
      insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
        source_location_id, reason, reason_detail, destino_tipo, destino_nome, expiry_tracking_id, performed_by, notes)
      values (v_item, 'pharmacy', v_mtype, 'out', v_qty, v_loc, p_reason, p_reason_detail,
        p_destino_tipo, p_destino_nome, v_lot, v_uid, p_notes);
      if v_lot is not null then
        -- ISOLAMENTO: o lote tem que ser DESTE estoque (v_loc).
        update public.expiry_tracking set current_quantity = current_quantity - v_qty
          where id = v_lot and location_id = v_loc returning current_quantity into v_newqty;
        if not found then raise exception 'Lote informado nao pertence ao estoque % (isolamento por local).', v_code; end if;
        if v_newqty < 0 then raise exception 'Saldo do lote insuficiente.'; end if;
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

-- ---- Sobrecarga 6-arg (legada, mesma trava por consistência) ----
CREATE OR REPLACE FUNCTION public.registrar_saida_lote(
  p_item_type text, p_reason text, p_items jsonb,
  p_reason_detail text DEFAULT NULL::text, p_notes text DEFAULT NULL::text,
  p_location_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_code text;
  v_loc uuid;
  it jsonb;
  v_item uuid;
  v_qty integer;
  v_lot uuid;
  v_newqty integer;
  v_cur integer;
  v_count integer := 0;
  v_total_qty integer := 0;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  if p_item_type not in ('pharmacy','warehouse') then raise exception 'item_type invalido: %', p_item_type; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Saida sem itens.'; end if;
  if coalesce(btrim(coalesce(p_reason,'')),'') = '' then raise exception 'Motivo da saida e obrigatorio.'; end if;

  if v_uid is not null then
    select role into v_role from public.users where id = v_uid;
    if coalesce(v_role,'') not in ('administrador','gestor','atendente','admin','manager','pharmacist','warehouse_manager') then
      raise exception 'Sem permissao para registrar saida.';
    end if;
  end if;

  v_code := coalesce(nullif(btrim(coalesce(p_location_code,'')),''),
                     case when p_item_type='pharmacy' then 'CAF' else 'ALMOX' end);
  select id into v_loc from public.stock_locations where code = v_code;
  if v_loc is null then raise exception 'Local % nao encontrado.', v_code; end if;

  for it in select value from jsonb_array_elements(p_items)
  loop
    v_item := (it->>'item_id')::uuid;
    v_qty  := (it->>'quantity')::integer;
    v_lot  := nullif(it->>'expiry_tracking_id','')::uuid;
    if v_item is null then raise exception 'Linha sem item.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade invalida em uma das linhas.'; end if;

    if p_item_type = 'pharmacy' then
      insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
        source_location_id, reason, reason_detail, expiry_tracking_id, performed_by, notes)
      values (v_item, 'pharmacy', 'SAIDA_AVULSA', 'out', v_qty, v_loc, p_reason, p_reason_detail, v_lot, v_uid, p_notes);
      if v_lot is not null then
        -- ISOLAMENTO: o lote tem que ser DESTE estoque (v_loc).
        update public.expiry_tracking set current_quantity = current_quantity - v_qty
          where id = v_lot and location_id = v_loc returning current_quantity into v_newqty;
        if not found then raise exception 'Lote informado nao pertence ao estoque % (isolamento por local).', v_code; end if;
        if v_newqty < 0 then raise exception 'Saldo do lote insuficiente.'; end if;
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
