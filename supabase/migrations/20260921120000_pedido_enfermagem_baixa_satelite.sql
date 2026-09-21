-- PEDIDO DE ENFERMAGEM: a baixa sai do estoque da SATELITE TERREO, nunca do
-- almoxarifado.
--
-- O ERRO (encontrado em 21/09/2026, antes de qualquer pedido de kit existir):
-- o pedido de enfermagem nasce type='warehouse'. Na entrega, o gatilho
-- deduct_stock_on_request_delivered abate de warehouse_items.current_stock,
-- que e o saldo do ALMOXARIFADO central. O material, porem, sai da prateleira
-- da Satelite Terreo, cujo saldo e item_stocks(SAT_T). Resultado, se um pedido
-- fosse entregue: o almox perderia saldo que nao saiu dele, e a satelite
-- ficaria com saldo que ja nao tem.
--
-- Regra do negocio (Adonias, 21/09): o material sai do estoque de quem atende.
-- Os pedidos que o almoxarifado ja atende hoje continuam certos baixando do
-- almoxarifado — e nao mudam.
--
-- A CORRECAO:
--   1. atender_pedido_enfermagem: a satelite informa quantidade e lote, e a
--      baixa e feita por criar_saida_material — a MESMA funcao que a Satelite
--      Terreo ja usa pra dar saida de material (item_stocks + lote por local,
--      com saldo conferido antes). Nenhuma logica de estoque nova.
--   2. Pedido de enfermagem so e concluido por essa RPC. Entregar pelo fluxo
--      generico do almox e recusado com mensagem clara.
--   3. deduct_stock_on_request_delivered ganha UMA guarda no topo: pedido de
--      enfermagem nao abate do almoxarifado. Pra todo outro pedido o corpo e
--      identico ao de antes (conferido por diff antes de aplicar).
--
-- "Pedido de enfermagem" = pedido com linha em request_kits ou em
-- request_item_patients. So a RPC criar_pedido_enfermagem grava nessas
-- tabelas, e ela sempre grava ao menos uma linha.

-- 0) Quem e pedido de enfermagem ---------------------------------------------
create or replace function public.fn_is_pedido_enfermagem(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from public.request_kits where request_id = p_request_id)
      or exists (select 1 from public.request_item_patients where request_id = p_request_id)
$$;

-- 1) Guarda no gatilho de baixa do almoxarifado ------------------------------
-- Corpo original (em producao ate 21/09/2026) preservado linha a linha; a unica
-- mudanca e o bloco "Pedido de enfermagem" logo apos o begin.
create or replace function public.deduct_stock_on_request_delivered()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  ri RECORD;
  qty_to_deduct integer;
begin
  -- Pedido de enfermagem: a baixa e da Satelite Terreo, feita por
  -- atender_pedido_enfermagem. Nao abate do almoxarifado.
  if public.fn_is_pedido_enfermagem(NEW.id) then
    return NEW;
  end if;

  if (NEW.status in ('delivered','completed'))
     and (OLD.status is null or OLD.status not in ('delivered','completed')) then
    for ri in
      select id, item_type, warehouse_item_id, quantity, supplied_quantity, approved_quantity
        from request_items
       where request_id = NEW.id
    loop
      qty_to_deduct := coalesce(ri.supplied_quantity, ri.approved_quantity, ri.quantity);
      if qty_to_deduct is null or qty_to_deduct <= 0 then
        continue;
      end if;
      -- Apenas almoxarifado (modelo legado). Farmácia é tratada no recebimento.
      if ri.item_type = 'warehouse' and ri.warehouse_item_id is not null then
        update warehouse_items
           set current_stock = GREATEST(current_stock - qty_to_deduct, 0),
               updated_at = now()
         where id = ri.warehouse_item_id;
      end if;
    end loop;
  end if;
  return NEW;
end;
$function$;

-- 2) Pedido de enfermagem so conclui pela RPC da satelite ---------------------
create or replace function public.fn_pedido_enfermagem_so_pela_satelite()
returns trigger
language plpgsql
as $function$
begin
  if NEW.status in ('delivered','completed')
     and (OLD.status is null or OLD.status not in ('delivered','completed'))
     and public.fn_is_pedido_enfermagem(NEW.id)
     and coalesce(current_setting('app.pedido_enfermagem', true), '') <> NEW.id::text then
    raise exception 'Pedido de enfermagem e atendido pela Satelite Terreo: use "Atender pela Satelite Terreo" no detalhe do pedido.';
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_pedido_enfermagem_so_pela_satelite on public.requests;
create trigger trg_pedido_enfermagem_so_pela_satelite
  before update of status on public.requests
  for each row execute function public.fn_pedido_enfermagem_so_pela_satelite();

