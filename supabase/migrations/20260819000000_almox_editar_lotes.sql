-- Editar lotes de um MATERIAL direto na tela de edição do item.
-- Irmã da farmacia_editar_lotes, porém para item_type='warehouse': recebe o item
-- e um array de lotes (novos, alterados e marcados para remover), aplica em
-- expiry_tracking e RECALCULA item_stocks (por local) — tudo numa transação.
--
-- SECURITY DEFINER para funcionar com a chave anon (o controle de papel é feito
-- aqui dentro). Não toca em nada de farmácia/medicamento.
--
-- DIFERENÇA CRÍTICA em relação à farmacia_editar_lotes: esta função NÃO
-- atualiza warehouse_items.current_stock. No medicamento o saldo global é a
-- soma dos lotes; no material o current_stock é o saldo do ALMOXARIFADO, e os
-- lotes só existem no satélite (Satélite Térreo). Recalcular esse campo pela
-- soma dos lotes ZERARIA o estoque do almoxarifado inteiro. O campo fica
-- intocado de propósito.
CREATE OR REPLACE FUNCTION public.almox_editar_lotes(p_item_id uuid, p_lots jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  it jsonb;
  v_qty integer;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  select role into v_role from public.users where id = v_uid;
  if coalesce(v_role,'') not in ('administrador','gestor','atendente','pharmacist','admin','manager') then
    raise exception 'Sem permissao para editar lotes.';
  end if;
  if not exists (select 1 from public.warehouse_items where id = p_item_id) then
    raise exception 'Material invalido.';
  end if;

  for it in select value from jsonb_array_elements(coalesce(p_lots, '[]'::jsonb))
  loop
    v_qty := coalesce(nullif(it->>'quantity','')::integer, 0);
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
        v_qty, v_qty, (it->>'location_id')::uuid, v_uid);
    end if;
  end loop;

  -- Recalcula item_stocks (warehouse) para todo local que tenha lote OU linha de
  -- estoque deste item (assim locais que zeraram tambem ficam corretos).
  insert into public.item_stocks(item_id, item_type, location_id, quantity)
  select p_item_id, 'warehouse', sl.id,
         coalesce((select sum(current_quantity) from public.expiry_tracking et
                   where et.item_id = p_item_id and et.location_id = sl.id), 0)
  from public.stock_locations sl
  where sl.id in (
     select location_id from public.expiry_tracking where item_id = p_item_id and location_id is not null
     union
     select location_id from public.item_stocks where item_id = p_item_id and item_type = 'warehouse' and location_id is not null
  )
  on conflict (item_id, item_type, location_id)
  do update set quantity = excluded.quantity, updated_at = now();

  -- NAO ha update em warehouse_items.current_stock aqui — ver comentario do topo.

  return jsonb_build_object('ok', true, 'item_id', p_item_id);
exception
  when foreign_key_violation then
    raise exception 'Nao da para excluir um lote que ja foi usado em movimentacao. Zere a quantidade em vez de excluir.';
end $$;

GRANT EXECUTE ON FUNCTION public.almox_editar_lotes(uuid, jsonb) TO authenticated;
