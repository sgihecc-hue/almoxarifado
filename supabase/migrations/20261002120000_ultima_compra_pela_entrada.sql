-- 02/10/2026: "valor da ultima compra" nao acompanhava as entradas. As funcoes de
-- entrada gravavam unit_price so em stock_entries; a tela de estoque e os
-- relatorios de valor leem warehouse_items/pharmacy_items.last_purchase_price.
-- Regra: last_purchase_price = preco da entrada de COMPRA mais recente, ativa e
-- com preco > 0. Recalculado em toda insercao/edicao/exclusao de entrada.
-- Emprestimo, doacao, inventario e entradas sem preco nao mexem no valor.
create or replace function public.fn_atualiza_ultima_compra()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_item uuid := coalesce(new.item_id, old.item_id);
  v_tipo text := coalesce(new.item_type, old.item_type);
  v_preco numeric;
begin
  select se.unit_price into v_preco
    from public.stock_entries se
   where se.item_id = v_item and se.item_type = v_tipo
     and se.anulada_em is null and coalesce(se.acquisition_type, 'Compra') = 'Compra'
     and coalesce(se.unit_price, 0) > 0
   order by coalesce(se.invoice_date, se.created_at::date) desc, se.created_at desc
   limit 1;
  if v_preco is null then
    return null; -- sem compra com preco: mantem o valor que estiver no cadastro
  end if;
  if v_tipo = 'pharmacy' then
    update public.pharmacy_items set last_purchase_price = v_preco
     where id = v_item and last_purchase_price is distinct from v_preco;
  elsif v_tipo = 'warehouse' then
    update public.warehouse_items set last_purchase_price = v_preco
     where id = v_item and last_purchase_price is distinct from v_preco;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_atualiza_ultima_compra on public.stock_entries;
create trigger trg_atualiza_ultima_compra
  after insert or update of unit_price, acquisition_type, anulada_em, invoice_date or delete
  on public.stock_entries
  for each row execute function public.fn_atualiza_ultima_compra();

-- Acerto do que ja foi lancado: cada item com compra registrada passa a ter o
-- preco da compra mais recente. Itens sem compra com preco ficam como estao.
with ult as (
  select distinct on (item_id, item_type) item_id, item_type, unit_price
    from public.stock_entries
   where anulada_em is null and coalesce(acquisition_type, 'Compra') = 'Compra' and coalesce(unit_price, 0) > 0
   order by item_id, item_type, coalesce(invoice_date, created_at::date) desc, created_at desc
)
update public.pharmacy_items p set last_purchase_price = u.unit_price
  from ult u where u.item_type = 'pharmacy' and u.item_id = p.id and p.last_purchase_price is distinct from u.unit_price;

with ult as (
  select distinct on (item_id, item_type) item_id, item_type, unit_price
    from public.stock_entries
   where anulada_em is null and coalesce(acquisition_type, 'Compra') = 'Compra' and coalesce(unit_price, 0) > 0
   order by item_id, item_type, coalesce(invoice_date, created_at::date) desc, created_at desc
)
update public.warehouse_items w set last_purchase_price = u.unit_price
  from ult u where u.item_type = 'warehouse' and u.item_id = w.id and w.last_purchase_price is distinct from u.unit_price;
