-- Lotes do ALMOXARIFADO central editaveis pela janela "Editar item" (Anderson,
-- 16/10/2026: adicionar lote e validade). Os lotes do ALMOX sao copia
-- informativa (o saldo e warehouse_items.current_stock), entao nada de saldo
-- muda aqui. O que muda: quando o RPC mexe em lote do ALMOX e recebe motivo,
-- registra em almox_item_edicoes (quem, quando, motivo, lotes enviados).
-- Satelite Terreo e farmacia: comportamento identico ao anterior.
create or replace function public.almox_editar_lotes(p_item_id uuid, p_lots jsonb, p_motivo text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid;
  it jsonb;
  v_qty integer;
  v_almox uuid;
  v_loc uuid;
  v_locs uuid[] := '{}';
  v_mod text;
  v_ajustes integer := 0;
  v_mexeu_almox boolean := false;
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
    if v_loc is null or v_loc = v_almox then v_mexeu_almox := true; end if;
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

  -- Historico do item quando mexeu em lote do ALMOX com motivo.
  if v_mexeu_almox and coalesce(length(btrim(p_motivo)), 0) > 0 then
    insert into public.almox_item_edicoes(item_id, item_nome, item_codigo, usuario_id, usuario_nome, usuario_perfil, motivo, alteracoes)
    select w.id, w.name, w.code, v_uid, u.full_name, u.role, btrim(p_motivo),
           jsonb_build_object('lotes', p_lots)
      from public.warehouse_items w
      left join public.users u on u.id = v_uid
     where w.id = p_item_id;
  end if;

  return jsonb_build_object('ok', true, 'item_id', p_item_id,
                            'locais_recalculados', coalesce(array_length(v_locs,1),0),
                            'locais_ajustados', v_ajustes);
exception
  when foreign_key_violation then
    raise exception 'Nao da para excluir um lote que ja foi usado em movimentacao. Zere a quantidade em vez de excluir.';
end $function$;
