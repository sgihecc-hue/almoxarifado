-- =============================================================================
-- SOLICITACOES DA FARMACIA: atendimento atomico, lotes e confirmacao de
-- recebimento (auditoria de 28/09/2026 — achados C1, A4, M2)
--
-- C1 Farmacia baixava o CAF em dobro: a tela grava os lotes com delete+insert
--    em request_item_lots, mas a tabela so tinha policy de SELECT/INSERT. O
--    delete apagava 0 linhas SEM erro, o lote antigo ficava, e
--    confirmar_recebimento_solicitacao baixava a SOMA dos lotes ignorando o
--    fornecido (ex. #49759 AAS fornecido 42, saiu 84; 24+ pedidos).
--    -> policies de INSERT/UPDATE/DELETE so para quem atende farmacia e so com
--       o pedido aberto; confirmar recusa quando a soma dos lotes nao bate com
--       o fornecido (mensagem clara); search_path fixo.
-- A4 Aprovar da farmacia era uma sequencia de gravacoes do navegador (status
--    delivered primeiro, depois quantidade item a item; ainda gravava status
--    'atendido'/'nao_atendido' que violam o CHECK e falhavam calados). Pedido
--    #49728 ficou entregue sem quantidade nenhuma.
--    -> atender_solicitacao_farmacia: uma transacao; confere status, papel,
--       modulo, lotes x fornecido; fornecido total 0 -> "use Rejeitar".
-- M2 A policy "Anyone can confirm receipt of delivered" deixava qualquer
--    usuario passar delivered -> completed sem a RPC (sem mexer estoque) e a
--    regra de quem confirma era diferente entre tela e banco.
--    -> policy removida (fluxo so pela RPC); a RPC confere quem confirma:
--       quem pediu, alguem do setor que pediu, administrador, ou equipe da
--       farmacia confirmando por uma satelite/CAF (e o que a operacao faz hoje:
--       atendentes lotados na Satelite 1 confirmam os pedidos da Satelite 2).
-- =============================================================================

-- 1) Lotes do atendimento (request_item_lots) ------------------------------------
create or replace function public.fn_pode_mexer_lotes_solicitacao(p_request_item_id uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  select exists (
    select 1 from public.request_items ri
      join public.requests r on r.id = ri.request_id
     where ri.id = p_request_item_id
       and r.type = 'pharmacy'
       and r.status in ('pending', 'approved', 'processing')
  ) and public.fn_pode_atender_solicitacao('pharmacy')
$f$;
revoke execute on function public.fn_pode_mexer_lotes_solicitacao(uuid) from public, anon;
grant execute on function public.fn_pode_mexer_lotes_solicitacao(uuid) to authenticated;

drop policy if exists req_lots_write on public.request_item_lots;
drop policy if exists req_lots_insert on public.request_item_lots;
drop policy if exists req_lots_update on public.request_item_lots;
drop policy if exists req_lots_delete on public.request_item_lots;
create policy req_lots_insert on public.request_item_lots
  for insert to authenticated
  with check (public.fn_pode_mexer_lotes_solicitacao(request_item_id));
create policy req_lots_update on public.request_item_lots
  for update to authenticated
  using (public.fn_pode_mexer_lotes_solicitacao(request_item_id))
  with check (public.fn_pode_mexer_lotes_solicitacao(request_item_id));
create policy req_lots_delete on public.request_item_lots
  for delete to authenticated
  using (public.fn_pode_mexer_lotes_solicitacao(request_item_id));

-- 2) Atender (aprovar) a solicitacao da farmacia -----------------------------------
-- p_itens (opcional): [{request_item_id, supplied_quantity}] — a tela manda o
-- que esta digitado, para nao depender de gravacao no blur. Sem p_itens vale o
-- que esta gravado. Fornecido vazio = item nao atendido (0).
create or replace function public.atender_solicitacao_farmacia(
  p_request_id uuid, p_itens jsonb default null, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_req public.requests%rowtype;
  it jsonb;
  v_ri uuid;
  v_txt text;
  v_qty integer;
  r record;
  v_total integer := 0;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  if not public.fn_pode_atender_solicitacao('pharmacy') then
    raise exception 'Sem permissao para atender solicitacao da farmacia.';
  end if;

  select * into v_req from public.requests where id = p_request_id for update;
  if v_req.id is null then raise exception 'Solicitacao nao encontrada.'; end if;
  if v_req.type <> 'pharmacy' then raise exception 'Esta solicitacao nao e da farmacia.'; end if;
  if v_req.status <> 'pending' then
    raise exception 'Este pedido ja foi alterado por outra pessoa (agora esta %). Recarregue a pagina.',
      public.fn_status_rotulo(v_req.status);
  end if;

  if p_itens is not null then
    if jsonb_typeof(p_itens) <> 'array' then raise exception 'Itens invalidos.'; end if;
    for it in select value from jsonb_array_elements(p_itens)
    loop
      v_ri := nullif(it->>'request_item_id', '')::uuid;
      v_txt := nullif(btrim(coalesce(it->>'supplied_quantity', '')), '');
      if v_txt is not null and v_txt !~ '^\d+$' then
        raise exception 'Quantidade fornecida invalida: use numero inteiro, sem casas decimais.';
      end if;
      v_qty := v_txt::integer;
      update public.request_items set supplied_quantity = v_qty
       where id = v_ri and request_id = p_request_id;
      if not found then raise exception 'Item nao pertence a esta solicitacao.'; end if;
    end loop;
  end if;

  for r in
    select ri.id, ri.item_name, coalesce(ri.supplied_quantity, 0) as forn,
           (select coalesce(sum(l.quantity), 0) from public.request_item_lots l
             where l.request_item_id = ri.id) as lotes
      from public.request_items ri
     where ri.request_id = p_request_id
  loop
    if r.lotes > 0 and r.lotes <> r.forn then
      raise exception 'Os lotes de "%" somam % mas o fornecido e %. Ajuste os lotes antes de aprovar.',
        r.item_name, r.lotes, r.forn;
    end if;
    v_total := v_total + r.forn;
  end loop;

  if v_total = 0 then
    raise exception 'Nenhum item com quantidade fornecida. Se nao ha como atender, use Rejeitar.';
  end if;

  update public.request_items
     set approved_quantity = coalesce(supplied_quantity, 0)
   where request_id = p_request_id;

  update public.requests
     set status = 'delivered',
         approved_at = now(), approved_by = v_uid,
         delivered_at = now(), delivered_by = v_uid,
         delivery_notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), delivery_notes)
   where id = p_request_id;

  return jsonb_build_object('request_id', p_request_id, 'numero', v_req.request_number,
                            'total_fornecido', v_total);
