-- =============================================================================
-- SOLICITACOES: maquina de estados, trava dos itens e baixa do almoxarifado
-- (auditoria de 28/09/2026 — achados C2, C3, C4, A5)
--
-- C3 (critico) Pedido do almoxarifado concluido por ATENDENTE nao baixava
--    estoque: deduct_stock_on_request_delivered era SECURITY INVOKER e a policy
--    de UPDATE em warehouse_items so aceita admin/administrador/gestor. O UPDATE
--    afetava 0 linhas em silencio (65 pedidos desde 03/08).
--    -> gatilho SECURITY DEFINER, baixa registrada por item em
--       solicitacao_baixas_almox (nunca baixa o mesmo item duas vezes) e saldo
--       insuficiente e RECUSADO com mensagem (antes: GREATEST(...,0) zerava).
--    Por que nao stock_movements: o almoxarifado central roda no modelo legado
--    (saldo = warehouse_items.current_stock; ver fn_sync_legacy_stock_columns,
--    ramo ALMOX removido em 24/08). Um movimento em stock_movements dispararia
--    fn_apply_stock_movement e mexeria em item_stocks(ALMOX), que NAO e o saldo
--    do almox. A tabela nova guarda a baixa com saldo antes/depois.
-- C2 "Qtd Fornec." em branco baixava a quantidade PEDIDA (coalesce com
--    approved/quantity). -> fornecido vazio RECUSA a entrega ("digite 0").
-- C4 Nenhuma acao conferia o status atual: pedido concluido voltava para
--    processing e baixava de novo (#48798).
--    -> gatilho BEFORE UPDATE com a maquina de estados: nunca sai de
--       completed/rejected/cancelled; delivered so vai para completed; pedido
--       da farmacia so e entregue/concluido pelas funcoes do banco (que movem
--       lote/estoque); mudanca de status direta pelo navegador exige papel e
--       modulo de quem atende (almox x farmacia isolados), exceto o
--       solicitante cancelando o proprio pedido pendente.
-- A5 Dava para alterar quantidades dos itens depois de aprovar/concluir.
--    -> gatilho em request_items recusa mudar quantidade/item/lote quando o
--       pedido nao esta mais pending/approved/processing; inserir item so em
--       pedido pendente.
--
-- NAO corrige saldos ja distorcidos (decisao do dono).
-- =============================================================================

-- 0) Auxiliares ----------------------------------------------------------------

create or replace function public.fn_status_rotulo(p_status text)
returns text language sql immutable set search_path to 'public', 'pg_temp' as $f$
  select case p_status
    when 'pending' then 'pendente' when 'approved' then 'aprovado'
    when 'processing' then 'em processamento' when 'delivered' then 'entregue'
    when 'completed' then 'concluido' when 'rejected' then 'rejeitado'
    when 'cancelled' then 'cancelado' else coalesce(p_status, '?') end
$f$;

-- Modulo do usuario pelo SETOR, igual ao homeModule da tela
-- (src/contexts/module.tsx): Almoxarifado -> almoxarifado; CAF ou Farmacia
-- Satelite -> farmacia; administrador ou outro setor -> null (sem restricao).
create or replace function public.fn_modulo_usuario(p_uid uuid default auth.uid())
returns text language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  select case
    when u.role in ('administrador', 'admin') then null
    when d.name is null then null
    when lower(btrim(d.name)) = 'almoxarifado' then 'almoxarifado'
    when lower(btrim(d.name)) like 'caf%' or d.name ~* '^\s*farm.cia\s+sat.lite' then 'farmacia'
    else null end
  from public.users u
  left join public.departments d on d.id = u.department_id
  where u.id = p_uid
$f$;
revoke execute on function public.fn_modulo_usuario(uuid) from public, anon;
grant execute on function public.fn_modulo_usuario(uuid) to authenticated;

-- Quem pode ATENDER (aprovar, separar, entregar, rejeitar) uma solicitacao
-- deste tipo: papel de quem atende + modulo compativel. Mesma regra da tela
-- (podeAtenderSolicitacao + papeis em request-actions.tsx).
create or replace function public.fn_pode_atender_solicitacao(p_type text)
returns boolean language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $f$
declare
  v_role text; v_ativo boolean; v_mod text;
