-- A tela Entradas (almox e farmacia) consulta
--   stock_entries?select=*,item:warehouse_items(name,code,unit)   (ou pharmacy_items)
-- mas stock_entries.item_id e polimorfico (item_type = warehouse | pharmacy) e
-- nao tem chave estrangeira -> PostgREST responde PGRST200 "Could not find a
-- relationship" e a tela mostra "Nenhuma entrada encontrada".
-- Relacionamento computado do PostgREST (funcao com o nome da tabela alvo,
-- recebendo a linha de stock_entries, ROWS 1 = para-um). Roda como quem chama:
-- a RLS de warehouse_items/pharmacy_items continua valendo.
create or replace function public.warehouse_items(public.stock_entries)
returns setof public.warehouse_items
language sql stable rows 1
set search_path = public, pg_temp
as $$
  select wi.* from public.warehouse_items wi
   where wi.id = $1.item_id and $1.item_type = 'warehouse'
$$;

create or replace function public.pharmacy_items(public.stock_entries)
returns setof public.pharmacy_items
language sql stable rows 1
set search_path = public, pg_temp
as $$
  select pi.* from public.pharmacy_items pi
   where pi.id = $1.item_id and $1.item_type = 'pharmacy'
$$;

revoke execute on function public.warehouse_items(public.stock_entries) from public, anon;
revoke execute on function public.pharmacy_items(public.stock_entries) from public, anon;
grant execute on function public.warehouse_items(public.stock_entries) to authenticated;
grant execute on function public.pharmacy_items(public.stock_entries) to authenticated;

notify pgrst, 'reload schema';
