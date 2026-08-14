-- Dispensação DIRETA de MATERIAL a partir de um satélite de material (SAT_T)
-- para um setor. É separada da dispensação de medicamento (criar_dispensacao),
-- que é 100% pharmacy e cujas tabelas têm FK para pharmacy_items — por isso
-- material não cabe lá. Aqui a baixa é registrada como movimento de saída de
-- material (item_type='warehouse'); o trigger fn_apply_stock_movement debita
-- o item_stocks(SAT_T, warehouse) automaticamente (permite negativo, FA5).
-- NÃO toca em nada de medicamento.
create or replace function public.criar_saida_material(
  p_source_location_code text,
  p_sector text,
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
  v_loc uuid;
  it jsonb;
  v_item uuid;
  v_qty integer;
  v_count integer := 0;
  v_total integer := 0;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  if coalesce(btrim(coalesce(p_sector,'')),'') = '' then raise exception 'Informe o setor de destino.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Dispensacao sem itens.'; end if;

  select role into v_role from public.users where id = v_uid;
  if coalesce(v_role,'') not in ('administrador','gestor','atendente','pharmacist','admin','manager','warehouse_manager') then
    raise exception 'Sem permissao para dispensar material.';
  end if;

  select id into v_loc from public.stock_locations where code = coalesce(p_source_location_code,'SAT_T');
  if v_loc is null then raise exception 'Estoque de origem nao encontrado: %', p_source_location_code; end if;

  for it in select value from jsonb_array_elements(p_items)
  loop
    v_item := (it->>'item_id')::uuid;
    v_qty  := (it->>'quantity')::integer;
    if v_item is null then raise exception 'Linha sem item.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade invalida em uma das linhas.'; end if;

    -- Movimento de saída de MATERIAL. O trigger debita item_stocks(v_loc, warehouse).
    insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
      source_location_id, reason, reason_detail, destino_tipo, destino_nome, performed_by, notes)
    values (v_item, 'warehouse', 'SAIDA_AVULSA', 'out', v_qty, v_loc,
      'outro', 'Dispensacao de material', 'setor_interno', p_sector, v_uid, p_notes);

    v_count := v_count + 1;
    v_total := v_total + v_qty;
  end loop;

  return jsonb_build_object('itens', v_count, 'quantidade_total', v_total, 'local', p_source_location_code, 'setor', p_sector);
end $function$;
