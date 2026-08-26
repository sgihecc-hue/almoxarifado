-- Lote de FARMACIA: normaliza o numero na gravacao.
--
-- O PROBLEMA: o mesmo lote estava sendo cadastrado duas vezes por diferenca de
-- digitacao, e o saldo ficava dividido entre as duas linhas. Encontrados 7
-- pares, todos na Satelite 1:
--   25A75W / 25a75w      Losartana        (so caixa alta/baixa)
--   25E9F0 / 25e9f0      Metformina       (idem)
--   25E0234 / 25e0234    Sulfato ferroso  (idem)
--   DP25H227 / dp25h227  Dipirona inj.    (idem)
--   BTMID25001A / BTM1D25001A  Cefotaxima (I trocado por 1)
--   26D16I / 26D161            Cloreto K  (idem)
--   4O8521 / 408521            Rivaroxabana (letra O trocada por zero)
--
-- ESTA MIGRATION RESOLVE OS 4 PRIMEIROS e impede que voltem: passando tudo a
-- MAIUSCULA na gravacao, 25a75w e 25A75W deixam de ser lotes diferentes.
--
-- Os casos de I/1 e O/0 NAO sao corrigidos automaticamente de proposito: sao
-- caracteres realmente distintos e o banco nao tem como saber qual esta certo.
-- Adivinhar poderia fundir dois lotes de verdade.
--
-- SO FARMACIA: expiry_tracking guarda lote de medicamento E de material. O
-- gatilho age apenas quando o item existe em pharmacy_items — o almoxarifado
-- fica intocado, por decisao explicita.

create or replace function public.fn_normaliza_lote_farmacia()
returns trigger
language plpgsql
as $$
begin
  if new.batch_number is null then
    return new;
  end if;
  -- Almoxarifado passa direto: o item nao esta no catalogo de farmacia.
  if not exists (select 1 from public.pharmacy_items pi where pi.id = new.item_id) then
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

drop trigger if exists trg_normaliza_lote_farmacia on public.expiry_tracking;
create trigger trg_normaliza_lote_farmacia
  before insert or update of batch_number on public.expiry_tracking
  for each row execute function public.fn_normaliza_lote_farmacia();

-- Alinha o que ja esta gravado. So mexe em lote de FARMACIA que muda de fato,
-- e nao toca em quantidade nenhuma — e alteracao de texto, nao de saldo.
update public.expiry_tracking et
   set batch_number = regexp_replace(upper(btrim(et.batch_number)), '\s+', '', 'g')
 where et.batch_number is not null
   and exists (select 1 from public.pharmacy_items pi where pi.id = et.item_id)
   and et.batch_number is distinct from
       regexp_replace(upper(btrim(et.batch_number)), '\s+', '', 'g');

comment on function public.fn_normaliza_lote_farmacia() is
  'Grava lote de medicamento sempre em maiuscula e sem espacos, para o mesmo '
  'lote nao virar duas linhas com saldos separados. Nao age no almoxarifado.';
