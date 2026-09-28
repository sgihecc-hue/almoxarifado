-- =============================================================================
-- Auditoria 28/09/2026 — área TRANSVERSAL (sessão, permissões, cadastros)
--
-- 1. fn_user_module() / fn_user_pode_modulo(text): módulo do usuário pelo SETOR,
--    espelho do mapa do front (src/lib/permissoes.ts). Para as policies de RLS
--    por módulo das outras áreas (almox x farmácia isolados).
-- 2. external_units_write passa a incluir o farmacêutico (pharmacist): ele
--    opera a farmácia e cadastra unidade externa (empréstimos); o menu já
--    mostrava a tela para ele, e o banco recusava.
--    departments continua só administrador/gestor (o menu é que foi corrigido).
-- 3. farmacia_garantir_lote deixa de ser executável sem login (anon/PUBLIC):
--    criava lote em expiry_tracking sem usuário. Só a tela de solicitação
--    (logada) usa. lookup_employee_by_matricula e get_requester_names FICAM com
--    anon porque os painéis de TV (/tv/*, sem login) usam — ver relatório.
-- 4. Tabelas de cadastro não-estoque: tira TRUNCATE de anon/authenticated
--    (TRUNCATE ignora RLS) e INSERT/UPDATE/DELETE de anon.
-- =============================================================================

-- 1. Módulo do usuário -------------------------------------------------------

-- Módulo do SETOR do usuário logado: 'almox' (setor Almoxarifado), 'farmacia'
-- (CAF ou Farmácia Satélite) ou null (outro setor / sem setor / sem login).
-- Farmacêutico (pharmacist) é sempre 'farmacia', como no front.
create or replace function public.fn_user_module()
returns text
language sql
stable
security definer
set search_path = ''
as $f$
  select case
    when u.role = 'pharmacist' then 'farmacia'
    when lower(btrim(d.name)) = 'almoxarifado' then 'almox'
    when upper(btrim(coalesce(d.code, ''))) = 'CAF'
      or lower(btrim(d.name)) like 'caf%'
      or lower(btrim(d.name)) in ('farmácia satélite 1º andar', 'farmácia satélite 2º andar', 'farmácia satélite térreo')
      then 'farmacia'
    else null
  end
  from public.users u
  left join public.departments d on d.id = u.department_id
  where u.id = auth.uid()
$f$;

comment on function public.fn_user_module() is
  'Módulo do setor do usuário logado: almox | farmacia | null. Espelho de src/lib/permissoes.ts (moduloDoSetor).';

-- O usuário logado pode OPERAR este módulo ('almox' ou 'farmacia')?
--   administrador: sim; gestor: o do setor, ou os dois se o setor não é de
--   farmácia; farmacêutico: farmácia; atendente: só o do setor; solicitante,
--   inativo, desativado ou sem login: não.
create or replace function public.fn_user_pode_modulo(p_modulo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $f$
  select coalesce((
    select case
      when u.deleted_at is not null or u.is_active is false then false
      when u.role in ('administrador', 'admin') then true
      when u.role in ('gestor', 'manager') then
        case when public.fn_user_module() = 'farmacia' then p_modulo = 'farmacia' else p_modulo in ('almox', 'farmacia') end
      when u.role = 'pharmacist' then p_modulo = 'farmacia'
      when u.role = 'atendente' then public.fn_user_module() is not distinct from p_modulo and p_modulo is not null
      else false
    end
    from public.users u
    where u.id = auth.uid()
  ), false)
$f$;

comment on function public.fn_user_pode_modulo(text) is
  'true se o usuário logado pode operar o módulo (almox|farmacia). Espelho de src/lib/permissoes.ts (montarPerfil).';

revoke execute on function public.fn_user_module() from public, anon;
revoke execute on function public.fn_user_pode_modulo(text) from public, anon;
grant execute on function public.fn_user_module() to authenticated, service_role;
grant execute on function public.fn_user_pode_modulo(text) to authenticated, service_role;

-- 2. Unidades externas: farmacêutico também grava -----------------------------

drop policy if exists external_units_write on public.external_units;
create policy external_units_write on public.external_units
  for all to authenticated
  using (public.auth_user_role() = any (array['administrador', 'gestor', 'atendente', 'pharmacist']))
  with check (public.auth_user_role() = any (array['administrador', 'gestor', 'atendente', 'pharmacist']));

-- 3. farmacia_garantir_lote só logado ------------------------------------------

revoke execute on function public.farmacia_garantir_lote(uuid, text, date) from public, anon;
grant execute on function public.farmacia_garantir_lote(uuid, text, date) to authenticated, service_role;

-- 4. Cadastros não-estoque: sem TRUNCATE e sem escrita anônima ----------------
-- (users já teve anon revogado em 20260928100000; aqui sai o TRUNCATE de authenticated)

revoke truncate on
  public.users,
  public.departments,
  public.external_units,
  public.suppliers,
  public.prescribers,
  public.employees,
  public.notification_preferences,
  public.lgpd_consents,
  public.lgpd_data_requests,
  public.audit_logs,
  public.templates,
  public.template_items
from anon, authenticated;

revoke insert, update, delete on
  public.departments,
  public.external_units,
  public.suppliers,
  public.prescribers,
  public.employees,
  public.notification_preferences,
  public.lgpd_consents,
  public.lgpd_data_requests,
  public.audit_logs,
  public.templates,
  public.template_items
from anon;
