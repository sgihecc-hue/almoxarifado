-- PACIENTES: acesso restrito a quem cuida do paciente (LGPD).
--
-- ANTES: patients e patient_admissions tinham politicas "qualquer usuario
-- logado pode tudo" (ALL, inclusive apagar). Os 249 solicitantes de todos os
-- setores — faturamento, manutencao, TI, transporte... — podiam listar,
-- editar e apagar ficha de paciente. Com o pedido de kit da enfermagem a
-- tabela passou a ser usada por mais gente, e isso deixou de ser aceitavel.
--
-- DEPOIS:
--   ver e cadastrar  -> farmacia/gestao (administrador, gestor, atendente,
--                       farmaceutico) e os setores de ENFERMAGEM
--   editar e dar alta -> so farmacia/gestao
--   apagar           -> so administrador
--   demais usuarios  -> nada
--
-- "Setores de enfermagem" = farmacia_setores_enfermagem, a MESMA lista que as
-- RPCs de devolucao ja usam (Postos Terreo/1o/2o, Coordenacao de Enfermagem e
-- Unidade de Internacao). Nao se cria um segundo criterio.
--
-- Nao afeta: dispensacoes e devolucoes guardam o nome do paciente como texto
-- proprio; RPCs security definer e views seguem lendo normalmente.
-- Almoxarifado nao usa pacientes.

create or replace function public.fn_pode_acessar_pacientes()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.users u
     where u.id = auth.uid()
       and (
         u.role in ('administrador','gestor','atendente','pharmacist','admin','manager')
         or u.department_id in (select department_id from public.farmacia_setores_enfermagem)
       )
  )
$$;

create or replace function public.fn_farmacia_gere_pacientes()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.users u
     where u.id = auth.uid()
       and u.role in ('administrador','gestor','atendente','pharmacist','admin','manager')
  )
$$;

create or replace function public.fn_is_administrador()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.users u
     where u.id = auth.uid() and u.role in ('administrador','admin')
  )
$$;

revoke execute on function public.fn_pode_acessar_pacientes() from public, anon;
revoke execute on function public.fn_farmacia_gere_pacientes() from public, anon;
revoke execute on function public.fn_is_administrador() from public, anon;
grant execute on function public.fn_pode_acessar_pacientes() to authenticated;
grant execute on function public.fn_farmacia_gere_pacientes() to authenticated;
grant execute on function public.fn_is_administrador() to authenticated;

-- patients --------------------------------------------------------------------
drop policy if exists "Authenticated users can manage patients" on public.patients;
drop policy if exists "patients_select" on public.patients;
drop policy if exists "patients_write" on public.patients;

create policy "patients_select" on public.patients
  for select to authenticated using (public.fn_pode_acessar_pacientes());
create policy "patients_insert" on public.patients
  for insert to authenticated with check (public.fn_pode_acessar_pacientes());
create policy "patients_update" on public.patients
  for update to authenticated
  using (public.fn_farmacia_gere_pacientes())
  with check (public.fn_farmacia_gere_pacientes());
create policy "patients_delete" on public.patients
  for delete to authenticated using (public.fn_is_administrador());

-- patient_admissions ----------------------------------------------------------
drop policy if exists "admissions_select" on public.patient_admissions;
drop policy if exists "admissions_write" on public.patient_admissions;

create policy "admissions_select" on public.patient_admissions
  for select to authenticated using (public.fn_pode_acessar_pacientes());
create policy "admissions_insert" on public.patient_admissions
  for insert to authenticated with check (public.fn_pode_acessar_pacientes());
create policy "admissions_update" on public.patient_admissions
  for update to authenticated
  using (public.fn_farmacia_gere_pacientes())
  with check (public.fn_farmacia_gere_pacientes());
create policy "admissions_delete" on public.patient_admissions
  for delete to authenticated using (public.fn_is_administrador());