-- 3) Atender ------------------------------------------------------------------
-- p_items: [{request_item_id, quantity, expiry_tracking_id?, batch_number?, expiry_date?}]
-- quantity 0 = item nao fornecido (fica registrado como 0).
-- O mesmo request_item_id pode vir mais de uma vez: um lote por linha.
create or replace function public.atender_pedido_enfermagem(
  p_request_id uuid,
  p_items jsonb,
  p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_req public.requests%rowtype;
  v_sat uuid;
  v_setor text;
  it jsonb;
  v_ri uuid;
  v_item uuid;
  v_qty integer;
  v_saida jsonb := '[]'::jsonb;
  v_res jsonb;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  select role into v_role from public.users where id = v_uid;
  if coalesce(v_role,'') not in ('administrador','gestor','atendente','pharmacist','admin','manager') then
    raise exception 'Sem permissao para atender pedido de enfermagem.';
  end if;

  select * into v_req from public.requests where id = p_request_id for update;
  if v_req.id is null then raise exception 'Pedido nao encontrado.'; end if;
  if not public.fn_is_pedido_enfermagem(p_request_id) then
    raise exception 'Este pedido nao e pedido de enfermagem.';
  end if;
  select id into v_sat from public.stock_locations where code = 'SAT_T';
  if v_req.source_location_id is distinct from v_sat then
    raise exception 'Pedido nao e da Satelite Terreo.';
  end if;
  if v_req.status not in ('pending','approved','processing') then
    raise exception 'Pedido ja foi %.', case v_req.status
      when 'completed' then 'atendido' when 'delivered' then 'entregue'
      when 'rejected' then 'recusado' when 'cancelled' then 'cancelado' else v_req.status end;
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Informe a quantidade fornecida de cada item.';
  end if;

  select name into v_setor from public.departments where id = v_req.department_id;

  -- Zera o fornecido e soma linha a linha (um item pode sair de dois lotes).
  update public.request_items set supplied_quantity = 0 where request_id = p_request_id;

  for it in select value from jsonb_array_elements(p_items)
  loop
    v_ri  := (it->>'request_item_id')::uuid;
    v_qty := coalesce((it->>'quantity')::integer, 0);
    if v_qty < 0 then raise exception 'Quantidade negativa.'; end if;
    select warehouse_item_id into v_item from public.request_items
     where id = v_ri and request_id = p_request_id;
    if v_item is null then raise exception 'Item nao pertence a este pedido.'; end if;

    update public.request_items
       set supplied_quantity = coalesce(supplied_quantity,0) + v_qty,
           approved_quantity = coalesce(supplied_quantity,0) + v_qty
     where id = v_ri;

    if v_qty > 0 then
      v_saida := v_saida || jsonb_build_array(jsonb_build_object(
        'item_id', v_item,
        'quantity', v_qty,
        'expiry_tracking_id', nullif(it->>'expiry_tracking_id',''),
        'batch_number', nullif(it->>'batch_number',''),
        'expiry_date', nullif(it->>'expiry_date','')));
    end if;
  end loop;

  if jsonb_array_length(v_saida) = 0 then
    raise exception 'Nenhum item fornecido. Se nao ha como atender, use Recusar.';
  end if;

  -- Baixa pela funcao que a Satelite Terreo ja usa: item_stocks(SAT_T) e lote
  -- do proprio local, com saldo conferido antes (erro diz item e quanto falta).
  v_res := public.criar_saida_material('SAT_T', coalesce(v_setor, 'Enfermagem'), v_saida,
    'Pedido de enfermagem n. ' || v_req.request_number || coalesce(' · ' || nullif(btrim(coalesce(p_notes,'')),''), ''));

  perform set_config('app.pedido_enfermagem', p_request_id::text, true);
  update public.requests
     set status = 'completed',
         approved_at = coalesce(approved_at, now()), approved_by = coalesce(approved_by, v_uid),
         delivered_at = now(), delivered_by = v_uid,
         completed_at = now(), completed_by = v_uid,
         delivery_notes = nullif(btrim(coalesce(p_notes,'')),'')
   where id = p_request_id;
  perform set_config('app.pedido_enfermagem', '', true);

  return jsonb_build_object('request_id', p_request_id, 'numero', v_req.request_number,
    'itens', v_res->'itens', 'quantidade_total', v_res->'quantidade_total');
end $function$;

-- 4) Recusar ------------------------------------------------------------------
create or replace function public.recusar_pedido_enfermagem(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_status text;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  select role into v_role from public.users where id = v_uid;
  if coalesce(v_role,'') not in ('administrador','gestor','atendente','pharmacist','admin','manager') then
    raise exception 'Sem permissao para recusar pedido de enfermagem.';
  end if;
  if coalesce(btrim(coalesce(p_reason,'')),'') = '' then raise exception 'Informe o motivo da recusa.'; end if;
  if not public.fn_is_pedido_enfermagem(p_request_id) then
    raise exception 'Este pedido nao e pedido de enfermagem.';
  end if;
  select status into v_status from public.requests where id = p_request_id for update;
  if v_status not in ('pending','approved','processing') then
    raise exception 'Pedido nao pode mais ser recusado.';
  end if;
  update public.requests
     set status = 'rejected', rejected_at = now(), rejected_by = v_uid,
         rejection_reason = btrim(p_reason)
   where id = p_request_id;
end $function$;

revoke execute on function public.atender_pedido_enfermagem(uuid, jsonb, text) from public, anon;
grant execute on function public.atender_pedido_enfermagem(uuid, jsonb, text) to authenticated;
revoke execute on function public.recusar_pedido_enfermagem(uuid, text) from public, anon;
grant execute on function public.recusar_pedido_enfermagem(uuid, text) to authenticated;
revoke execute on function public.fn_is_pedido_enfermagem(uuid) from public, anon;
grant execute on function public.fn_is_pedido_enfermagem(uuid) to authenticated;
