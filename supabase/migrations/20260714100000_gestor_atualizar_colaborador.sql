-- Permite que um GESTOR ajuste o setor e o nível de acesso de um colaborador,
-- de forma controlada (sem poder se autopromover nem editar admins/gestores).
--
-- Contexto: a coordenação de farmácia (gestor) precisa poder encontrar um
-- colaborador e (a) mudar o setor e (b) dar nível de Farmacêutico (pharmacist).
-- A RLS só deixa administrador atualizar usuários, então usamos uma função
-- SECURITY DEFINER com travas:
--   - administrador: acesso total (mantém compatibilidade);
--   - gestor: só atribui Solicitante/Atendente/Farmacêutico, só em setores de
--     farmácia (CAF ou "Farmácia Satélite ..."), e nunca em admins/gestores.

CREATE OR REPLACE FUNCTION public.gestor_atualizar_colaborador(
  p_user_id uuid,
  p_role text,
  p_department_id uuid
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  caller_role text;
  target_role text;
  dept_is_pharmacy boolean;
BEGIN
  SELECT role INTO caller_role FROM users WHERE id = auth.uid();
  IF caller_role IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Nao autenticado');
  END IF;

  -- Administrador: acesso total (mantem compatibilidade)
  IF caller_role = 'administrador' THEN
    UPDATE users SET role = p_role, department_id = p_department_id, updated_at = now()
      WHERE id = p_user_id;
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Usuario nao encontrado'); END IF;
    RETURN json_build_object('success', true);
  END IF;

  IF caller_role <> 'gestor' THEN
    RETURN json_build_object('success', false, 'error', 'Sem permissao');
  END IF;

  -- Gestor so pode atribuir estes papeis
  IF p_role NOT IN ('solicitante','atendente','pharmacist') THEN
    RETURN json_build_object('success', false, 'error', 'Gestor so pode atribuir Solicitante, Atendente ou Farmaceutico');
  END IF;

  SELECT role INTO target_role FROM users WHERE id = p_user_id;
  IF target_role IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Usuario nao encontrado');
  END IF;
  IF target_role IN ('administrador','gestor') THEN
    RETURN json_build_object('success', false, 'error', 'Gestor nao pode editar administradores ou gestores');
  END IF;

  -- Destino deve ser setor de farmacia (CAF ou Farmacia Satelite*)
  SELECT (code = 'CAF' OR name ILIKE 'Farm%') INTO dept_is_pharmacy
    FROM departments WHERE id = p_department_id;
  IF dept_is_pharmacy IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'Gestor so pode lotar colaboradores em setores de farmacia');
  END IF;

  UPDATE users SET role = p_role, department_id = p_department_id, updated_at = now()
    WHERE id = p_user_id;
  RETURN json_build_object('success', true);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.gestor_atualizar_colaborador(uuid,text,uuid) TO authenticated;
