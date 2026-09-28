-- =============================================================================
-- DISPENSACAO segura (auditoria 28/09/2026 — C5, C6, M1, F11, idempotencia)
--
-- criar_dispensacao:
--   * Saia de lote VENCIDO (Morfina AZ00125M, venc. 31/05/26, dispensada em
--     23/09): o FEFO nao olhava validade e a tela oferecia lote vencido.
--     Agora o FEFO ignora vencidos e lote vencido escolhido so passa com
--     justificativa por linha (fica gravada no item e no movimento).
--   * FEFO automatico nao dividia entre lotes e deixava o lote NEGATIVO
--     (25 lotes negativos na farmacia). Agora divide pela validade e recusa
--     quando os lotes validos nao cobrem.
--   * Nao conferia item_stocks (4 itens negativos no CAF): trava e recusa.
--   * So exigia login: agora papel + modulo farmacia (F11).
--   * p_chave: repetir a mesma rodada (timeout, duplo clique) nao duplica.
-- cancelar_dispensacao: papel + modulo farmacia.
-- criar_saida_material (Satelite Terreo): trava saldo, FEFO dividido e nunca
--   deixa lote negativo; lote digitado que nao existe fica anotado no
--   movimento (historico) em vez de criar lote com saldo negativo.
-- Policies: o navegador so le pharmacy_dispensations(+items); gravacao so
--   pelas RPCs (nenhuma tela grava direto — conferido no front em 28/09).
-- =============================================================================

alter table public.pharmacy_dispensation_items
  add column if not exists justificativa_vencido text;

alter table public.pharmacy_dispensations
  add column if not exists chave uuid;
create unique index if not exists pharmacy_dispensations_chave on public.pharmacy_dispensations (chave) where chave is not null;

drop function if exists public.criar_dispensacao(text, text, text, text, date, jsonb, uuid, uuid, uuid, text, text, text, boolean, text, text, date);

create or replace function public.criar_dispensacao(
  p_patient_name text, p_medical_record_number text, p_prescribing_doctor text,
  p_prescription_number text, p_prescription_date date, p_items jsonb,
  p_patient_id uuid default null, p_admission_id uuid default null, p_prescriber_id uuid default null,
  p_patient_bed_room text default null, p_sector text default null, p_notes text default null,
  p_mav_confirmado boolean default false, p_tipo text default 'prescricao',
  p_source_location_code text default 'CAF', p_rm_date date default null,
  p_chave uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_uid uuid;
  v_prev jsonb;
  v_src uuid;
  v_src_code text;
  v_disp_id uuid;
  v_disp_num integer;
  it jsonb;
  v_item_id uuid;
  v_qty integer;
  v_lot uuid;
  v_just text;
  v_price numeric;
  r record;
  v_batch text;
  v_val date;
  v_result jsonb;
begin
  v_src_code := coalesce(nullif(btrim(coalesce(p_source_location_code,'')),''), 'CAF');
  select id into v_src from public.stock_locations where code = v_src_code;
  if v_src is null then raise exception 'Local de origem nao encontrado: %', v_src_code; end if;
  if v_src_code = 'ALMOX' then raise exception 'Dispensacao nao sai do almoxarifado.'; end if;
  v_uid := public.fn_saidas_exigir_operador('farmacia');

  v_prev := public.fn_saidas_reservar_chave(p_chave, 'criar_dispensacao');
  if v_prev is not null then return v_prev; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Dispensacao sem itens.';
  end if;
  if p_tipo not in ('prescricao','requisicao') then raise exception 'Tipo invalido: %', p_tipo; end if;
  if p_tipo = 'requisicao' and coalesce(btrim(coalesce(p_sector,'')),'') = '' then
    raise exception 'Requisicao exige o setor solicitante.';
  end if;

  insert into public.pharmacy_dispensations(
    tipo, patient_name, patient_bed_room, medical_record_number, prescribing_doctor,
    prescription_number, prescription_date, rm_date, sector, notes, created_by,
    source_location_id, status, patient_id, admission_id, prescriber_id, mav_confirmado, chave
  ) values (
    p_tipo,
    nullif(btrim(coalesce(p_patient_name,'')),''),
    nullif(btrim(coalesce(p_patient_bed_room,'')),''),
    nullif(btrim(coalesce(p_medical_record_number,'')),''),
    nullif(btrim(coalesce(p_prescribing_doctor,'')),''),
    nullif(btrim(coalesce(p_prescription_number,'')),''),
    p_prescription_date, p_rm_date,
    nullif(btrim(coalesce(p_sector,'')),''),
    nullif(btrim(coalesce(p_notes,'')),''),
    v_uid, v_src, 'completed', p_patient_id, p_admission_id, p_prescriber_id,
    coalesce(p_mav_confirmado,false), p_chave
  ) returning id, dispensation_number into v_disp_id, v_disp_num;

  for it in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_item_id := (it->>'item_id')::uuid;
      v_qty := (it->>'quantity')::integer;
      v_lot := nullif(it->>'expiry_tracking_id','')::uuid;
    exception when others then
      raise exception 'Linha com item, quantidade ou lote invalidos.';
    end;
    v_just := nullif(btrim(coalesce(it->>'justificativa_vencido','')),'');
    if v_item_id is null then raise exception 'Linha sem item.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade invalida (use numero inteiro maior que zero).'; end if;
    select price into v_price from public.pharmacy_items where id = v_item_id;
    if not found then raise exception 'Medicamento nao encontrado.'; end if;

    -- saldo do estoque de origem (trava; recusa se faltar)
    perform public.fn_saidas_conferir_saldo(v_item_id, 'pharmacy', v_src, v_qty);

    -- lote escolhido ou FEFO dividido (sem vencidos, nunca negativo)
    for r in select * from public.fn_saidas_consumir_lotes(v_item_id, v_src, v_qty, v_lot, true, v_just)
    loop
      select batch_number, expiry_date into v_batch, v_val from public.expiry_tracking where id = r.lote_id;
      insert into public.pharmacy_dispensation_items(dispensation_id, item_id, quantity, expiry_tracking_id,
        batch_number, expiry_date, justificativa_vencido)
      values (v_disp_id, v_item_id, r.quantidade, r.lote_id, v_batch, v_val,
        case when v_val is not null and v_val < current_date then v_just end);
      insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity, unit_cost,
        source_location_id, dispensation_id, medical_record_number, prescription_date, expiry_tracking_id,
        performed_by, historico)
      values (v_item_id, 'pharmacy', 'PRESCRICAO', 'out', r.quantidade, v_price,
        v_src, v_disp_id, nullif(btrim(coalesce(p_medical_record_number,'')),''), p_prescription_date, r.lote_id,
        v_uid, case when v_val is not null and v_val < current_date
                    then 'Lote vencido em ' || to_char(v_val,'DD/MM/YYYY') || ' — justificativa: ' || v_just end);
    end loop;
  end loop;

  v_result := jsonb_build_object('id', v_disp_id, 'dispensation_number', v_disp_num, 'needs_approval', false);
  return public.fn_saidas_gravar_resultado(p_chave, v_result);
