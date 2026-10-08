-- 08/10/2026: pedido da Rafaela. Valor do inventario = ultima compra; o que
-- nunca foi comprado vale pelo VALOR REFERENCIAL (antes era ignorado e 66 itens
-- entravam com R$ 0). Ultima compra gravada como 0 tambem nao zera mais o valor.
create or replace function public.fn_almox_inventario_calcular(p_inv uuid)
returns table(item_id uuid, item_nome text, item_codigo text, unidade text, contado boolean,
  quantidade_contada integer, saldo_sistema_contagem integer, saldo_antes integer, diferenca integer,
  saldo_depois integer, valor_unitario numeric, valor_diferenca numeric, valor_final numeric, linhas integer)
language sql stable security definer
set search_path = public, pg_temp
as $f$
  with inv as (select * from public.almox_inventarios where id = p_inv),
  c as (
    select ct.item_id, sum(ct.quantidade)::integer qtd,
           max(ct.saldo_sistema_no_momento)::integer saldo_c, count(*)::integer n
      from public.almox_inventario_contagens ct
     where ct.inventario_id = p_inv
     group by ct.item_id),
  base as (
    select w.id, w.name, w.code, w.unit, coalesce(w.current_stock, 0) atual,
           coalesce(nullif(w.last_purchase_price, 0), nullif(w.reference_price, 0), nullif(w.price, 0), 0)::numeric vu, c.qtd, c.saldo_c, c.n
      from public.warehouse_items w
      left join c on c.item_id = w.id
     where w.is_active is true or c.item_id is not null)
  select b.id, b.name, b.code, b.unit, b.qtd is not null, b.qtd, b.saldo_c, b.atual,
         d.dif, b.atual + d.dif, b.vu, d.dif * b.vu, (b.atual + d.dif) * b.vu, coalesce(b.n, 0)
    from base b
   cross join inv
   cross join lateral (
     select case when b.qtd is not null then b.qtd - b.saldo_c
                 when inv.nao_contados = 'zerar' then -b.atual
                 else 0 end as dif) d
$f$;

revoke all on function public.fn_almox_inventario_calcular(uuid) from public, anon, authenticated;
