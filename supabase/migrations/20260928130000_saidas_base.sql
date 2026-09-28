-- =============================================================================
-- SAIDAS E MOVIMENTACOES — base comum (auditoria de 28/09/2026)
--
-- Peças usadas pelas migrations 2026092813xxxx seguintes:
--   1. fn_saidas_exigir_operador(modulo): quem pode mexer em estoque de saida.
--      Papel (administrador/gestor/atendente/farmaceutico) E modulo do setor:
--      atendente do Almoxarifado nao da saida na farmacia e vice-versa
--      (regra do projeto: almox e farmacia ISOLADOS). Setor que nao e de
--      nenhum dos dois (ex.: Supervisao Administrativa) ou sem setor segue sem
--      restricao de modulo — mesmo criterio do front (contexts/module.tsx).
--   2. saidas_idempotencia: chave da "rodada" enviada pela tela. O mesmo
--      clique repetido (duplo clique, timeout e reenvio) devolve o resultado
--      da primeira vez em vez de baixar de novo.
--   3. almox_movimentos: livro das saidas do ALMOXARIFADO. O saldo do almox
--      vive em warehouse_items.current_stock (modelo legado, ver
--      20260825120000_almox_livro_movimentacao.sql) e o item_stocks(ALMOX) e
--      uma copia divergente que NAO pode ser tocada (zerou saldos em ago/26).
--      Por isso as saidas do almox nao vao para stock_movements: vao para ca,
--      com motivo, destino, lote, saldo antes/depois e quem fez.
--   4. fn_saidas_saldo_local / fn_saidas_consumir_lotes: conferem saldo com
--      trava (FOR UPDATE) e baixam lote por FEFO dividindo entre lotes,
--      ignorando vencidos e NUNCA deixando lote negativo.
-- =============================================================================

-- 1) Quem opera saidas -----------------------------------------------------------
create or replace function public.fn_saidas_modulo_do_local(p_local uuid)
returns text
language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  select case when code = 'ALMOX' then 'almoxarifado' else 'farmacia' end
    from public.stock_locations where id = p_local
$f$;
revoke execute on function public.fn_saidas_modulo_do_local(uuid) from public, anon;
grant execute on function public.fn_saidas_modulo_do_local(uuid) to authenticated;

create or replace function public.fn_saidas_modulo_usuario(p_uid uuid)
returns text
language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  select case
           when lower(btrim(coalesce(d.name,''))) = 'almoxarifado' then 'almoxarifado'
           when lower(btrim(coalesce(d.name,''))) like 'caf%'
             or lower(btrim(coalesce(d.name,''))) ~ '^farm.cia sat.lite' then 'farmacia'
           else null
         end
    from public.users u left join public.departments d on d.id = u.department_id
   where u.id = p_uid
$f$;
revoke execute on function public.fn_saidas_modulo_usuario(uuid) from public, anon;
grant execute on function public.fn_saidas_modulo_usuario(uuid) to authenticated;

-- Devolve o auth.uid() do operador ou levanta erro com mensagem clara.
-- p_papeis: papeis aceitos alem de administrador (padrao: gestor, atendente,
-- farmaceutico). Farmaceutico so opera a farmacia.
create or replace function public.fn_saidas_exigir_operador(p_modulo text, p_papeis text[] default null)
returns uuid
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $f$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_mod text;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  select u.role into v_role from public.users u
   where u.id = v_uid and coalesce(u.is_active, true) and u.deleted_at is null;
  if v_role is null then raise exception 'Usuario sem perfil ativo.'; end if;
  if v_role in ('administrador', 'admin') then return v_uid; end if;

  if not (v_role = any (coalesce(p_papeis, array['gestor','manager','atendente','pharmacist','warehouse_manager']))) then
    raise exception 'Sem permissao para esta operacao (perfil %).', v_role;
  end if;
  if v_role = 'pharmacist' and p_modulo <> 'farmacia' then
    raise exception 'Farmaceutico nao opera o almoxarifado.';
  end if;
  if v_role = 'warehouse_manager' and p_modulo <> 'almoxarifado' then
    raise exception 'Sem permissao para operar a farmacia.';
  end if;

  v_mod := public.fn_saidas_modulo_usuario(v_uid);
  if v_mod is not null and p_modulo is not null and v_mod <> p_modulo then
    raise exception 'Seu setor e do modulo %; esta operacao e do modulo %.',
      case v_mod when 'farmacia' then 'Farmacia' else 'Almoxarifado' end,
      case p_modulo when 'farmacia' then 'Farmacia' else 'Almoxarifado' end;
  end if;
  return v_uid;
end $f$;
revoke execute on function public.fn_saidas_exigir_operador(text, text[]) from public, anon;
grant execute on function public.fn_saidas_exigir_operador(text, text[]) to authenticated;

