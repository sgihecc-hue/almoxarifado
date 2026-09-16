-- =====================================================================
-- Edição de item do almoxarifado: permissão por pessoa + registro auditável
-- Decisão de 16/09/2026 (Adonias): Anderson (atendente) pode editar itens do
-- almoxarifado, inclusive saldo, e TODA edição fica auditável, com motivo
-- obrigatório para todos (inclusive administradores).
--
-- Só almoxarifado (warehouse_items). Não toca em farmácia.
-- =====================================================================

-- 1. Permissão de edição concedida pessoa a pessoa (sem mudar o perfil).
create table if not exists public.almox_permissoes_edicao (
  user_id       uuid primary key references public.users(id) on delete cascade,
  concedido_por uuid references public.users(id),
  concedido_em  timestamptz not null default now(),
  observacao    text
);
alter table public.almox_permissoes_edicao enable row level security;

drop policy if exists "almox_perm_select" on public.almox_permissoes_edicao;
create policy "almox_perm_select" on public.almox_permissoes_edicao
  for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from public.users u where u.id = auth.uid() and u.role in ('administrador','admin')));

drop policy if exists "almox_perm_admin_insert" on public.almox_permissoes_edicao;
create policy "almox_perm_admin_insert" on public.almox_permissoes_edicao
  for insert to authenticated
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('administrador','admin')));

drop policy if exists "almox_perm_admin_delete" on public.almox_permissoes_edicao;
create policy "almox_perm_admin_delete" on public.almox_permissoes_edicao
  for delete to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('administrador','admin')));

revoke all on public.almox_permissoes_edicao from anon;
revoke update, truncate on public.almox_permissoes_edicao from authenticated;

-- 2. Registro de edições: só acrescenta. Ninguém altera nem apaga pelo sistema.
create table if not exists public.almox_item_edicoes (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null,           -- sem FK: o registro sobrevive à exclusão do item
  item_nome      text,
  item_codigo    text,
  feito_em       timestamptz not null default now(),
  usuario_id     uuid not null,
  usuario_nome   text,
  usuario_perfil text,
  motivo         text not null check (length(btrim(motivo)) >= 10),
  alteracoes     jsonb not null,          -- { campo: { antes, depois } }
  entrada        jsonb                    -- entrada de estoque registrada junto, se houver
);
create index if not exists almox_item_edicoes_item_idx on public.almox_item_edicoes (item_id, feito_em desc);
alter table public.almox_item_edicoes enable row level security;

drop policy if exists "almox_edicoes_select" on public.almox_item_edicoes;
create policy "almox_edicoes_select" on public.almox_item_edicoes
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid()
                 and u.role in ('administrador','admin','gestor','manager','atendente','warehouse_manager','pharmacist')));

revoke all on public.almox_item_edicoes from anon;
revoke insert, update, delete, truncate on public.almox_item_edicoes from authenticated;

create or replace function public.fn_almox_item_edicoes_imutavel()
returns trigger language plpgsql as $tg$
begin
  raise exception 'O registro de edicoes do almoxarifado nao pode ser alterado nem apagado.';
end $tg$;

drop trigger if exists trg_almox_item_edicoes_imutavel on public.almox_item_edicoes;
create trigger trg_almox_item_edicoes_imutavel
  before update or delete on public.almox_item_edicoes
  for each row execute function public.fn_almox_item_edicoes_imutavel();

