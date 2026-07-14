-- Corrige vazamento de segurança: solicitantes viam TODAS as solicitações.
--
-- A tabela requests tinha uma policy "All authenticated can read requests"
-- com USING(true), que anulava a policy "Users can read own requests".
-- Resultado: qualquer usuário autenticado (inclusive solicitante) lia todas
-- as solicitações, dos dois módulos (farmácia e almoxarifado).
--
-- Removemos apenas essa policy. Mantemos:
--   - "Allow anon read requests" (anon): necessária pros painéis de TV, que são
--     rotas públicas (/tv/*) e leem requests sem sessão. NÃO afeta usuários
--     autenticados, pois anon e authenticated são roles distintos.
--   - "Managers can read all requests": staff (administrador/gestor/atendente) vê todas.
--   - "Users can read own requests": solicitante vê só as próprias.
--
-- Efeito final:
--   solicitante  -> só as próprias
--   staff        -> todas
--   anon (TV)    -> todas (inalterado)

DROP POLICY IF EXISTS "All authenticated can read requests" ON public.requests;
