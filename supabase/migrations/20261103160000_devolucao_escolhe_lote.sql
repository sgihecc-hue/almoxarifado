-- Devolucao interna (03/11/2026, Andressa): o lote era digitado e, na
-- confirmacao, so casava com texto identico; cada erro de digitacao
-- (RWW25003A x RWA25003A, 25E9FO x 25E9F0) criava lote novo no estoque e ele
-- voltava a aparecer na dispensacao. Agora a tela escolhe o lote que ja existe
-- no estoque (expiry_tracking_id) e, sem escolha, o casamento ignora
-- pontuacao. Lote novo so quando nao ha nenhum parecido.

CREATE OR REPLACE FUNCTION public.farmacia_devolucao_enviar(p_origem_department_id uuid, p_target_location_id uuid, p_returned_at date, p_motivo text, p_observacao text, p_patient_name text, p_prontuario text, p_itens jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_et        uuid;
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
    -- Lote escolhido da lista (03/11): vale o lote do estoque de destino,
    -- com o numero e a validade de la. Lote digitado so quando nao escolheu.
    v_et := nullif(v_it->>'expiry_tracking_id', '')::uuid;
    if v_et is not null then
      select batch_number, expiry_date into v_lote, v_val from public.expiry_tracking
       where id = v_et and item_id = v_item and location_id = p_target_location_id;
      if not found then
        raise exception 'Lote escolhido nao pertence a este item/estoque.';
      end if;
      v_val := coalesce(v_val, nullif(v_it->>'expiry_date', '')::date);
    end if;
    if v_lote is null or v_val is null then
      raise exception 'Informe lote e validade de cada item.';
    end if;
    insert into public.stock_return_items (return_id, item_id, item_type, quantity, batch_number, expiry_date, expiry_tracking_id)
    values (v_id, v_item, 'pharmacy', v_qtd, v_lote, v_val, v_et);
    v_n := v_n + 1;
  end loop;

  -- FarmÃ¡cia registrando: ela mesma recebe, entÃ£o confirma na hora com as
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
end $function$;

CREATE OR REPLACE FUNCTION public.farmacia_devolucao_confirmar(p_return_id uuid, p_itens jsonb, p_divergencia text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_role  text;
  v_ret   public.stock_returns%rowtype;
  v_item  record;
  v_conf  int;
  v_div   boolean := false;
  v_et    uuid;
  v_preco numeric;
  v_total int := 0;
  v_esc   uuid;
begin
  if v_uid is null then
    raise exception 'Usuario nao autenticado.';
  end if;
  select role into v_role from public.users where id = v_uid and coalesce(is_active, true);
  if coalesce(v_role, '') not in ('atendente','gestor','administrador','admin','pharmacist') then
    raise exception 'Somente a farmacia confirma o recebimento de devolucoes.';
  end if;

  select * into v_ret from public.stock_returns where id = p_return_id for update;
  if not found then
    raise exception 'Devolucao nao encontrada.';
  end if;
  if v_ret.return_status <> 'pending' then
    raise exception 'Esta devolucao ja foi confirmada.';
  end if;

  for v_item in select * from public.stock_return_items where return_id = p_return_id order by id loop
    select nullif(e->>'confirmed_quantity', '')::int into v_conf
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
    where e->>'id' = v_item.id::text
    limit 1;
    if v_conf is null then
      raise exception 'Informe a quantidade recebida de todos os itens.';
    end if;
    if v_conf < 0 or v_conf > v_item.quantity then
      raise exception 'Quantidade recebida invalida: deve ficar entre 0 e %.', v_item.quantity;
    end if;
    if v_conf <> v_item.quantity then
      v_div := true;
    end if;

    v_et := null;
    if v_conf > 0 then
      -- Lote: o escolhido na confirmacao, senao o escolhido no envio. Sem
      -- escolha, casa o texto ignorando ponto/traco/barra/espaco (03/11:
      -- devolucao digitada criava lote novo a cada erro de digitacao).
      select nullif(e->>'expiry_tracking_id', '')::uuid into v_esc
      from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
      where e->>'id' = v_item.id::text
      limit 1;
      v_esc := coalesce(v_esc, v_item.expiry_tracking_id);
      if v_esc is not null then
        select id into v_et from public.expiry_tracking
         where id = v_esc and item_id = v_item.item_id and location_id = v_ret.target_location_id
         for update;
        if v_et is null then
          raise exception 'Lote escolhido nao pertence a este item/estoque.';
        end if;
      else
        select id into v_et from public.expiry_tracking
         where item_id = v_item.item_id
           and location_id = v_ret.target_location_id
           and regexp_replace(upper(batch_number), '[^A-Z0-9]', '', 'g')
             = regexp_replace(upper(v_item.batch_number), '[^A-Z0-9]', '', 'g')
         order by (coalesce(current_quantity, 0) > 0) desc, created_at
         limit 1
         for update;
      end if;
      if v_et is not null then
        -- Lote que ja existe: so soma. A validade e a do lote do estoque.
        update public.expiry_tracking
           set current_quantity = coalesce(current_quantity, 0) + v_conf,
               expiry_date = coalesce(expiry_date, v_item.expiry_date)
         where id = v_et;
      else
        insert into public.expiry_tracking (item_id, batch_number, expiry_date, initial_quantity,
                                            current_quantity, location_id, created_by)
        values (v_item.item_id, v_item.batch_number, v_item.expiry_date, v_conf, v_conf,
                v_ret.target_location_id, v_uid)
        returning id into v_et;
      end if;

      select price into v_preco from public.pharmacy_items where id = v_item.item_id;
      insert into public.stock_movements (item_id, item_type, movement_type, direction, quantity, unit_cost,
                                          target_location_id, return_id, performed_by, expiry_tracking_id)
      values (v_item.item_id, 'pharmacy', 'DEVOLUCAO_INT', 'in', v_conf, v_preco,
              v_ret.target_location_id, p_return_id, v_uid, v_et);
      v_total := v_total + v_conf;
    end if;

    update public.stock_return_items
       set confirmed_quantity = v_conf, expiry_tracking_id = v_et
     where id = v_item.id;
  end loop;

  if v_div and length(btrim(coalesce(p_divergencia, ''))) < 5 then
    raise exception 'A quantidade recebida difere da enviada: descreva a divergencia.';
  end if;

  update public.stock_returns
     set return_status = 'confirmed', confirmed_by = v_uid, confirmed_at = now(),
         divergence_notes = nullif(btrim(p_divergencia), '')
   where id = p_return_id;

  return jsonb_build_object('id', p_return_id, 'recebido', v_total, 'divergencia', v_div);
end $function$;