-- 3. Único caminho auditado de edição: confere permissão, exige motivo,
--    grava o item, a entrada (se houver) e o registro na MESMA transação.
create or replace function public.almox_editar_item(
  p_item_id uuid,
  p_campos  jsonb,
  p_motivo  text,
  p_entrada jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid        uuid := auth.uid();
  v_user       public.users%rowtype;
  v_old        public.warehouse_items%rowtype;
  v_new        public.warehouse_items%rowtype;
  v_permitidos text[] := array['code','barcode','name','description','category','unit',
                               'min_stock','lead_time_days','avg_daily_consumption','current_stock',
                               'batch_number','expiry_date','last_purchase_price','reference_price'];
  v_k          text;
  v_diff       jsonb := '{}'::jsonb;
  v_qtd        int;
  v_id         uuid;
begin
  if v_uid is null then
    raise exception 'Usuario nao autenticado.';
  end if;
  select * into v_user from public.users where id = v_uid;
  if not found or v_user.is_active is false then
    raise exception 'Usuario inativo ou inexistente.';
  end if;
  if not (v_user.role in ('administrador','admin','gestor')
          or exists (select 1 from public.almox_permissoes_edicao p where p.user_id = v_uid)) then
    raise exception 'Sem permissao para editar itens do almoxarifado.';
  end if;
  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Informe o motivo da alteracao (minimo 10 caracteres).';
  end if;
  if p_campos is null or jsonb_typeof(p_campos) <> 'object' then
    raise exception 'Campos invalidos.';
  end if;
  for v_k in select jsonb_object_keys(p_campos) loop
    if not (v_k = any (v_permitidos)) then
      raise exception 'Campo nao pode ser editado por aqui: %', v_k;
    end if;
  end loop;

  select * into v_old from public.warehouse_items where id = p_item_id for update;
  if not found then
    raise exception 'Item do almoxarifado nao encontrado.';
  end if;

  v_new := jsonb_populate_record(v_old, p_campos);
  if length(btrim(coalesce(v_new.name, ''))) < 3 then
    raise exception 'Nome deve ter no minimo 3 caracteres.';
  end if;
  if coalesce(v_new.current_stock, 0) < 0 then
    raise exception 'Estoque atual nao pode ser negativo.';
  end if;

  if p_entrada is not null then
    v_qtd := nullif(p_entrada->>'quantity', '')::int;
    if v_qtd is null or v_qtd <= 0 then
      raise exception 'Quantidade da entrada deve ser maior que zero.';
    end if;
    if coalesce(p_entrada->>'acquisition_type', '') = '' then
      raise exception 'Selecione o tipo de aquisicao da nova entrada.';
    end if;
    v_new.current_stock := coalesce(v_new.current_stock, 0) + v_qtd;
  end if;

  foreach v_k in array v_permitidos loop
    if to_jsonb(v_old)->v_k is distinct from to_jsonb(v_new)->v_k then
      v_diff := v_diff || jsonb_build_object(v_k,
        jsonb_build_object('antes', to_jsonb(v_old)->v_k, 'depois', to_jsonb(v_new)->v_k));
    end if;
  end loop;
  if v_diff = '{}'::jsonb then
    raise exception 'Nenhuma alteracao para salvar.';
  end if;

  update public.warehouse_items set
    code = v_new.code, barcode = v_new.barcode, name = v_new.name,
    description = v_new.description, category = v_new.category, unit = v_new.unit,
    min_stock = v_new.min_stock, lead_time_days = v_new.lead_time_days,
    avg_daily_consumption = v_new.avg_daily_consumption, current_stock = v_new.current_stock,
    batch_number = v_new.batch_number, expiry_date = v_new.expiry_date,
    last_purchase_price = v_new.last_purchase_price, reference_price = v_new.reference_price
  where id = p_item_id;

  if p_entrada is not null then
    insert into public.stock_entries (
      item_id, item_type, quantity, acquisition_type, invoice_number, invoice_date,
      invoice_total_value, unit_price, afm_number, supplier_cnpj, supplier_name,
      batch_number, expiry_date, notes, created_by)
    values (
      p_item_id, 'warehouse', v_qtd, p_entrada->>'acquisition_type',
      coalesce(nullif(btrim(p_entrada->>'invoice_number'), ''), '—'),
      coalesce(nullif(p_entrada->>'invoice_date', '')::date, current_date),
      coalesce(nullif(p_entrada->>'invoice_total_value', '')::numeric, 0),
      coalesce(nullif(p_entrada->>'unit_price', '')::numeric, 0),
      coalesce(nullif(btrim(p_entrada->>'afm_number'), ''), '—'),
      coalesce(nullif(btrim(p_entrada->>'supplier_cnpj'), ''), '00.000.000/0000-00'),
      coalesce(nullif(btrim(p_entrada->>'supplier_name'), ''), 'Entrada via edicao do item'),
      nullif(btrim(p_entrada->>'batch_number'), ''),
      nullif(p_entrada->>'expiry_date', '')::date,
      'Entrada registrada na edicao do item. Motivo: ' || btrim(p_motivo),
      v_uid);
  end if;

  insert into public.almox_item_edicoes (
    item_id, item_nome, item_codigo, usuario_id, usuario_nome, usuario_perfil,
    motivo, alteracoes, entrada)
  values (
    p_item_id, v_new.name, v_new.code, v_uid, v_user.full_name, v_user.role,
    btrim(p_motivo), v_diff, p_entrada)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'alteracoes', v_diff);
