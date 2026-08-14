-- Nova Entrada (farmácia/almox): captura a DATA DE ENTREGA (dia que o item
-- chegou no hospital), além da data de emissão da NF (que já era o p_invoice_date).
-- A coluna stock_entries.delivery_date já existe; a RPC só não a gravava.
-- Criamos um overload com p_delivery_date ao final (default null). O overload
-- antigo (9 params) continua existindo para não quebrar chamadas em cache
-- durante o deploy — o PostgREST resolve pelo conjunto de parâmetros nomeados.
create or replace function public.registrar_entrada_nf(
  p_item_type text, p_invoice_number text, p_invoice_date date, p_afm_number text,
  p_supplier_cnpj text, p_supplier_name text, p_items jsonb,
  p_acquisition_type text default 'Compra', p_location_code text default null,
  p_delivery_date date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text; v_code text; v_loc uuid;
  it jsonb; v_item uuid; v_qty integer; v_price numeric; v_batch text; v_exp date; v_lot uuid;
  v_line_total numeric; v_count integer := 0; v_total_qty integer := 0; v_total_val numeric := 0;
  v_afm text := coalesce(nullif(btrim(coalesce(p_afm_number,'')),''), 'N/I');
  v_cnpj text := coalesce(nullif(btrim(coalesce(p_supplier_cnpj,'')),''), '00.000.000/0000-00');
  v_supp text := coalesce(nullif(btrim(coalesce(p_supplier_name,'')),''), 'Nao informado');
  v_inv text := nullif(btrim(coalesce(p_invoice_number,'')),'');
  v_invdate date := coalesce(p_invoice_date, current_date);
  v_delivdate date := p_delivery_date;  -- pode ser null
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  if p_item_type not in ('pharmacy','warehouse') then raise exception 'item_type invalido: %', p_item_type; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Entrada sem itens.'; end if;

  select role into v_role from public.users where id = v_uid;
  if coalesce(v_role,'') not in ('administrador','gestor','atendente','admin','manager','pharmacist','warehouse_manager') then
    raise exception 'Sem permissao para registrar entrada.';
  end if;

  v_code := coalesce(nullif(btrim(coalesce(p_location_code,'')),''),
                     case when p_item_type='pharmacy' then 'CAF' else 'ALMOX' end);
  select id into v_loc from public.stock_locations where code = v_code;
  if v_loc is null then raise exception 'Local % nao encontrado.', v_code; end if;

  for it in select value from jsonb_array_elements(p_items)
  loop
    v_item  := (it->>'item_id')::uuid;
    v_qty   := (it->>'quantity')::integer;
    v_price := coalesce((it->>'unit_price')::numeric, 0);
    v_batch := nullif(btrim(coalesce(it->>'batch_number','')),'');
    v_exp   := nullif(it->>'expiry_date','')::date;
    if v_item is null then raise exception 'Linha sem item.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade invalida em uma das linhas.'; end if;
    v_line_total := round(v_qty * v_price, 2);

    v_lot := null;
    if v_batch is not null then
      select id into v_lot from public.expiry_tracking
       where item_id = v_item and batch_number = v_batch and location_id = v_loc limit 1;
      if v_lot is null then
        insert into public.expiry_tracking(item_id, batch_number, expiry_date, initial_quantity,
          current_quantity, created_by, invoice_number, invoice_date, afm_number, supplier_cnpj,
          supplier_name, invoice_total_value, location_id)
        values (v_item, v_batch, v_exp, v_qty, v_qty, v_uid, v_inv, v_invdate, v_afm, v_cnpj,
          v_supp, v_line_total, v_loc)
        returning id into v_lot;
      else
        update public.expiry_tracking
           set current_quantity = current_quantity + v_qty,
               initial_quantity = initial_quantity + v_qty,
               expiry_date = coalesce(expiry_date, v_exp)
         where id = v_lot;
      end if;
    end if;

    if p_item_type = 'pharmacy' then
      insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity, unit_cost,
        target_location_id, expiry_tracking_id, performed_by, notes)
      values (v_item, 'pharmacy', 'ENTRADA_NF', 'in', v_qty, v_price, v_loc, v_lot, v_uid,
        'Entrada (' || coalesce(p_acquisition_type,'Compra') || ')' || coalesce(' NF ' || v_inv, ''));
    else
      update public.warehouse_items set current_stock = current_stock + v_qty, updated_at = now() where id = v_item;
    end if;

    insert into public.stock_entries(item_id, item_type, quantity, acquisition_type, invoice_number, invoice_date,
      invoice_total_value, expiry_date, afm_number, supplier_cnpj, supplier_name, unit_price, batch_number,
      delivery_date, created_by)
    values (v_item, p_item_type, v_qty, coalesce(p_acquisition_type,'Compra'), v_inv, v_invdate,
      v_line_total, v_exp, v_afm, v_cnpj, v_supp, v_price, v_batch, v_delivdate, v_uid);

    v_count := v_count + 1; v_total_qty := v_total_qty + v_qty; v_total_val := v_total_val + v_line_total;
  end loop;

  return jsonb_build_object('itens', v_count, 'quantidade_total', v_total_qty, 'valor_total', v_total_val, 'local', v_code);
end $function$;
