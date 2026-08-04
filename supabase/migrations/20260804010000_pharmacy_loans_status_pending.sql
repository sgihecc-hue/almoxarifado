-- Nova Movimentação (empréstimo/permuta/doação...) passou a nascer como
-- 'pending' e ir para a tela de PENDÊNCIAS. Mas em produção a constraint de
-- status só permitia 'completed'/'cancelled', então TODO salvamento falhava
-- (o insert com status='pending' era rejeitado pelo CHECK). No banco de teste
-- não havia constraint — por isso lá funcionava e em produção não.
--
-- Correção: permitir os três estados válidos do fluxo.
ALTER TABLE public.pharmacy_loans DROP CONSTRAINT IF EXISTS pharmacy_loans_status_check;
ALTER TABLE public.pharmacy_loans ADD CONSTRAINT pharmacy_loans_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'completed'::text, 'cancelled'::text]));
