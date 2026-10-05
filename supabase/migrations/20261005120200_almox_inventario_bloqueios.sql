-- =============================================================================
-- MODO INVENTARIO DO ALMOXARIFADO (3/3): bloqueios enquanto ha inventario aberto
-- Depende de 20261005120000 e 20261005120100.
--
-- Os bloqueios ficam no BANCO (gatilhos), entao valem para toda porta de
-- entrada: tela nova, tela antiga, RPC ou PostgREST direto.
--
--   Criar pedido do almox (item 'warehouse' em request_items) ..... bloqueado nos 2 modos
--   Entregar/concluir pedido do almox (baixa do estoque) ........... bloqueado no modo 'todos'
--                                                                    (exceto pedido liberado)
--   Saidas do almox em almox_movimentos (saida direta, saida em
--   lote/quebra, vencimento, emprestimo enviado...) ................ bloqueado no modo 'todos'
--   Editar Item mudando o saldo (current_stock) .................... bloqueado nos 2 modos
--      (o ajuste do inventario e pela diferenca contada; um ajuste
--       manual no meio seria aplicado duas vezes)
--   Entradas (NF, estorno de saida, emprestimo recebido) ........... LIBERADAS nos 2 modos:
--      mercadoria pode chegar. O fechamento soma a diferenca da contagem
--      ao saldo atual, entao entrada feita depois da contagem do item
--      continua valendo. Se a mercadoria nova for guardada ANTES de o item
--      ser contado, ela entra na contagem e tambem na NF: conte o item
--      antes de guardar, ou reconte (salvar de novo atualiza a fotografia).
--   Pedido de enfermagem: fora (e atendido pela Satelite Terreo, nao pelo almox).
-- =============================================================================

-- 1) Pedido novo do almoxarifado: a linha 'warehouse' de request_items e o que
--    torna um pedido "do almox" (criar_solicitacao, tela antiga e PostgREST
--    direto passam por aqui). No pedido de enfermagem request_kits /
--    request_item_patients ja existem quando as linhas sao gravadas.
create or replace function public.fn_almox_inventario_bloqueia_pedido_novo()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $f$
declare
  v_inv public.almox_inventarios;
begin
  v_inv := public.fn_almox_inventario_aberto();
  if v_inv.id is null then return new; end if;
  if public.fn_is_pedido_enfermagem(new.request_id) then return new; end if;
  raise exception '%', public.fn_almox_inventario_msg(v_inv,
    'pedidos do almoxarifado bloqueados até o fechamento. Tente de novo depois do inventário.');
end $f$;

drop trigger if exists trg_request_items_inventario_almox on public.request_items;
create trigger trg_request_items_inventario_almox
  before insert on public.request_items
  for each row when (new.item_type = 'warehouse')
  execute function public.fn_almox_inventario_bloqueia_pedido_novo();

-- 2) Entrega/conclusao do pedido do almox (e quando o gatilho
--    deduct_stock_on_request_delivered baixa o estoque). Nome com "b" para
--    rodar depois de trg_requests_a_maquina_estados.
create or replace function public.fn_almox_inventario_bloqueia_entrega()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $f$
declare
  v_inv public.almox_inventarios;
begin
  if new.status is not distinct from old.status
     or new.status not in ('delivered', 'completed')
     or old.status in ('delivered', 'completed') then
    return new;
  end if;
  v_inv := public.fn_almox_inventario_aberto();
  if v_inv.id is null or v_inv.bloqueio <> 'todos' then return new; end if;
  if public.fn_is_pedido_enfermagem(new.id) then return new; end if;
  if exists (select 1 from public.almox_inventario_liberacoes l
              where l.inventario_id = v_inv.id and l.request_id = new.id) then
    return new;
  end if;
  raise exception '%', public.fn_almox_inventario_msg(v_inv,
    'entregas do almoxarifado bloqueadas até o fechamento.'
    || case when v_inv.permite_liberacao_urgente
            then ' Se for urgente, peça ao administrador para liberar este pedido.' else '' end);
end $f$;

drop trigger if exists trg_requests_b_inventario_almox on public.requests;
create trigger trg_requests_b_inventario_almox
  before update of status on public.requests
  for each row when (new.type = 'warehouse')
  execute function public.fn_almox_inventario_bloqueia_entrega();

-- 3) Saidas do almox gravadas no livro almox_movimentos.
create or replace function public.fn_almox_inventario_bloqueia_saida()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $f$
declare
  v_inv public.almox_inventarios;
begin
  v_inv := public.fn_almox_inventario_aberto();
  if v_inv.id is null or v_inv.bloqueio <> 'todos' then return new; end if;
  raise exception '%', public.fn_almox_inventario_msg(v_inv,
    'saídas do almoxarifado bloqueadas até o fechamento.');
end $f$;

drop trigger if exists trg_almox_movimentos_inventario on public.almox_movimentos;
create trigger trg_almox_movimentos_inventario
  before insert on public.almox_movimentos
  for each row when (new.direcao = 'out' and new.origem <> 'inventario')
  execute function public.fn_almox_inventario_bloqueia_saida();

-- 4) Editar Item mudando o saldo durante o inventario.
create or replace function public.fn_almox_inventario_bloqueia_edicao_saldo()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $f$
declare
  v_inv public.almox_inventarios;
begin
  v_inv := public.fn_almox_inventario_aberto();
  if v_inv.id is null then return new; end if;
  raise exception '%', public.fn_almox_inventario_msg(v_inv,
    'o saldo é ajustado pela contagem no fechamento. Lance a quantidade na tela Inventário; nada foi gravado.');
end $f$;

drop trigger if exists trg_almox_item_edicoes_inventario on public.almox_item_edicoes;
create trigger trg_almox_item_edicoes_inventario
  before insert on public.almox_item_edicoes
  for each row when (new.alteracoes ? 'current_stock')
  execute function public.fn_almox_inventario_bloqueia_edicao_saldo();

revoke all on function public.fn_almox_inventario_bloqueia_pedido_novo() from public, anon, authenticated;
revoke all on function public.fn_almox_inventario_bloqueia_entrega() from public, anon, authenticated;
revoke all on function public.fn_almox_inventario_bloqueia_saida() from public, anon, authenticated;
revoke all on function public.fn_almox_inventario_bloqueia_edicao_saldo() from public, anon, authenticated;
