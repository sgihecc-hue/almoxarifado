-- 01/10/2026: Satelite 1 e Satelite 2 sem etapa de confirmar recebimento.
-- atender_solicitacao_farmacia conclui o pedido e move o estoque CAF -> satelite
-- na hora do atendimento (chama confirmar_recebimento_solicitacao internamente).
CREATE OR REPLACE FUNCTION public.atender_solicitacao_farmacia(p_request_id uuid, p_itens jsonb DEFAULT NULL::jsonb, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_req public.requests%rowtype;
  it jsonb;
  v_ri uuid;
  v_txt text;
  v_qty integer;
  r record;
  v_total integer := 0;
  v_caf uuid; v_lx record; v_saldo_caf integer;
  v_dn text; v_auto boolean := false;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  if not public.fn_pode_atender_solicitacao('pharmacy') then
    raise exception 'Sem permissao para atender solicitacao da farmacia.';
  end if;

  select * into v_req from public.requests where id = p_request_id for update;
  if v_req.id is null then raise exception 'Solicitacao nao encontrada.'; end if;
  if v_req.type <> 'pharmacy' then raise exception 'Esta solicitacao nao e da farmacia.'; end if;
  if v_req.status <> 'pending' then
    raise exception 'Este pedido ja foi alterado por outra pessoa (agora esta %). Recarregue a pagina.',
      public.fn_status_rotulo(v_req.status);
  end if;

  if p_itens is not null then
    if jsonb_typeof(p_itens) <> 'array' then raise exception 'Itens invalidos.'; end if;
    for it in select value from jsonb_array_elements(p_itens)
    loop
      v_ri := nullif(it->>'request_item_id', '')::uuid;
      v_txt := nullif(btrim(coalesce(it->>'supplied_quantity', '')), '');
      if v_txt is not null and v_txt !~ '^\d+$' then
        raise exception 'Quantidade fornecida invalida: use numero inteiro, sem casas decimais.';
      end if;
      v_qty := v_txt::integer;
      update public.request_items set supplied_quantity = v_qty
       where id = v_ri and request_id = p_request_id;
      if not found then raise exception 'Item nao pertence a esta solicitacao.'; end if;
    end loop;
  end if;

  for r in
    select ri.id, ri.item_name, coalesce(ri.supplied_quantity, 0) as forn,
           (select coalesce(sum(l.quantity), 0) from public.request_item_lots l
             where l.request_item_id = ri.id) as lotes
      from public.request_items ri
     where ri.request_id = p_request_id
  loop
    if r.lotes > 0 and r.lotes <> r.forn then
      raise exception 'Os lotes de "%" somam % mas o fornecido e %. Ajuste os lotes antes de aprovar.',
        r.item_name, r.lotes, r.forn;
    end if;
    -- 30/09/2026: pedido da farmacia SEMPRE sai da CAF. Lote de outro estoque
    -- (ex.: Satelite 2) ou sem saldo era aceito aqui e, na confirmacao, a baixa
    -- saia "sem lote" deixando a CAF negativa (caso Gabapentina #49871/75/76).
    if r.forn > 0 then
      select id into v_caf from public.stock_locations where code = 'CAF';
      for v_lx in
        select l.quantity, e.batch_number, e.current_quantity, e.location_id, sl.name as estoque
          from public.request_item_lots l
          join public.expiry_tracking e on e.id = l.expiry_tracking_id
          left join public.stock_locations sl on sl.id = e.location_id
         where l.request_item_id = r.id and l.quantity > 0
      loop
        if v_lx.location_id is distinct from v_caf then
          raise exception 'O lote % de "%" e do estoque %, nao da CAF. Pedido da farmacia sai da CAF: escolha um lote da CAF (ou faca uma Transferencia entre estoques).',
            v_lx.batch_number, r.item_name, coalesce(v_lx.estoque, '?');
        end if;
        if coalesce(v_lx.current_quantity, 0) < v_lx.quantity then
          raise exception 'O lote % de "%" tem so % na CAF e o atendimento tira %. Lance a entrada na CAF antes de atender.',
            v_lx.batch_number, r.item_name, coalesce(v_lx.current_quantity, 0), v_lx.quantity;
        end if;
      end loop;
      if r.lotes = 0 then
        select coalesce(sum(s.quantity), 0) into v_saldo_caf
          from public.item_stocks s join public.request_items ri2 on ri2.pharmacy_item_id = s.item_id
         where ri2.id = r.id and s.location_id = v_caf;
        if v_saldo_caf < r.forn then
          raise exception 'A CAF tem so % de "%" e o atendimento tira %. Lance a entrada na CAF antes de atender.',
            v_saldo_caf, r.item_name, r.forn;
        end if;
      end if;
    end if;
    v_total := v_total + r.forn;
  end loop;

  if v_total = 0 then
    raise exception 'Nenhum item com quantidade fornecida. Se nao ha como atender, use Rejeitar.';
  end if;

  update public.request_items
     set approved_quantity = coalesce(supplied_quantity, 0)
   where request_id = p_request_id;

  update public.requests
     set status = 'delivered',
         approved_at = now(), approved_by = v_uid,
         delivered_at = now(), delivered_by = v_uid,
         delivery_notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), delivery_notes)
   where id = p_request_id;

  -- 01/10/2026 (decisao do Adonias): pedido da Satelite 1 e da Satelite 2 nao
  -- tem mais etapa de "confirmar recebimento". Ao atender na CAF, o estoque ja
  -- sai da CAF e entra na satelite e o pedido fica concluido. A baixa usa a
  -- mesma rotina da confirmacao (com as travas de lote/saldo da CAF).
  -- Satelite Terreo e demais setores continuam com a confirmacao.
  select lower(coalesce(name, '')) into v_dn from public.departments where id = v_req.department_id;
  if v_dn ~* 'sat.?lite' and v_dn !~* 't.rreo' and (v_dn ~ '1' or v_dn ~ '2') then
    perform public.confirmar_recebimento_solicitacao(p_request_id,
      'Recebimento automatico: pedido da satelite concluido no atendimento da CAF (sem etapa de confirmacao desde 01/10/2026).');
    v_auto := true;
  end if;

  return jsonb_build_object('request_id', p_request_id, 'numero', v_req.request_number,
                            'total_fornecido', v_total, 'concluido_automatico', v_auto);
end $function$;