end $f$;
revoke execute on function public.criar_dispensacao(text, text, text, text, date, jsonb, uuid, uuid, uuid, text, text, text, boolean, text, text, date, uuid) from public, anon;
grant execute on function public.criar_dispensacao(text, text, text, text, date, jsonb, uuid, uuid, uuid, text, text, text, boolean, text, text, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.cancelar_dispensacao(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_uid uuid;
  v_src uuid; v_status text; r record;
begin
  v_uid := public.fn_saidas_exigir_operador('farmacia');
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Motivo do cancelamento e obrigatorio.'; end if;
  select status, source_location_id into v_status, v_src
    from public.pharmacy_dispensations where id = p_id for update;
  if not found then raise exception 'Dispensacao nao encontrada.'; end if;
  if v_status = 'cancelled' then raise exception 'Dispensacao ja esta cancelada.'; end if;
  if v_status not in ('completed','pending_approval') then
    raise exception 'Status nao permite cancelamento: %', v_status;
  end if;

  if v_status = 'completed' then
    if v_src is null then select id into v_src from public.stock_locations where code='CAF'; end if;
    for r in select item_id, quantity, expiry_tracking_id
             from public.pharmacy_dispensation_items where dispensation_id = p_id
    loop
      insert into public.stock_movements(item_id,item_type,movement_type,direction,quantity,
        target_location_id,dispensation_id,expiry_tracking_id,performed_by,notes)
      values (r.item_id,'pharmacy','AJUSTE','in',r.quantity,
        v_src,p_id,r.expiry_tracking_id,v_uid,'Estorno de dispensacao cancelada');
      if r.expiry_tracking_id is not null then
        update public.expiry_tracking set current_quantity = current_quantity + r.quantity
          where id = r.expiry_tracking_id;
      end if;
    end loop;
  end if;

  update public.pharmacy_dispensations
    set status='cancelled', cancelled_at=now(), cancelled_by=v_uid, cancellation_reason=btrim(p_reason)
    where id = p_id;
  return jsonb_build_object('id', p_id, 'status','cancelled', 'estornado', v_status='completed');
end $f$;
revoke execute on function public.cancelar_dispensacao(uuid, text) from public, anon;
grant execute on function public.cancelar_dispensacao(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
drop function if exists public.criar_saida_material(text, text, jsonb, text);

create or replace function public.criar_saida_material(
  p_source_location_code text, p_sector text, p_items jsonb, p_notes text default null,
  p_chave uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_uid uuid;
  v_prev jsonb;
  v_loc uuid;
  v_code text;
  it jsonb;
  v_item uuid;
  v_qty integer;
  v_lot uuid;
  v_batch text;
  v_exp date;
  v_nota text;
  r record;
  v_count integer := 0;
  v_total integer := 0;
begin
  v_code := coalesce(nullif(btrim(coalesce(p_source_location_code,'')),''), 'SAT_T');
  select id into v_loc from public.stock_locations where code = v_code;
  if v_loc is null then raise exception 'Estoque de origem nao encontrado: %', v_code; end if;
  if v_code = 'ALMOX' then raise exception 'Esta tela nao da saida do almoxarifado.'; end if;
  v_uid := public.fn_saidas_exigir_operador('farmacia');

  v_prev := public.fn_saidas_reservar_chave(p_chave, 'criar_saida_material');
  if v_prev is not null then return v_prev; end if;

  if coalesce(btrim(coalesce(p_sector,'')),'') = '' then raise exception 'Informe o setor de destino.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Dispensacao sem itens.';
  end if;

  for it in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_item := (it->>'item_id')::uuid;
      v_qty  := (it->>'quantity')::integer;
      v_lot  := nullif(it->>'expiry_tracking_id','')::uuid;
      v_exp  := nullif(it->>'expiry_date','')::date;
    exception when others then
      raise exception 'Linha com item, quantidade, lote ou validade invalidos.';
    end;
    v_batch := nullif(btrim(coalesce(it->>'batch_number','')),'');
    v_nota := null;
    if v_item is null then raise exception 'Linha sem item.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade invalida em uma das linhas (use numero inteiro maior que zero).'; end if;

    -- Lote DIGITADO: usa a linha existente do mesmo lote neste local se ela
    -- cobre a quantidade; senao so anota o lote no movimento (nao cria lote
    -- com saldo negativo).
    if v_lot is null and v_batch is not null then
      select e.id into v_lot from public.expiry_tracking e
       where e.item_id = v_item and e.location_id = v_loc
         and upper(btrim(coalesce(e.batch_number,''))) = upper(v_batch)
         and e.current_quantity >= v_qty
       order by e.expiry_date nulls last limit 1;
      if v_lot is null then
        v_nota := 'Lote informado: ' || v_batch || coalesce(' val ' || to_char(v_exp,'DD/MM/YYYY'), '') || ' (sem saldo de lote no sistema)';
      end if;
    end if;

    -- Saldo do material no satelite (trava; recusa se faltar)
    perform public.fn_saidas_conferir_saldo(v_item, 'warehouse', v_loc, v_qty);

    for r in
      -- lote digitado sem saldo no sistema: sai sem abater lote (so anotado);
      -- sem lote nenhum: FEFO; lote escolhido: abate dele.
      select null::uuid as lote_id, v_qty as quantidade where v_nota is not null
      union all
      select * from public.fn_saidas_consumir_lotes(v_item, v_loc, v_qty, v_lot, false,
               nullif(btrim(coalesce(it->>'justificativa_vencido','')),'')) where v_nota is null
    loop
      insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
        source_location_id, reason, reason_detail, destino_tipo, destino_nome, performed_by, notes,
        expiry_tracking_id, historico)
      values (v_item, 'warehouse', 'SAIDA_AVULSA', 'out', r.quantidade, v_loc,
        'outro', 'Dispensacao de material', 'setor_interno', p_sector, v_uid, p_notes,
        r.lote_id, case when r.lote_id is null then v_nota end);
    end loop;

    v_count := v_count + 1;
    v_total := v_total + v_qty;
  end loop;

  return public.fn_saidas_gravar_resultado(p_chave,
    jsonb_build_object('itens', v_count, 'quantidade_total', v_total, 'local', v_code, 'setor', p_sector));
end $f$;
revoke execute on function public.criar_saida_material(text, text, jsonb, text, uuid) from public, anon;
grant execute on function public.criar_saida_material(text, text, jsonb, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
drop policy if exists "Auth insert dispensations" on public.pharmacy_dispensations;
drop policy if exists "Auth update dispensations" on public.pharmacy_dispensations;
drop policy if exists "Auth insert dispensation items" on public.pharmacy_dispensation_items;
revoke insert, update, delete, truncate on public.pharmacy_dispensations from anon, authenticated;
revoke insert, update, delete, truncate on public.pharmacy_dispensation_items from anon, authenticated;
