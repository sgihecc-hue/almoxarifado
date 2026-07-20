-- FA5 (correção de paridade): permitir saldo NEGATIVO em item_stocks apenas
-- para FARMÁCIA.
--
-- Sintoma em produção: "Confirmar Recebimento" falhava com
--   new row for relation "item_stocks" violates check constraint
--   "item_stocks_quantity_check"
-- porque o constraint original era CHECK (quantity >= 0). No ambiente de
-- teste esse constraint tinha sido removido quando a FA5 foi feita, mas em
-- produção não — por isso funcionava no teste e quebrava em produção.
--
-- item_stocks é COMPARTILHADA entre os módulos (item_type pharmacy/warehouse).
-- Simplesmente remover o constraint liberaria negativo para o ALMOXARIFADO
-- também, o que não é desejado. Então trocamos por um constraint que permite
-- negativo só quando item_type = 'pharmacy' (estoque negativo consentido da
-- FA5, acertado depois na recontagem). Almoxarifado continua protegido
-- contra saldo negativo, exatamente como antes.

ALTER TABLE public.item_stocks
  DROP CONSTRAINT IF EXISTS item_stocks_quantity_check;

ALTER TABLE public.item_stocks
  ADD CONSTRAINT item_stocks_quantity_check
  CHECK (quantity >= 0 OR item_type = 'pharmacy');
