-- Farmácia: TODA saída passa a abater um LOTE (FEFO automático quando o
-- operador não informar). Fecha a causa da divergência item_stocks x
-- expiry_tracking: antes, uma solicitação/prescrição atendida SEM lote abatia
-- o saldo agregado (item_stocks, via trigger do stock_movement) mas não abatia
-- nenhum lote — os dois "livros" desencontravam.
--
-- Correção nas duas RPCs de saída de farmácia:
--   confirmar_recebimento_solicitacao — ramo "sem lote" agora deriva o lote
--     FEFO do CAF e o trata igual ao ramo com lote (abate na origem + propaga
--     o mesmo lote pro satélite de destino).
--   criar_dispensacao — quando não vem expiry_tracking_id, deriva o lote FEFO
--     do local de origem e abate dele.
--
-- Só farmácia. Nenhuma função de almoxarifado é tocada.

-- ============================================================
-- 1) confirmar_recebimento_solicitacao
-- ============================================================
CREATE OR REPLACE FUNCTION public.confirmar_recebimento_solicitacao(
  p_request_id uuid, p_notes text DEFAULT NULL::text
)
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
        select expiry_tracking_id, quantity
          from public.request_item_lots
         where request_item_id = ri.id and quantity > 0
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
                 select 1 from public.request_item_lots
                  where request_item_id = ri.id and quantity > 0
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

-- ============================================================
-- 2) criar_dispensacao — FEFO quando não vier lote
-- ============================================================
CREATE OR REPLACE FUNCTION public.criar_dispensacao(
  p_patient_name text, p_medical_record_number text, p_prescribing_doctor text,
  p_prescription_number text, p_prescription_date date, p_items jsonb,
  p_patient_id uuid DEFAULT NULL::uuid, p_admission_id uuid DEFAULT NULL::uuid,
  p_prescriber_id uuid DEFAULT NULL::uuid, p_patient_bed_room text DEFAULT NULL::text,
  p_sector text DEFAULT NULL::text, p_notes text DEFAULT NULL::text,
  p_mav_confirmado boolean DEFAULT false, p_tipo text DEFAULT 'prescricao'::text,
  p_source_location_code text DEFAULT 'CAF'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_src uuid;
  v_needs boolean := false;
  v_disp_id uuid;
  v_disp_num integer;
  v_status text;
  it jsonb;
  v_item_id uuid;
  v_qty integer;
  v_lot uuid;
  v_lot_auto boolean;
  v_price numeric;
  v_newqty integer;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Dispensacao sem itens.'; end if;
  if p_tipo not in ('prescricao','requisicao') then raise exception 'Tipo invalido: %', p_tipo; end if;
  if p_tipo = 'requisicao' and coalesce(btrim(coalesce(p_sector,'')),'') = '' then
    raise exception 'Requisicao exige o setor solicitante.';
  end if;
  select id into v_src from stock_locations where code = coalesce(p_source_location_code,'CAF');
  if v_src is null then raise exception 'Local de origem nao encontrado: %', p_source_location_code; end if;

  select exists(
    select 1 from pharmacy_items pi
    where pi.id in (select (e->>'item_id')::uuid from jsonb_array_elements(p_items) e)
      and (pi.is_mav = true or pi.medication_class in ('controlados','antimicrobianos','mav'))
  ) into v_needs;
  v_status := case when v_needs then 'pending_approval' else 'completed' end;

  insert into pharmacy_dispensations(
    tipo, patient_name, patient_bed_room, medical_record_number, prescribing_doctor,
    prescription_number, prescription_date, sector, notes, created_by,
    source_location_id, status, patient_id, admission_id, prescriber_id, mav_confirmado
  ) values (
    p_tipo,
    nullif(btrim(coalesce(p_patient_name,'')),''),
    nullif(btrim(coalesce(p_patient_bed_room,'')),''),
    nullif(btrim(coalesce(p_medical_record_number,'')),''),
    nullif(btrim(coalesce(p_prescribing_doctor,'')),''),
    nullif(btrim(coalesce(p_prescription_number,'')),''),
    p_prescription_date,
    nullif(btrim(coalesce(p_sector,'')),''),
    nullif(btrim(coalesce(p_notes,'')),''),
    v_uid, v_src, v_status, p_patient_id, p_admission_id, p_prescriber_id, coalesce(p_mav_confirmado,false)
  ) returning id, dispensation_number into v_disp_id, v_disp_num;

  for it in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := (it->>'item_id')::uuid;
    v_qty := (it->>'quantity')::integer;
    v_lot := nullif(it->>'expiry_tracking_id','')::uuid;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade invalida.'; end if;

    -- FEFO: se o operador não escolheu lote, pega o de validade mais próxima
    -- com saldo no local de origem, pra abater o lote (mantém item_stocks e
    -- expiry_tracking em sincronia).
    v_lot_auto := false;
    if v_lot is null then
      select e.id into v_lot from expiry_tracking e
       where e.item_id = v_item_id
         and coalesce(e.location_id, v_src) = v_src
         and e.current_quantity > 0
       order by e.expiry_date asc nulls last
       limit 1;
      v_lot_auto := (v_lot is not null);
    end if;

    insert into pharmacy_dispensation_items(dispensation_id, item_id, quantity, expiry_tracking_id, batch_number, expiry_date)
    values (v_disp_id, v_item_id, v_qty, v_lot, nullif(it->>'batch_number',''), nullif(it->>'expiry_date','')::date);

    if not v_needs then
      select price into v_price from pharmacy_items where id = v_item_id;
      insert into stock_movements(item_id, item_type, movement_type, direction, quantity, unit_cost,
        source_location_id, dispensation_id, medical_record_number, prescription_date, expiry_tracking_id, performed_by)
      values (v_item_id, 'pharmacy', 'PRESCRICAO', 'out', v_qty, v_price,
        v_src, v_disp_id, nullif(btrim(coalesce(p_medical_record_number,'')),''), p_prescription_date, v_lot, v_uid);
      if v_lot is not null then
        update expiry_tracking set current_quantity = current_quantity - v_qty
          where id = v_lot returning current_quantity into v_newqty;
        if not found then raise exception 'Lote nao encontrado: %', v_lot; end if;
        -- Só bloqueia saldo insuficiente quando o operador ESCOLHEU o lote.
        -- No FEFO automático deixamos abater (mesmo indo negativo) pra não
        -- travar a dispensação e manter os dois livros consistentes.
        if v_newqty < 0 and not v_lot_auto then raise exception 'Saldo do lote insuficiente.'; end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object('id', v_disp_id, 'dispensation_number', v_disp_num, 'needs_approval', v_needs);
end
$function$;
