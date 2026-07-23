-- Recebimento de solicitação de farmácia: propagar o LOTE para o destino e
-- deixar o lote da CAF ficar NEGATIVO (coerente com o item_stocks).
--
-- Cenário: solicitação para a CAF de um item SEM estoque. O atendente digita a
-- quantidade e o lote na hora do atendimento. O esperado é:
--   - CAF fica NEGATIVA (saldo e lote), porque saiu o que não havia lançado;
--   - o satélite que recebeu fica POSITIVO e COM O LOTE digitado.
--
-- Dois defeitos corrigidos aqui:
--
-- 1) O lote não chegava no destino. A RPC criava o movimento 'in' pro satélite
--    (o que faz o item_stocks subir, via fn_apply_stock_movement), mas nunca
--    criava uma linha de expiry_tracking NO LOCAL DE DESTINO. Como o lote é
--    por local (FA4), o satélite ficava com saldo e nenhum lote. Agora a RPC
--    acha-ou-cria o lote no destino (mesmo número/validade) e soma a
--    quantidade nele; o movimento 'in' passa a apontar pro lote do destino.
--
-- 2) O lote da origem era travado em zero por greatest(qtd - x, 0), enquanto o
--    item_stocks ia a negativo — a soma dos lotes deixava de bater com o
--    saldo. Como a FA5 aceita negativo na farmácia, o lote de origem agora
--    também pode ficar negativo, e a recontagem/entrada compensa depois.
--
-- fn_apply_stock_movement só mexe em item_stocks (não em expiry_tracking),
-- então estas atualizações de lote não duplicam baixa.

CREATE OR REPLACE FUNCTION public.confirmar_recebimento_solicitacao(
  p_request_id uuid,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  v_status text; v_type text; v_dept_id uuid; v_dept text;
  v_caf uuid; v_target uuid; v_uid uuid := auth.uid();
  ri record; lt record; v_qty integer; v_moved integer := 0; v_tem_lotes boolean;
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
      -- SO o que o atendente informou como FORNECIDO sai do estoque.
      -- Sem quantidade digitada => item nao atendido => nada sai.
      v_qty := ri.supplied_quantity;
      if v_qty is null or v_qty <= 0 then continue; end if;

      select exists(select 1 from public.request_item_lots where request_item_id=ri.id and quantity>0)
        into v_tem_lotes;

      if v_tem_lotes then
        for lt in select expiry_tracking_id, quantity from public.request_item_lots
                   where request_item_id=ri.id and quantity>0
        loop
          -- SAIDA da CAF (pode deixar o saldo negativo — FA5)
          insert into public.stock_movements(item_id,item_type,movement_type,direction,quantity,
            source_location_id,request_id,performed_by,notes,expiry_tracking_id)
          values (ri.pharmacy_item_id,'pharmacy','SOLICITACAO','out',lt.quantity,
            v_caf,p_request_id,v_uid,'Atendimento de solicitacao (lote)',lt.expiry_tracking_id);

          -- Baixa no lote de ORIGEM. Sem piso em zero: se nao havia saldo
          -- lancado, o lote fica negativo junto com o item_stocks.
          if lt.expiry_tracking_id is not null then
            update public.expiry_tracking set current_quantity = current_quantity - lt.quantity
             where id = lt.expiry_tracking_id;
          end if;

          -- ENTRADA no satelite, JA COM O LOTE.
          v_in_lote := lt.expiry_tracking_id;
          if v_target is not null then
            if lt.expiry_tracking_id is not null then
              select batch_number, expiry_date into v_batch, v_val
                from public.expiry_tracking where id = lt.expiry_tracking_id;

              -- acha-ou-cria o MESMO lote no local de destino
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
              v_target,p_request_id,v_uid,'Recebimento em satelite (lote)',v_in_lote);
          end if;

          v_moved := v_moved + 1;
        end loop;
      else
        -- Sem lote informado: move so a quantidade.
        insert into public.stock_movements(item_id,item_type,movement_type,direction,quantity,
          source_location_id,request_id,performed_by,notes,expiry_tracking_id)
        values (ri.pharmacy_item_id,'pharmacy','SOLICITACAO','out',v_qty,
          v_caf,p_request_id,v_uid,'Atendimento de solicitacao',ri.expiry_tracking_id);
        if v_target is not null then
          insert into public.stock_movements(item_id,item_type,movement_type,direction,quantity,
            target_location_id,request_id,performed_by,notes,expiry_tracking_id)
          values (ri.pharmacy_item_id,'pharmacy','SOLICITACAO','in',v_qty,
            v_target,p_request_id,v_uid,'Recebimento em satelite',ri.expiry_tracking_id);
        end if;
        if ri.expiry_tracking_id is not null then
          update public.expiry_tracking set current_quantity = current_quantity - v_qty
           where id = ri.expiry_tracking_id;
        end if;
        v_moved := v_moved + 1;
      end if;
    end loop;
  end if;

  update public.requests set status='completed', received_at=now(), received_by=v_uid,
    receipt_notes=nullif(btrim(coalesce(p_notes,'')),''), completed_at=now(),
    completed_by=v_uid, needs_receipt_confirmation=false where id=p_request_id;
  return jsonb_build_object('request_id',p_request_id,'type',v_type,
    'target_location_id',v_target,'items_movimentados',v_moved);
end $function$;
