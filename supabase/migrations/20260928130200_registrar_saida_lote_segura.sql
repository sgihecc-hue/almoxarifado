-- =============================================================================
-- SAIDA EM LOTE segura (auditoria 28/09/2026 — C6, M1, A1, A2, A9, F14, C5)
--
-- registrar_saida_lote e usada pela tela "Registrar Saida" (inventory/saida-lote)
-- da farmacia (CAF/satelites) e do almoxarifado. Problemas corrigidos:
--   * Duplo clique gravava a saida duas vezes (Metronidazol 10/08, 0,85s):
--     p_chave = chave da rodada gerada pela tela; repetir devolve o 1o resultado.
--   * Farmacia: nao conferia item_stocks (4 itens negativos no CAF) e deixava o
--     lote ficar negativo (lote digitado nascia com 0). Agora trava saldo e
--     lote, recusa saldo insuficiente e NUNCA deixa lote negativo. Sem lote
--     escolhido: FEFO dividindo entre lotes, ignorando vencidos.
--   * Lote vencido so sai com motivo Vencimento / Troca por validade /
--     Devolucao ao fornecedor (ou seja: e a baixa do vencido); qualquer outro
--     motivo e recusado.
--   * Almoxarifado: so mexia em current_stock, sem lote/motivo/destino e sem
--     registro. Agora grava almox_movimentos (motivo, destino, lote, saldo
--     antes/depois, quem) e abate o lote quando informado.
--   * Almox pelo Satelite Terreo (material, loc=SAT_T): o ramo "warehouse"
--     abatia o saldo do ALMOXARIFADO. Agora SAT_T baixa o item_stocks do
--     proprio satelite (stock_movements), como a dispensacao de material.
--   * CAF: destino "setor interno" com nome de satelite/almoxarifado tirava da
--     CAF e nao entrava em estoque nenhum. Setor com nome de estoque e
--     recusado; para mandar a um satelite use "estoque interno" (transferencia
--     real, credita o destino e o lote do destino).
--   * Transferencia interna: o movimento de ENTRADA fica ligado ao de SAIDA
--     (linked_movement_id) para a reversao conseguir desfazer os dois (C4).
--   * Papel e modulo conferidos (farmacia x almox isolados).
--   * F14: a versao antiga de 6 parametros (sem destino) e removida.
-- =============================================================================

drop function if exists public.registrar_saida_lote(text, text, jsonb, text, text, text);
drop function if exists public.registrar_saida_lote(text, text, jsonb, text, text, text, text, text);

