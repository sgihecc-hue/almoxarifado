-- =============================================================================
-- ESTORNO DO ALMOXARIFADO com origem e teto (auditoria 28/09/2026 — A7)
--
-- ANTES: estornar_estoque_almox somava QUALQUER quantidade a QUALQUER item,
-- quantas vezes quisesse — era uma "entrada livre" sem nota.
-- AGORA (decisao): todo estorno tem que apontar a ORIGEM — uma solicitacao
-- entregue ou uma saida direta — e fica limitado ao que saiu nela para aquele
-- item menos o que ja foi estornado. Motivo continua obrigatorio. Chave de
-- rodada contra duplo clique. Papel + modulo almoxarifado.
--   solicitacao: teto = mesma quantidade que o gatilho de entrega abateu
--                (supplied, senao approved, senao pedida), so pedido de
--                almoxarifado entregue/concluido (pedido de enfermagem nao
--                abate do almox e fica de fora).
--   saida direta: teto = quantidade_baixada da saida (nao estornada).
-- Os 3 estornos antigos (sem origem) continuam como estao.
-- =============================================================================

alter table public.warehouse_request_returns
  add column if not exists dispatch_id uuid references public.warehouse_dispatches(id),  -- ja criada em 20260928130100
  add column if not exists chave uuid;
create unique index if not exists warehouse_request_returns_chave on public.warehouse_request_returns (chave) where chave is not null;

drop function if exists public.estornar_estoque_almox(uuid, integer, text);

-- Quanto ainda pode ser estornado de um item numa origem.
create or replace function public.almox_estorno_disponivel(p_origem_tipo text, p_origem_id uuid, p_item uuid)
returns table(saiu integer, estornado integer, disponivel integer)
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $f$
declare
  v_saiu integer := 0;
  v_est integer := 0;
  v_status text;
  v_type text;
begin
  if p_origem_tipo = 'solicitacao' then
    select status, type into v_status, v_type from public.requests where id = p_origem_id;
    if v_status is null then raise exception 'Solicitacao nao encontrada.'; end if;
    if v_type <> 'warehouse' then raise exception 'A solicitacao nao e do almoxarifado.'; end if;
    if v_status not in ('delivered','completed') then raise exception 'A solicitacao ainda nao foi entregue (status %).', v_status; end if;
    if public.fn_is_pedido_enfermagem(p_origem_id) then
      raise exception 'Pedido de enfermagem nao sai do almoxarifado; estorno nao se aplica.';
    end if;
    select coalesce(sum(coalesce(ri.supplied_quantity, ri.approved_quantity, ri.quantity)), 0)::integer into v_saiu
      from public.request_items ri
     where ri.request_id = p_origem_id and ri.item_type = 'warehouse' and ri.warehouse_item_id = p_item;
    select coalesce(sum(quantity), 0)::integer into v_est from public.warehouse_request_returns
     where request_id = p_origem_id and warehouse_item_id = p_item;
  elsif p_origem_tipo = 'saida_direta' then
    select status into v_status from public.warehouse_dispatches where id = p_origem_id;
    if v_status is null then raise exception 'Saida direta nao encontrada.'; end if;
    if v_status = 'cancelled' then raise exception 'Esta saida direta ja foi estornada por inteiro.'; end if;
    select coalesce(sum(coalesce(quantidade_baixada, 0)), 0)::integer into v_saiu
      from public.warehouse_dispatch_items where dispatch_id = p_origem_id and item_id = p_item;
    select coalesce(sum(quantity), 0)::integer into v_est from public.warehouse_request_returns
     where dispatch_id = p_origem_id and warehouse_item_id = p_item;
  else
    raise exception 'Origem invalida: informe a solicitacao ou a saida direta.';
  end if;
  saiu := v_saiu; estornado := v_est; disponivel := greatest(v_saiu - v_est, 0);
  return next;
end $f$;
revoke execute on function public.almox_estorno_disponivel(text, uuid, uuid) from public, anon;
grant execute on function public.almox_estorno_disponivel(text, uuid, uuid) to authenticated;

-- Itens de uma origem com o que ainda pode ser estornado (para a tela).
create or replace function public.almox_estorno_itens_origem(p_origem_tipo text, p_numero bigint)
returns table(origem_id uuid, item_id uuid, item_nome text, item_codigo text, unidade text,
              saiu integer, estornado integer, disponivel integer)
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $f$
declare
  v_id uuid;
