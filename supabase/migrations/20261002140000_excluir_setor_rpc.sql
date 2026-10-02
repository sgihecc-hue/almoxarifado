-- 02/10/2026: gestor passa a poder "excluir" setor (desvincular usuarios +
-- desativar). Antes o front fazia dois updates separados e, para o gestor, o de
-- users afetava 0 linhas (RLS so deixa editar o proprio perfil) e o erro era
-- engolido. Agora e uma funcao unica, atomica, que confere o papel.
create or replace function public.excluir_setor(p_department_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_role text; v_users int; v_nome text;
begin
  if auth.uid() is null then raise exception 'Usuario nao autenticado.'; end if;
  select role into v_role from public.users where id = auth.uid();
  if coalesce(v_role, '') not in ('administrador', 'admin', 'gestor') then
    raise exception 'Sem permissao para excluir setor.';
  end if;
  select name into v_nome from public.departments where id = p_department_id for update;
  if v_nome is null then raise exception 'Setor nao encontrado.'; end if;
  update public.users set department_id = null, updated_at = now() where department_id = p_department_id;
  get diagnostics v_users = row_count;
  update public.departments set is_active = false, updated_at = now() where id = p_department_id;
  return jsonb_build_object('setor', v_nome, 'usuarios_desvinculados', v_users);
end;
$$;
revoke execute on function public.excluir_setor(uuid) from public, anon;
grant execute on function public.excluir_setor(uuid) to authenticated;
