-- PEDIDO DE KIT: liberado para os 5 setores de enfermagem.
--
-- A fase 1 aceitava so setor com default_warehouse_location_id = SAT_T, que
-- sao os 3 Postos. Mas 114 dos 137 usuarios de enfermagem estao na Unidade de
-- Internacao, que nao e roteada pra Satelite Terreo: a maior parte da
-- enfermagem nao conseguia pedir kit. Decisao do Adonias (21/09/2026): os 5
-- setores de farmacia_setores_enfermagem pedem, e o pedido vai sempre pra
-- Satelite Terreo.
--
-- Nao muda o roteamento dos pedidos NORMAIS de material desses setores
-- (departments nao e tocado) — o almoxarifado nao e afetado.
--
-- Corpo gerado a partir do que estava em producao; a unica mudanca e a
-- checagem do setor.

create or replace function public.criar_pedido_enfermagem(
  p_department_id uuid,
  p_kits jsonb default '[]'::jsonb,
  p_avulsos jsonb default '[]'::jsonb,
  p_priority text default 'medium',
  p_justification text default null,
  p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_sat uuid;
  v_dept_loc uuid;
  v_req uuid;
  v_req_num integer;
  k jsonb; pac jsonb; a jsonb;
  v_kit uuid; v_kit_name text; v_kit_qtd integer; v_kit_total integer := 0;
  v_pat uuid; v_pat_name text; v_qtd integer;
  v_item uuid; v_item_name text; v_item_unit text;
  v_total_itens integer := 0;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;

  select role into v_role from public.users where id = v_uid;
  if coalesce(v_role,'') not in ('administrador','gestor','atendente','solicitante','admin','manager') then
    raise exception 'Sem permissao para criar pedido de enfermagem.';
  end if;

  select id into v_sat from public.stock_locations where code = 'SAT_T';
  if v_sat is null then raise exception 'Estoque Satelite Terreo (SAT_T) nao encontrado.'; end if;

  if p_department_id is null then raise exception 'Setor solicitante e obrigatorio.'; end if;
  -- Quem pede kit: a lista oficial de setores de enfermagem (a mesma da
  -- devolucao e da regra de pacientes). O pedido vai SEMPRE pra Satelite
  -- Terreo (source_location_id = v_sat, abaixo), qualquer que seja o setor.
  if not exists (select 1 from public.farmacia_setores_enfermagem where department_id = p_department_id) then
    raise exception 'Pedido de kit e so para os setores de enfermagem.';
  end if;

  if (p_kits is null or jsonb_array_length(p_kits) = 0)
     and (p_avulsos is null or jsonb_array_length(p_avulsos) = 0) then
    raise exception 'Pedido sem kit e sem item avulso.';
  end if;

  insert into public.requests(type, status, priority, requester_id, department_id,
    justification, notes, source_location_id, needs_receipt_confirmation)
  values ('warehouse', 'pending', coalesce(nullif(btrim(coalesce(p_priority,'')),''),'medium'),
    v_uid, p_department_id, nullif(btrim(coalesce(p_justification,'')),''),
    nullif(btrim(coalesce(p_notes,'')),''), v_sat, false)
  returning id, request_number into v_req, v_req_num;

  create temporary table tmp_itens(item_id uuid primary key, quantity integer not null)
    on commit drop;

  for k in select value from jsonb_array_elements(coalesce(p_kits,'[]'::jsonb))
  loop
    v_kit := (k->>'kit_id')::uuid;
    if v_kit is null then raise exception 'Kit sem identificacao.'; end if;
    select name into v_kit_name from public.kits where id = v_kit and is_active;
    if v_kit_name is null then raise exception 'Kit nao encontrado ou inativo.'; end if;

    v_kit_qtd := 0;
    for pac in select value from jsonb_array_elements(coalesce(k->'pacientes','[]'::jsonb))
    loop
      v_pat := (pac->>'patient_id')::uuid;
      v_qtd := (pac->>'quantity')::integer;
      if v_pat is null then raise exception 'Kit % sem paciente.', v_kit_name; end if;
      if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade invalida no kit %.', v_kit_name; end if;
      select full_name into v_pat_name from public.patients where id = v_pat;
      if v_pat_name is null then raise exception 'Paciente nao encontrado.'; end if;

      insert into public.request_kits(request_id, kit_id, kit_name, patient_id, patient_name, quantity)
      values (v_req, v_kit, v_kit_name, v_pat, v_pat_name, v_qtd);
      v_kit_qtd := v_kit_qtd + v_qtd;
    end loop;
    if v_kit_qtd = 0 then raise exception 'Kit % sem paciente.', v_kit_name; end if;
    v_kit_total := v_kit_total + v_kit_qtd;

    if exists (select 1 from public.kit_items where kit_id = v_kit and item_type <> 'warehouse') then
      raise exception 'Kit % tem item que nao e material. Nesta versao o kit so leva material.', v_kit_name;
    end if;

    -- Composicao usada neste pedido (fotografia). O mesmo kit pode aparecer
    -- duas vezes no pedido; a segunda nao regrava a fotografia.
    insert into public.request_kit_items(request_id, kit_id, warehouse_item_id, item_name, quantity_por_kit)
    select v_req, v_kit, ki.warehouse_item_id, w.name, ki.quantity
      from public.kit_items ki join public.warehouse_items w on w.id = ki.warehouse_item_id
     where ki.kit_id = v_kit and ki.item_type = 'warehouse'
    on conflict (request_id, kit_id, warehouse_item_id) do nothing;

    insert into tmp_itens(item_id, quantity)
    select ki.warehouse_item_id, ki.quantity * v_kit_qtd
      from public.kit_items ki
     where ki.kit_id = v_kit and ki.item_type = 'warehouse'
    on conflict (item_id) do update set quantity = tmp_itens.quantity + excluded.quantity;
  end loop;

  for a in select value from jsonb_array_elements(coalesce(p_avulsos,'[]'::jsonb))
  loop
    v_item := (a->>'item_id')::uuid;
    v_pat  := (a->>'patient_id')::uuid;
    v_qtd  := (a->>'quantity')::integer;
    if v_item is null then raise exception 'Item avulso sem identificacao.'; end if;
    if v_pat is null then raise exception 'Item avulso sem paciente.'; end if;
    if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade invalida em um item avulso.'; end if;

    select name, unit into v_item_name, v_item_unit from public.warehouse_items where id = v_item;
    if v_item_name is null then raise exception 'Item de material nao encontrado.'; end if;
    select full_name into v_pat_name from public.patients where id = v_pat;
    if v_pat_name is null then raise exception 'Paciente nao encontrado.'; end if;

    insert into public.request_item_patients(request_id, warehouse_item_id, item_name,
      patient_id, patient_name, quantity)
    values (v_req, v_item, v_item_name, v_pat, v_pat_name, v_qtd);

    insert into tmp_itens(item_id, quantity) values (v_item, v_qtd)
    on conflict (item_id) do update set quantity = tmp_itens.quantity + excluded.quantity;
  end loop;

  insert into public.request_items(request_id, item_type, warehouse_item_id, item_name, quantity, unit)
  select v_req, 'warehouse', t.item_id, w.name, t.quantity, w.unit
    from tmp_itens t join public.warehouse_items w on w.id = t.item_id;
  get diagnostics v_total_itens = row_count;

  update public.request_item_patients rip
     set request_item_id = ri.id
    from public.request_items ri
   where ri.request_id = v_req
     and rip.request_id = v_req
     and ri.warehouse_item_id = rip.warehouse_item_id;

  return jsonb_build_object('request_id', v_req, 'request_number', v_req_num,
    'itens', v_total_itens, 'kits', v_kit_total);
end $function$;
