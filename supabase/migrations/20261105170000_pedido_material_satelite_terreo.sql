-- Pedido de material do posto para a Satelite Terreo (fluxo novo desde 04/11).
--
-- O posto pede material do dia a dia a Satelite Terreo (source_location_id =
-- SAT_T). Esse pedido e atendido pela propria Satelite e a baixa sai do
-- estoque dela (item_stocks SAT_T, com lote), igual ao pedido de enfermagem.
-- Antes ele caia no gatilho do almoxarifado, que abatia warehouse_items, e a
-- farmacia nao tinha como atender.
--
-- fn_is_pedido_enfermagem passa a responder "pedido atendido pela Satelite
-- Terreo": enfermagem (kits/pacientes) OU material com origem SAT_T criado no
-- fluxo novo. Corte em 04/11 18:00 UTC: os pedidos antigos com origem SAT_T
-- foram atendidos pelo almox (com baixa no almox) e ficam como estao.

create or replace function public.fn_is_pedido_enfermagem(p_request_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (select 1 from public.request_kits where request_id = p_request_id)
      or exists (select 1 from public.request_item_patients where request_id = p_request_id)
      or exists (
        select 1 from public.requests r
         where r.id = p_request_id
           and r.type = 'warehouse'
           and r.source_location_id = (select id from public.stock_locations where code = 'SAT_T')
           and r.created_at >= timestamptz '2026-11-04 18:00:00+00'
           and not exists (select 1 from public.solicitacao_baixas_almox b where b.request_id = r.id)
      )
$function$;

create or replace function public.fn_pedido_enfermagem_so_pela_satelite()
returns trigger
language plpgsql
as $function$
begin
  if NEW.status in ('delivered','completed')
     and (OLD.status is null or OLD.status not in ('delivered','completed'))
     and public.fn_is_pedido_enfermagem(NEW.id)
     and coalesce(current_setting('app.pedido_enfermagem', true), '') <> NEW.id::text then
    raise exception 'Pedido da Satelite Terreo e atendido por ela: use "Atender pela Satelite Terreo" no detalhe do pedido.';
  end if;
  return NEW;
end;
$function$;

-- Movimentacao/Consumo: o pedido do fluxo novo conta na Satelite Terreo (local
-- = origem), como o de enfermagem. Os antigos com origem SAT_T continuam no
-- ALMOX, que foi quem deu a baixa.
do $$
declare
  v_def text;
  v_novo text;
  v_de constant text := ')))) THEN ''ad02bf13-ab91-42e0-bfe7-b2e5bbb01e40''::uuid';
  v_para constant text := '))) AND (NOT ((r.source_location_id = ''6f3fdf99-829a-46bb-b354-19a44fa36324''::uuid) '
    || 'AND (r.created_at >= ''2026-11-04 18:00:00+00''::timestamp with time zone) '
    || 'AND (NOT (EXISTS (SELECT 1 FROM solicitacao_baixas_almox sba_l WHERE (sba_l.request_id = r.id))))))) '
    || 'THEN ''ad02bf13-ab91-42e0-bfe7-b2e5bbb01e40''::uuid';
  v_view text;
begin
  foreach v_view in array array['v_inventory_movements', 'v_warehouse_consumption']
  loop
    v_def := pg_get_viewdef(('public.' || v_view)::regclass);
    if (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 then
      raise exception '%: esperava 1 ocorrencia da regra de local do pedido', v_view;
    end if;
    v_novo := replace(v_def, v_de, v_para);
    execute format('create or replace view public.%I as %s', v_view, v_novo);
  end loop;
end $$;
