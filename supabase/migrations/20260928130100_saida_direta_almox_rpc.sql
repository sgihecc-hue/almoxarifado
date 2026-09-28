-- =============================================================================
-- SAIDA DIRETA DO ALMOXARIFADO por RPC (auditoria 28/09/2026 — C2, C3, F13, M9)
--
-- ORIGEM: a Saida Direta era gravada pelo navegador (insert em
-- warehouse_dispatches + warehouse_dispatch_items) e a baixa vinha do gatilho
-- deduct_warehouse_stock, SECURITY INVOKER. Como a policy de UPDATE de
-- warehouse_items so aceita admin/administrador/gestor, a saida feita por
-- ATENDENTE gravava a saida e NAO baixava nada, sem erro (10 saidas do
-- Anderson, #66 e #82 a #92, ultima em 25/09). Pior: o estorno (UPDATE status,
-- permitido a qualquer logado) devolvia ao estoque o que nunca tinha saido.
-- E o gatilho usava GREATEST(current_stock - qtd, 0): saida maior que o saldo
-- zerava em silencio.
--
-- AGORA:
--   * criar_saida_direta_almox: uma transacao, papel+modulo conferidos, trava
--     o item (FOR UPDATE), recusa saldo insuficiente com mensagem, grava
--     quanto efetivamente baixou por item (quantidade_baixada) e o livro
--     almox_movimentos. Chave de rodada contra duplo clique.
--   * estornar_saida_direta_almox: so gestor/admin do almox, so uma vez
--     (trava a saida), devolve SO o que efetivamente baixou.
--   * Gatilhos legados removidos; o navegador perde INSERT/UPDATE/DELETE
--     nessas tabelas (so leitura).
--
-- DADOS: quantidade_baixada das saidas antigas e preenchida pela auditoria
-- (audit_logs de warehouse_items no mesmo instante do item). As 10 saidas do
-- atendente ficam com 0 — estorna-las nao devolve nada (correto: nada saiu).
-- O saldo dessas 10 saidas continua como esta (decisao do dono: lancar ou nao).
-- =============================================================================

alter table public.warehouse_dispatch_items
  add column if not exists quantidade_baixada integer;

comment on column public.warehouse_dispatch_items.quantidade_baixada is
  'Quanto esta linha efetivamente abateu de warehouse_items.current_stock. O estorno devolve exatamente isso. Nulo = desconhecido (tratado como 0).';

-- Backfill pela auditoria (so linhas antigas, sem valor).
update public.warehouse_dispatch_items i
   set quantidade_baixada = coalesce((
     select greatest((a.old_data->>'current_stock')::numeric - (a.new_data->>'current_stock')::numeric, 0)::integer
       from public.audit_logs a
      where a.table_name = 'warehouse_items'
        and a.record_id = i.item_id
        and a.action = 'UPDATE'
        and a.created_at between i.created_at - interval '3 seconds' and i.created_at + interval '3 seconds'
        and (a.old_data->>'current_stock')::numeric > (a.new_data->>'current_stock')::numeric
      order by abs(extract(epoch from (a.created_at - i.created_at)))
      limit 1), 0)
 where i.quantidade_baixada is null;

alter table public.warehouse_dispatches
  add column if not exists chave uuid;

-- Estorno parcial de saida direta (tela Estorno do almox) aponta a saida:
-- o estorno total depois so devolve o que ainda nao voltou.
alter table public.warehouse_request_returns
  add column if not exists dispatch_id uuid references public.warehouse_dispatches(id);
create unique index if not exists warehouse_dispatches_chave on public.warehouse_dispatches (chave) where chave is not null;

-- Gatilhos legados: a baixa e o estorno passam a ser feitos SO pelas RPCs.
drop trigger if exists trg_deduct_warehouse_stock on public.warehouse_dispatch_items;
drop trigger if exists trg_restore_warehouse_stock_on_cancel on public.warehouse_dispatches;
drop function if exists public.deduct_warehouse_stock();
drop function if exists public.restore_warehouse_stock_on_cancel();

