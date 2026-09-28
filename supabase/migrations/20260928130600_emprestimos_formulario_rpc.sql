-- =============================================================================
-- FORMULARIO DE MOVIMENTACAO / EMPRESTIMO (pharmacy_loans) por RPC
-- (auditoria 28/09/2026 — A3, C3, F13)
--
-- ANTES:
--   * "Confirmar item" fazia UPDATE em pharmacy_loan_items, que NAO tem policy
--     de UPDATE: gravava nada e a tela nao avisava.
--   * "Aprovar todos" marcava o formulario como concluido sem mexer em estoque
--     (o gatilho so agia no INSERT do item, quando o formulario ja nascia
--     pendente — ou seja, nunca).
--   * Cancelar revertia estoque mesmo de formulario PENDENTE (que nunca mexeu
--     em estoque), escrevendo direto em current_stock, com GREATEST(..,0).
-- AGORA:
--   * emprestimo_criar: cabecalho + itens numa transacao (sem "apaga se o
--     segundo insert falhar"), chave contra duplo clique.
--   * emprestimo_confirmar_item / emprestimo_confirmar_todos: ao confirmar,
--     o item MOVIMENTA o estoque (farmacia: CAF por stock_movements + lote;
--     almox: current_stock + almox_movimentos). Enviando recusa saldo/lote
--     insuficiente. O que foi movido fica gravado no item (baixas).
--   * emprestimo_cancelar: so desfaz o que foi efetivamente movido; pendente
--     sem nada movido so muda o status. Recebido que ja foi consumido: recusa.
--   * Gatilhos legados removidos; navegador so le.
-- DADOS: o formulario no 14 (pendente, 7 itens) nao e alterado. Quando for
--   confirmado, passa a baixar estoque normalmente.
-- =============================================================================

alter table public.pharmacy_loan_items
  add column if not exists estoque_movido boolean not null default false,
  add column if not exists baixas jsonb;
comment on column public.pharmacy_loan_items.baixas is
  'O que a confirmacao moveu: [{"lote_id": uuid|null, "quantidade": n, "movimento_id": uuid}] (farmacia, CAF) ou [{"quantidade": n}] (almox). O cancelamento desfaz exatamente isso.';

alter table public.pharmacy_loans add column if not exists chave uuid;
create unique index if not exists pharmacy_loans_chave on public.pharmacy_loans (chave) where chave is not null;

drop trigger if exists trg_apply_pharmacy_loan_item_stock on public.pharmacy_loan_items;
drop trigger if exists trg_revert_pharmacy_loan_stock_on_cancel on public.pharmacy_loans;
drop function if exists public.apply_pharmacy_loan_item_stock();
drop function if exists public.revert_pharmacy_loan_stock_on_cancel();

-- motivo de stock_movements a partir do tipo do formulario
create or replace function public.fn_emprestimo_motivo(p_tipo text)
returns text language sql immutable set search_path to 'public', 'pg_temp' as $f$
  select case p_tipo
           when 'emprestimo' then 'emprestimo'
           when 'devolucao_emprestimo' then 'pagamento_emprestimo'
           when 'troca_validade' then 'troca_validade'
           when 'permuta' then 'permuta'
           when 'consignacao' then 'consignado'
           when 'doacao' then 'doacao'
           else 'outro' end
$f$;

-- ---------------------------------------------------------------------------
create or replace function public.emprestimo_criar(p_dados jsonb, p_chave uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_uid uuid;
  v_prev jsonb;
  v_scope text := coalesce(p_dados->>'scope', 'pharmacy');
  v_env text := nullif(p_dados->>'enviando_type','');
  v_rec text := nullif(p_dados->>'recebendo_type','');
  v_id uuid;
  v_num bigint;
  it jsonb;
  v_qtd numeric;
begin
  if v_scope not in ('pharmacy','warehouse') then raise exception 'Escopo invalido: %', v_scope; end if;
  v_uid := public.fn_saidas_exigir_operador(case when v_scope = 'pharmacy' then 'farmacia' else 'almoxarifado' end);
  v_prev := public.fn_saidas_reservar_chave(p_chave, 'emprestimo_criar');
  if v_prev is not null then return v_prev; end if;

  if coalesce(btrim(p_dados->>'origem'),'') = '' or coalesce(btrim(p_dados->>'destino'),'') = '' then
    raise exception 'Origem e Destino sao obrigatorios.';
  end if;
  if v_env is null and v_rec is null then
    raise exception 'Marque o tipo da movimentacao (Enviando e/ou Recebendo).';
  end if;
  if jsonb_typeof(p_dados->'items') <> 'array' or jsonb_array_length(p_dados->'items') = 0 then
    raise exception 'Adicione pelo menos um item ao formulario.';
  end if;

  insert into public.pharmacy_loans(scope, origem, destino, contato_origem, contato_destino, form_date,
    enviando_type, recebendo_type, signature_solicitante_name, signature_cedente_name, related_loan_id,
    notes, status, created_by, chave)
  values (v_scope, btrim(p_dados->>'origem'), btrim(p_dados->>'destino'),
    nullif(btrim(coalesce(p_dados->>'contato_origem','')),''), nullif(btrim(coalesce(p_dados->>'contato_destino','')),''),
    coalesce(nullif(p_dados->>'form_date','')::date, (now() at time zone 'America/Bahia')::date),
    v_env, v_rec,
    nullif(btrim(coalesce(p_dados->>'signature_solicitante_name','')),''),
    nullif(btrim(coalesce(p_dados->>'signature_cedente_name','')),''),
    nullif(p_dados->>'related_loan_id','')::uuid,
    nullif(btrim(coalesce(p_dados->>'notes','')),''), 'pending', v_uid, p_chave)
  returning id, form_number into v_id, v_num;

  for it in select value from jsonb_array_elements(p_dados->'items')
  loop
    if it->>'direction' not in ('enviando','recebendo') then raise exception 'Direcao invalida em um item.'; end if;
    if it->>'direction' = 'enviando' and v_env is null then raise exception 'Ha itens em "Enviando" mas o tipo nao foi marcado.'; end if;
    if it->>'direction' = 'recebendo' and v_rec is null then raise exception 'Ha itens em "Recebendo" mas o tipo nao foi marcado.'; end if;
    if coalesce(btrim(it->>'item_description'),'') = '' then raise exception 'Cada item precisa de uma descricao.'; end if;
    begin v_qtd := (it->>'quantity')::numeric; exception when others then raise exception 'Quantidade invalida no item "%".', it->>'item_description'; end;
    if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade invalida no item "%".', it->>'item_description'; end if;
    if v_scope = 'pharmacy' and nullif(it->>'warehouse_item_id','') is not null then
      raise exception 'Formulario de Farmacia nao pode ter item de Almoxarifado.';
    end if;
    if v_scope = 'warehouse' and nullif(it->>'pharmacy_item_id','') is not null then
      raise exception 'Formulario de Almoxarifado nao pode ter item de Farmacia.';
    end if;
    if (nullif(it->>'pharmacy_item_id','') is not null or nullif(it->>'warehouse_item_id','') is not null)
       and v_qtd <> trunc(v_qtd) then
      raise exception 'Item "%" vinculado ao estoque: a quantidade precisa ser inteira.', it->>'item_description';
    end if;
    insert into public.pharmacy_loan_items(loan_id, direction, pharmacy_item_id, warehouse_item_id,
      item_description, unit, quantity, unit_price, validity_date, batch_number, codigo_simpas, observation)
    values (v_id, it->>'direction', nullif(it->>'pharmacy_item_id','')::uuid, nullif(it->>'warehouse_item_id','')::uuid,
      btrim(it->>'item_description'), nullif(btrim(coalesce(it->>'unit','')),''), v_qtd,
      nullif(it->>'unit_price','')::numeric, nullif(it->>'validity_date','')::date,
      nullif(btrim(coalesce(it->>'batch_number','')),''), nullif(btrim(coalesce(it->>'codigo_simpas','')),''),
      nullif(btrim(coalesce(it->>'observation','')),''));
  end loop;

  return public.fn_saidas_gravar_resultado(p_chave, jsonb_build_object('id', v_id, 'form_number', v_num));
end $f$;
revoke execute on function public.emprestimo_criar(jsonb, uuid) from public, anon;
grant execute on function public.emprestimo_criar(jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Move o estoque de UM item (chamada interna; o formulario ja esta travado).
create or replace function public.fn_emprestimo_mover_item(p_loan record, p_item_id uuid, p_uid uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  it record;
  v_loc uuid;
  v_qty integer;
  v_tipo text;
  v_lot uuid;
  v_saldo integer;
  r record;
  v_mov uuid;
  v_baixas jsonb := '[]'::jsonb;
begin
  select * into it from public.pharmacy_loan_items where id = p_item_id and loan_id = p_loan.id for update;
  if not found then raise exception 'Item nao encontrado neste formulario.'; end if;
  if it.confirmed_at is not null then return; end if;

  if it.pharmacy_item_id is not null or it.warehouse_item_id is not null then
    if it.quantity <> trunc(it.quantity) then
      raise exception 'Item "%": quantidade fracionada nao pode movimentar estoque.', it.item_description;
    end if;
    v_qty := it.quantity::integer;
    v_tipo := case when it.direction = 'enviando' then p_loan.enviando_type else p_loan.recebendo_type end;

    if it.pharmacy_item_id is not null then
      select id into v_loc from public.stock_locations where code = 'CAF';
      if it.direction = 'enviando' then
        perform public.fn_saidas_conferir_saldo(it.pharmacy_item_id, 'pharmacy', v_loc, v_qty);
        v_lot := null;
        if it.batch_number is not null then
          select e.id into v_lot from public.expiry_tracking e
           where e.item_id = it.pharmacy_item_id and e.location_id = v_loc
             and upper(btrim(coalesce(e.batch_number,''))) = upper(btrim(it.batch_number))
           order by (e.expiry_date is not distinct from it.validity_date) desc, e.current_quantity desc
           limit 1;
          if v_lot is null then
            raise exception 'Item "%": o lote % nao existe no CAF.', it.item_description, it.batch_number;
          end if;
        end if;
        for r in select * from public.fn_saidas_consumir_lotes(it.pharmacy_item_id, v_loc, v_qty, v_lot, true,
                                                               'formulario de ' || coalesce(v_tipo,'movimentacao'))
        loop
          insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity, source_location_id,
            reason, reason_detail, destino_tipo, destino_nome, expiry_tracking_id, performed_by, notes, unit_cost)
          values (it.pharmacy_item_id, 'pharmacy', 'SAIDA_AVULSA', 'out', r.quantidade, v_loc,
            public.fn_emprestimo_motivo(v_tipo), 'Formulario de movimentacao no ' || p_loan.form_number,
            'unidade_externa', p_loan.destino, r.lote_id, p_uid, p_loan.notes, it.unit_price)
          returning id into v_mov;
          v_baixas := v_baixas || jsonb_build_object('lote_id', r.lote_id, 'quantidade', r.quantidade, 'movimento_id', v_mov);
        end loop;
      else
        -- recebendo: credita o CAF e o lote (acha ou cria o lote)
        v_lot := null;
        if it.batch_number is not null then
          select e.id into v_lot from public.expiry_tracking e
           where e.item_id = it.pharmacy_item_id and e.location_id = v_loc
             and upper(btrim(coalesce(e.batch_number,''))) = upper(btrim(it.batch_number))
             and e.expiry_date is not distinct from it.validity_date
           limit 1 for update;
          if v_lot is null then
            insert into public.expiry_tracking(item_id, batch_number, expiry_date, initial_quantity, current_quantity,
              location_id, created_by)
            values (it.pharmacy_item_id, btrim(it.batch_number), it.validity_date, 0, 0, v_loc, p_uid)
            returning id into v_lot;
          end if;
          update public.expiry_tracking set current_quantity = current_quantity + v_qty where id = v_lot;
        end if;
        insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity, target_location_id,
          reason, reason_detail, expiry_tracking_id, performed_by, notes, unit_cost)
        values (it.pharmacy_item_id, 'pharmacy', 'RETORNO_EMPRESTIMO', 'in', v_qty, v_loc,
          public.fn_emprestimo_motivo(v_tipo), 'Formulario de movimentacao no ' || p_loan.form_number || ' — de ' || p_loan.origem,
          v_lot, p_uid, p_loan.notes, it.unit_price)
        returning id into v_mov;
        v_baixas := jsonb_build_array(jsonb_build_object('lote_id', v_lot, 'quantidade', v_qty, 'movimento_id', v_mov));
      end if;
    else
      -- almoxarifado (modelo legado: current_stock)
      select id into v_loc from public.stock_locations where code = 'ALMOX';
      if it.direction = 'enviando' then
        v_saldo := public.fn_saidas_conferir_saldo(it.warehouse_item_id, 'warehouse', v_loc, v_qty);
        update public.warehouse_items set current_stock = current_stock - v_qty, updated_at = now() where id = it.warehouse_item_id;
      else
        select current_stock into v_saldo from public.warehouse_items where id = it.warehouse_item_id for update;
        update public.warehouse_items set current_stock = current_stock + v_qty, updated_at = now() where id = it.warehouse_item_id;
      end if;
      insert into public.almox_movimentos(item_id, direcao, quantidade, origem, motivo, motivo_detalhe,
        destino_tipo, destino_nome, referencia_id, saldo_antes, saldo_depois, realizado_por)
      values (it.warehouse_item_id, case when it.direction = 'enviando' then 'out' else 'in' end, v_qty, 'emprestimo',
        public.fn_emprestimo_motivo(v_tipo), 'Formulario de movimentacao no ' || p_loan.form_number,
        'unidade_externa', case when it.direction = 'enviando' then p_loan.destino else p_loan.origem end,
        it.id, v_saldo, v_saldo + case when it.direction = 'enviando' then -v_qty else v_qty end, p_uid);
      v_baixas := jsonb_build_array(jsonb_build_object('quantidade', v_qty));
    end if;
  end if;

  update public.pharmacy_loan_items
     set confirmed_at = now(), confirmed_by = p_uid,
         estoque_movido = (pharmacy_item_id is not null or warehouse_item_id is not null),
         baixas = case when pharmacy_item_id is not null or warehouse_item_id is not null then v_baixas end
   where id = p_item_id;
end $f$;
revoke execute on function public.fn_emprestimo_mover_item(record, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.emprestimo_confirmar_itens(p_loan_id uuid, p_item_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_uid uuid;
  l record;
  r record;
  v_pend integer;
begin
  select * into l from public.pharmacy_loans where id = p_loan_id for update;
  if not found then raise exception 'Formulario nao encontrado.'; end if;
  v_uid := public.fn_saidas_exigir_operador(case when l.scope = 'warehouse' then 'almoxarifado' else 'farmacia' end);
  if l.status <> 'pending' then raise exception 'Formulario nao esta pendente (status: %).', l.status; end if;

  if p_item_id is not null then
    perform public.fn_emprestimo_mover_item(l, p_item_id, v_uid);
  else
    for r in select id from public.pharmacy_loan_items where loan_id = p_loan_id and confirmed_at is null order by created_at, id
    loop
      perform public.fn_emprestimo_mover_item(l, r.id, v_uid);
    end loop;
  end if;

  select count(*) into v_pend from public.pharmacy_loan_items where loan_id = p_loan_id and confirmed_at is null;
  if v_pend = 0 then
    update public.pharmacy_loans set status = 'completed', confirmed_at = now(), confirmed_by = v_uid where id = p_loan_id;
  end if;
  return jsonb_build_object('id', p_loan_id, 'pendentes', v_pend, 'concluido', v_pend = 0);
end $f$;
revoke execute on function public.emprestimo_confirmar_itens(uuid, uuid) from public, anon;
grant execute on function public.emprestimo_confirmar_itens(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.emprestimo_cancelar(p_loan_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_uid uuid;
  l record;
  it record;
  b jsonb;
  v_loc uuid;
  v_q integer;
  v_lot uuid;
  v_saldo integer;
  v_lq integer;
  v_nome text;
  v_desfeitos integer := 0;
begin
  select * into l from public.pharmacy_loans where id = p_loan_id for update;
  if not found then raise exception 'Formulario nao encontrado.'; end if;
  v_uid := public.fn_saidas_exigir_operador(case when l.scope = 'warehouse' then 'almoxarifado' else 'farmacia' end,
                                            array['gestor','manager']);
  if coalesce(length(btrim(p_motivo)),0) < 3 then raise exception 'Informe um motivo (minimo 3 caracteres) para o estorno.'; end if;
  if l.status = 'cancelled' then raise exception 'Este formulario ja foi cancelado.'; end if;

  for it in select * from public.pharmacy_loan_items where loan_id = p_loan_id and estoque_movido for update
  loop
    if it.pharmacy_item_id is not null then
      select id into v_loc from public.stock_locations where code = 'CAF';
      select name into v_nome from public.pharmacy_items where id = it.pharmacy_item_id;
      for b in select value from jsonb_array_elements(coalesce(it.baixas, '[]'::jsonb))
      loop
        v_q := (b->>'quantidade')::integer;
        v_lot := nullif(b->>'lote_id','')::uuid;
        if it.direction = 'enviando' then
          -- devolve ao CAF e ao lote de onde saiu
          insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity, target_location_id,
            reason_detail, expiry_tracking_id, linked_movement_id, performed_by, notes)
          values (it.pharmacy_item_id, 'pharmacy', 'DEVOLUCAO_INT', 'in', v_q, v_loc,
            'Estorno do formulario no ' || l.form_number, v_lot, nullif(b->>'movimento_id','')::uuid, v_uid, btrim(p_motivo));
          if v_lot is not null then
            update public.expiry_tracking set current_quantity = current_quantity + v_q where id = v_lot;
          end if;
        else
          -- recebido: so desfaz se o CAF ainda tem
          select quantity into v_saldo from public.item_stocks
           where item_id = it.pharmacy_item_id and item_type = 'pharmacy' and location_id = v_loc for update;
          if coalesce(v_saldo,0) < v_q then
            raise exception 'Nao da para cancelar: "%" recebido neste formulario ja foi consumido (saldo no CAF %, recebido %).',
              coalesce(v_nome,'item'), coalesce(v_saldo,0), v_q;
          end if;
          if v_lot is not null then
            select current_quantity into v_lq from public.expiry_tracking where id = v_lot for update;
            if coalesce(v_lq,0) < v_q then
              raise exception 'Nao da para cancelar: o lote recebido de "%" ja foi consumido (saldo do lote %, recebido %).',
                coalesce(v_nome,'item'), coalesce(v_lq,0), v_q;
            end if;
            update public.expiry_tracking set current_quantity = current_quantity - v_q where id = v_lot;
          end if;
          insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity, source_location_id,
            reason, reason_detail, expiry_tracking_id, performed_by, notes)
          values (it.pharmacy_item_id, 'pharmacy', 'AJUSTE', 'out', v_q, v_loc,
            'outro', 'Estorno do formulario no ' || l.form_number, v_lot, v_uid, btrim(p_motivo));
        end if;
      end loop;
    else
      select id into v_loc from public.stock_locations where code = 'ALMOX';
      v_q := it.quantity::integer;
      if it.direction = 'enviando' then
        select current_stock into v_saldo from public.warehouse_items where id = it.warehouse_item_id for update;
        update public.warehouse_items set current_stock = current_stock + v_q, updated_at = now() where id = it.warehouse_item_id;
      else
        v_saldo := public.fn_saidas_conferir_saldo(it.warehouse_item_id, 'warehouse', v_loc, v_q);
        update public.warehouse_items set current_stock = current_stock - v_q, updated_at = now() where id = it.warehouse_item_id;
      end if;
      insert into public.almox_movimentos(item_id, direcao, quantidade, origem, motivo, motivo_detalhe, referencia_id,
        saldo_antes, saldo_depois, observacao, realizado_por)
      values (it.warehouse_item_id, case when it.direction = 'enviando' then 'in' else 'out' end, v_q,
        'cancelamento_emprestimo', 'estorno', 'Estorno do formulario no ' || l.form_number, it.id,
        v_saldo, v_saldo + case when it.direction = 'enviando' then v_q else -v_q end, btrim(p_motivo), v_uid);
    end if;
    update public.pharmacy_loan_items set estoque_movido = false where id = it.id;
    v_desfeitos := v_desfeitos + 1;
  end loop;

  update public.pharmacy_loans
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, cancellation_reason = btrim(p_motivo)
   where id = p_loan_id;
  return jsonb_build_object('id', p_loan_id, 'itens_desfeitos', v_desfeitos);
end $f$;
revoke execute on function public.emprestimo_cancelar(uuid, text) from public, anon;
grant execute on function public.emprestimo_cancelar(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
drop policy if exists "pharmacy_loans insert" on public.pharmacy_loans;
drop policy if exists "pharmacy_loans update" on public.pharmacy_loans;
drop policy if exists "pharmacy_loan_items insert" on public.pharmacy_loan_items;
revoke insert, update, delete, truncate on public.pharmacy_loans from anon, authenticated;
revoke insert, update, delete, truncate on public.pharmacy_loan_items from anon, authenticated;
