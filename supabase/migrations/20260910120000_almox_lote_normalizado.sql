-- Lote de ALMOXARIFADO: normaliza o numero na gravacao.
--
-- Espelha o que a 20260826190000_farmacia_lote_normalizado.sql ja fez para a
-- farmacia. Aquela migration deixou o almoxarifado de fora "por decisao
-- explicita"; a varredura de 10/09/2026 mostrou que o estrago aqui e MAIOR do
-- que era na farmacia, entao agora o almoxarifado ganha a mesma protecao.
--
-- O PROBLEMA: batch_number e texto livre. O mesmo lote fisico entra no sistema
-- com grafias diferentes e cada grafia vira uma LINHA de saldo separada. As
-- rotinas que dao baixa procuram o lote por igualdade exata de texto
-- (registrar_entrada_material, saida_material_*), entao "25e0234" nao encontra
-- "25E0234": em vez de somar no lote que existe, criam outro. A saida sai de um
-- e a entrada entra no outro, e o primeiro afunda para saldo negativo e nunca
-- mais volta.
--
-- Medido em 10/09/2026, no almoxarifado:
--   63 lotes com saldo NEGATIVO, em 35 itens, somando -2.814 unidades
--   30 desses nasceram com initial_quantity = 0 (lote "fantasma": nunca teve
--      entrada, so saida)
--   piores casos: fralda geriatrica EG (-490), mascara cirurgica, seringa
--      20 mL, luva de procedimento P — itens de giro alto
--
-- O QUE ESTA MIGRATION FAZ: passa o lote para MAIUSCULA e tira os espacos na
-- hora de gravar. Com isso "25a75w", "25A 75W" e "25A75W" viram a mesma coisa,
-- e as rotinas de baixa voltam a encontrar o lote que ja existe em vez de criar
-- um novo.
--
-- O QUE ESTA MIGRATION **NAO** FAZ, de proposito:
--   1. Nao corrige troca de I por 1 nem de O por zero (BTM1D25001A x
--      BTMID25001A). Sao caracteres realmente distintos e o banco nao tem como
--      saber qual esta certo — adivinhar poderia FUNDIR DOIS LOTES DE VERDADE,
--      que e um erro pior do que o que estamos corrigindo.
--   2. Nao mexe em quantidade nenhuma. E alteracao de TEXTO, nao de saldo.
--   3. Nao funde as linhas que ja estao duplicadas hoje. Juntar dois lotes
--      existentes muda saldo e e decisao do almoxarifado, nao do banco.
--      Depois desta migration eles continuam separados, mas param de se
--      multiplicar.
--
-- SO ALMOXARIFADO: expiry_tracking guarda lote de medicamento E de material.
-- O gatilho age apenas quando o item existe em warehouse_items. A farmacia tem
-- o gatilho dela (trg_normaliza_lote_farmacia) e fica intocada — os dois
-- modulos sao isolados.

create or replace function public.fn_normaliza_lote_almox()
returns trigger
language plpgsql
as $$
begin
  if new.batch_number is null then
    return new;
  end if;
  -- Farmacia passa direto: o item nao esta no catalogo de almoxarifado.
  -- (trg_normaliza_lote_farmacia cuida daquele lado.)
  if not exists (select 1 from public.warehouse_items wi where wi.id = new.item_id) then
    return new;
  end if;
  new.batch_number := upper(btrim(new.batch_number));
  -- Espaco no meio tambem separava lotes iguais ("25A 75W" x "25A75W").
  new.batch_number := regexp_replace(new.batch_number, '\s+', '', 'g');
  if new.batch_number = '' then
    new.batch_number := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_normaliza_lote_almox on public.expiry_tracking;
create trigger trg_normaliza_lote_almox
  before insert or update of batch_number on public.expiry_tracking
  for each row execute function public.fn_normaliza_lote_almox();

-- Alinha o que ja esta gravado. So mexe em lote de ALMOXARIFADO que muda de
-- fato, e nao toca em quantidade nenhuma.
update public.expiry_tracking et
   set batch_number = regexp_replace(upper(btrim(et.batch_number)), '\s+', '', 'g')
 where et.batch_number is not null
   and exists (select 1 from public.warehouse_items wi where wi.id = et.item_id)
   and et.batch_number is distinct from
       regexp_replace(upper(btrim(et.batch_number)), '\s+', '', 'g');

comment on function public.fn_normaliza_lote_almox() is
  'Grava lote de material sempre em maiuscula e sem espacos, para o mesmo lote '
  'nao virar duas linhas com saldos separados. Nao age na farmacia.';
