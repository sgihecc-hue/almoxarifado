-- 30/09/2026 (caso Gabapentina #49871, #49875, #49876): pedido da farmacia sai
-- SEMPRE da CAF. Atendimento recusa lote de outro estoque ou sem saldo e item
-- sem saldo na CAF; confirmacao recusa quando nenhum lote e da CAF e quando a
-- saida "sem lote" deixaria a CAF negativa.
CREATE OR REPLACE FUNCTION public.atender_solicitacao_farmacia(p_request_id uuid, p_itens jsonb DEFAULT NULL::jsonb, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_req public.requests%rowtype;
  it jsonb;
  v_ri uuid;
  v_txt text;
  v_qty integer;
  r record;
  v_total integer := 0;
  v_caf uuid; v_lx record; v_saldo_caf integer;
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
    -- 30/09/2026: pedido da farmacia SEMPRE sai da CAF. Lote de outro estoque
    -- (ex.: Satelite 2) ou sem saldo era aceito aqui e, na confirmacao, a baixa
    -- saia "sem lote" deixando a CAF negativa (caso Gabapentina #49871/75/76).
    if r.forn > 0 then
      select id into v_caf from public.stock_locations where code = 'CAF';
      for v_lx in
        select l.quantity, e.batch_number, e.current_quantity, e.location_id, sl.name as estoque
          from public.request_item_lots l
          join public.expiry_tracking e on e.id = l.expiry_tracking_id
          left join public.stock_locations sl on sl.id = e.location_id
         where l.request_item_id = r.id and l.quantity > 0
      loop
        if v_lx.location_id is distinct from v_caf then
          raise exception 'O lote % de "%" e do estoque %, nao da CAF. Pedido da farmacia sai da CAF: escolha um lote da CAF (ou faca uma Transferencia entre estoques).',
            v_lx.batch_number, r.item_name, coalesce(v_lx.estoque, '?');
        end if;
        if coalesce(v_lx.current_quantity, 0) < v_lx.quantity then
          raise exception 'O lote % de "%" tem so % na CAF e o atendimento tira %. Lance a entrada na CAF antes de atender.',
            v_lx.batch_number, r.item_name, coalesce(v_lx.current_quantity, 0), v_lx.quantity;
        end if;
      end loop;
      if r.lotes = 0 then
        select coalesce(sum(s.quantity), 0) into v_saldo_caf
          from public.item_stocks s join public.request_items ri2 on ri2.pharmacy_item_id = s.item_id
         where ri2.id = r.id and s.location_id = v_caf;
        if v_saldo_caf < r.forn then
          raise exception 'A CAF tem so % de "%" e o atendimento tira %. Lance a entrada na CAF antes de atender.',
            v_saldo_caf, r.item_name, r.forn;
        end if;
      end if;
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

CREATE OR REPLACE FUNCTION public.confirmar_recebimento_solicitacao(p_request_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_status text; v_type text; v_dept_id uuid; v_dept text; v_requester uuid;
  v_caf uuid; v_target uuid; v_uid uuid := auth.uid();
  ri record; lt record; v_qty integer; v_moved integer := 0;
  v_batch text; v_val date; v_dest_lote uuid; v_in_lote uuid;
  v_role text; v_user_dept uuid; v_soma integer; v_soma_caf integer;
  v_saldo_lote integer; v_lote_nome text;
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
      -- 30/09/2026: antes so disparava se PARTE dos lotes fosse da CAF; com
      -- NENHUM lote da CAF (v_soma_caf = 0) passava e saia "sem lote".
      if v_soma > 0 and v_soma_caf <> v_qty then
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
        -- 30/09/2026: o lote PRECISA cobrir a quantidade. Antes descontava sem
        -- conferir e criava lote negativo no CAF (caso Piperacilina: saida do
        -- lote 45370071 antes de ele ter entrado no CAF).
        if lt.expiry_tracking_id is not null then
          select current_quantity, batch_number into v_saldo_lote, v_lote_nome
            from public.expiry_tracking where id = lt.expiry_tracking_id for update;
          if coalesce(v_saldo_lote, 0) < lt.quantity then
            raise exception 'O lote % de "%" tem so % no CAF e o atendimento tira %. A farmacia precisa ajustar os lotes do pedido (ou lancar a entrada do lote) antes da confirmacao.',
              coalesce(v_lote_nome, '?'), ri.item_name, coalesce(v_saldo_lote, 0), lt.quantity;
          end if;
        end if;
        -- Sem lote: a CAF precisa ter saldo do item (antes ficava negativa).
        if lt.expiry_tracking_id is null then
          select coalesce(sum(quantity), 0) into v_saldo_lote from public.item_stocks
           where item_id = ri.pharmacy_item_id and location_id = v_caf;
          if v_saldo_lote < lt.quantity then
            raise exception 'A CAF tem so % de "%" e o pedido tira %. Lance a entrada na CAF antes da confirmacao.',
              v_saldo_lote, ri.item_name, lt.quantity;
          end if;
        end if;
        -- SAIDA da CAF
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
