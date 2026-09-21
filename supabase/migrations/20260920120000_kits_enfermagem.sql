-- KITS E AVULSOS PELA ENFERMAGEM — pedido atendido pela Satelite Terreo.
-- Spec: docs/superpowers/specs/2026-09-20-kits-enfermagem-design.md
--
-- O enfermeiro pede "5 x Kit Banho" e diz pra quais pacientes. A satelite
-- recebe os ITENS SOMADOS (5 x 2A = 10A...) e atende com a tela e as RPCs que
-- ja existem. Kit e pacientes ficam nas tabelas novas abaixo, ligados ao
-- pedido, so pra rastreio e relatorio.
--
-- ALMOXARIFADO INTOCADO (regra do projeto): tudo aqui e NOVO — 4 tabelas, 1
-- RPC e uma coluna nova em patients. Nenhuma tabela, RPC ou politica existente
-- e alterada. O pedido gerado e um pedido de material comum (type='warehouse',
-- origem SAT_T), igual aos que os Postos ja fazem hoje.

-- 1) Catalogo de kits ---------------------------------------------------------
create table public.kits (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index kits_name_unique on public.kits (lower(btrim(name)));

-- item_type ja existe pensando no dia em que um kit puder levar medicamento.
-- Hoje a tela so cadastra material, e a RPC recusa qualquer outra coisa.
create table public.kit_items (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references public.kits(id) on delete cascade,
  item_type text not null default 'warehouse' check (item_type in ('warehouse','pharmacy')),
  warehouse_item_id uuid references public.warehouse_items(id),
  pharmacy_item_id uuid references public.pharmacy_items(id),
  quantity integer not null check (quantity > 0),
  unit text,
  created_at timestamptz not null default now(),
  check (
    (item_type = 'warehouse' and warehouse_item_id is not null and pharmacy_item_id is null)
    or (item_type = 'pharmacy' and pharmacy_item_id is not null and warehouse_item_id is null)
  )
);
create index kit_items_kit on public.kit_items (kit_id);
create unique index kit_items_sem_repeticao on public.kit_items
  (kit_id, coalesce(warehouse_item_id, pharmacy_item_id));

-- 2) O que foi pedido, por kit e por paciente ---------------------------------
-- kit_name/patient_name sao COPIA do nome no momento do pedido: renomear ou
-- recompor o kit depois nao reescreve o historico.
create table public.request_kits (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  kit_id uuid references public.kits(id),
  kit_name text not null,
  patient_id uuid references public.patients(id),
  patient_name text not null,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now()
);
create index request_kits_request on public.request_kits (request_id);
create index request_kits_patient on public.request_kits (patient_id);

create table public.request_item_patients (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  request_item_id uuid references public.request_items(id) on delete cascade,
  warehouse_item_id uuid references public.warehouse_items(id),
  item_name text not null,
  patient_id uuid references public.patients(id),
  patient_name text not null,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now()
);
create index request_item_patients_request on public.request_item_patients (request_id);
create index request_item_patients_patient on public.request_item_patients (patient_id);

-- 3) Paciente vindo de fora (fase 3) ------------------------------------------
-- Preenchido no dia em que o sistema do hospital mandar os pacientes por API.
-- Criado agora pra sincronizacao futura nao exigir remendo no historico.
alter table public.patients add column if not exists external_id text;
create unique index if not exists patients_external_id_unique on public.patients (external_id)
  where external_id is not null;

-- 4) RLS ----------------------------------------------------------------------
alter table public.kits enable row level security;
alter table public.kit_items enable row level security;
alter table public.request_kits enable row level security;
alter table public.request_item_patients enable row level security;

create policy "kits_read" on public.kits for select to authenticated using (true);
create policy "kits_write" on public.kits for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid()
                  and u.role in ('administrador','gestor','admin','manager')))
  with check (exists (select 1 from public.users u where u.id = auth.uid()
                  and u.role in ('administrador','gestor','admin','manager')));

create policy "kit_items_read" on public.kit_items for select to authenticated using (true);
create policy "kit_items_write" on public.kit_items for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid()
                  and u.role in ('administrador','gestor','admin','manager')))
  with check (exists (select 1 from public.users u where u.id = auth.uid()
                  and u.role in ('administrador','gestor','admin','manager')));

-- Leitura pra quem ja enxerga o pedido; a escrita e so da RPC (security definer).
create policy "request_kits_read" on public.request_kits for select to authenticated using (true);
create policy "request_item_patients_read" on public.request_item_patients for select to authenticated using (true);

-- 5) RPC: cria o pedido de enfermagem numa transacao --------------------------
-- p_kits:    [{kit_id, pacientes:[{patient_id, quantity}]}]
-- p_avulsos: [{item_id, patient_id, quantity}]
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
  select default_warehouse_location_id into v_dept_loc from public.departments where id = p_department_id;
  -- So setor atendido pela Satelite Terreo. Sem isso o pedido cairia na caixa
  -- de outro estoque e ninguem atenderia.
  if v_dept_loc is distinct from v_sat then
    raise exception 'Este setor nao e atendido pela Satelite Terreo.';
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

  -- Itens somados: o que a satelite vai separar. Uma linha por item, somando
  -- a explosao dos kits com os avulsos.
  create temporary table tmp_itens(item_id uuid primary key, quantity integer not null)
    on commit drop;

  -- 5.1) Kits
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

    -- Explode a composicao multiplicando pelo total de kits pedidos.
    insert into tmp_itens(item_id, quantity)
    select ki.warehouse_item_id, ki.quantity * v_kit_qtd
      from public.kit_items ki
     where ki.kit_id = v_kit and ki.item_type = 'warehouse'
    on conflict (item_id) do update set quantity = tmp_itens.quantity + excluded.quantity;

    if exists (select 1 from public.kit_items where kit_id = v_kit and item_type <> 'warehouse') then
      raise exception 'Kit % tem item que nao e material. Nesta versao o kit so leva material.', v_kit_name;
    end if;
  end loop;

  -- 5.2) Avulsos (paciente por linha)
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

  -- 5.3) Grava os itens somados e liga cada avulso a sua linha
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

revoke execute on function public.criar_pedido_enfermagem(uuid, jsonb, jsonb, text, text, text) from public, anon;
grant execute on function public.criar_pedido_enfermagem(uuid, jsonb, jsonb, text, text, text) to authenticated;
