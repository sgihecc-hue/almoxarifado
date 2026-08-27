-- 27/08/2026 — o lote escolhido no atendimento tinha de estar NO CAF.
--
-- SINTOMA: satelite com saldo e nenhum lote com saldo por tras. Quem ia
-- dispensar nao achava lote nenhum e a prateleira "aparecia zerada", mesmo o
-- numero dizendo que tinha. 17 itens nessa situacao (Rivaroxabana SAT_1 com 45
-- e zero em lote, Furosemida SAT_2 72 x 36, Paracetamol SAT_2 41 x 16...).
--
-- CAUSA: esta funcao debita SEMPRE o CAF, mas aceitava o lote que a tela de
-- atendimento enviava — e aquela tela oferece os lotes do ESTOQUE ATIVO, que
-- pode ser um satelite. Quando o atendente estava com um satelite ativo, a
-- SAIDA do CAF abatia um lote do satelite e a ENTRADA no satelite creditava o
-- MESMO lote: -45 e +45 na mesma linha, anulando-se. Ja item_stocks movia de
-- verdade (CAF -45, satelite +45), e o saldo ficava sem lastro.
--
-- CORRECAO: lote de outro local passa a ser ignorado; nesse caso vale o FEFO
-- do CAF, que e o que a funcao ja fazia quando nenhum lote era informado.
-- Nada mais na funcao muda.

CREATE OR REPLACE FUNCTION public.confirmar_recebimento_solicitacao(p_request_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_status text; v_type text; v_dept_id uuid; v_dept text;
  v_caf uuid; v_target uuid; v_uid uuid := auth.uid();
  ri record; lt record; v_qty integer; v_moved integer := 0;
  v_batch text; v_val date; v_dest_lote uuid; v_in_lote uuid;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  select status, type, department_id into v_status, v_type, v_dept_id
    from public.requests where id = p_request_id for update;
  if not found then raise exception 'Solicitacao nao encontrada.'; end if;
  if v_status <> 'delivered' then
    raise exception 'Solicitacao nao esta aguardando recebimento (status atual: %).', v_status;
  end if;

  if v_type = 'pharmacy' then
    select id into v_caf from public.stock_locations where code='CAF';
    select lower(name) into v_dept from public.departments where id=v_dept_id;
    if v_dept ~* 'sat.?lite' then
      if v_dept ~* 't.rreo' then select id into v_target from public.stock_locations where code='SAT_T';
      elsif v_dept ~ '1' then select id into v_target from public.stock_locations where code='SAT_1';
      elsif v_dept ~ '2' then select id into v_target from public.stock_locations where code='SAT_2';
      end if;
    end if;

    for ri in
      select id, pharmacy_item_id, supplied_quantity, expiry_tracking_id
        from public.request_items
       where request_id=p_request_id and item_type='pharmacy' and pharmacy_item_id is not null
    loop
      v_qty := ri.supplied_quantity;
      if v_qty is null or v_qty <= 0 then continue; end if;

      -- Linhas de lote a processar:
      --   1) as informadas em request_item_lots; ou
      --   2) fallback: o lote FEFO do CAF (o mais próximo do vencimento com
      --      saldo). Se não houver lote nenhum no CAF, processa com lote null
      --      (move só a quantidade — caso inerente de item sem lote lançado).
      for lt in
        -- CORRECAO 27/08: so vale lote que esteja MESMO no CAF.
        -- A saida abaixo debita o CAF sempre, mas a tela de atendimento
        -- oferece os lotes do ESTOQUE ATIVO — que pode ser um satelite. Quando
        -- isso acontecia, a saida do CAF abatia um lote do satelite e a entrada
        -- creditava o MESMO lote de volta: as duas se anulavam na mesma linha,
        -- enquanto item_stocks movia de verdade. Resultado: satelite com saldo
        -- e nenhum lote por tras — o "no sistema tem, na prateleira nao".
        -- Lote de outro local e ignorado aqui e cai no FEFO do CAF.
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
end $function$
;
