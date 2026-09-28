-- =============================================================================
-- CRIAR SOLICITACAO numa transacao so, com chave contra envio duplicado
-- (auditoria de 28/09/2026 — achados M8 e A3)
--
-- M8 A tela criava o pedido e DEPOIS os itens, em duas chamadas. Se a segunda
--    falhasse ficava um pedido vazio na fila (e o solicitante nao consegue
--    apagar: requests_delete so aceita 'draft').
--    -> criar_solicitacao: cabecalho + itens na mesma transacao.
-- A3 Pedido de enfermagem duplicava com dois cliques (o botao reabilitava antes
--    do navigate de 1,4s).
--    -> as duas funcoes aceitam p_chave (uuid gerado pela tela uma vez por
--       formulario). A mesma chave nao cria dois pedidos: a segunda chamada
--       devolve o pedido ja criado, com repetido=true.
-- =============================================================================

create table if not exists public.solicitacao_envios (
  chave      uuid primary key,
  request_id uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.solicitacao_envios enable row level security;
-- sem policies: so as funcoes SECURITY DEFINER abaixo escrevem/leem.
revoke all on public.solicitacao_envios from anon, authenticated;

-- Reserva a chave. Devolve o request_id ja criado com ela (repetido) ou null
-- (chave nova, reservada nesta transacao). Duas chamadas simultaneas com a
-- mesma chave: a segunda espera a primeira terminar e cai no unique_violation.
create or replace function public.fn_reservar_envio_solicitacao(p_chave uuid)
returns uuid language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare
  v_req uuid;
begin
  if p_chave is null then return null; end if;
  begin
    insert into public.solicitacao_envios(chave, created_by) values (p_chave, auth.uid());
    return null;
  exception when unique_violation then
    select request_id into v_req from public.solicitacao_envios where chave = p_chave;
    if v_req is null then
      raise exception 'Este pedido ja esta sendo enviado. Aguarde e confira em Minhas Solicitacoes.';
    end if;
    return v_req;
  end;
end $f$;
revoke execute on function public.fn_reservar_envio_solicitacao(uuid) from public, anon, authenticated;

-- 1) Solicitacao comum (farmacia ou almoxarifado) ---------------------------------
-- p_items: [{item_id, quantity}]
create or replace function public.criar_solicitacao(
  p_type text,
  p_priority text,
  p_department_id uuid,
  p_items jsonb,
  p_destination_department_id uuid default null,
  p_justification text default null,
  p_notes text default null,
  p_source_location_id uuid default null,
  p_chave uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_ativo boolean;
  v_existente uuid;
  v_src uuid := p_source_location_id;
  v_req uuid;
  v_num integer;
  it jsonb;
  v_item uuid;
  v_txt text;
  v_qty integer;
  v_nome text;
  v_count integer := 0;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  select coalesce(is_active, true) into v_ativo from public.users where id = v_uid;
  if v_ativo is null or not v_ativo then raise exception 'Usuario inativo ou sem cadastro.'; end if;

  v_existente := public.fn_reservar_envio_solicitacao(p_chave);
  if v_existente is not null then
    select request_number into v_num from public.requests where id = v_existente;
    return jsonb_build_object('request_id', v_existente, 'request_number', v_num, 'repetido', true);
  end if;

  if p_type not in ('pharmacy', 'warehouse') then raise exception 'Tipo de solicitacao invalido.'; end if;
  if coalesce(p_priority, '') not in ('low', 'medium', 'high') then raise exception 'Prioridade invalida.'; end if;
  if p_department_id is null or not exists (select 1 from public.departments where id = p_department_id) then
    raise exception 'Setor solicitante e obrigatorio.';
  end if;
  if p_destination_department_id is not null
     and not exists (select 1 from public.departments where id = p_destination_department_id) then
    raise exception 'Setor solicitado nao encontrado.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Pelo menos um item deve ser solicitado.';
  end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'Maximo de 50 itens por solicitacao.'; end if;

  -- Estoque de origem: o informado ou o padrao do setor para o tipo.
  if v_src is null then
    select case when p_type = 'pharmacy' then default_pharmacy_location_id else default_warehouse_location_id end
      into v_src from public.departments where id = p_department_id;
  end if;

  insert into public.requests(type, status, priority, requester_id, department_id,
    destination_department_id, justification, notes, source_location_id)
  values (p_type, 'pending', p_priority, v_uid, p_department_id,
    p_destination_department_id, coalesce(btrim(p_justification), ''),
    nullif(btrim(coalesce(p_notes, '')), ''), v_src)
  returning id, request_number into v_req, v_num;

  for it in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_item := nullif(it->>'item_id', '')::uuid;
    exception when others then
      raise exception 'Item invalido na solicitacao.';
    end;
    if v_item is null then raise exception 'Item invalido na solicitacao.'; end if;
    v_txt := btrim(coalesce(it->>'quantity', ''));
    if v_txt !~ '^\d+$' then
      raise exception 'Quantidade invalida: use numero inteiro, sem casas decimais.';
    end if;
    v_qty := v_txt::integer;
    if v_qty < 1 or v_qty > 10000 then
      raise exception 'Quantidade deve ser de 1 a 10000.';
    end if;

    if p_type = 'pharmacy' then
      select name into v_nome from public.pharmacy_items where id = v_item;
    else
      select name into v_nome from public.warehouse_items where id = v_item;
    end if;
    if v_nome is null then raise exception 'Item nao encontrado no cadastro.'; end if;

    if p_type = 'pharmacy' then
      insert into public.request_items(request_id, item_type, pharmacy_item_id, item_name, quantity)
      values (v_req, 'pharmacy', v_item, v_nome, v_qty);
    else
      insert into public.request_items(request_id, item_type, warehouse_item_id, item_name, quantity)
      values (v_req, 'warehouse', v_item, v_nome, v_qty);
    end if;
    v_count := v_count + 1;
  end loop;

  if p_chave is not null then
    update public.solicitacao_envios set request_id = v_req where chave = p_chave;
  end if;

  return jsonb_build_object('request_id', v_req, 'request_number', v_num, 'itens', v_count, 'repetido', false);
end $function$;
revoke execute on function public.criar_solicitacao(text, text, uuid, jsonb, uuid, text, text, uuid, uuid) from public, anon;
grant execute on function public.criar_solicitacao(text, text, uuid, jsonb, uuid, text, text, uuid, uuid) to authenticated;

-- 2) Pedido de enfermagem com chave ---------------------------------------------------
-- Corpo de producao (lido em 28/09/2026) preservado; so entram p_chave e a
-- reserva/registro da chave. DROP antes: com um parametro a mais ficariam duas
-- versoes e o PostgREST nao saberia qual chamar.
drop function if exists public.criar_pedido_enfermagem(uuid, jsonb, jsonb, text, text, text);
create or replace function public.criar_pedido_enfermagem(
  p_department_id uuid,
  p_kits jsonb default '[]'::jsonb,
  p_avulsos jsonb default '[]'::jsonb,
  p_priority text default 'medium'::text,
  p_justification text default null::text,
  p_notes text default null::text,
  p_chave uuid default null)
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
  v_existente uuid;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;

  select role into v_role from public.users where id = v_uid;
  if coalesce(v_role,'') not in ('administrador','gestor','atendente','solicitante','admin','manager') then
    raise exception 'Sem permissao para criar pedido de enfermagem.';
  end if;

  -- Mesma chave = mesmo envio (duplo clique / reenvio): devolve o que ja existe.
  v_existente := public.fn_reservar_envio_solicitacao(p_chave);
  if v_existente is not null then
    select request_number into v_req_num from public.requests where id = v_existente;
    return jsonb_build_object('request_id', v_existente, 'request_number', v_req_num,
      'itens', (select count(*) from public.request_items where request_id = v_existente),
      'kits', (select coalesce(sum(quantity), 0) from public.request_kits where request_id = v_existente),
      'repetido', true);
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

  -- (drop antes: duas chamadas na mesma transacao quebravam com "tmp_itens already exists")
  drop table if exists pg_temp.tmp_itens;
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

  if p_chave is not null then
    update public.solicitacao_envios set request_id = v_req where chave = p_chave;
  end if;

  return jsonb_build_object('request_id', v_req, 'request_number', v_req_num,
    'itens', v_total_itens, 'kits', v_kit_total, 'repetido', false);
end $function$;
revoke execute on function public.criar_pedido_enfermagem(uuid, jsonb, jsonb, text, text, text, uuid) from public, anon;
grant execute on function public.criar_pedido_enfermagem(uuid, jsonb, jsonb, text, text, text, uuid) to authenticated;
