-- =============================================================================
-- PRIVILEGIOS DO NAVEGADOR NAS TABELAS DE ESTOQUE (auditoria 28/09/2026 — M7/F3)
-- Aplicar DEPOIS das migrations 20260928130000..131000 (as RPCs que passaram
-- a gravar o que o navegador gravava) e JUNTO com o deploy do front desta
-- rodada (o front antigo ainda grava stock_movements/stock_transfers direto).
--
-- PROBLEMA: qualquer usuario logado (ate solicitante) inseria em
-- stock_movements / item_stocks / stock_transfers(+items) — as policies eram
-- so "auth.role() = 'authenticated'" — e o gatilho fn_apply_stock_movement
-- (SECURITY DEFINER) aplicava o delta: dava para inflar saldo pela API.
-- anon e authenticated tinham TODOS os privilegios (ate TRUNCATE) em
-- item_stocks, stock_movements, expiry_tracking, warehouse_items,
-- pharmacy_items e stock_entries.
--
-- O QUE FICA REVOGADO (as RPCs SECURITY DEFINER continuam gravando):
--   * TRUNCATE, REFERENCES, TRIGGER de anon e authenticated em todas.
--   * Toda escrita de anon em todas.
--   * stock_movements: INSERT/UPDATE/DELETE de authenticated (so a tela de
--     saida avulsa/transferencia gravava direto; agora e RPC).
--   * stock_transfers / stock_transfer_items: INSERT/UPDATE/DELETE (a tela de
--     Transferencia passou a usar registrar_saida_lote).
--   * item_stocks: INSERT/UPDATE de quantidade e minimo/maximo e DELETE.
--     Continua liberado SO o que a tela de Medicamentos (pharmacy-items.tsx,
--     endereco de prateleira) usa: INSERT(item_id,item_type,location_id,
--     shelf_location) e UPDATE dessas colunas, com gatilho que impede mudar a
--     chave de uma linha existente e policy restrita a operadores.
--   * expiry_tracking, stock_entries: DELETE (nenhuma tela apaga direto).
--
-- O QUE FICOU PENDENTE (gravacao direta de OUTRAS areas — nao revogado):
--   * expiry_tracking INSERT/UPDATE: components/inventory/add-stock-dialog.tsx
--     (insert/update de lote na entrada) e lib/services/items.ts (insert de
--     lote no cadastro/entrada). Auditoria ligada em 20260928131000.
--   * warehouse_items / pharmacy_items INSERT/UPDATE/DELETE:
--     add-stock-dialog.tsx, register-entry-dialog.tsx e edit-item-dialog.tsx
--     (UPDATE de current_stock!), items.ts (cadastro, reativacao, exclusao).
--   * stock_entries INSERT/UPDATE: add-stock-dialog.tsx, edit-item-dialog.tsx,
--     register-entry-dialog.tsx, items.ts.
-- =============================================================================

-- 1) TRUNCATE/REFERENCES/TRIGGER e escrita anonima: fora em todas ------------------
revoke truncate, references, trigger on
  public.item_stocks, public.stock_movements, public.expiry_tracking,
  public.warehouse_items, public.pharmacy_items, public.stock_entries,
  public.stock_transfers, public.stock_transfer_items
  from anon, authenticated;
revoke insert, update, delete on
  public.item_stocks, public.stock_movements, public.expiry_tracking,
  public.warehouse_items, public.pharmacy_items, public.stock_entries,
  public.stock_transfers, public.stock_transfer_items
  from anon;

-- 2) stock_movements: livro-razao so por RPC -----------------------------------------
drop policy if exists stock_movements_insert on public.stock_movements;
revoke insert, update, delete on public.stock_movements from authenticated;

-- 3) stock_transfers(+items): so por RPC -------------------------------------------------
drop policy if exists stock_transfers_insert on public.stock_transfers;
drop policy if exists stock_transfer_items_insert on public.stock_transfer_items;
revoke insert, update, delete on public.stock_transfers, public.stock_transfer_items from authenticated;

-- 4) item_stocks: so endereco de prateleira pelo navegador ----------------------------------
revoke insert, update, delete on public.item_stocks from authenticated;
grant insert (item_id, item_type, location_id, shelf_location) on public.item_stocks to authenticated;
grant update (item_id, item_type, location_id, shelf_location) on public.item_stocks to authenticated;

drop policy if exists item_stocks_insert on public.item_stocks;
create policy item_stocks_insert on public.item_stocks for insert to authenticated
  with check (exists (select 1 from public.users u where u.id = auth.uid()
                       and u.role in ('admin','administrador','gestor','atendente','pharmacist')));
drop policy if exists item_stocks_update on public.item_stocks;
create policy item_stocks_update on public.item_stocks for update to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid()
                  and u.role in ('admin','administrador','gestor','atendente','pharmacist')))
  with check (exists (select 1 from public.users u where u.id = auth.uid()
                       and u.role in ('admin','administrador','gestor','atendente','pharmacist')));

-- Upsert do endereco reescreve as colunas-chave com o MESMO valor; mudar a
-- chave de uma linha (mover saldo de item/local) e recusado. Quantidade nao
-- e gravavel pelo navegador (sem privilegio de coluna).
create or replace function public.fn_item_stocks_protege_chave()
returns trigger
language plpgsql
-- INVOKER de proposito: current_user = quem chamou; RPCs (postgres) passam.
set search_path to 'public', 'pg_temp'
as $f$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if coalesce(new.quantity, 0) <> 0 then
      raise exception 'Saldo so muda por movimentacao de estoque.';
    end if;
    return new;
  end if;
  if new.item_id is distinct from old.item_id or new.item_type is distinct from old.item_type
     or new.location_id is distinct from old.location_id or new.quantity is distinct from old.quantity
     or new.min_qty is distinct from old.min_qty or new.max_qty is distinct from old.max_qty then
    raise exception 'Pelo navegador so o endereco de prateleira pode ser alterado; saldo so muda por movimentacao de estoque.';
  end if;
  return new;
end $f$;
drop trigger if exists trg_item_stocks_protege_chave on public.item_stocks;
create trigger trg_item_stocks_protege_chave before insert or update on public.item_stocks
  for each row execute function public.fn_item_stocks_protege_chave();

-- 5) DELETE que nenhuma tela usa ---------------------------------------------------------
revoke delete on public.expiry_tracking, public.stock_entries from authenticated;
