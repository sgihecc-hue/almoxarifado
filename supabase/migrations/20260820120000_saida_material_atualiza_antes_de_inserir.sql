-- Dispensar material da Satelite Terreo falhava com "Valor invalido para o
-- campo" mesmo havendo saldo.
--
-- Causa: na saida o gatilho fazia
--   INSERT ... VALUES (..., -NEW.quantity) ON CONFLICT ... DO UPDATE SET
--   quantity = item_stocks.quantity - NEW.quantity
-- O Postgres valida o CHECK da tabela sobre a LINHA PROPOSTA no INSERT — o
-- valor negativo puro (-1) — antes de resolver o conflito e chegar na conta
-- correta (11 - 1 = 10). Como item_stocks_quantity_check e
--   (quantity >= 0 OR item_type = 'pharmacy')
-- o material era barrado sempre que ja existia linha de saldo. Medicamento
-- nunca sentiu porque para ele o negativo e permitido.
--
-- Correcao: tenta o UPDATE primeiro e so insere quando nao ha linha. O
-- comportamento fica identico ao pretendido, inclusive o FA5 (saida sem linha
-- de saldo cria a linha negativa — que segue valendo so para medicamento,
-- porque o CHECK continua barrando material negativo, agora no momento certo).
create or replace function public.fn_apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  loc uuid;
  v_delta integer;
BEGIN
  IF NEW.direction = 'out' THEN
    loc := NEW.source_location_id;
    v_delta := -NEW.quantity;
  ELSE
    loc := NEW.target_location_id;
    v_delta := NEW.quantity;
  END IF;

  -- Atualiza a linha existente. Sem o INSERT especulativo, o CHECK passa a ser
  -- avaliado sobre o SALDO RESULTANTE, e nao sobre o delta cru.
  UPDATE public.item_stocks
     SET quantity = quantity + v_delta,
         updated_at = now()
   WHERE item_id = NEW.item_id
     AND item_type = NEW.item_type
     AND location_id = loc;

  -- Nao havia linha de saldo: cria. FA5 — na farmacia isso pode nascer
  -- negativo (item que existe no fisico e ainda nao foi lancado); no material
  -- o proprio CHECK barra, que e o comportamento desejado.
  IF NOT FOUND THEN
    INSERT INTO public.item_stocks (item_id, item_type, location_id, quantity)
    VALUES (NEW.item_id, NEW.item_type, loc, v_delta);
  END IF;

  RETURN NEW;
END
$function$;