-- ---------------------------------------------------------------------------
create or replace function public.criar_saida_direta_almox(
  p_itens jsonb,
  p_destino_departamento uuid default null,
  p_destino_texto text default null,
  p_tipo text default 'consumo',
  p_observacao text default null,
  p_chave uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_uid uuid;
  v_prev jsonb;
  v_almox uuid;
  v_disp uuid;
  v_num bigint;
  it jsonb;
  v_item uuid;
  v_qty integer;
  v_saldo integer;
  v_line uuid;
  v_dest_nome text;
  v_count integer := 0;
  v_total integer := 0;
begin
  v_uid := public.fn_saidas_exigir_operador('almoxarifado', array['gestor','manager','atendente','warehouse_manager']);
  v_prev := public.fn_saidas_reservar_chave(p_chave, 'criar_saida_direta_almox');
  if v_prev is not null then return v_prev; end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Adicione pelo menos um item.';
  end if;
  if p_destino_departamento is null and coalesce(btrim(p_destino_texto), '') = '' then
    raise exception 'Informe o destino.';
  end if;
  if coalesce(p_tipo, 'consumo') not in ('consumo','emprestimo','doacao','permuta','transferencia','vencimento','outro') then
    raise exception 'Tipo de saida invalido: %', p_tipo;
  end if;
  select id into v_almox from public.stock_locations where code = 'ALMOX';
  if p_destino_departamento is not null then
    select name into v_dest_nome from public.departments where id = p_destino_departamento;
    if v_dest_nome is null then raise exception 'Setor de destino nao encontrado.'; end if;
  else
    v_dest_nome := btrim(p_destino_texto);
  end if;

  insert into public.warehouse_dispatches(destination_department_id, destination_department_text,
    dispatch_type, notes, created_by, status, chave)
  values (p_destino_departamento, nullif(btrim(coalesce(p_destino_texto,'')),''),
    coalesce(p_tipo,'consumo'), nullif(btrim(coalesce(p_observacao,'')),''), v_uid, 'completed', p_chave)
  returning id, dispatch_number into v_disp, v_num;

  for it in select value from jsonb_array_elements(p_itens)
  loop
    begin
      v_item := (it->>'item_id')::uuid;
      v_qty  := (it->>'quantity')::integer;
    exception when others then
      raise exception 'Linha com item ou quantidade invalida.';
    end;
    if v_item is null then raise exception 'Linha sem item.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade invalida em uma das linhas (use numero inteiro maior que zero).'; end if;

    -- trava o item e recusa saldo insuficiente (nunca zera em silencio)
    v_saldo := public.fn_saidas_conferir_saldo(v_item, 'warehouse', v_almox, v_qty);

    insert into public.warehouse_dispatch_items(dispatch_id, item_id, quantity, quantidade_baixada)
    values (v_disp, v_item, v_qty, v_qty) returning id into v_line;

    update public.warehouse_items
       set current_stock = current_stock - v_qty, updated_at = now()
     where id = v_item;

    insert into public.almox_movimentos(item_id, direcao, quantidade, origem, motivo, destino_tipo, destino_nome,
      dispatch_id, dispatch_item_id, saldo_antes, saldo_depois, observacao, chave, realizado_por)
    values (v_item, 'out', v_qty, 'saida_direta', coalesce(p_tipo,'consumo'),
      case when p_destino_departamento is not null then 'setor_interno' else 'texto' end, v_dest_nome,
      v_disp, v_line, v_saldo, v_saldo - v_qty, nullif(btrim(coalesce(p_observacao,'')),''), p_chave, v_uid);

    v_count := v_count + 1; v_total := v_total + v_qty;
  end loop;

  return public.fn_saidas_gravar_resultado(p_chave,
    jsonb_build_object('id', v_disp, 'dispatch_number', v_num, 'itens', v_count, 'quantidade_total', v_total));
end $f$;
revoke execute on function public.criar_saida_direta_almox(jsonb, uuid, text, text, text, uuid) from public, anon;
grant execute on function public.criar_saida_direta_almox(jsonb, uuid, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.estornar_saida_direta_almox(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_uid uuid;
  v_status text;
  r record;
  v_saldo integer;
  v_dev integer := 0;
  v_sem_baixa integer := 0;
begin
  v_uid := public.fn_saidas_exigir_operador('almoxarifado', array['gestor','manager']);
  if coalesce(length(btrim(p_motivo)), 0) < 3 then
    raise exception 'Informe um motivo (minimo 3 caracteres) para o estorno.';
  end if;

  select status into v_status from public.warehouse_dispatches where id = p_id for update;
  if not found then raise exception 'Saida nao encontrada.'; end if;
  if v_status = 'cancelled' then raise exception 'Esta saida ja foi estornada.'; end if;
  if v_status <> 'completed' then raise exception 'Status nao permite estorno: %', v_status; end if;

  -- por item: o que baixou menos o que ja voltou por estorno parcial
  for r in select i.item_id, sum(coalesce(i.quantidade_baixada, 0))::integer
                  - coalesce((select sum(w.quantity) from public.warehouse_request_returns w
                               where w.dispatch_id = p_id and w.warehouse_item_id = i.item_id), 0)::integer as devolver
             from public.warehouse_dispatch_items i where i.dispatch_id = p_id
            group by i.item_id
  loop
    if r.devolver > 0 then
      select current_stock into v_saldo from public.warehouse_items where id = r.item_id for update;
      update public.warehouse_items
         set current_stock = current_stock + r.devolver, updated_at = now()
       where id = r.item_id;
      insert into public.almox_movimentos(item_id, direcao, quantidade, origem, motivo, dispatch_id,
        saldo_antes, saldo_depois, observacao, realizado_por)
      values (r.item_id, 'in', r.devolver, 'estorno_saida_direta', 'estorno', p_id,
        v_saldo, v_saldo + r.devolver, btrim(p_motivo), v_uid);
      v_dev := v_dev + r.devolver;
    else
      v_sem_baixa := v_sem_baixa + 1;
    end if;
  end loop;

  update public.warehouse_dispatches
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, cancellation_reason = btrim(p_motivo)
   where id = p_id;

  return jsonb_build_object('id', p_id, 'quantidade_devolvida', v_dev, 'linhas_sem_baixa', v_sem_baixa);
end $f$;
revoke execute on function public.estornar_saida_direta_almox(uuid, text) from public, anon;
grant execute on function public.estornar_saida_direta_almox(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies: o navegador so le. Gravacao so pelas RPCs acima.
drop policy if exists "warehouse_dispatches insert" on public.warehouse_dispatches;
drop policy if exists "warehouse_dispatches update" on public.warehouse_dispatches;
drop policy if exists "warehouse_dispatch_items insert" on public.warehouse_dispatch_items;
revoke insert, update, delete, truncate on public.warehouse_dispatches from anon, authenticated;
revoke insert, update, delete, truncate on public.warehouse_dispatch_items from anon, authenticated;
