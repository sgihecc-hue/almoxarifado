-- =============================================================================
-- 07/10/2026: INVENTARIO DA FARMACIA (pedido da Andressa).
--
-- Grade com lote, validade e quantidade de todos os medicamentos do estoque
-- escolhido (CAF ou satelite). Cada alteracao salva entra NA HORA no estoque,
-- como ajuste de inventario, sem pedir motivo. O nome do medicamento nao muda.
--
-- Quem pode: so as pessoas da lista farmacia_inventario_acesso (Andressa,
-- Pedro Paulo, Roselia e a nova coordenadora Cristianne quando tiver usuario).
-- A lista so e mexida pelo banco (service_role) ou por administrador.
--
-- Historico: cada mudanca de quantidade vira um movimento AJUSTE ligado ao
-- proprio lote (expiry_tracking_id), com o antes/depois nas notas. Depois o
-- saldo do local e acertado pela soma dos lotes (corrige lote negativo
-- escondido e saldo sem lote).
-- =============================================================================

create table if not exists public.farmacia_inventario_acesso (
  user_id uuid primary key references public.users(id) on delete cascade,
  incluido_em timestamptz not null default now(),
  incluido_por uuid
);
alter table public.farmacia_inventario_acesso enable row level security;

drop policy if exists inv_farm_acesso_le on public.farmacia_inventario_acesso;
create policy inv_farm_acesso_le on public.farmacia_inventario_acesso
  for select to authenticated using (true);

drop policy if exists inv_farm_acesso_admin on public.farmacia_inventario_acesso;
create policy inv_farm_acesso_admin on public.farmacia_inventario_acesso
  for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('administrador','admin')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('administrador','admin')));

revoke all on public.farmacia_inventario_acesso from anon;

insert into public.farmacia_inventario_acesso(user_id)
select id from public.users
 where full_name in ('Andressa Silva de Souza', 'Pedro Paulo Silva de Assis Junior', 'Roselia Delgado das Chagas')
   and coalesce(is_active, true)
on conflict do nothing;

-- Pode usar o inventario da farmacia?
create or replace function public.farmacia_inventario_pode()
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.farmacia_inventario_acesso a
      join public.users u on u.id = a.user_id
     where a.user_id = auth.uid() and coalesce(u.is_active, true)
  );
$$;

-- Grade: todos os itens ativos do catalogo do estoque + os lotes NAQUELE local
-- (inclusive zerados e negativos, para poder corrigir).
create or replace function public.farmacia_inventario_grade(p_location_code text)
returns table(item_id uuid, item_name text, item_code text, unidade text, nao_padronizado boolean,
              saldo integer, lot_id uuid, lote text, validade date, quantidade integer)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_loc uuid;
begin
  if not public.farmacia_inventario_pode() then
    raise exception 'Sem permissao para o inventario da farmacia.';
  end if;
  select id into v_loc from public.stock_locations where code = p_location_code;
  if v_loc is null or p_location_code not in ('CAF','SAT_1','SAT_2','SAT_T') then
    raise exception 'Estoque invalido.';
  end if;

  if p_location_code = 'SAT_T' then
    return query
      select w.id, w.name, w.code, w.unit, false,
             coalesce(s.quantity, 0)::integer, e.id, e.batch_number, e.expiry_date, e.current_quantity
        from public.warehouse_items w
        left join public.item_stocks s on s.item_id = w.id and s.location_id = v_loc
        left join public.expiry_tracking e on e.item_id = w.id and e.location_id = v_loc
       where coalesce(w.is_active, true)
       order by w.name, e.expiry_date nulls last, e.batch_number;
  else
    return query
      select p.id, p.name, p.code, p.unit, coalesce(p.nao_padronizado, false),
             coalesce(s.quantity, 0)::integer, e.id, e.batch_number, e.expiry_date, e.current_quantity
        from public.pharmacy_items p
        left join public.item_stocks s on s.item_id = p.id and s.location_id = v_loc
        left join public.expiry_tracking e on e.item_id = p.id and e.location_id = v_loc
       where coalesce(p.is_active, true)
       order by p.name, e.expiry_date nulls last, e.batch_number;
  end if;
end $$;

-- Salva UM lote (existente ou novo). Entra no estoque na hora.
create or replace function public.farmacia_inventario_salvar(
  p_location_code text, p_item_id uuid, p_lot_id uuid,
  p_lote text, p_validade date, p_quantidade integer)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_loc uuid;
  v_tipo text;
  v_lot record;
  v_delta integer;
  v_lote text := nullif(btrim(coalesce(p_lote, '')), '');
  v_nota text;
  v_ajuste_saldo integer;
  v_saldo integer;
