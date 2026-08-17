CREATE OR REPLACE FUNCTION public.criar_dispensacao(p_patient_name text, p_medical_record_number text, p_prescribing_doctor text, p_prescription_number text, p_prescription_date date, p_items jsonb, p_patient_id uuid DEFAULT NULL::uuid, p_admission_id uuid DEFAULT NULL::uuid, p_prescriber_id uuid DEFAULT NULL::uuid, p_patient_bed_room text DEFAULT NULL::text, p_sector text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_mav_confirmado boolean DEFAULT false, p_tipo text DEFAULT 'prescricao'::text, p_source_location_code text DEFAULT 'CAF'::text)
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

  -- Aprovacao do farmaceutico REMOVIDA: toda dispensacao conclui direto.
  v_needs := false;
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
$function$