-- 2) Idempotencia ------------------------------------------------------------------
create table if not exists public.saidas_idempotencia (
  chave uuid primary key,
  operacao text not null,
  usuario uuid,
  resultado jsonb,
  criado_em timestamptz not null default now()
);
alter table public.saidas_idempotencia enable row level security;
-- sem politicas: so as funcoes SECURITY DEFINER leem/escrevem.
revoke all on public.saidas_idempotencia from anon, authenticated;

-- Reserva a chave. Retorna NULL se e a primeira vez (pode seguir) ou o
-- resultado gravado da primeira execucao (a tela deve tratar como sucesso).
-- Chamadas simultaneas com a mesma chave: a segunda espera a primeira
-- terminar (indice unico) e recebe o resultado dela.
create or replace function public.fn_saidas_reservar_chave(p_chave uuid, p_operacao text)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare
  v_res jsonb;
  v_op text;
begin
  if p_chave is null then return null; end if;
  insert into public.saidas_idempotencia(chave, operacao, usuario)
  values (p_chave, p_operacao, auth.uid())
  on conflict (chave) do nothing;
  if found then return null; end if;
  select resultado, operacao into v_res, v_op from public.saidas_idempotencia where chave = p_chave;
  if v_op is distinct from p_operacao then
    raise exception 'Chave de operacao reutilizada em outra operacao. Recarregue a tela.';
  end if;
  if v_res is null then
    raise exception 'Esta operacao ja esta sendo processada. Aguarde e confira a lista antes de repetir.';
  end if;
  return v_res || jsonb_build_object('repetida', true);
end $f$;
revoke execute on function public.fn_saidas_reservar_chave(uuid, text) from public, anon, authenticated;

create or replace function public.fn_saidas_gravar_resultado(p_chave uuid, p_resultado jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
begin
  if p_chave is not null then
    update public.saidas_idempotencia set resultado = p_resultado where chave = p_chave;
  end if;
  return p_resultado;
end $f$;
revoke execute on function public.fn_saidas_gravar_resultado(uuid, jsonb) from public, anon, authenticated;

-- 3) Livro de saidas do almoxarifado ------------------------------------------------
create table if not exists public.almox_movimentos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.warehouse_items(id),
  direcao text not null check (direcao in ('in','out')),
  quantidade integer not null check (quantidade > 0),
  origem text not null,            -- saida_lote | saida_direta | estorno_saida_direta | estorno_almox | vencimento | emprestimo | cancelamento_emprestimo
  motivo text,
  motivo_detalhe text,
  destino_tipo text,
  destino_nome text,
  expiry_tracking_id uuid references public.expiry_tracking(id),
  dispatch_id uuid references public.warehouse_dispatches(id),
  dispatch_item_id uuid references public.warehouse_dispatch_items(id),
  referencia_id uuid,              -- movimento/registro de origem (estornos)
  saldo_antes integer,
  saldo_depois integer,
  observacao text,
  chave uuid,
  realizado_por uuid references public.users(id),
  realizado_em timestamptz not null default now()
);
create index if not exists almox_movimentos_item on public.almox_movimentos (item_id, realizado_em desc);
create index if not exists almox_movimentos_dispatch on public.almox_movimentos (dispatch_id) where dispatch_id is not null;
create index if not exists almox_movimentos_ref on public.almox_movimentos (referencia_id) where referencia_id is not null;
alter table public.almox_movimentos enable row level security;
drop policy if exists almox_movimentos_select on public.almox_movimentos;
create policy almox_movimentos_select on public.almox_movimentos for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid()
                  and u.role in ('administrador','admin','gestor','manager','atendente','warehouse_manager')));
revoke insert, update, delete, truncate on public.almox_movimentos from anon, authenticated;
grant select on public.almox_movimentos to authenticated;

-- 4) Saldo com trava ------------------------------------------------------------------
-- Saldo do item no local, travando a linha. ALMOX/material = warehouse_items
-- (modelo legado); demais = item_stocks. Levanta erro legivel se faltar.
create or replace function public.fn_saidas_conferir_saldo(p_item uuid, p_item_type text, p_local uuid, p_qtd integer)
returns integer
language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare
  v_code text;
  v_saldo integer;
  v_nome text;
