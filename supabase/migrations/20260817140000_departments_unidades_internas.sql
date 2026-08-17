-- Unidades internas (setores do hospital) = tabela public.departments.
--
-- A tabela já existe desde o schema inicial. O que falta aqui é o que o
-- frontend já assume mas nunca esteve numa migration versionada:
--   1) a coluna is_active (soft delete de setor — o registro fica para que
--      solicitações/saídas antigas continuem com a referência);
--   2) a leitura normalizada no mesmo padrão de suppliers/external_units:
--      "for select to authenticated using (true)", sem auth.role() e sem
--      liberar o papel anon.
--
-- Nada aqui muda o comportamento do almoxarifado: a policy de SELECT já era
-- efetivamente "todo autenticado lê", e a de escrita (gestor/admin) não é
-- tocada.

alter table public.departments
  add column if not exists is_active boolean not null default true;

-- Listagens sempre filtram por setor ativo.
create index if not exists departments_is_active_idx
  on public.departments (is_active);

alter table public.departments enable row level security;

revoke select on public.departments from anon;

drop policy if exists departments_select_policy on public.departments;
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
  for select to authenticated using (true);
