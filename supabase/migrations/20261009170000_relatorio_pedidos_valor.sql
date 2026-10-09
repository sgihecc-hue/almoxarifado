-- 09/10/2026: pedido da Rafaela. Valor em R$ dos pedidos (solicitado, aprovado e
-- atendido) para apresentar ao financeiro. Valor do item = ultima compra; item
-- nunca comprado = valor referencial (mesma regra do inventario).
create or replace function public.relatorio_pedidos_valor(p_tipo text, p_inicio date, p_fim date, p_request_id uuid default null)
returns table(request_id uuid, request_number integer, criado_em timestamptz, status text, setor text, solicitante text,
              itens integer, valor_solicitado numeric, valor_aprovado numeric, valor_atendido numeric)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and coalesce(u.is_active, true)
                 and u.role in ('administrador','admin','gestor','atendente','pharmacist')) then
    raise exception 'Sem permissao para o relatorio de pedidos com valor.';
  end if;
  return query
  with it as (
    select ri.request_id rid, ri.quantity q, ri.approved_quantity qa, coalesce(ri.supplied_quantity, ri.delivered_quantity) qs,
           coalesce(nullif(w.last_purchase_price,0), nullif(w.reference_price,0), nullif(w.price,0),
                    nullif(p.last_purchase_price,0), nullif(p.reference_price,0), nullif(p.price,0), 0)::numeric vu
      from public.request_items ri
      left join public.warehouse_items w on w.id = ri.warehouse_item_id
      left join public.pharmacy_items p on p.id = ri.pharmacy_item_id
  )
  select r.id, r.request_number::integer, r.created_at, r.status::text,
         coalesce(d.name, r.department, '')::text, coalesce(u.full_name, '')::text,
         count(it.*)::integer,
         round(coalesce(sum(it.q * it.vu), 0), 2),
         round(coalesce(sum(coalesce(it.qa, it.q) * it.vu) filter (where r.status not in ('pending','rejected','cancelled')), 0), 2),
         round(coalesce(sum(coalesce(it.qs, case when r.status in ('completed','delivered') then coalesce(it.qa, it.q) end, 0) * it.vu), 0), 2)
    from public.requests r
    left join public.departments d on d.id = r.department_id
    left join public.users u on u.id = r.requester_id
    left join it on it.rid = r.id
   where r.type = p_tipo
     and (p_request_id is not null and r.id = p_request_id
          or p_request_id is null and (r.created_at at time zone 'America/Bahia')::date between p_inicio and p_fim)
   group by r.id, r.request_number, r.created_at, r.status, d.name, r.department, u.full_name
   order by r.created_at desc;
end $$;
revoke all on function public.relatorio_pedidos_valor(text, date, date, uuid) from public, anon;
grant execute on function public.relatorio_pedidos_valor(text, date, date, uuid) to authenticated, service_role;
