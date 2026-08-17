-- Carros de Emergência (A, B, C e D).
--
-- Por que NÃO é um stock_location: cada linha de stock_locations opera com um
-- único item_type ('pharmacy' OU 'warehouse'), e o carro de emergência carrega
-- MEDICAMENTOS E MATERIAIS ao mesmo tempo. Além disso o carro não é um estoque
-- de onde se dispensa — é um kit lacrado que a enfermagem confere. Por isso vira
-- entidade própria, fora do seletor de estoque do topo.
--
-- Nesta primeira entrega o carro NÃO abate saldo de satélite: é só o cadastro do
-- conteúdo (o que deveria estar dentro) e a conferência de lote/validade. O
-- fluxo de reposição que debita a satélite entra depois.
--
-- Nada aqui encosta no almoxarifado: emergency_cart_items apenas REFERENCIA o id
-- do item (pharmacy_items ou warehouse_items) sem FK e sem tocar em saldo.

-- -----------------------------------------------------------------
-- 1. Carros
-- -----------------------------------------------------------------
create table if not exists public.emergency_carts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,            -- 'A','B','C','D'
  name text not null,                   -- 'Carro de Emergência A'
  registration_number text,             -- nasce nulo; os usuários preenchem/editam
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.emergency_carts is
  'Carros de emergência do hospital (A, B, C, D). Não é stock_location: o carro mistura medicamentos e materiais.';
comment on column public.emergency_carts.registration_number is
  'Número de registro do carro, preenchido e editável pelos usuários da farmácia. Começa vazio.';

-- -----------------------------------------------------------------
-- 2. Conteúdo do carro
-- -----------------------------------------------------------------
-- item_id aponta para pharmacy_items OU warehouse_items conforme item_type —
-- por isso não há FK (o Postgres não faz FK condicional). A resolução do nome
-- é feita no serviço, consultando os dois catálogos.
create table if not exists public.emergency_cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.emergency_carts(id) on delete cascade,
  item_id uuid not null,
  item_type text not null check (item_type in ('pharmacy','warehouse')),
  quantity integer not null default 0 check (quantity >= 0),
  min_quantity integer,                 -- quantidade padrão do carro (base da conferência)
  batch_number text,
  expiry_date date,
  source_location_id uuid references public.stock_locations(id), -- satélite de origem
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.emergency_cart_items.item_id is
  'Id em pharmacy_items (item_type=pharmacy) ou warehouse_items (item_type=warehouse). Sem FK: catálogo depende do tipo.';
comment on column public.emergency_cart_items.min_quantity is
  'Quantidade padrão que o carro deve ter deste item — referência do checklist da enfermagem.';
comment on column public.emergency_cart_items.source_location_id is
  'Satélite que abasteceu (SAT_1/SAT_2/SAT_T). Informativo: nesta entrega o carro não debita saldo.';

-- A tela sempre carrega o conteúdo de UM carro; o segundo índice atende o
-- corte por tipo (medicamentos x materiais) dentro do carro.
create index if not exists emergency_cart_items_cart_idx
  on public.emergency_cart_items (cart_id);
create index if not exists emergency_cart_items_cart_type_idx
  on public.emergency_cart_items (cart_id, item_type);

-- -----------------------------------------------------------------
-- 3. Seed dos 4 carros (idempotente por code)
-- -----------------------------------------------------------------
insert into public.emergency_carts (code, name)
select v.code, v.name
from (values
  ('A', 'Carro de Emergência A'),
  ('B', 'Carro de Emergência B'),
  ('C', 'Carro de Emergência C'),
  ('D', 'Carro de Emergência D')
) as v(code, name)
where not exists (
  select 1 from public.emergency_carts c where c.code = v.code
);

-- -----------------------------------------------------------------
-- 4. RLS
-- -----------------------------------------------------------------
-- Leitura: todo usuário logado (a enfermagem confere o carro). Sem anon.
-- Escrita: papéis que operam a farmácia — mesmo conjunto usado em
-- item_stocks_update / pharmacy_items_update.
alter table public.emergency_carts enable row level security;
alter table public.emergency_cart_items enable row level security;

revoke select on public.emergency_carts from anon;
revoke select on public.emergency_cart_items from anon;

drop policy if exists emergency_carts_select on public.emergency_carts;
create policy emergency_carts_select on public.emergency_carts
  for select to authenticated using (true);

drop policy if exists emergency_carts_insert on public.emergency_carts;
create policy emergency_carts_insert on public.emergency_carts
  for insert to authenticated
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = any (array['admin','administrador','gestor','atendente','pharmacist'])
    )
  );

drop policy if exists emergency_carts_update on public.emergency_carts;
create policy emergency_carts_update on public.emergency_carts
  for update to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = any (array['admin','administrador','gestor','atendente','pharmacist'])
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = any (array['admin','administrador','gestor','atendente','pharmacist'])
    )
  );

-- Apagar carro é estrutural (são 4 fixos) — só administrador/gestor.
drop policy if exists emergency_carts_delete on public.emergency_carts;
create policy emergency_carts_delete on public.emergency_carts
  for delete to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = any (array['admin','administrador','gestor'])
    )
  );

drop policy if exists emergency_cart_items_select on public.emergency_cart_items;
create policy emergency_cart_items_select on public.emergency_cart_items
  for select to authenticated using (true);

drop policy if exists emergency_cart_items_insert on public.emergency_cart_items;
create policy emergency_cart_items_insert on public.emergency_cart_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = any (array['admin','administrador','gestor','atendente','pharmacist'])
    )
  );

drop policy if exists emergency_cart_items_update on public.emergency_cart_items;
create policy emergency_cart_items_update on public.emergency_cart_items
  for update to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = any (array['admin','administrador','gestor','atendente','pharmacist'])
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = any (array['admin','administrador','gestor','atendente','pharmacist'])
    )
  );

-- Remover item do carro é operação de rotina da farmácia (troca de lote,
-- item que saiu do padrão) — mesmo conjunto de papéis da escrita.
drop policy if exists emergency_cart_items_delete on public.emergency_cart_items;
create policy emergency_cart_items_delete on public.emergency_cart_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = any (array['admin','administrador','gestor','atendente','pharmacist'])
    )
  );
