-- Validade de lote de ALMOXARIFADO: recusa data impossivel.
--
-- O PROBLEMA: expiry_date aceita qualquer data. Um escorregao no teclado grava
-- ano 0208 e ninguem percebe, porque nada valida e nada reclama. O efeito nao e
-- so cosmetico: o lote some do controle de vencimento. A tela de vencimentos
-- procura lote vencendo nos proximos N dias; um lote com validade no ano 0208
-- ja "venceu" ha 1.800 anos e um no ano 8027 so vence daqui a 6.000 — nenhum
-- dos dois cai na janela de alerta. O material fica invisivel ate alguem tropecar
-- nele na prateleira.
--
-- Encontrados em 10/09/2026, no sistema inteiro:
--   6 lotes com data impossivel: 0001-01-30, 0208-08-31, 0554-04-28,
--     8027-06-30 e dois em 2001-09-30
--   29 lotes sem validade nenhuma
--
-- FAIXA ACEITA: de 2015-01-01 ate 30 anos a frente da data de hoje.
--   - O piso pega o dedo escorregando no ano (0208, 0554, 2001) sem impedir o
--     lancamento de material realmente vencido, que as vezes precisa entrar no
--     sistema justamente para ser baixado como perda.
--   - O teto pega o 8027 sem apertar demais: material de almoxarifado com
--     validade longa (equipamento, curativo) cabe folgado em 30 anos.
--
-- SO NA GRAVACAO DA DATA: o gatilho e "update of expiry_date", entao mexer na
-- quantidade de um lote que ja tem data torta NAO trava. Os 6 registros ruins
-- de hoje continuam la e precisam ser corrigidos a mao pelo almoxarifado — o
-- banco nao tem como adivinhar se 0208-08-31 queria dizer 2028-08-31.
--
-- SO ALMOXARIFADO: age apenas quando o item existe em warehouse_items. A
-- farmacia nao e tocada; se for aplicar la, e outra migration, outro deploy.

create or replace function public.fn_valida_validade_almox()
returns trigger
language plpgsql
as $$
declare
  v_piso date := date '2015-01-01';
  v_teto date := (current_date + interval '30 years')::date;
begin
  if new.expiry_date is null then
    return new;
  end if;
  -- Farmacia passa direto.
  if not exists (select 1 from public.warehouse_items wi where wi.id = new.item_id) then
    return new;
  end if;

  if new.expiry_date < v_piso or new.expiry_date > v_teto then
    raise exception
      'Validade % parece digitada errada. Confira o ano — o sistema aceita de % ate %.',
      to_char(new.expiry_date, 'DD/MM/YYYY'),
      to_char(v_piso, 'DD/MM/YYYY'),
      to_char(v_teto, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_valida_validade_almox on public.expiry_tracking;
create trigger trg_valida_validade_almox
  before insert or update of expiry_date on public.expiry_tracking
  for each row execute function public.fn_valida_validade_almox();

comment on function public.fn_valida_validade_almox() is
  'Recusa validade de lote de material fora da faixa 2015 ate hoje+30 anos. '
  'Erro de digitacao no ano tirava o lote do controle de vencimento. Nao age na farmacia.';