begin
  perform public.fn_saidas_exigir_operador('almoxarifado', array['gestor','manager','atendente','warehouse_manager']);
  if p_origem_tipo = 'solicitacao' then
    select id into v_id from public.requests where request_number = p_numero and type = 'warehouse';
  elsif p_origem_tipo = 'saida_direta' then
    select id into v_id from public.warehouse_dispatches where dispatch_number = p_numero;
  else
    raise exception 'Origem invalida.';
  end if;
  if v_id is null then raise exception 'Numero % nao encontrado.', p_numero; end if;

  return query
  select v_id, w.id, w.name, w.code, w.unit, d.saiu, d.estornado, d.disponivel
    from (select distinct x.item_id from (
            select ri.warehouse_item_id as item_id from public.request_items ri
             where p_origem_tipo = 'solicitacao' and ri.request_id = v_id and ri.item_type = 'warehouse' and ri.warehouse_item_id is not null
            union
            select di.item_id from public.warehouse_dispatch_items di
             where p_origem_tipo = 'saida_direta' and di.dispatch_id = v_id) x) i
    join public.warehouse_items w on w.id = i.item_id
    cross join lateral public.almox_estorno_disponivel(p_origem_tipo, v_id, i.item_id) d
   order by w.name;
end $f$;
revoke execute on function public.almox_estorno_itens_origem(text, bigint) from public, anon;
grant execute on function public.almox_estorno_itens_origem(text, bigint) to authenticated;

create or replace function public.estornar_estoque_almox(
  p_warehouse_item_id uuid, p_quantity integer, p_reason text,
  p_origem_tipo text, p_origem_id uuid, p_chave uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_uid uuid;
  v_prev jsonb;
  d record;
  v_saldo integer;
  v_nome text;
begin
  v_uid := public.fn_saidas_exigir_operador('almoxarifado', array['gestor','manager','atendente','warehouse_manager']);
  v_prev := public.fn_saidas_reservar_chave(p_chave, 'estornar_estoque_almox');
  if v_prev is not null then return v_prev::json; end if;

  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantidade invalida.'; end if;
  if coalesce(length(btrim(p_reason)), 0) < 3 then raise exception 'Informe o motivo do estorno (minimo 3 caracteres).'; end if;
  if p_origem_id is null then raise exception 'Informe a solicitacao ou a saida direta de origem do estorno.'; end if;

  -- trava o item e a origem (dois estornos simultaneos nao passam do teto)
  select current_stock, name into v_saldo, v_nome from public.warehouse_items where id = p_warehouse_item_id for update;
  if not found then raise exception 'Item de almoxarifado nao encontrado.'; end if;
  if p_origem_tipo = 'solicitacao' then
    perform 1 from public.requests where id = p_origem_id for update;
  else
    perform 1 from public.warehouse_dispatches where id = p_origem_id for update;
  end if;

  select * into d from public.almox_estorno_disponivel(p_origem_tipo, p_origem_id, p_warehouse_item_id);
  if d.saiu = 0 then raise exception '"%" nao saiu nesta origem.', v_nome; end if;
  if p_quantity > d.disponivel then
    raise exception 'Estorno maior que o que saiu: saiu %, ja estornado %, disponivel para estorno %, pedido %.',
      d.saiu, d.estornado, d.disponivel, p_quantity;
  end if;

  update public.warehouse_items set current_stock = current_stock + p_quantity, updated_at = now()
   where id = p_warehouse_item_id;

  insert into public.warehouse_request_returns (request_id, dispatch_id, warehouse_item_id, item_name, quantity, reason, returned_by, chave)
  values (case when p_origem_tipo = 'solicitacao' then p_origem_id end,
          case when p_origem_tipo = 'saida_direta' then p_origem_id end,
          p_warehouse_item_id, v_nome, p_quantity, btrim(p_reason), v_uid, p_chave);

  insert into public.almox_movimentos(item_id, direcao, quantidade, origem, motivo, motivo_detalhe, referencia_id,
    dispatch_id, saldo_antes, saldo_depois, observacao, chave, realizado_por)
  values (p_warehouse_item_id, 'in', p_quantity, 'estorno_almox', 'estorno', p_origem_tipo, p_origem_id,
    case when p_origem_tipo = 'saida_direta' then p_origem_id end, v_saldo, v_saldo + p_quantity, btrim(p_reason), p_chave, v_uid);

  return public.fn_saidas_gravar_resultado(p_chave,
    jsonb_build_object('success', true, 'disponivel_restante', d.disponivel - p_quantity))::json;
end $f$;
revoke execute on function public.estornar_estoque_almox(uuid, integer, text, text, uuid, uuid) from public, anon;
grant execute on function public.estornar_estoque_almox(uuid, integer, text, text, uuid, uuid) to authenticated;
