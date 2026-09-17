-- =====================================================================
-- Devolução: a FARMÁCIA volta a poder registrar (decisão de 17/09/2026).
-- Enfermagem continua enviando como pendente. Quando quem registra é da
-- farmácia (e não da enfermagem), a devolução já nasce confirmada: a própria
-- farmácia está recebendo o material, então lote + saldo + movimento + status
-- são gravados na mesma transação, pela farmacia_devolucao_confirmar.
-- Origem continua obrigatória entre os setores de enfermagem.
-- Só farmácia.
-- =====================================================================
create or replace function public.farmacia_devolucao_enviar(
  p_origem_department_id uuid,
  p_target_location_id   uuid,
  p_returned_at          date,
  p_motivo               text,
  p_observacao           text,
  p_patient_name         text,
  p_prontuario           text,
  p_itens                jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_role      text;
  v_enf       boolean;
  v_farmacia  boolean;
  v_id        uuid;
  v_numero    int;
  v_it        jsonb;
  v_item      uuid;
  v_qtd       int;
  v_lote      text;
  v_val       date;
  v_n         int := 0;
  v_status    text := 'pending';
begin
  if v_uid is null then
    raise exception 'Usuario nao autenticado.';
  end if;
  select role into v_role from public.users where id = v_uid and coalesce(is_active, true);
  v_enf := public.fn_eh_enfermagem(v_uid);
  v_farmacia := coalesce(v_role, '') in ('atendente','gestor','administrador','admin','pharmacist');
  if not (v_enf or v_farmacia) then
    raise exception 'Seu perfil nao registra devolucao. A devolucao e feita pela enfermagem ou pela farmacia.';
  end if;
  if not exists (select 1 from public.farmacia_setores_enfermagem where department_id = p_origem_department_id) then
    raise exception 'Selecione o posto/setor de origem da devolucao.';
  end if;
  if not exists (select 1 from public.stock_locations
                 where id = p_target_location_id and (code = 'CAF' or code like 'SAT%')) then
    raise exception 'Estoque de destino invalido.';
  end if;
  if coalesce(p_motivo, '') not in ('melhora_clinica','suspensao_medica','erro_dispensacao','alta_paciente',
                                    'obito','troca_terapeutica','recusa_paciente','sem_acesso_venoso',
                                    'encontrado_posto','outro') then
    raise exception 'Selecione o motivo da devolucao.';
  end if;
  if p_returned_at is not null and p_returned_at > (now() at time zone 'America/Bahia')::date then
    raise exception 'A data da devolucao nao pode ser futura.';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Adicione ao menos um item.';
  end if;

  insert into public.stock_returns (
    target_location_id, returned_by_user_id, returned_at, department_id,
    patient_name, patient_prontuario, return_reason, observacao, return_status)
  values (
    p_target_location_id, v_uid,
    coalesce((p_returned_at::text || ' 12:00:00 America/Bahia')::timestamptz, now()),
    p_origem_department_id,
    nullif(btrim(p_patient_name), ''), nullif(btrim(p_prontuario), ''),
    p_motivo, nullif(btrim(p_observacao), ''), 'pending')
  returning id, return_number into v_id, v_numero;

  for v_it in select value from jsonb_array_elements(p_itens) loop
    v_item := nullif(v_it->>'item_id', '')::uuid;
    v_qtd  := nullif(v_it->>'quantity', '')::int;
    v_lote := nullif(btrim(v_it->>'batch_number'), '');
    v_val  := nullif(v_it->>'expiry_date', '')::date;
    if v_item is null or not exists (select 1 from public.pharmacy_items where id = v_item) then
      raise exception 'Item invalido na devolucao.';
    end if;
    if v_qtd is null or v_qtd <= 0 then
      raise exception 'Quantidade deve ser maior que zero.';
    end if;
    if v_lote is null or v_val is null then
      raise exception 'Informe lote e validade de cada item.';
    end if;
    insert into public.stock_return_items (return_id, item_id, item_type, quantity, batch_number, expiry_date)
    values (v_id, v_item, 'pharmacy', v_qtd, v_lote, v_val);
    v_n := v_n + 1;
  end loop;

  -- Farmácia registrando: ela mesma recebe, então confirma na hora com as
  -- quantidades informadas (a enfermagem continua mandando como pendente).
  if v_farmacia and not v_enf then
    perform public.farmacia_devolucao_confirmar(
      v_id,
      (select jsonb_agg(jsonb_build_object('id', i.id, 'confirmed_quantity', i.quantity))
         from public.stock_return_items i where i.return_id = v_id),
      null);
    v_status := 'confirmed';
  end if;

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'itens', v_n, 'status', v_status);
end $fn$;
revoke all on function public.farmacia_devolucao_enviar(uuid, uuid, date, text, text, text, text, jsonb) from public, anon;
grant execute on function public.farmacia_devolucao_enviar(uuid, uuid, date, text, text, text, text, jsonb) to authenticated;
