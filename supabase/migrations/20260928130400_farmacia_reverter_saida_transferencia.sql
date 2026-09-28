-- =============================================================================
-- REVERTER SAIDA da farmacia (auditoria 28/09/2026 — C4, M2)
--
-- C4: reverter uma TRANSFERENCIA satelite->CAF devolvia a quantidade a origem
--     mas NAO desfazia a entrada no destino nem o lote do destino: o item
--     ficava contado duas vezes (Piperacilina+Tazobactam 120 un, 18/08).
--     Agora a reversao de transferencia interna desfaz os dois lados: tira do
--     destino (saldo e lote, com trava e conferindo que o destino ainda tem) e
--     devolve a origem. Se o destino ja consumiu, a reversao e RECUSADA com o
--     saldo disponivel na mensagem.
--     Transferencias antigas nao tinham ligacao entre saida e entrada: a
--     entrada e achada pelo mesmo item, quantidade, instante (mesma transacao)
--     e tipo; se nao achar, recusa (nao reverte "meia" transferencia).
-- M2: reversao dupla possivel (sem trava). Agora trava o movimento original
--     (FOR UPDATE) e ha indice unico parcial: uma saida so tem UMA reversao.
--     O recalculo manual de pharmacy_items.current_stock (soma de TODOS os
--     locais) foi removido: o gatilho fn_sync_legacy_stock_columns ja espelha
--     o CAF, que e o que current_stock significa.
-- Papel/modulo: so farmacia.
-- =============================================================================

create unique index if not exists stock_movements_uma_reversao
  on public.stock_movements (linked_movement_id)
  where movement_type = 'DEVOLUCAO_INT' and linked_movement_id is not null;

create or replace function public.farmacia_reverter_saida(p_movement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_uid uuid;
  m record;
  e record;
  v_saldo integer;
  v_lote_q integer;
  v_nome text;
  v_dest_code text;
  v_out_dest uuid;
begin
  v_uid := public.fn_saidas_exigir_operador('farmacia');

  select * into m from public.stock_movements where id = p_movement_id for update;
  if not found then raise exception 'Saida nao encontrada.'; end if;
  if m.item_type <> 'pharmacy' then raise exception 'Reversao disponivel apenas para saidas de farmacia.'; end if;
  if m.direction <> 'out' or m.movement_type not in ('SAIDA_AVULSA','TRANSFERENCIA') then
    raise exception 'So e possivel reverter saidas avulsas e transferencias.';
  end if;
  if exists (select 1 from public.stock_movements
              where linked_movement_id = p_movement_id and movement_type = 'DEVOLUCAO_INT') then
    raise exception 'Esta saida ja foi revertida.';
  end if;
  select name into v_nome from public.pharmacy_items where id = m.item_id;

  -- Transferencia para outro estoque: localizar a ENTRADA correspondente.
  if m.movement_type = 'TRANSFERENCIA' and m.destino_tipo = 'estoque_interno' then
    select * into e from public.stock_movements
     where linked_movement_id = m.id and movement_type = 'TRANSFERENCIA' and direction = 'in'
     for update;
    if not found then
      -- legado: mesma transacao (performed_at identico), mesmo item/quantidade
      select * into e from public.stock_movements x
       where x.movement_type = 'TRANSFERENCIA' and x.direction = 'in'
         and x.item_id = m.item_id and x.item_type = 'pharmacy'
         and x.quantity = m.quantity and x.performed_at = m.performed_at
         and x.target_location_id = (select id from public.stock_locations where code = btrim(m.destino_nome))
         and not exists (select 1 from public.stock_movements y where y.linked_movement_id = x.id)
       order by x.id
       limit 1
       for update;
      if not found then
        raise exception 'Nao foi possivel localizar a entrada desta transferencia no destino (%). Reversao bloqueada para nao contar o item duas vezes; ajuste pelo inventario.', m.destino_nome;
      end if;
    end if;
    select code into v_dest_code from public.stock_locations where id = e.target_location_id;

    -- o destino ainda tem o que recebeu?
    select quantity into v_saldo from public.item_stocks
     where item_id = e.item_id and item_type = 'pharmacy' and location_id = e.target_location_id
     for update;
    if coalesce(v_saldo, 0) < e.quantity then
      raise exception 'O destino (%) ja consumiu parte desta transferencia: saldo % de "%", transferido %. Reversao bloqueada.',
        v_dest_code, coalesce(v_saldo,0), coalesce(v_nome,'item'), e.quantity;
    end if;
    if e.expiry_tracking_id is not null then
      select current_quantity into v_lote_q from public.expiry_tracking where id = e.expiry_tracking_id for update;
      if coalesce(v_lote_q, 0) < e.quantity then
        raise exception 'O lote no destino (%) ja foi consumido: saldo do lote %, transferido %. Reversao bloqueada.',
          v_dest_code, coalesce(v_lote_q,0), e.quantity;
      end if;
    end if;

    -- tira do destino
    insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
      source_location_id, reason, reason_detail, expiry_tracking_id, linked_movement_id, performed_by, notes)
    values (e.item_id, 'pharmacy', 'TRANSFERENCIA', 'out', e.quantity, e.target_location_id,
      'transferencia', 'Estorno de transferencia recebida', e.expiry_tracking_id, e.id, v_uid,
      'Reversao da transferencia ' || m.id::text)
    returning id into v_out_dest;
    if e.expiry_tracking_id is not null then
      update public.expiry_tracking set current_quantity = current_quantity - e.quantity
       where id = e.expiry_tracking_id;
    end if;
  elsif m.movement_type = 'TRANSFERENCIA' and m.transfer_id is not null then
    raise exception 'Transferencia registrada pela tela de Transferencia: desfaca com uma nova transferencia no sentido contrario.';
  end if;

  -- devolve a origem (o gatilho credita item_stocks; o CAF espelha em current_stock)
  insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
    target_location_id, reason, reason_detail, expiry_tracking_id, linked_movement_id, performed_by, notes)
  values (m.item_id, 'pharmacy', 'DEVOLUCAO_INT', 'in', m.quantity,
    m.source_location_id, null,
    case when v_out_dest is not null then 'Estorno de transferencia' else 'Estorno de saida avulsa' end,
    m.expiry_tracking_id, m.id, v_uid, 'Reversao da saida ' || p_movement_id::text);

  if m.expiry_tracking_id is not null then
    update public.expiry_tracking set current_quantity = current_quantity + m.quantity
      where id = m.expiry_tracking_id;
  end if;

  return jsonb_build_object('ok', true, 'item_id', m.item_id, 'quantidade', m.quantity,
                            'destino_desfeito', v_out_dest is not null);
end $f$;
revoke execute on function public.farmacia_reverter_saida(uuid) from public, anon;
grant execute on function public.farmacia_reverter_saida(uuid) to authenticated;
