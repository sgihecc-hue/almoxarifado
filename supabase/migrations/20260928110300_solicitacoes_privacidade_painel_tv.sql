-- =============================================================================
-- PAINEL DE TV sem login nao le dado de paciente (auditoria de 28/09/2026)
--
-- A policy "Allow anon read requests" (USING true) deixava qualquer um, sem
-- login, ler requests.notes — onde fica "[Dados do Paciente] Nome/Leito" — e
-- os demais textos livres (justificativa, observacoes de entrega/recebimento,
-- motivos). O anon ainda tinha INSERT/UPDATE/DELETE/TRUNCATE herdados do
-- padrao do Supabase (a RLS barra os tres primeiros; TRUNCATE nao passa por RLS).
--
-- O painel (rotas /tv/*) so precisa de numero, tipo, status, prioridade,
-- setores, solicitante e datas. Continua lendo sem login, mas so essas colunas:
-- o anon perde o SELECT da tabela inteira e ganha SELECT coluna a coluna.
-- (O painel tambem deixou de gravar: ver src/lib/services/tv-requests.ts.)
-- =============================================================================

revoke all on public.requests from anon;
grant select (id, type, status, priority, department_id, destination_department_id,
              requester_id, request_number, created_at, updated_at,
              delivered_at, received_at, completed_at, source_location_id)
  on public.requests to anon;
