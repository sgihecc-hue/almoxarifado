-- Consumo médio mensal INFORMADO no cadastro do medicamento.
--
-- Até aqui a coluna "Consumo" da tela era 100% calculada a partir de
-- consumption_history (média das entradas do histórico). Como esse histórico
-- ainda não é alimentado, a tela mostrava "0 Un/mês" para todo mundo — e o
-- ponto de pedido, que deriva desse consumo, também ficava zerado.
--
-- Agora a farmácia pode INFORMAR o consumo médio mensal do medicamento no
-- cadastro. Quando informado, ele é a fonte usada na tela; quando nulo,
-- mantém-se o cálculo pelo histórico (comportamento anterior).
--
-- Só pharmacy_items: o almoxarifado não foi solicitado e fica intocado.
ALTER TABLE public.pharmacy_items
  ADD COLUMN IF NOT EXISTS avg_monthly_consumption integer;

COMMENT ON COLUMN public.pharmacy_items.avg_monthly_consumption IS
  'Consumo médio mensal informado no cadastro (unidades/mês). NULL = usar a média calculada por consumption_history.';
