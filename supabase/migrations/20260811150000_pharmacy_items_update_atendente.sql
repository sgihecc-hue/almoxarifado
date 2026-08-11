-- =====================================================================
-- Farmácia — RLS: atendente e farmacêutico podem ATUALIZAR pharmacy_items.
-- Bug: "clico em Reativar/Inativar/Editar e não acontece nada". A policy de
-- UPDATE só permitia admin/gestor, então o atendente/farmacêutico atualizava
-- 0 linhas SEM erro (RLS filtra em silêncio). A policy de INSERT já incluía
-- atendente/pharmacist — esta alinha o UPDATE com ela.
-- =====================================================================
DROP POLICY IF EXISTS "Pharmacists and admins can update pharmacy items" ON public.pharmacy_items;
CREATE POLICY "Pharmacists and admins can update pharmacy items" ON public.pharmacy_items
  FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid()
     AND u.role = ANY (ARRAY['admin','administrador','atendente','pharmacist','gestor'])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid()
     AND u.role = ANY (ARRAY['admin','administrador','atendente','pharmacist','gestor'])));
