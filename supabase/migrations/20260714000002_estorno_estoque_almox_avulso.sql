-- P8 (revisão): estorno avulso pela sidebar — entrada manual de item + qtd,
-- sem vínculo obrigatório com uma solicitação. Devolve ao estoque do
-- almoxarifado (warehouse_items) e registra em warehouse_request_returns
-- (request_id NULL). Isolado da farmácia.

CREATE OR REPLACE FUNCTION public.estornar_estoque_almox(
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
BEGIN
  SELECT role INTO caller_role FROM users WHERE id = auth.uid();
  IF caller_role IS NULL OR caller_role NOT IN ('administrador','gestor','atendente') THEN
    RETURN json_build_object('success', false, 'error', 'Sem permissao para estornar');
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'Quantidade invalida');
  END IF;
  UPDATE warehouse_items
    SET current_stock = current_stock + p_quantity, updated_at = now()
    WHERE id = p_warehouse_item_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Item de almoxarifado nao encontrado');
  END IF;
  INSERT INTO warehouse_request_returns (request_id, warehouse_item_id, item_name, quantity, reason, returned_by)
  VALUES (NULL, p_warehouse_item_id,
    (SELECT name FROM warehouse_items WHERE id = p_warehouse_item_id),
    p_quantity, p_reason, auth.uid());
  RETURN json_build_object('success', true);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.estornar_estoque_almox(uuid,integer,text) TO authenticated;