begin
  select role, coalesce(is_active, true) into v_role, v_ativo from public.users where id = auth.uid();
  if v_role is null or not v_ativo then return false; end if;
  if not (v_role in ('administrador', 'admin', 'gestor', 'manager', 'atendente', 'warehouse_manager')
          or (v_role = 'pharmacist' and p_type = 'pharmacy')) then
    return false;
  end if;
  v_mod := public.fn_modulo_usuario(auth.uid());
  if v_mod is null then return true; end if;
  return (p_type = 'pharmacy' and v_mod = 'farmacia') or (p_type = 'warehouse' and v_mod = 'almoxarifado');
end $f$;
revoke execute on function public.fn_pode_atender_solicitacao(text) from public, anon;
grant execute on function public.fn_pode_atender_solicitacao(text) to authenticated;

-- 1) Maquina de estados do pedido ----------------------------------------------
-- INVOKER de proposito: current_user precisa ser quem chamou. As funcoes do
-- banco (SECURITY DEFINER, dono postgres) passam direto: elas mesmas conferem
-- papel, status e estoque.
create or replace function public.fn_requests_maquina_estados()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $f$
declare
  v_uid uuid := auth.uid();
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Transicoes validas (vale para todos, inclusive funcoes do banco).
  if old.status in ('completed', 'rejected', 'cancelled') then
    raise exception 'Este pedido ja esta % e nao pode mudar de situacao. Recarregue a pagina.',
      public.fn_status_rotulo(old.status);
  end if;
  if new.status = 'pending' then
    raise exception 'Pedido nao pode voltar para pendente.';
  end if;
  if old.status = 'delivered' and new.status <> 'completed' then
    raise exception 'Pedido ja entregue: so pode ser concluido pela confirmacao de recebimento.';
  end if;
  if old.status = 'processing' and new.status = 'approved' then
    raise exception 'Pedido em processamento nao volta para aprovado.';
  end if;

  -- Daqui pra baixo: so mudanca feita direto pelo navegador.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if v_uid is null then
    raise exception 'Usuario nao autenticado.';
  end if;

  -- Solicitante cancelando o proprio pedido pendente.
  if new.status = 'cancelled' and old.status = 'pending' and old.requester_id = v_uid then
    return new;
  end if;

  if not public.fn_pode_atender_solicitacao(new.type) then
    raise exception 'Sem permissao para alterar pedido %: o atendimento e do modulo %.',
      case when new.type = 'pharmacy' then 'da farmacia' else 'do almoxarifado' end,
      case when new.type = 'pharmacy' then 'Farmacia' else 'Almoxarifado' end;
  end if;

  -- Farmacia: entrega e conclusao movem lote/estoque e so acontecem pelas
  -- funcoes atender_solicitacao_farmacia e confirmar_recebimento_solicitacao.
  if new.type = 'pharmacy' and new.status not in ('rejected', 'cancelled') then
    raise exception 'Pedido da farmacia e atendido pelo botao Aprovar e concluido pela Confirmacao de recebimento.';
  end if;

  -- Almoxarifado: "entregue" do painel antigo nao existe mais; entregar conclui.
  if new.type = 'warehouse' and new.status = 'delivered' then
    raise exception 'Use Marcar como Entregue no detalhe do pedido.';
  end if;

  return new;
end $f$;

drop trigger if exists trg_requests_a_maquina_estados on public.requests;
create trigger trg_requests_a_maquina_estados
  before update of status on public.requests
  for each row execute function public.fn_requests_maquina_estados();

-- 2) Itens: quantidade/lote travados fora de pending/approved/processing -------
create or replace function public.fn_request_items_trava()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $f$
declare
  v_status text;
begin
  if new.quantity is not distinct from old.quantity
     and new.approved_quantity is not distinct from old.approved_quantity
     and new.supplied_quantity is not distinct from old.supplied_quantity
     and new.delivered_quantity is not distinct from old.delivered_quantity
     and new.warehouse_item_id is not distinct from old.warehouse_item_id
     and new.pharmacy_item_id is not distinct from old.pharmacy_item_id
     and new.item_type is not distinct from old.item_type
     and new.request_id is not distinct from old.request_id
     and new.expiry_tracking_id is not distinct from old.expiry_tracking_id then
    return new;
  end if;
  select status into v_status from public.requests where id = old.request_id;
  if v_status not in ('pending', 'approved', 'processing') then
    raise exception 'Pedido ja %: as quantidades dos itens nao podem mais ser alteradas.',
      public.fn_status_rotulo(v_status);
  end if;
  if new.supplied_quantity is not null and new.supplied_quantity < 0 then
    raise exception 'Quantidade fornecida nao pode ser negativa.';
  end if;
  return new;
