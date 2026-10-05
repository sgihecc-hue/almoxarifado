-- 05/10/2026: pedido da farmacia sai do estoque do SETOR SOLICITADO.
-- O sistema aceita pedido de satelite para satelite (Setor Solicitado = Satelite 1
-- ou 2), mas a baixa sempre saia da CAF (desde a correcao de 27/08) e as listas
-- filtravam por requests.source_location_id, que nunca era preenchido (todo
-- pedido aparecia no painel da CAF). Ex.: #49941 (Sat 2 pediu a Sat 1): saiu da
-- CAF; #49921 (Sat 1 pediu a Sat 2): saiu da CAF.

create or replace function public.fn_local_do_setor(p_department_id uuid)
returns uuid
language sql stable
set search_path to 'public', 'pg_temp'
as $f$
  select l.id from public.departments d
    join public.stock_locations l on l.code = case
      when lower(d.name) like 'caf%' then 'CAF'
      when lower(d.name) ~ 'sat.?lite' and lower(d.name) ~ 't.rreo' then 'SAT_T'
      when lower(d.name) ~ 'sat.?lite' and d.name ~ '1' then 'SAT_1'
      when lower(d.name) ~ 'sat.?lite' and d.name ~ '2' then 'SAT_2'
    end
   where d.id = p_department_id
$f$;
grant execute on function public.fn_local_do_setor(uuid) to authenticated;

create or replace function public.fn_pedido_farmacia_locais()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $f$
begin
  if new.type = 'pharmacy' then
    new.source_location_id := coalesce(public.fn_local_do_setor(new.destination_department_id),
                                       (select id from public.stock_locations where code = 'CAF'));
    new.target_location_id := public.fn_local_do_setor(new.department_id);
    if new.target_location_id is not null and new.target_location_id = new.source_location_id then
      raise exception 'O setor solicitado e o mesmo estoque de quem pede. Escolha outro setor solicitado.';
    end if;
  end if;
  return new;
end;
$f$;
drop trigger if exists trg_pedido_farmacia_locais on public.requests;
create trigger trg_pedido_farmacia_locais
  before insert or update of destination_department_id, department_id on public.requests
  for each row execute function public.fn_pedido_farmacia_locais();

-- Preenche origem/destino de todos os pedidos de farmacia existentes (so colunas
-- de localizacao; gatilhos de status nao sao acionados por este UPDATE).
alter table public.requests disable trigger user;
update public.requests r
   set source_location_id = coalesce(public.fn_local_do_setor(r.destination_department_id),
                                     (select id from public.stock_locations where code = 'CAF')),
       target_location_id = public.fn_local_do_setor(r.department_id)
 where r.type = 'pharmacy';
alter table public.requests enable trigger user;

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
  v_caf uuid; v_lx record; v_saldo_caf integer; v_orig_nome text;
  v_dn text; v_auto boolean := false;
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
      -- 05/10/2026: origem = estoque do SETOR SOLICITADO (CAF, Satelite 1 ou 2), nao mais CAF fixa.
      v_caf := coalesce(v_req.source_location_id, public.fn_local_do_setor(v_req.destination_department_id), (select id from public.stock_locations where code = 'CAF'));
      select name into v_orig_nome from public.stock_locations where id = v_caf;
      for v_lx in
        select l.quantity, e.batch_number, e.current_quantity, e.location_id, sl.name as estoque
          from public.request_item_lots l
          join public.expiry_tracking e on e.id = l.expiry_tracking_id
          left join public.stock_locations sl on sl.id = e.location_id
         where l.request_item_id = r.id and l.quantity > 0
      loop
        if v_lx.location_id is distinct from v_caf then
          raise exception 'O lote % de "%" e do estoque %, mas este pedido sai de %. Escolha um lote de %.',
            v_lx.batch_number, r.item_name, coalesce(v_lx.estoque, '?'), v_orig_nome, v_orig_nome;
        end if;
        if coalesce(v_lx.current_quantity, 0) < v_lx.quantity then
          raise exception 'O lote % de "%" tem so % em % e o atendimento tira %.',
            v_lx.batch_number, r.item_name, coalesce(v_lx.current_quantity, 0), v_orig_nome, v_lx.quantity;
        end if;
      end loop;
      if r.lotes = 0 then
        select coalesce(sum(s.quantity), 0) into v_saldo_caf
          from public.item_stocks s join public.request_items ri2 on ri2.pharmacy_item_id = s.item_id
         where ri2.id = r.id and s.location_id = v_caf;
        if v_saldo_caf < r.forn then
          raise exception '% tem so % de "%" e o atendimento tira %.',
            v_orig_nome, v_saldo_caf, r.item_name, r.forn;
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

  -- 01/10/2026 (decisao do Adonias): pedido da Satelite 1 e da Satelite 2 nao
  -- tem mais etapa de "confirmar recebimento". Ao atender na CAF, o estoque ja
  -- sai da CAF e entra na satelite e o pedido fica concluido. A baixa usa a
  -- mesma rotina da confirmacao (com as travas de lote/saldo da CAF).
  -- Satelite Terreo e demais setores continuam com a confirmacao.
  select lower(coalesce(name, '')) into v_dn from public.departments where id = v_req.department_id;
  if v_dn ~* 'sat.?lite' and v_dn !~* 't.rreo' and (v_dn ~ '1' or v_dn ~ '2') then
    perform public.confirmar_recebimento_solicitacao(p_request_id,
      'Recebimento automatico: pedido da satelite concluido no atendimento (sem etapa de confirmacao desde 01/10/2026).');
    v_auto := true;
  end if;

  return jsonb_build_object('request_id', p_request_id, 'numero', v_req.request_number,
                            'total_fornecido', v_total, 'concluido_automatico', v_auto);
end $function$;

CREATE OR REPLACE FUNCTION public.confirmar_recebimento_solicitacao(p_request_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_status text; v_type text; v_dept_id uuid; v_dept text; v_requester uuid;
  v_caf uuid; v_target uuid; v_uid uuid := auth.uid(); v_orig_nome text;
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
    -- 05/10/2026: origem = estoque do SETOR SOLICITADO (CAF, Satelite 1 ou 2), nao mais CAF fixa.
    select coalesce(r.source_location_id, public.fn_local_do_setor(r.destination_department_id), (select id from public.stock_locations where code='CAF'))
      into v_caf from public.requests r where r.id = p_request_id;
    select name into v_orig_nome from public.stock_locations where id = v_caf;
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
        raise exception 'Parte dos lotes de "%" nao e de % (% de %). Corrija os lotes do pedido antes de concluir.',
          ri.item_name, v_orig_nome, v_soma_caf, v_qty;
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
            raise exception 'O lote % de "%" tem so % em % e o atendimento tira %. Ajuste os lotes do pedido antes de concluir.',
              coalesce(v_lote_nome, '?'), ri.item_name, coalesce(v_saldo_lote, 0), v_orig_nome, lt.quantity;
          end if;
        end if;
        -- Sem lote: a CAF precisa ter saldo do item (antes ficava negativa).
        if lt.expiry_tracking_id is null then
          select coalesce(sum(quantity), 0) into v_saldo_lote from public.item_stocks
           where item_id = ri.pharmacy_item_id and location_id = v_caf;
          if v_saldo_lote < lt.quantity then
            raise exception '% tem so % de "%" e o pedido tira %.',
              v_orig_nome, v_saldo_lote, ri.item_name, lt.quantity;
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
