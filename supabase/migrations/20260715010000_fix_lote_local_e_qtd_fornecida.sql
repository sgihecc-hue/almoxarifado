-- =====================================================================
-- Correção de 2 falhas encontradas no primeiro uso do FA3/FA4.
-- Aplicado em PRODUÇÃO e TESTE em 2026-07-15.
-- =====================================================================

-- ---------- BUG 1: lotes cadastrados não apareciam no atendimento ----------
-- O FA4 passou a filtrar o seletor de lote por local, mas NENHUM dos pontos
-- de criação de lote grava location_id (diálogo de entrada de estoque,
-- items.ts e a RPC de entrada). Resultado: todo lote novo nascia com local
-- nulo e o filtro o escondia.
-- Em vez de alterar cada ponto de criação (fácil esquecer um), o local é
-- carimbado no banco: lote de farmácia entra pelo CAF (onde a entrada por NF
-- cai). Cobre todos os caminhos de uma vez, inclusive os futuros.
CREATE OR REPLACE FUNCTION public.fn_expiry_tracking_default_local()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
  IF NEW.location_id IS NULL THEN
    SELECT id INTO NEW.location_id FROM public.stock_locations WHERE code = 'CAF';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_expiry_tracking_default_local ON public.expiry_tracking;
CREATE TRIGGER trg_expiry_tracking_default_local
  BEFORE INSERT ON public.expiry_tracking
  FOR EACH ROW EXECUTE FUNCTION public.fn_expiry_tracking_default_local();

UPDATE public.expiry_tracking SET location_id = (SELECT id FROM stock_locations WHERE code='CAF')
 WHERE location_id IS NULL;

-- ---------- BUG 2: saía do estoque a quantidade SOLICITADA ----------
-- A RPC fazia coalesce(supplied_quantity, approved_quantity, quantity).
-- Como a aprovação preenche approved_quantity com o valor pedido, um item
-- SEM quantidade fornecida informada caía no fallback e dava baixa do valor
-- solicitado — mesmo sem o atendente informar nada e sem marcar o item.
-- Agora: só supplied_quantity conta. Sem valor => item não atendido => nada sai.
CREATE OR REPLACE FUNCTION public.confirmar_recebimento_solicitacao(p_request_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $fn$
declare
  v_status text; v_type text; v_dept_id uuid; v_dept text;
  v_caf uuid; v_target uuid; v_uid uuid := auth.uid();
  ri record; lt record; v_qty integer; v_moved integer := 0; v_tem_lotes boolean;
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

      select exists(select 1 from public.request_item_lots where request_item_id=ri.id and quantity>0)
        into v_tem_lotes;

      if v_tem_lotes then
        for lt in select expiry_tracking_id, quantity from public.request_item_lots
                   where request_item_id=ri.id and quantity>0
        loop
          insert into public.stock_movements(item_id,item_type,movement_type,direction,quantity,
            source_location_id,request_id,performed_by,notes,expiry_tracking_id)
          values (ri.pharmacy_item_id,'pharmacy','SOLICITACAO','out',lt.quantity,
            v_caf,p_request_id,v_uid,'Atendimento de solicitacao (lote)',lt.expiry_tracking_id);
          if v_target is not null then
            insert into public.stock_movements(item_id,item_type,movement_type,direction,quantity,
              target_location_id,request_id,performed_by,notes,expiry_tracking_id)
            values (ri.pharmacy_item_id,'pharmacy','SOLICITACAO','in',lt.quantity,
              v_target,p_request_id,v_uid,'Recebimento em satelite (lote)',lt.expiry_tracking_id);
          end if;
          if lt.expiry_tracking_id is not null then
            update public.expiry_tracking set current_quantity=greatest(current_quantity-lt.quantity,0)
             where id=lt.expiry_tracking_id;
          end if;
          v_moved := v_moved + 1;
        end loop;
      else
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
          update public.expiry_tracking set current_quantity=greatest(current_quantity-v_qty,0)
           where id=ri.expiry_tracking_id;
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
end $fn$;