end $fn$;

revoke all on function public.almox_editar_item(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function public.almox_editar_item(uuid, jsonb, text, jsonb) to authenticated;

-- 4. Movimentação do almoxarifado passa a mostrar o motivo das edições.
--    Mesmas colunas de antes + "motivo" no fim. O registro da edição e o
--    audit_logs nascem na mesma transação, com o mesmo now().
create or replace view public.v_almox_movimentacao as
 SELECT a.id,
    a.created_at AS data,
    a.record_id AS item_id,
    wi.name AS item,
    wi.code AS codigo,
    wi.unit AS unidade,
    (a.old_data ->> 'current_stock'::text)::numeric AS saldo_antes,
    (a.new_data ->> 'current_stock'::text)::numeric AS saldo_depois,
    ((a.new_data ->> 'current_stock'::text)::numeric) - ((a.old_data ->> 'current_stock'::text)::numeric) AS delta,
        CASE
            WHEN ((a.new_data ->> 'current_stock'::text)::numeric) > ((a.old_data ->> 'current_stock'::text)::numeric) THEN 'entrada'::text
            ELSE 'saida'::text
        END AS tipo,
    COALESCE(a.changed_by, a.user_id) AS usuario_id,
    u.full_name AS usuario,
        CASE
            WHEN ed.motivo IS NOT NULL THEN 'edicao do item (motivo registrado)'::text
            WHEN (EXISTS ( SELECT 1
               FROM stock_entries e
              WHERE e.item_id = a.record_id AND e.item_type = 'warehouse'::text AND e.created_at >= (a.created_at - '00:02:00'::interval) AND e.created_at <= (a.created_at + '00:02:00'::interval))) THEN 'entrada por nota/inventario'::text
            WHEN (EXISTS ( SELECT 1
               FROM request_items ri
                 JOIN requests r ON r.id = ri.request_id
              WHERE ri.warehouse_item_id = a.record_id AND r.updated_at >= (a.created_at - '00:02:00'::interval) AND r.updated_at <= (a.created_at + '00:02:00'::interval))) THEN 'atendimento de solicitacao'::text
            ELSE 'ajuste direto no cadastro'::text
        END AS origem_provavel,
    ed.motivo
   FROM audit_logs a
     LEFT JOIN warehouse_items wi ON wi.id = a.record_id
     LEFT JOIN users u ON u.id = COALESCE(a.changed_by, a.user_id)
     LEFT JOIN LATERAL ( SELECT e.motivo
           FROM almox_item_edicoes e
          WHERE e.item_id = a.record_id AND e.feito_em = a.created_at
          LIMIT 1) ed ON true
  WHERE a.table_name = 'warehouse_items'::text AND a.old_data IS NOT NULL AND a.new_data IS NOT NULL AND (a.old_data ->> 'current_stock'::text) IS DISTINCT FROM (a.new_data ->> 'current_stock'::text) AND (EXISTS ( SELECT 1
           FROM users me
          WHERE me.id = auth.uid() AND (me.role = ANY (ARRAY['administrador'::text, 'admin'::text, 'gestor'::text, 'manager'::text, 'atendente'::text, 'warehouse_manager'::text, 'pharmacist'::text]))));

-- 5. Permissão concedida ao Anderson (atendente do Almoxarifado).
insert into public.almox_permissoes_edicao (user_id, concedido_por, observacao)
select u.id,
       (select a.id from public.users a where a.full_name = 'Adonias Santos' limit 1),
       'Autorizado por Adonias em 16/09/2026: editar itens do almoxarifado com motivo obrigatorio.'
from public.users u
where u.email = '05831159507@hecc.local'
on conflict (user_id) do nothing;
