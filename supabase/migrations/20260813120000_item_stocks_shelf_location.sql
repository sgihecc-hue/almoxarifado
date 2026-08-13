-- Local/prateleira do item DENTRO de cada estoque de farmácia.
-- Fica em item_stocks (por item × local) porque o mesmo medicamento pode
-- estar em prateleiras diferentes na CAF e nos satélites — não é um atributo
-- global do item. É só uma referência física de organização (texto livre).
alter table item_stocks
  add column if not exists shelf_location text;

comment on column item_stocks.shelf_location is
  'Localização física (prateleira/posição) do item dentro deste estoque. Texto livre, editável pelos operadores da farmácia.';

-- Operadores da farmácia (atendente e farmacêutico, além de gestor/admin)
-- precisam gravar o Local. A policy antiga só tinha administrador/gestor/atendente.
drop policy if exists item_stocks_update on item_stocks;
create policy item_stocks_update on item_stocks
  for update
  using (
    exists (
      select 1 from users u
      where u.id = auth.uid()
        and u.role = any (array['admin','administrador','gestor','atendente','pharmacist'])
    )
  );
