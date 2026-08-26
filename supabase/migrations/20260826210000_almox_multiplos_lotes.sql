-- ALMOXARIFADO — varios lotes por item ao atender uma solicitacao.
--
-- POR QUE UMA COLUNA JSONB, E NAO request_item_lots:
-- pelo mesmo motivo que levou almox_batch_number a existir em 24/08.
-- request_item_lots.quantity e NOT NULL CHECK (> 0), e a UI de lote da FARMACIA
-- sincroniza a soma dessas quantidades em request_items.supplied_quantity — que
-- e exatamente o numero que trg_deduct_stock_on_request_delivered subtrai de
-- warehouse_items.current_stock. Usa-la aqui faria "informar lote" mexer no
-- saldo do almoxarifado em silencio, e ja tivemos um debito em dobro de 9.564
-- unidades por acoplamento parecido.
--
-- Esta coluna e registro puro: nenhum gatilho a le, nenhuma conta depende dela.
-- Quem move o saldo do almoxarifado continua sendo supplied_quantity, e so ela.
--
-- FORMATO: [{"lote": "ABC123", "validade": "2027-05-31", "quantidade": 250}, ...]
-- validade e quantidade podem vir nulos — o lote pode ser informado antes de
-- se saber o quanto sai dele.
--
-- COMPATIBILIDADE: almox_batch_number e almox_expiry_date continuam existindo e
-- passam a espelhar o PRIMEIRO lote da lista. A confirmacao de recebimento do
-- Satelite Terreo le esses dois campos e nao precisa saber desta coluna.

alter table public.request_items
  add column if not exists almox_lotes jsonb;

comment on column public.request_items.almox_lotes is
  'Lotes informados pelo almoxarifado ao atender, com a quantidade que sai de '
  'cada um: [{"lote","validade","quantidade"}]. Registro informativo — NAO '
  'participa de nenhum calculo de saldo. Quem debita o estoque continua sendo '
  'supplied_quantity.';

-- Migra o que ja existe: quem tinha lote unico vira uma lista de um item, para
-- a tela nao precisar tratar dois formatos.
update public.request_items ri
   set almox_lotes = jsonb_build_array(jsonb_build_object(
         'lote', ri.almox_batch_number,
         'validade', ri.almox_expiry_date,
         'quantidade', ri.supplied_quantity))
 where ri.almox_lotes is null
   and ri.almox_batch_number is not null;
