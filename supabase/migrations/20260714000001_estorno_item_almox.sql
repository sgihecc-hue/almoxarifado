-- P8: Estorno de item de solicitação de ALMOXARIFADO entregue.
--
-- Quando uma solicitação de almoxarifado é atendida/entregue mas algum item
-- retorna, o staff pode estornar a quantidade devolvida, que volta ao estoque
-- (warehouse_items.current_stock). Totalmente isolado da farmácia — só toca
-- warehouse_items e a tabela de registro abaixo.

CREATE TABLE IF NOT EXISTS public.warehouse_request_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.requests(id) ON DELETE SET NULL,
  warehouse_item_id uuid REFERENCES public.warehouse_items(id) ON DELETE SET NULL,
  item_name text,
  quantity integer NOT NULL CHECK (quantity > 0),
  reason text,
  returned_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  returned_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.warehouse_request_returns ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_wrr_request ON public.warehouse_request_returns(request_id);

CREATE POLICY "wrr_staff_read" ON public.warehouse_request_returns
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
      AND users.role = ANY (ARRAY['administrador','gestor','atendente'])
  ));

-- RPC: valida (staff + request warehouse + entregue), devolve ao estoque e
-- registra. SECURITY DEFINER para atualizar warehouse_items sob RLS.
CREATE OR REPLACE FUNCTION public.estornar_item_almox(
  p_request_id uuid,
  p_warehouse_item_id uuid,
  p_quantity integer,
  p_reason text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  caller_role text;
  req record;
BEGIN
  SELECT role INTO caller_role FROM users WHERE id = auth.uid();
  IF caller_role IS NULL OR caller_role NOT IN ('administrador','gestor','atendente') THEN
    RETURN json_build_object('success', false, 'error', 'Sem permissao para estornar');
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'Quantidade invalida');
  END IF;
  SELECT id, type, status INTO req FROM requests WHERE id = p_request_id;
  IF req.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Solicitacao nao encontrada');
  END IF;
  IF req.type <> 'warehouse' THEN
    RETURN json_build_object('success', false, 'error', 'Estorno disponivel apenas para solicitacoes de almoxarifado');
  END IF;
  IF req.status NOT IN ('delivered','completed') THEN
    RETURN json_build_object('success', false, 'error', 'So e possivel estornar itens de solicitacoes entregues');
  END IF;
  UPDATE warehouse_items
    SET current_stock = current_stock + p_quantity, updated_at = now()
    WHERE id = p_warehouse_item_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Item de almoxarifado nao encontrado');
  END IF;
  INSERT INTO warehouse_request_returns (request_id, warehouse_item_id, item_name, quantity, reason, returned_by)
  VALUES (p_request_id, p_warehouse_item_id,
    (SELECT name FROM warehouse_items WHERE id = p_warehouse_item_id),
    p_quantity, p_reason, auth.uid());
  RETURN json_build_object('success', true);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.estornar_item_almox(uuid,uuid,integer,text) TO authenticated;
