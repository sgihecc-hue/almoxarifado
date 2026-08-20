-- Dispensar material com saldo insuficiente mostrava 'Valor invalido para o
-- campo. Verifique os dados informados.' — texto que a aplicacao usa para
-- QUALQUER violacao de constraint. Quem barrava era o CHECK de item_stocks
-- (material nao pode ficar negativo), e a operadora nao tinha como saber
-- qual item da lista estava sem estoque.
--
-- Agora a funcao confere o saldo antes de gravar e diz o nome do item, o
-- disponivel e o pedido.
-- Dispensação de MATERIAL da farmácia satélite passa a aceitar LOTE.
-- Cada linha de p_items pode trazer, todos opcionais:
--   expiry_tracking_id -> lote JÁ existente do item naquele local
--   batch_number/expiry_date -> lote DIGITADO na hora pela operadora
-- Quando não vem nenhum dos dois, o comportamento é o de antes (movimento sem
-- lote), porque há material antigo que nunca teve lote informado.
-- O lote digitado existe porque muito material do satélite chegou por
-- solicitação do almoxarifado sem lote no sistema: a operadora está com a
-- caixa na mão e o lote impresso nela. Se o lote digitado já existir para o
-- item/local, reaproveita a linha; senão cria — e o abatimento pode deixá-la
-- NEGATIVA de propósito (mesma filosofia do FA5 da farmácia: o físico existe e
-- ainda não foi lançado; quando lançarem a entrada, o negativo é compensado).
-- expiry_tracking não tem CHECK de não-negativo. O CHECK que continua valendo
-- é o de item_stocks (quantity >= 0 or item_type='pharmacy'): sem saldo no
-- local a dispensação falha de qualquer jeito, com ou sem lote — e isso é o
-- desejado, não é contornado aqui.
-- MESMA assinatura de 4 parâmetros — sem sobrecarga (função ambígua já causou
-- incidente aqui). Nada de medicamento é tocado.
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
  v_saldo integer;
  v_code text;
  v_nome text;
  v_qty integer;
  v_lot uuid;
  v_lot_item uuid;
  v_lot_loc uuid;
  v_batch text;
  v_exp date;
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

  v_code := coalesce(p_source_location_code,'SAT_T');
  select id into v_loc from public.stock_locations where code = v_code;
  if v_loc is null then raise exception 'Estoque de origem nao encontrado: %', p_source_location_code; end if;

  for it in select value from jsonb_array_elements(p_items)
  loop
    v_item := (it->>'item_id')::uuid;
    v_qty  := (it->>'quantity')::integer;
    v_lot  := nullif(it->>'expiry_tracking_id','')::uuid;
    v_batch := nullif(btrim(coalesce(it->>'batch_number','')),'');
    v_exp   := nullif(it->>'expiry_date','')::date;
    if v_item is null then raise exception 'Linha sem item.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade invalida em uma das linhas.'; end if;

    -- Lote é OPCIONAL. Quando informado, tem que ser deste item e deste local
    -- — lote de outro estoque nunca pode sair daqui (FA4: lote por local).
    if v_lot is not null then
      select item_id, location_id into v_lot_item, v_lot_loc
        from public.expiry_tracking where id = v_lot;
      if v_lot_item is null then raise exception 'Lote informado nao encontrado.'; end if;
      if v_lot_item <> v_item then raise exception 'O lote informado nao pertence ao item da linha.'; end if;
      if v_lot_loc is distinct from v_loc then raise exception 'O lote informado nao esta no estoque %.', coalesce(p_source_location_code,'SAT_T'); end if;
    elsif v_batch is not null or v_exp is not null then
      -- Lote DIGITADO. Reaproveita a linha quando o mesmo batch_number ja
      -- existe pra esse item nesse local (nao duplica); senao cria zerada e
      -- deixa o abatimento abaixo levar a saldo negativo (FA5).
      select id into v_lot
        from public.expiry_tracking
       where item_id = v_item
         and location_id = v_loc
         and coalesce(btrim(batch_number),'') = coalesce(v_batch,'')
       order by created_at nulls last
       limit 1;

      if v_lot is null then
        insert into public.expiry_tracking(item_id, location_id, batch_number, expiry_date,
          initial_quantity, current_quantity, created_by)
        values (v_item, v_loc, v_batch, v_exp, 0, 0, v_uid)
        returning id into v_lot;
      elsif v_exp is not null then
        -- Lote ja existia sem validade e agora ela veio da caixa: completa.
        update public.expiry_tracking
           set expiry_date = coalesce(expiry_date, v_exp)
         where id = v_lot;
      end if;
    end if;

    -- Confere o saldo ANTES de gravar. Sem isto, quem barrava era o CHECK de
    -- item_stocks (material nao pode ficar negativo) — e a tela mostrava
    -- "Valor invalido para o campo", sem dizer qual item nem quanto falta.
    select coalesce(quantity, 0) into v_saldo
      from public.item_stocks
     where item_id = v_item and item_type = 'warehouse' and location_id = v_loc;
    if coalesce(v_saldo, 0) < v_qty then
      select name into v_nome from public.warehouse_items where id = v_item;
      raise exception 'Estoque insuficiente de "%" na %: disponivel %, pedido %.',
        coalesce(v_nome, 'item'), v_code, coalesce(v_saldo, 0), v_qty;
    end if;

    -- Movimento de saída de MATERIAL. O trigger debita item_stocks(v_loc, warehouse).
    insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
      source_location_id, reason, reason_detail, destino_tipo, destino_nome, performed_by, notes,
      expiry_tracking_id)
    values (v_item, 'warehouse', 'SAIDA_AVULSA', 'out', v_qty, v_loc,
      'outro', 'Dispensacao de material', 'setor_interno', p_sector, v_uid, p_notes,
      v_lot);

    -- Abate o saldo do lote (só quando veio lote). PODE ficar negativo, de
    -- propósito: o lote digitado nasce com zero e o físico ja saiu da caixa.
    -- Truncar em zero perderia essa quantidade da contabilidade — a entrada
    -- lançada depois somaria por cima e o saldo ficaria maior que o real.
    -- Com o negativo, a entrada posterior compensa e o número fecha (FA5).
    -- Quem barra saída sem lastro é o item_stocks, que não aceita material
    -- negativo — essa proteção continua valendo.
    if v_lot is not null then
      update public.expiry_tracking
         set current_quantity = coalesce(current_quantity,0) - v_qty
       where id = v_lot;
    end if;

    v_count := v_count + 1;
    v_total := v_total + v_qty;
  end loop;

  return jsonb_build_object('itens', v_count, 'quantidade_total', v_total, 'local', p_source_location_code, 'setor', p_sector);
end $function$;