end $f$;

drop trigger if exists trg_request_items_trava on public.request_items;
create trigger trg_request_items_trava
  before update on public.request_items
  for each row execute function public.fn_request_items_trava();

-- Solicitante so inclui item em pedido PENDENTE (antes: em qualquer status —
-- item incluido depois de aprovar entrava na baixa sem ninguem ver).
drop policy if exists "Users can insert request items for own requests" on public.request_items;
create policy "Users can insert request items for own requests" on public.request_items
  for insert to authenticated
  with check (exists (select 1 from public.requests r
                       where r.id = request_items.request_id
                         and r.requester_id = auth.uid()
                         and r.status = 'pending'));

-- 3) Baixa do almoxarifado -------------------------------------------------------
create table if not exists public.solicitacao_baixas_almox (
  request_item_id   uuid primary key,
  request_id        uuid not null,
  warehouse_item_id uuid not null,
  quantidade        integer not null check (quantidade > 0),
  saldo_antes       integer not null,
  saldo_depois      integer not null,
  baixado_por       uuid,
  baixado_em        timestamptz not null default now()
);
create index if not exists solicitacao_baixas_almox_request on public.solicitacao_baixas_almox (request_id);
create index if not exists solicitacao_baixas_almox_item on public.solicitacao_baixas_almox (warehouse_item_id, baixado_em desc);
alter table public.solicitacao_baixas_almox enable row level security;
drop policy if exists solicitacao_baixas_almox_select on public.solicitacao_baixas_almox;
create policy solicitacao_baixas_almox_select on public.solicitacao_baixas_almox
  for select to authenticated using (true);
-- sem policy de escrita: so o gatilho (SECURITY DEFINER) grava.
revoke all on public.solicitacao_baixas_almox from anon;

create or replace function public.deduct_stock_on_request_delivered()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  ri record;
  v_saldo integer;
  v_nome text;
begin
  -- Pedido de enfermagem: a baixa e da Satelite Terreo, feita por
  -- atender_pedido_enfermagem. Nao abate do almoxarifado.
  if public.fn_is_pedido_enfermagem(NEW.id) then
    return NEW;
  end if;

  if (NEW.status in ('delivered', 'completed'))
     and (OLD.status is null or OLD.status not in ('delivered', 'completed')) then
    for ri in
      select id, item_type, warehouse_item_id, item_name, supplied_quantity
        from public.request_items
       where request_id = NEW.id
         and item_type = 'warehouse'
         and warehouse_item_id is not null
       order by warehouse_item_id, id   -- ordem fixa: evita deadlock entre pedidos
    loop
      -- C2: vazio nunca vira "o que foi pedido".
      if ri.supplied_quantity is null then
        raise exception 'Informe a quantidade fornecida de "%" (digite 0 se nao foi fornecido).', ri.item_name;
      end if;
      if ri.supplied_quantity <= 0 then
        continue;
      end if;
      -- Idempotente: item ja baixado nao baixa de novo.
      if exists (select 1 from public.solicitacao_baixas_almox b where b.request_item_id = ri.id) then
        continue;
      end if;

      select current_stock, name into v_saldo, v_nome
        from public.warehouse_items where id = ri.warehouse_item_id for update;
      if not found then
        raise exception 'Item "%" nao existe mais no almoxarifado.', ri.item_name;
      end if;
      if coalesce(v_saldo, 0) < ri.supplied_quantity then
        raise exception 'Saldo insuficiente no almoxarifado para "%": disponivel %, fornecido %.',
          coalesce(v_nome, ri.item_name), coalesce(v_saldo, 0), ri.supplied_quantity;
      end if;

      update public.warehouse_items
         set current_stock = current_stock - ri.supplied_quantity,
             updated_at = now()
       where id = ri.warehouse_item_id;

      insert into public.solicitacao_baixas_almox(request_item_id, request_id, warehouse_item_id,
        quantidade, saldo_antes, saldo_depois, baixado_por)
      values (ri.id, NEW.id, ri.warehouse_item_id, ri.supplied_quantity,
        coalesce(v_saldo, 0), coalesce(v_saldo, 0) - ri.supplied_quantity, auth.uid());
    end loop;
  end if;
  return NEW;
end;
$function$;
