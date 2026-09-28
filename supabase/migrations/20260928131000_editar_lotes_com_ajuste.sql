-- =============================================================================
-- EDITAR LOTES gera movimento de AJUSTE (auditoria 28/09/2026 — F8)
--
-- ANTES: farmacia_editar_lotes / almox_editar_lotes reescreviam item_stocks
-- como "soma dos lotes" direto, sem movimento: o saldo mudava sem aparecer no
-- livro-razao, sem quem nem por que. farmacia_editar_lotes ainda gravava
-- pharmacy_items.current_stock como soma de TODOS os locais (o sincronismo
-- oficial espelha so o CAF). expiry_tracking nao tinha auditoria.
-- AGORA:
--   * a diferenca de cada local vira um movimento AJUSTE (entrada ou saida)
--     com quem fez e o motivo (p_motivo, opcional — padrao "Edicao de lotes");
--     o gatilho do livro-razao aplica o delta e o CAF espelha em current_stock.
--   * ALMOX: o saldo oficial e warehouse_items.current_stock (modelo legado);
--     o item_stocks(ALMOX) e so uma copia e continua sendo recalculado direto
--     (nao e saldo). Satelite Terreo (material) passa a ter AJUSTE.
--   * expiry_tracking ganha auditoria (audit_logs) de insert/update/delete.
--   * papel + modulo conferidos.
-- Assinatura compativel: (p_item_id, p_lots) continua funcionando.
-- =============================================================================

drop trigger if exists audit_expiry_tracking on public.expiry_tracking;
create trigger audit_expiry_tracking after insert or update or delete on public.expiry_tracking
  for each row execute function public.audit_log_changes();

-- Aplica a diferenca (soma dos lotes - saldo) de um local como AJUSTE.
create or replace function public.fn_saidas_ajustar_local_pela_soma_dos_lotes(
  p_item uuid, p_item_type text, p_local uuid, p_uid uuid, p_motivo text)
returns integer
language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare
  v_soma integer;
  v_saldo integer;
  v_delta integer;
begin
  select coalesce(sum(current_quantity), 0) into v_soma from public.expiry_tracking
   where item_id = p_item and location_id = p_local;
  select quantity into v_saldo from public.item_stocks
   where item_id = p_item and item_type = p_item_type and location_id = p_local for update;
  v_delta := v_soma - coalesce(v_saldo, 0);
  if v_delta = 0 then return 0; end if;
  insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
    source_location_id, target_location_id, reason, reason_detail, performed_by, notes)
  values (p_item, p_item_type, 'AJUSTE', case when v_delta > 0 then 'in' else 'out' end, abs(v_delta),
    case when v_delta < 0 then p_local end, case when v_delta > 0 then p_local end,
    case when v_delta < 0 then 'ajuste_inventario' end,
    'Edicao de lotes', p_uid, coalesce(nullif(btrim(p_motivo),''), 'Edicao de lotes'));
  return v_delta;
end $f$;
revoke execute on function public.fn_saidas_ajustar_local_pela_soma_dos_lotes(uuid, text, uuid, uuid, text) from public, anon, authenticated;

drop function if exists public.farmacia_editar_lotes(uuid, jsonb);
create or replace function public.farmacia_editar_lotes(p_item_id uuid, p_lots jsonb, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_uid uuid;
  it jsonb;
  v_qty integer;
  v_loc uuid;
  v_locs uuid[] := '{}';
  v_ajustes integer := 0;
begin
  v_uid := public.fn_saidas_exigir_operador('farmacia');
  if not exists (select 1 from public.pharmacy_items where id = p_item_id) then
    raise exception 'Medicamento invalido.';
  end if;

  for it in select value from jsonb_array_elements(coalesce(p_lots, '[]'::jsonb))
  loop
    v_qty := coalesce(nullif(it->>'quantity','')::integer, 0);
    if v_qty < 0 then raise exception 'Quantidade de lote nao pode ser negativa.'; end if;
    if nullif(it->>'id','') is not null then
      select location_id into v_loc from public.expiry_tracking
       where id = (it->>'id')::uuid and item_id = p_item_id for update;
      if v_loc is not null then v_locs := v_locs || v_loc; end if;
    end if;
    if coalesce((it->>'deleted')::boolean, false) then
      if nullif(it->>'id','') is not null then
        delete from public.expiry_tracking where id = (it->>'id')::uuid and item_id = p_item_id;
      end if;
    elsif nullif(it->>'id','') is not null then
      update public.expiry_tracking set
        batch_number = nullif(it->>'batch_number',''),
        expiry_date  = nullif(it->>'expiry_date','')::date,
        current_quantity = v_qty
      where id = (it->>'id')::uuid and item_id = p_item_id;
    else
      if nullif(it->>'location_id','') is null then raise exception 'Informe o estoque do lote novo.'; end if;
      insert into public.expiry_tracking(item_id, batch_number, expiry_date,
        initial_quantity, current_quantity, location_id, created_by)
      values (p_item_id, nullif(it->>'batch_number',''), nullif(it->>'expiry_date','')::date,
        v_qty, v_qty, (it->>'location_id')::uuid, v_uid)
      returning location_id into v_loc;
      v_locs := v_locs || v_loc;
    end if;
  end loop;

  -- cada local tocado: saldo passa a ser a soma dos lotes, POR MOVIMENTO
  for v_loc in select distinct unnest(v_locs)
  loop
    if v_loc is not null and public.fn_saidas_ajustar_local_pela_soma_dos_lotes(p_item_id, 'pharmacy', v_loc, v_uid, p_motivo) <> 0 then
      v_ajustes := v_ajustes + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'item_id', p_item_id, 'locais_ajustados', v_ajustes);