begin
  select code into v_code from public.stock_locations where id = p_local;
  if v_code is null then raise exception 'Local de estoque nao encontrado.'; end if;
  if p_item_type = 'warehouse' and v_code = 'ALMOX' then
    select current_stock, name into v_saldo, v_nome from public.warehouse_items where id = p_item for update;
    if not found then raise exception 'Item de almoxarifado nao encontrado.'; end if;
  else
    select quantity into v_saldo from public.item_stocks
     where item_id = p_item and item_type = p_item_type and location_id = p_local
     for update;
    if p_item_type = 'pharmacy' then
      select name into v_nome from public.pharmacy_items where id = p_item;
    else
      select name into v_nome from public.warehouse_items where id = p_item;
    end if;
    if v_nome is null then raise exception 'Item nao encontrado.'; end if;
  end if;
  v_saldo := coalesce(v_saldo, 0);
  if v_saldo < p_qtd then
    raise exception 'Saldo insuficiente de "%" em %: disponivel %, pedido %.', v_nome, v_code, v_saldo, p_qtd;
  end if;
  return v_saldo;
end $f$;
revoke execute on function public.fn_saidas_conferir_saldo(uuid, text, uuid, integer) from public, anon, authenticated;

-- 5) Baixa por lote ----------------------------------------------------------------------
-- Consome p_qtd do item no local:
--   * p_lote informado: tem que ser do item e do local; vencido so com
--     p_justificativa_vencido; saldo do lote tem que cobrir (nunca negativo).
--   * sem lote: FEFO pelos lotes do local com saldo e NAO vencidos, dividindo
--     entre eles. Se os lotes nao cobrem tudo e p_exigir_lote, erro; senao o
--     resto volta numa linha com lote_id nulo (saida sem lote).
-- Devolve uma linha por lote usado. As baixas no expiry_tracking ja ficam feitas.
create or replace function public.fn_saidas_consumir_lotes(
  p_item uuid, p_local uuid, p_qtd integer, p_lote uuid,
  p_exigir_lote boolean, p_justificativa_vencido text default null)
returns table(lote_id uuid, quantidade integer)
language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare
  v_rest integer := p_qtd;
  v_take integer;
  r record;
  v_nome text;
  v_code text;
begin
  select code into v_code from public.stock_locations where id = p_local;
  if p_lote is not null then
    select e.id, e.item_id, e.location_id, e.batch_number, e.expiry_date, coalesce(e.current_quantity,0) q
      into r from public.expiry_tracking e where e.id = p_lote for update;
    if not found then raise exception 'Lote informado nao encontrado.'; end if;
    if r.item_id <> p_item then raise exception 'O lote % nao pertence ao item da linha.', coalesce(r.batch_number,'(sem numero)'); end if;
    if r.location_id is distinct from p_local then
      raise exception 'O lote % nao esta no estoque % (cada estoque so baixa os proprios lotes).', coalesce(r.batch_number,'(sem numero)'), v_code;
    end if;
    if r.expiry_date is not null and r.expiry_date < current_date
       and coalesce(btrim(p_justificativa_vencido),'') = '' then
      raise exception 'O lote % venceu em %. Lote vencido so sai como baixa de vencimento (motivo Vencimento, Troca por validade ou Devolucao ao fornecedor) ou com justificativa registrada.',
        coalesce(r.batch_number,'(sem numero)'), to_char(r.expiry_date,'DD/MM/YYYY');
    end if;
    if r.q < p_qtd then
      raise exception 'Saldo do lote % insuficiente: disponivel %, pedido %.', coalesce(r.batch_number,'(sem numero)'), r.q, p_qtd;
    end if;
    update public.expiry_tracking set current_quantity = current_quantity - p_qtd where id = p_lote;
    lote_id := p_lote; quantidade := p_qtd; return next;
    return;
  end if;

  for r in
    select e.id, coalesce(e.current_quantity,0) q
      from public.expiry_tracking e
     where e.item_id = p_item and e.location_id = p_local
       and e.current_quantity > 0
       and (e.expiry_date is null or e.expiry_date >= current_date)
     order by e.expiry_date asc nulls last, e.created_at asc
     for update
  loop
    exit when v_rest <= 0;
    v_take := least(v_rest, r.q);
    update public.expiry_tracking set current_quantity = current_quantity - v_take where id = r.id;
    lote_id := r.id; quantidade := v_take; return next;
    v_rest := v_rest - v_take;
  end loop;

  if v_rest > 0 then
    if p_exigir_lote then
      select coalesce(name,'item') into v_nome from public.pharmacy_items where id = p_item;
      if v_nome is null then select coalesce(name,'item') into v_nome from public.warehouse_items where id = p_item; end if;
      raise exception 'Saldo em lotes validos de "%" em % insuficiente: disponivel % (lotes vencidos nao contam), pedido %.',
        coalesce(v_nome,'item'), v_code, p_qtd - v_rest, p_qtd;
    end if;
    lote_id := null; quantidade := v_rest; return next;
  end if;
end $f$;
revoke execute on function public.fn_saidas_consumir_lotes(uuid, uuid, integer, uuid, boolean, text) from public, anon, authenticated;
