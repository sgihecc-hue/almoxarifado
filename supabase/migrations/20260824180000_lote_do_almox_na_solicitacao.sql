-- 24/08/2026 — o lote informado pelo ALMOXARIFADO viaja ate a conferencia do
-- Satelite Terreo.
--
-- POR QUE COLUNAS NOVAS EM request_items, E NAO request_item_lots:
-- request_item_lots.quantity e NOT NULL CHECK (> 0). Usa-la obrigaria a gravar
-- uma quantidade por lote, e a UI de lote da farmacia sincroniza essa soma em
-- request_items.supplied_quantity — que e EXATAMENTE o numero que o trigger
-- trg_deduct_stock_on_request_delivered subtrai de warehouse_items.current_stock.
-- Ou seja: informar lote passaria a alterar o saldo do almoxarifado, em silencio.
-- Estas duas colunas sao registro puro: sem quantidade, sem trigger, sem
-- acoplamento com saldo nenhum.
--
-- Sao OPCIONAIS. Em branco, todo o fluxo se comporta exatamente como hoje.

alter table public.request_items
  add column if not exists almox_batch_number text,
  add column if not exists almox_expiry_date  date;

comment on column public.request_items.almox_batch_number is
  'Lote informado pelo almoxarifado ao atender. Apenas informativo: pre-preenche a conferencia de recebimento do satelite. NAO participa de nenhum calculo de saldo.';
comment on column public.request_items.almox_expiry_date is
  'Validade informada pelo almoxarifado ao atender. Mesma regra do almox_batch_number.';