exception
  when foreign_key_violation then
    raise exception 'Nao da para excluir um lote que ja foi usado em dispensacao ou movimentacao. Zere a quantidade em vez de excluir.';
end $f$;
revoke execute on function public.farmacia_editar_lotes(uuid, jsonb, text) from public, anon;
grant execute on function public.farmacia_editar_lotes(uuid, jsonb, text) to authenticated;

drop function if exists public.almox_editar_lotes(uuid, jsonb);
create or replace function public.almox_editar_lotes(p_item_id uuid, p_lots jsonb, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_uid uuid;
  it jsonb;
  v_qty integer;
  v_almox uuid;
  v_loc uuid;
  v_locs uuid[] := '{}';
  v_mod text;
  v_ajustes integer := 0;
begin
  if not exists (select 1 from public.warehouse_items where id = p_item_id) then
    raise exception 'Material invalido.';
  end if;
  select id into v_almox from public.stock_locations where code = 'ALMOX';

  -- modulo: lote do ALMOX = almoxarifado; lote do Satelite Terreo = farmacia
  for it in select value from jsonb_array_elements(coalesce(p_lots, '[]'::jsonb))
  loop
    if nullif(it->>'id','') is not null then
      select location_id into v_loc from public.expiry_tracking where id = (it->>'id')::uuid and item_id = p_item_id;
    else
      v_loc := coalesce(nullif(it->>'location_id','')::uuid, v_almox);
    end if;
    v_mod := case when v_loc is null or v_loc = v_almox then 'almoxarifado' else 'farmacia' end;
    v_uid := public.fn_saidas_exigir_operador(v_mod);
  end loop;
  if v_uid is null then v_uid := public.fn_saidas_exigir_operador('almoxarifado'); end if;

  for it in select value from jsonb_array_elements(coalesce(p_lots, '[]'::jsonb))
  loop
    v_qty := coalesce(nullif(it->>'quantity','')::integer, 0);
    if v_qty < 0 then raise exception 'Quantidade de lote nao pode ser negativa.'; end if;
    if nullif(it->>'id','') is not null then
      select location_id into v_loc
        from public.expiry_tracking where id = (it->>'id')::uuid and item_id = p_item_id for update;
      if v_loc is not null then v_locs := v_locs || v_loc; end if;
    end if;

    if coalesce((it->>'deleted')::boolean, false) then
      if nullif(it->>'id','') is not null then
        delete from public.expiry_tracking where id = (it->>'id')::uuid and item_id = p_item_id;
      end if;
    elsif nullif(it->>'id','') is not null then
      update public.expiry_tracking set
        batch_number = nullif(it->>'batch_number',''),
        expiry_date  = nullif(it->>'expiry_date','')::date,
        current_quantity = v_qty
      where id = (it->>'id')::uuid and item_id = p_item_id;
    else
      insert into public.expiry_tracking(item_id, batch_number, expiry_date,
        initial_quantity, current_quantity, location_id, created_by)
      values (p_item_id, nullif(it->>'batch_number',''), nullif(it->>'expiry_date','')::date,
        v_qty, v_qty, coalesce(nullif(it->>'location_id','')::uuid, v_almox), v_uid)
      returning location_id into v_loc;
      if v_loc is not null then v_locs := v_locs || v_loc; end if;
    end if;
  end loop;

  for v_loc in select distinct unnest(v_locs)
  loop
    continue when v_loc is null;
    if v_loc = v_almox then
      -- copia (nao e saldo): recalculo direto, como antes
      insert into public.item_stocks(item_id, item_type, location_id, quantity)
      values (p_item_id, 'warehouse', v_loc,
              coalesce((select sum(current_quantity) from public.expiry_tracking et
                         where et.item_id = p_item_id and et.location_id = v_loc), 0))
      on conflict (item_id, item_type, location_id)
      do update set quantity = excluded.quantity, updated_at = now();
    elsif public.fn_saidas_ajustar_local_pela_soma_dos_lotes(p_item_id, 'warehouse', v_loc, v_uid, p_motivo) <> 0 then
      v_ajustes := v_ajustes + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'item_id', p_item_id,
                            'locais_recalculados', coalesce(array_length(v_locs,1),0),
                            'locais_ajustados', v_ajustes);
exception
  when foreign_key_violation then
    raise exception 'Nao da para excluir um lote que ja foi usado em movimentacao. Zere a quantidade em vez de excluir.';
end $f$;
revoke execute on function public.almox_editar_lotes(uuid, jsonb, text) from public, anon;
grant execute on function public.almox_editar_lotes(uuid, jsonb, text) to authenticated;