end $function$;
revoke execute on function public.atender_solicitacao_farmacia(uuid, jsonb, text) from public, anon;
grant execute on function public.atender_solicitacao_farmacia(uuid, jsonb, text) to authenticated;

-- 3) Confirmar recebimento ---------------------------------------------------------
-- Corpo de producao (lido em 28/09/2026) preservado; mudancas:
--   a) SET search_path;
--   b) quem pode confirmar (ver cabecalho);
--   c) recusa quando a soma dos lotes nao bate com o fornecido (causa do C1).
create or replace function public.confirmar_recebimento_solicitacao(p_request_id uuid, p_notes text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_status text; v_type text; v_dept_id uuid; v_dept text; v_requester uuid;
  v_caf uuid; v_target uuid; v_uid uuid := auth.uid();
  ri record; lt record; v_qty integer; v_moved integer := 0;
  v_batch text; v_val date; v_dest_lote uuid; v_in_lote uuid;
  v_role text; v_user_dept uuid; v_soma integer; v_soma_caf integer;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  select status, type, department_id, requester_id into v_status, v_type, v_dept_id, v_requester
    from public.requests where id = p_request_id for update;
  if not found then raise exception 'Solicitacao nao encontrada.'; end if;
  if v_status <> 'delivered' then
    raise exception 'Este pedido nao esta aguardando recebimento (agora esta %). Recarregue a pagina.',
      public.fn_status_rotulo(v_status);
  end if;

  -- Quem confirma: quem pediu, alguem do setor que pediu, administrador, ou a
  -- equipe da farmacia (CAF/satelite) confirmando pedido de uma satelite/CAF.
  select role, department_id into v_role, v_user_dept from public.users where id = v_uid;
  select name into v_dept from public.departments where id = v_dept_id;
  if not (
       v_uid = v_requester
    or (v_user_dept is not null and v_user_dept = v_dept_id)
    or coalesce(v_role, '') in ('administrador', 'admin')
    or (coalesce(v_role, '') in ('atendente', 'pharmacist', 'gestor')
        and public.fn_modulo_usuario(v_uid) = 'farmacia'
        and (lower(btrim(coalesce(v_dept, ''))) like 'caf%' or coalesce(v_dept, '') ~* '^\s*farm.cia\s+sat.lite'))
  ) then
    raise exception 'Sem permissao para confirmar este recebimento: a confirmacao e do setor que fez o pedido.';
  end if;
  v_dept := lower(v_dept);

  if v_type = 'pharmacy' then
    select id into v_caf from public.stock_locations where code='CAF';
    if v_dept ~* 'sat.?lite' then
      if v_dept ~* 't.rreo' then select id into v_target from public.stock_locations where code='SAT_T';
      elsif v_dept ~ '1' then select id into v_target from public.stock_locations where code='SAT_1';
      elsif v_dept ~ '2' then select id into v_target from public.stock_locations where code='SAT_2';
      end if;
    end if;

    for ri in
      select id, item_name, pharmacy_item_id, supplied_quantity, expiry_tracking_id
        from public.request_items
       where request_id=p_request_id and item_type='pharmacy' and pharmacy_item_id is not null
    loop
      v_qty := ri.supplied_quantity;
      if v_qty is null or v_qty <= 0 then continue; end if;

      -- C1: a baixa sai dos lotes informados. Se eles nao somam o fornecido
      -- (linha duplicada, lote de outro estoque), nada sai e a farmacia corrige.
      select coalesce(sum(l.quantity), 0),
             coalesce(sum(l.quantity) filter (where e.id is not null and coalesce(e.location_id, v_caf) = v_caf), 0)
        into v_soma, v_soma_caf
        from public.request_item_lots l
        left join public.expiry_tracking e on e.id = l.expiry_tracking_id
       where l.request_item_id = ri.id and l.quantity > 0;
      if v_soma > 0 and v_soma <> v_qty then
        raise exception 'Os lotes de "%" somam % mas o fornecido e %. A farmacia precisa corrigir os lotes antes da confirmacao.',
          ri.item_name, v_soma, v_qty;
      end if;
      if v_soma_caf > 0 and v_soma_caf <> v_qty then
        raise exception 'Parte dos lotes de "%" nao e do CAF (% de %). A farmacia precisa corrigir os lotes antes da confirmacao.',
          ri.item_name, v_soma_caf, v_qty;
      end if;

      -- Linhas de lote a processar:
      --   1) as informadas em request_item_lots; ou
      --   2) fallback: o lote FEFO do CAF (o mais proximo do vencimento com
      --      saldo). Se nao houver lote nenhum no CAF, processa com lote null.
      for lt in
        -- CORRECAO 27/08: so vale lote que esteja MESMO no CAF.
        select l.expiry_tracking_id, l.quantity
          from public.request_item_lots l
          join public.expiry_tracking e on e.id = l.expiry_tracking_id
         where l.request_item_id = ri.id and l.quantity > 0
           and coalesce(e.location_id, v_caf) = v_caf
        union all
        select (
                 select e.id from public.expiry_tracking e
                  where e.item_id = ri.pharmacy_item_id
                    and coalesce(e.location_id, v_caf) = v_caf
                    and e.current_quantity > 0
                  order by e.expiry_date asc nulls last
                  limit 1
               ) as expiry_tracking_id,
               v_qty as quantity
         where not exists (
                 select 1 from public.request_item_lots l
                  join public.expiry_tracking e on e.id = l.expiry_tracking_id
                  where l.request_item_id = ri.id and l.quantity > 0
                    and coalesce(e.location_id, v_caf) = v_caf
               )
      loop
        -- SAIDA da CAF (pode deixar o saldo negativo — FA5)
        insert into public.stock_movements(item_id,item_type,movement_type,direction,quantity,
          source_location_id,request_id,performed_by,notes,expiry_tracking_id)
        values (ri.pharmacy_item_id,'pharmacy','SOLICITACAO','out',lt.quantity,
          v_caf,p_request_id,v_uid,'Atendimento de solicitacao',lt.expiry_tracking_id);

        if lt.expiry_tracking_id is not null then
          update public.expiry_tracking set current_quantity = current_quantity - lt.quantity
           where id = lt.expiry_tracking_id;
        end if;

        -- ENTRADA no satelite, propagando o MESMO lote quando houver.
        v_in_lote := lt.expiry_tracking_id;
        if v_target is not null then
          if lt.expiry_tracking_id is not null then
            select batch_number, expiry_date into v_batch, v_val
              from public.expiry_tracking where id = lt.expiry_tracking_id;

            select id into v_dest_lote
              from public.expiry_tracking
             where item_id = ri.pharmacy_item_id
               and location_id = v_target
               and lower(btrim(batch_number)) = lower(btrim(v_batch))
             limit 1;

            if v_dest_lote is null then
              insert into public.expiry_tracking(item_id, location_id, batch_number, expiry_date,
                initial_quantity, current_quantity, created_by)
              values (ri.pharmacy_item_id, v_target, v_batch, v_val,
                lt.quantity, lt.quantity, v_uid)
              returning id into v_dest_lote;
            else
              update public.expiry_tracking
                 set current_quantity = current_quantity + lt.quantity
               where id = v_dest_lote;
            end if;
            v_in_lote := v_dest_lote;
          end if;

          insert into public.stock_movements(item_id,item_type,movement_type,direction,quantity,
            target_location_id,request_id,performed_by,notes,expiry_tracking_id)
          values (ri.pharmacy_item_id,'pharmacy','SOLICITACAO','in',lt.quantity,
            v_target,p_request_id,v_uid,'Recebimento em satelite',v_in_lote);
        end if;

        v_moved := v_moved + 1;
      end loop;
    end loop;
  end if;

  update public.requests set status='completed', received_at=now(), received_by=v_uid,
    receipt_notes=nullif(btrim(coalesce(p_notes,'')),''), completed_at=now(),
    completed_by=v_uid, needs_receipt_confirmation=false where id=p_request_id;
  return jsonb_build_object('request_id',p_request_id,'type',v_type,
    'target_location_id',v_target,'items_movimentados',v_moved);
end $function$;
revoke execute on function public.confirmar_recebimento_solicitacao(uuid, text) from public, anon;
grant execute on function public.confirmar_recebimento_solicitacao(uuid, text) to authenticated;

-- 4) Fluxo de recebimento so pela RPC ------------------------------------------------
drop policy if exists "Anyone can confirm receipt of delivered" on public.requests;