create or replace function public.registrar_saida_lote(
  p_item_type text,
  p_reason text,
  p_items jsonb,
  p_reason_detail text default null,
  p_notes text default null,
  p_location_code text default null,
  p_destino_tipo text default null,
  p_destino_nome text default null,
  p_chave uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_uid uuid;
  v_prev jsonb;
  v_code text;
  v_loc uuid;
  v_mod text;
  v_mtype text;
  v_dest uuid;
  v_dest_code text;
  v_vencido_ok text;
  it jsonb;
  v_item uuid;
  v_qty integer;
  v_lot uuid;
  v_batch text;
  v_val date;
  v_saldo integer;
  v_nota_lote text;
  r record;
  v_out uuid;
  v_dlot uuid;
  v_dbatch text;
  v_dval date;
  v_count integer := 0;
  v_total integer := 0;
begin
  if p_item_type not in ('pharmacy','warehouse') then raise exception 'Tipo de item invalido: %', p_item_type; end if;
  v_code := coalesce(nullif(btrim(coalesce(p_location_code,'')),''),
                     case when p_item_type = 'pharmacy' then 'CAF' else 'ALMOX' end);
  select id into v_loc from public.stock_locations where code = v_code;
  if v_loc is null then raise exception 'Local % nao encontrado.', v_code; end if;
  if p_item_type = 'pharmacy' and v_code = 'ALMOX' then
    raise exception 'O almoxarifado nao tem estoque de medicamentos.';
  end if;
  if p_item_type = 'warehouse' and v_code not in ('ALMOX','SAT_T') then
    raise exception 'O estoque % nao tem material do almoxarifado.', v_code;
  end if;
  v_mod := public.fn_saidas_modulo_do_local(v_loc);
  v_uid := public.fn_saidas_exigir_operador(v_mod);

  v_prev := public.fn_saidas_reservar_chave(p_chave, 'registrar_saida_lote');
  if v_prev is not null then return v_prev; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Saida sem itens.';
  end if;
  if coalesce(btrim(coalesce(p_reason,'')),'') = '' then raise exception 'Motivo da saida e obrigatorio.'; end if;
  if p_reason not in ('emprestimo','devolucao_fornecedor','quebra','vencimento','outro','obito_sem_reaproveitamento',
      'defeito_fabricacao','embalagem_violada','falha_fracionamento','doacao','permuta','consignado',
      'troca_validade','transferencia','ajuste_inventario','pagamento_emprestimo') then
    raise exception 'Motivo invalido: %', p_reason;
  end if;
  if p_reason = 'outro' and coalesce(btrim(p_reason_detail),'') = '' and coalesce(btrim(p_notes),'') = '' then
    raise exception 'Motivo "Outro" exige descrever o motivo.';
  end if;
  if p_reason in ('transferencia','devolucao_fornecedor') and coalesce(btrim(p_destino_nome),'') = '' then
    raise exception 'Para este motivo, informe o destino.';
  end if;
  if p_destino_tipo is not null and p_destino_tipo not in ('fornecedor','unidade_externa','setor_interno','estoque_interno') then
    raise exception 'Tipo de destino invalido: %', p_destino_tipo;
  end if;

  -- Setor com nome de ESTOQUE (satelite, CAF, almoxarifado) nao e destino de
  -- consumo: a saida sumiria sem entrar em lugar nenhum (A9).
  if p_destino_tipo = 'setor_interno' and (
       lower(btrim(p_destino_nome)) = 'almoxarifado'
    or lower(btrim(p_destino_nome)) like 'caf%'
    or lower(btrim(p_destino_nome)) ~ '^farm.cia sat.lite') then
    raise exception 'O destino "%" e um estoque. Para enviar a outro estoque use a opcao "Estoque interno" (transferencia), que credita o destino.', p_destino_nome;
  end if;

  v_mtype := case when p_reason = 'transferencia' then 'TRANSFERENCIA' else 'SAIDA_AVULSA' end;

  if p_destino_tipo = 'estoque_interno' then
    if p_item_type <> 'pharmacy' then
      raise exception 'Transferencia entre estoques de material nao e feita por esta tela.';
    end if;
    if v_mtype <> 'TRANSFERENCIA' then
      raise exception 'Destino "estoque interno" so vale para o motivo Transferencia.';
    end if;
    select id, code into v_dest, v_dest_code from public.stock_locations where code = btrim(p_destino_nome);
    if v_dest is null then raise exception 'Estoque de destino % nao encontrado.', p_destino_nome; end if;
    if v_dest = v_loc then raise exception 'Origem e destino nao podem ser o mesmo estoque.'; end if;
    if v_dest_code not in ('CAF','SAT_1','SAT_2','SAT_T') then
      raise exception 'Destino % nao e um estoque da farmacia.', v_dest_code;
    end if;
  end if;

  -- Lote vencido so sai quando a propria saida e a baixa do vencido.
  v_vencido_ok := case when p_reason in ('vencimento','troca_validade','devolucao_fornecedor')
                       then 'motivo ' || p_reason else null end;

  for it in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_item  := (it->>'item_id')::uuid;
      v_qty   := (it->>'quantity')::integer;
      v_lot   := nullif(it->>'expiry_tracking_id','')::uuid;
      v_val   := nullif(it->>'expiry_date','')::date;
    exception when others then
      raise exception 'Linha com item, quantidade, lote ou validade invalidos.';
    end;
    v_batch := nullif(btrim(coalesce(it->>'batch_number','')),'');
    v_nota_lote := null;
    if v_item is null then raise exception 'Linha sem item.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade invalida em uma das linhas (use numero inteiro maior que zero).'; end if;

    -- Lote digitado: so vale se o lote EXISTE neste estoque.
    if v_lot is null and v_batch is not null then
      select e.id into v_lot from public.expiry_tracking e
       where e.item_id = v_item and e.location_id = v_loc
         and upper(btrim(coalesce(e.batch_number,''))) = upper(v_batch)
       order by e.current_quantity desc nulls last, e.expiry_date nulls last
       limit 1;
      if v_lot is null then
        if p_item_type = 'pharmacy' then
          raise exception 'O lote % nao existe no estoque %. Lance a entrada do lote antes de dar saida.', v_batch, v_code;
        end if;
        -- material: o lote so fica anotado (nao ha saldo de lote para abater)
        v_nota_lote := 'Lote informado: ' || v_batch || coalesce(' val ' || to_char(v_val,'DD/MM/YYYY'), '');
      end if;
    end if;

    if p_item_type = 'warehouse' and v_code = 'ALMOX' then
      -- ------------------------- ALMOXARIFADO (modelo legado) -----------
      v_saldo := public.fn_saidas_conferir_saldo(v_item, 'warehouse', v_loc, v_qty);
      if v_lot is not null then
        perform public.fn_saidas_consumir_lotes(v_item, v_loc, v_qty, v_lot, true, v_vencido_ok);
      end if;
      update public.warehouse_items set current_stock = current_stock - v_qty, updated_at = now() where id = v_item;
      insert into public.almox_movimentos(item_id, direcao, quantidade, origem, motivo, motivo_detalhe,
        destino_tipo, destino_nome, expiry_tracking_id, saldo_antes, saldo_depois, observacao, chave, realizado_por)
      values (v_item, 'out', v_qty, 'saida_lote', p_reason, nullif(btrim(coalesce(p_reason_detail,'')),''),
        p_destino_tipo, nullif(btrim(coalesce(p_destino_nome,'')),''), v_lot, v_saldo, v_saldo - v_qty,
        nullif(concat_ws(' · ', nullif(btrim(coalesce(p_notes,'')),''), v_nota_lote), ''), p_chave, v_uid);
    else
      -- ------------------------- FARMACIA e SATELITE TERREO -------------
      v_saldo := public.fn_saidas_conferir_saldo(v_item, p_item_type, v_loc, v_qty);
      for r in select * from public.fn_saidas_consumir_lotes(
                 v_item, v_loc, v_qty, v_lot, p_item_type = 'pharmacy', v_vencido_ok)
      loop
        insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
          source_location_id, reason, reason_detail, destino_tipo, destino_nome, expiry_tracking_id,
          performed_by, notes, historico)
        values (v_item, p_item_type, v_mtype, 'out', r.quantidade, v_loc, p_reason,
          nullif(btrim(coalesce(p_reason_detail,'')),''), p_destino_tipo, nullif(btrim(coalesce(p_destino_nome,'')),''),
          r.lote_id, v_uid, nullif(btrim(coalesce(p_notes,'')),''), v_nota_lote)
        returning id into v_out;

        -- Transferencia para outro estoque da farmacia: credita o destino
        -- (saldo + lote espelhado) e liga a entrada a saida.
        if v_dest is not null then
          v_dlot := null;
          if r.lote_id is not null then
            select batch_number, expiry_date into v_dbatch, v_dval from public.expiry_tracking where id = r.lote_id;
            select id into v_dlot from public.expiry_tracking
             where item_id = v_item and location_id = v_dest
               and batch_number is not distinct from v_dbatch
               and expiry_date is not distinct from v_dval
             order by created_at limit 1
             for update;
            if v_dlot is null then
              insert into public.expiry_tracking(item_id, batch_number, expiry_date,
                initial_quantity, current_quantity, location_id, created_by)
              values (v_item, v_dbatch, v_dval, 0, 0, v_dest, v_uid)
              returning id into v_dlot;
            end if;
            update public.expiry_tracking set current_quantity = current_quantity + r.quantidade where id = v_dlot;
          end if;
          insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
            target_location_id, reason, reason_detail, destino_tipo, destino_nome, expiry_tracking_id,
            linked_movement_id, performed_by, notes)
          values (v_item, 'pharmacy', 'TRANSFERENCIA', 'in', r.quantidade, v_dest, p_reason,
            nullif(btrim(coalesce(p_reason_detail,'')),''), p_destino_tipo, p_destino_nome, v_dlot,
            v_out, v_uid, nullif(btrim(coalesce(p_notes,'')),''));
        end if;
      end loop;
    end if;

    v_count := v_count + 1; v_total := v_total + v_qty;
  end loop;

  return public.fn_saidas_gravar_resultado(p_chave,
    jsonb_build_object('itens', v_count, 'quantidade_total', v_total, 'local', v_code, 'motivo', p_reason));
end $f$;

revoke execute on function public.registrar_saida_lote(text, text, jsonb, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.registrar_saida_lote(text, text, jsonb, text, text, text, text, text, uuid) to authenticated;