begin
  if not public.farmacia_inventario_pode() then
    raise exception 'Sem permissao para o inventario da farmacia.';
  end if;
  if p_quantidade is null or p_quantidade < 0 then
    raise exception 'Quantidade invalida (precisa ser 0 ou mais).';
  end if;
  select id into v_loc from public.stock_locations where code = p_location_code;
  if v_loc is null or p_location_code not in ('CAF','SAT_1','SAT_2','SAT_T') then
    raise exception 'Estoque invalido.';
  end if;
  v_tipo := case when p_location_code = 'SAT_T' then 'warehouse' else 'pharmacy' end;
  if v_tipo = 'pharmacy' and not exists (select 1 from public.pharmacy_items where id = p_item_id) then
    raise exception 'Medicamento invalido.';
  end if;
  if v_tipo = 'warehouse' and not exists (select 1 from public.warehouse_items where id = p_item_id) then
    raise exception 'Item invalido.';
  end if;

  if p_lot_id is not null then
    select * into v_lot from public.expiry_tracking where id = p_lot_id for update;
    if not found or v_lot.item_id <> p_item_id or v_lot.location_id is distinct from v_loc then
      raise exception 'Lote nao pertence a este item/estoque.';
    end if;
    v_delta := p_quantidade - v_lot.current_quantity;
    v_nota := format('Inventario da farmacia: lote %s%s, qtd %s -> %s%s',
      coalesce(v_lot.batch_number, 'sem lote'),
      case when v_lote is distinct from v_lot.batch_number then ' (renomeado para ' || coalesce(v_lote, 'sem lote') || ')' else '' end,
      v_lot.current_quantity, p_quantidade,
      case when p_validade is distinct from v_lot.expiry_date
           then ', validade ' || coalesce(to_char(v_lot.expiry_date, 'DD/MM/YYYY'), '-') || ' -> ' || coalesce(to_char(p_validade, 'DD/MM/YYYY'), '-')
           else '' end);
    if v_delta <> 0 then
      insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
        source_location_id, target_location_id, expiry_tracking_id, reason, notes, performed_by, performed_at)
      values (p_item_id, v_tipo, 'AJUSTE', case when v_delta > 0 then 'in' else 'out' end, abs(v_delta),
        case when v_delta < 0 then v_loc end, case when v_delta > 0 then v_loc end,
        p_lot_id, 'ajuste_inventario', v_nota, v_uid, now());
    end if;
    update public.expiry_tracking
       set batch_number = v_lote, expiry_date = p_validade, current_quantity = p_quantidade
     where id = p_lot_id;
  else
    if p_quantidade = 0 and v_lote is null then
      raise exception 'Informe o lote ou a quantidade do lote novo.';
    end if;
    insert into public.expiry_tracking(item_id, batch_number, expiry_date, initial_quantity, current_quantity, location_id, created_by)
    values (p_item_id, v_lote, p_validade, p_quantidade, p_quantidade, v_loc, v_uid)
    returning * into v_lot;
    if p_quantidade > 0 then
      insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
        target_location_id, expiry_tracking_id, reason, notes, performed_by, performed_at)
      values (p_item_id, v_tipo, 'AJUSTE', 'in', p_quantidade, v_loc, v_lot.id, 'ajuste_inventario',
        format('Inventario da farmacia: lote novo %s, validade %s, qtd %s',
          coalesce(v_lote, 'sem lote'), coalesce(to_char(p_validade, 'DD/MM/YYYY'), '-'), p_quantidade),
        v_uid, now());
    end if;
  end if;

  -- Saldo do local = soma dos lotes (corrige saldo sem lote / divergencia antiga).
  v_ajuste_saldo := public.fn_saidas_ajustar_local_pela_soma_dos_lotes(p_item_id, v_tipo, v_loc, v_uid,
    'Inventario da farmacia: saldo acertado pela soma dos lotes');
  select quantity into v_saldo from public.item_stocks where item_id = p_item_id and location_id = v_loc;

  return jsonb_build_object('ok', true, 'lot_id', v_lot.id, 'saldo', coalesce(v_saldo, 0), 'ajuste_saldo', v_ajuste_saldo);
end $$;

revoke all on function public.farmacia_inventario_pode() from public, anon;
revoke all on function public.farmacia_inventario_grade(text) from public, anon;
revoke all on function public.farmacia_inventario_salvar(text, uuid, uuid, text, date, integer) from public, anon;
grant execute on function public.farmacia_inventario_pode() to authenticated, service_role;
grant execute on function public.farmacia_inventario_grade(text) to authenticated, service_role;
grant execute on function public.farmacia_inventario_salvar(text, uuid, uuid, text, date, integer) to authenticated, service_role;
