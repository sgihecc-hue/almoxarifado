-- =============================================================================
-- Seguranca urgente (auditoria de 28/09/2026)
--
-- 1. Qualquer usuario logado conseguia virar administrador: a policy
--    "Users can update own profile" nao tinha WITH CHECK e authenticated tem
--    UPDATE na coluna role. "Anon can insert profile on signup" (WITH CHECK true)
--    deixava criar perfil com qualquer papel sem login.
--    -> gatilho que so deixa papel/setor/ativo/exclusao mudarem por
--       administrador (ou por funcoes do banco / service_role), e
--       insercao de perfil por usuario comum so como 'solicitante'.
-- 2. Funcoes que mexem em estoque executaveis sem login:
--    registrar_entrada_estoque pulava a checagem de papel quando auth.uid()
--    era nulo; increment/decrement_expiry_tracking (SECURITY DEFINER) sem
--    nenhuma checagem.
-- =============================================================================

create or replace function public.fn_users_protege_campos()
returns trigger
language plpgsql
-- INVOKER de proposito: current_user precisa ser quem chamou (authenticated/anon);
-- funcoes SECURITY DEFINER do banco chegam aqui como postgres e passam.
set search_path to 'public', 'pg_temp'
as $$
declare
  v_papel text;
begin
  -- Funcoes do banco (SECURITY DEFINER, dono postgres), GoTrue e service_role
  -- nao passam por aqui como authenticated/anon.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  select role into v_papel from public.users where id = auth.uid();

  if tg_op = 'INSERT' then
    if coalesce(v_papel, '') in ('administrador', 'admin') then
      return new;
    end if;
    if new.id is distinct from auth.uid() then
      raise exception 'Sem permissao para criar perfil de outro usuario.';
    end if;
    if coalesce(new.role, 'solicitante') <> 'solicitante' then
      raise exception 'Sem permissao para definir o perfil de acesso.';
    end if;
    return new;
  end if;

  -- UPDATE
  if coalesce(v_papel, '') in ('administrador', 'admin') then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Sem permissao para alterar o perfil de acesso.';
  end if;
  if new.is_active is distinct from old.is_active or new.deleted_at is distinct from old.deleted_at then
    raise exception 'Sem permissao para ativar ou desativar usuario.';
  end if;
  if new.department_id is distinct from old.department_id then
    -- Gestor desvincula usuarios ao apagar um setor (departments.delete).
    if not (v_papel = 'gestor' and new.department_id is null) then
      raise exception 'Sem permissao para alterar o setor do usuario.';
    end if;
  end if;
  if new.email is distinct from old.email or new.id is distinct from old.id then
    raise exception 'Sem permissao para alterar e-mail ou identificador.';
  end if;
  -- must_change_password: o proprio usuario so pode desligar (apos trocar a senha).
  if new.must_change_password is distinct from old.must_change_password
     and coalesce(new.must_change_password, false) then
    raise exception 'Sem permissao para alterar a exigencia de troca de senha.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_users_protege_campos on public.users;
create trigger trg_users_protege_campos
  before insert or update on public.users
  for each row execute function public.fn_users_protege_campos();

-- Perfil anonimo: o autocadastro esta desligado (DISABLE_SIGNUP=true) e contas
-- novas saem da Edge Function admin-create-user (service_role).
drop policy if exists "Anon can insert profile on signup" on public.users;
revoke insert, update, delete, truncate on public.users from anon;

-- ---------------------------------------------------------------------------
-- 2. Funcoes de estoque sem login
-- ---------------------------------------------------------------------------
revoke execute on function public.increment_expiry_tracking(uuid, integer) from public, anon, authenticated;
revoke execute on function public.decrement_expiry_tracking(uuid, integer) from public, anon, authenticated;

revoke execute on function public.registrar_entrada_estoque(uuid, text, integer, text, date, text, text, text, numeric, numeric, text, text, date, date, text, text) from public, anon;
grant execute on function public.registrar_entrada_estoque(uuid, text, integer, text, date, text, text, text, numeric, numeric, text, text, date, date, text, text) to authenticated;

-- Dentro da funcao, auth.uid() nulo so acontece para service_role (anon perdeu o
-- EXECUTE acima). A checagem de papel continua valendo para todo usuario logado.
