-- Entrada de material na Satelite Terreo falhava com "erro inesperado".
--
-- Causa: existiam DUAS versoes de registrar_entrada_nf no banco — a antiga de
-- 9 parametros e a de 10, criada junto com a "Data de Entrega" da farmacia
-- (20260812xxxxx_entrada_nf_data_entrega). Como p_delivery_date tem DEFAULT,
-- uma chamada com 9 argumentos nomeados servia para as duas e o PostgREST
-- recusava com PGRST203 ("Could not choose the best candidate function").
--
-- A tela da farmacia manda os 10 argumentos e por isso nunca quebrou; a de
-- material (Almoxarifado / Satelite Terreo) manda 9 e quebrava sempre.
--
-- Correcao: derrubar a versao antiga. Quem chama com 9 argumentos passa a
-- resolver para a de 10, com p_delivery_date = null — mesmo comportamento de
-- antes, porque a versao antiga simplesmente nao tinha esse campo.
drop function if exists public.registrar_entrada_nf(
  text,   -- p_item_type
  text,   -- p_invoice_number
  date,   -- p_invoice_date
  text,   -- p_afm_number
  text,   -- p_supplier_cnpj
  text,   -- p_supplier_name
  jsonb,  -- p_items
  text,   -- p_acquisition_type
  text    -- p_location_code
);
