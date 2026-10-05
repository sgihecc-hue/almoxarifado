-- =============================================================================
-- MODO INVENTARIO DO ALMOXARIFADO (2/3): funcoes
-- Depende de 20261005120000_almox_inventario_tabelas.sql.
--
-- Papeis:
--   abrir / fechar / cancelar ....... gestor do almoxarifado ou administrador
--   salvar contagem de item ......... atendente/gestor do almox ou administrador
--   liberar saida urgente ........... so administrador (e so se a opcao permitir)
-- =============================================================================

-- Inventario aberto agora (ou nada). Usado pelos bloqueios e pelas telas.
create or replace function public.fn_almox_inventario_aberto()
returns public.almox_inventarios
language sql stable security definer
set search_path = public, pg_temp
as $f$
  select * from public.almox_inventarios where status = 'aberto' limit 1
$f$;

-- 'Almoxarifado em inventário desde DD/MM HH:MM — <texto>'
create or replace function public.fn_almox_inventario_msg(p_inv public.almox_inventarios, p_texto text)
returns text
language sql stable
set search_path = public, pg_temp
as $f$
  select 'Almoxarifado em inventário desde '
      || to_char(p_inv.aberto_em at time zone 'America/Bahia', 'DD/MM HH24:MI')
      || ' — ' || p_texto
$f$;

-- Papel do usuario no inventario: 'admin', 'gestao', 'operador' ou null.
create or replace function public.fn_almox_inventario_papel()
returns text
language sql stable security definer
set search_path = public, pg_temp
as $f$
  select case
    when u.role in ('administrador', 'admin') then 'admin'
    when not public.fn_user_pode_modulo('almox') then null
    when u.role in ('gestor', 'manager') then 'gestao'
    when u.role = 'atendente' then 'operador'
    else null end
  from public.users u
  where u.id = auth.uid() and coalesce(u.is_active, true) and u.deleted_at is null
$f$;

-- Calculo por item (previa na Conferencia e base do fechamento).
-- Itens: os ativos do almox + os contados (mesmo se inativados depois).
--   contado:      diferenca = soma das linhas - saldo do sistema no momento da contagem
--   nao contado:  'manter' => 0 ; 'zerar' => -saldo atual
--   saldo_depois = saldo atual + diferenca
-- Valor unitario = ultimo preco de compra (senao o preco do cadastro, senao 0).
create or replace function public.fn_almox_inventario_calcular(p_inv uuid)
returns table(item_id uuid, item_nome text, item_codigo text, unidade text, contado boolean,
  quantidade_contada integer, saldo_sistema_contagem integer, saldo_antes integer, diferenca integer,
  saldo_depois integer, valor_unitario numeric, valor_diferenca numeric, valor_final numeric, linhas integer)
language sql stable security definer
set search_path = public, pg_temp
as $f$
  with inv as (select * from public.almox_inventarios where id = p_inv),
  c as (
    select ct.item_id, sum(ct.quantidade)::integer qtd,
           max(ct.saldo_sistema_no_momento)::integer saldo_c, count(*)::integer n
      from public.almox_inventario_contagens ct
     where ct.inventario_id = p_inv
     group by ct.item_id),
  base as (
    select w.id, w.name, w.code, w.unit, coalesce(w.current_stock, 0) atual,
           coalesce(w.last_purchase_price, w.price, 0)::numeric vu, c.qtd, c.saldo_c, c.n
      from public.warehouse_items w
      left join c on c.item_id = w.id
     where w.is_active is true or c.item_id is not null)
  select b.id, b.name, b.code, b.unit, b.qtd is not null, b.qtd, b.saldo_c, b.atual,
         d.dif, b.atual + d.dif, b.vu, d.dif * b.vu, (b.atual + d.dif) * b.vu, coalesce(b.n, 0)
    from base b
   cross join inv
   cross join lateral (
     select case when b.qtd is not null then b.qtd - b.saldo_c
                 when inv.nao_contados = 'zerar' then -b.atual
                 else 0 end as dif) d
$f$;

-- -----------------------------------------------------------------------------
-- Status publico (qualquer usuario logado): a tela de Nova Solicitacao avisa
-- antes de a pessoa montar um pedido que o banco vai recusar.
-- -----------------------------------------------------------------------------
create or replace function public.almox_inventario_status()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $f$
declare
  v_inv public.almox_inventarios;
begin
  if auth.uid() is null then
    return jsonb_build_object('aberto', false);
  end if;
  v_inv := public.fn_almox_inventario_aberto();
  if v_inv.id is null then
    return jsonb_build_object('aberto', false);
  end if;
  return jsonb_build_object(
    'aberto', true,
    'id', v_inv.id,
    'numero', v_inv.numero,
    'desde', v_inv.aberto_em,
    'bloqueio', v_inv.bloqueio,
    'permite_liberacao_urgente', v_inv.permite_liberacao_urgente,
    'mensagem', public.fn_almox_inventario_msg(v_inv,
      case when v_inv.bloqueio = 'todos'
           then 'pedidos e saídas do almoxarifado bloqueados até o fechamento.'
           else 'pedidos novos do almoxarifado bloqueados até o fechamento.' end));
end $f$;

-- -----------------------------------------------------------------------------
-- ABRIR
-- -----------------------------------------------------------------------------
create or replace function public.almox_inventario_abrir(
  p_bloqueio text, p_permite_liberacao boolean, p_nao_contados text, p_observacao text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $f$
declare
  v_papel text := public.fn_almox_inventario_papel();
  v_inv public.almox_inventarios;
begin
  if auth.uid() is null then raise exception 'Usuário não autenticado.'; end if;
  if v_papel is null or v_papel = 'operador' then
    raise exception 'Só o gestor do almoxarifado ou o administrador abre o inventário.';
  end if;
  if coalesce(p_bloqueio, '') not in ('todos', 'novos') then
    raise exception 'Escolha o tipo de bloqueio: todos os pedidos ou só pedidos novos.';
  end if;
  if coalesce(p_nao_contados, '') not in ('manter', 'zerar') then
    raise exception 'Escolha o que fazer com os itens não contados: manter ou zerar.';
  end if;
  v_inv := public.fn_almox_inventario_aberto();
  if v_inv.id is not null then
    raise exception 'Já existe um inventário aberto (nº %, desde %). Feche ou cancele antes de abrir outro.',
      v_inv.numero, to_char(v_inv.aberto_em at time zone 'America/Bahia', 'DD/MM HH24:MI');
  end if;

  begin
    insert into public.almox_inventarios(status, aberto_por, bloqueio, permite_liberacao_urgente,
      nao_contados, observacao)
    values ('aberto', auth.uid(), p_bloqueio, coalesce(p_permite_liberacao, false),
      p_nao_contados, nullif(btrim(coalesce(p_observacao, '')), ''))
    returning * into v_inv;
  exception when unique_violation then
    raise exception 'Já existe um inventário aberto. Recarregue a página.';
  end;

  return jsonb_build_object('id', v_inv.id, 'numero', v_inv.numero, 'aberto_em', v_inv.aberto_em);
end $f$;

-- -----------------------------------------------------------------------------
-- SALVAR CONTAGEM DE UM ITEM (substitui as linhas do item neste inventario)
-- p_linhas: [{ "quantidade": "10", "lote": "ab 12", "validade": "2027-05-31" }, ...]
-- Lista vazia = apaga a contagem do item (volta a "nao contado").
-- -----------------------------------------------------------------------------
create or replace function public.almox_inventario_salvar_item(p_inventario uuid, p_item uuid, p_linhas jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $f$
declare
  v_uid uuid := auth.uid();
  v_papel text := public.fn_almox_inventario_papel();
  v_status text;
  v_saldo integer;
  v_nome text;
  v_ativo boolean;
  l jsonb;
  v_txt text;
  v_qtd integer;
  v_lote text;
  v_val date;
  v_piso date := date '2015-01-01';
  v_teto date := (current_date + interval '30 years')::date;
  v_n integer := 0;
  v_total integer := 0;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.'; end if;
  if v_papel is null then
    raise exception 'Só quem opera o almoxarifado pode lançar contagem.';
  end if;
  -- FOR SHARE: varias pessoas contam ao mesmo tempo, mas o fechamento espera.
  select status into v_status from public.almox_inventarios where id = p_inventario for share;
  if v_status is null then raise exception 'Inventário não encontrado.'; end if;
  if v_status <> 'aberto' then
    raise exception 'Este inventário já foi %. A contagem não pode mais ser alterada.',
      case v_status when 'fechado' then 'fechado' else 'cancelado' end;
  end if;

  select current_stock, name, is_active into v_saldo, v_nome, v_ativo
    from public.warehouse_items where id = p_item;
  if v_nome is null then raise exception 'Item do almoxarifado não encontrado.'; end if;
  if v_ativo is not true then raise exception 'O item "%" está inativo e não entra no inventário.', v_nome; end if;

  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'Linhas da contagem inválidas.';
  end if;
  if jsonb_array_length(p_linhas) > 200 then
    raise exception 'Máximo de 200 linhas por item.';
  end if;

  delete from public.almox_inventario_contagens where inventario_id = p_inventario and item_id = p_item;

  for l in select value from jsonb_array_elements(p_linhas)
  loop
    v_n := v_n + 1;
    v_txt := btrim(coalesce(l->>'quantidade', ''));
    if v_txt !~ '^\d+$' or length(v_txt) > 7 then
      raise exception 'Linha %: quantidade inválida. Use número inteiro (0 ou mais), sem casas decimais.', v_n;
    end if;
    v_qtd := v_txt::integer;

    v_lote := public.fn_lote_normalizado(l->>'lote');
    if v_lote is not null and length(v_lote) > 60 then
      raise exception 'Linha %: lote muito longo.', v_n;
    end if;

    v_val := null;
    if nullif(btrim(coalesce(l->>'validade', '')), '') is not null then
      begin
        v_val := to_date(btrim(l->>'validade'), 'YYYY-MM-DD');
        if to_char(v_val, 'YYYY-MM-DD') <> btrim(l->>'validade') then raise exception 'x'; end if;
      exception when others then
        raise exception 'Linha %: validade inválida (use dia/mês/ano).', v_n;
      end;
      -- Mesma faixa do gatilho fn_valida_validade_almox (lotes do almox).
      if v_val < v_piso or v_val > v_teto then
        raise exception 'Linha %: validade % parece digitada errada. Confira o ano — o sistema aceita de % até %.',
          v_n, to_char(v_val, 'DD/MM/YYYY'), to_char(v_piso, 'DD/MM/YYYY'), to_char(v_teto, 'DD/MM/YYYY');
      end if;
    end if;

    insert into public.almox_inventario_contagens(inventario_id, item_id, lote, validade, quantidade,
      saldo_sistema_no_momento, contado_por)
    values (p_inventario, p_item, v_lote, v_val, v_qtd, coalesce(v_saldo, 0), v_uid);
    v_total := v_total + v_qtd;
  end loop;

  return jsonb_build_object('item_id', p_item, 'linhas', v_n, 'total', v_total, 'contado', v_n > 0);
end $f$;

-- -----------------------------------------------------------------------------
-- LIBERAR SAIDA URGENTE (pedido do almox parado pelo bloqueio 'todos')
-- -----------------------------------------------------------------------------
create or replace function public.almox_inventario_liberar_saida(p_inventario uuid, p_request_id uuid, p_motivo text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $f$
declare
  v_inv public.almox_inventarios;
  v_req record;
begin
  if auth.uid() is null then raise exception 'Usuário não autenticado.'; end if;
  if public.fn_almox_inventario_papel() is distinct from 'admin' then
    raise exception 'Só o administrador libera saída urgente durante o inventário.';
  end if;
  select * into v_inv from public.almox_inventarios where id = p_inventario for share;
  if v_inv.id is null then raise exception 'Inventário não encontrado.'; end if;
  if v_inv.status <> 'aberto' then raise exception 'Este inventário não está aberto.'; end if;
  if not v_inv.permite_liberacao_urgente then
    raise exception 'Este inventário foi aberto sem a opção de liberar saída urgente.';
  end if;
  if v_inv.bloqueio <> 'todos' then
    raise exception 'Neste inventário só os pedidos novos estão bloqueados; a entrega dos pedidos existentes já está liberada.';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo da liberação (mínimo 5 caracteres).';
  end if;
  select id, type, status, request_number into v_req from public.requests where id = p_request_id;
  if v_req.id is null then raise exception 'Pedido não encontrado.'; end if;
  if v_req.type <> 'warehouse' then raise exception 'Só pedido do almoxarifado precisa de liberação.'; end if;
  if v_req.status not in ('pending', 'approved', 'processing') then
    raise exception 'O pedido nº % já está fechado; não há o que liberar.', v_req.request_number;
  end if;

  insert into public.almox_inventario_liberacoes(inventario_id, request_id, liberado_por, motivo)
  values (p_inventario, p_request_id, auth.uid(), btrim(p_motivo))
  on conflict (inventario_id, request_id) do nothing;

  return jsonb_build_object('ok', true, 'request_id', p_request_id, 'request_number', v_req.request_number);
end $f$;

-- -----------------------------------------------------------------------------
-- PREVIA / CONFERENCIA (gestor e admin): o que o fechamento faria agora.
-- -----------------------------------------------------------------------------
create or replace function public.almox_inventario_previa(p_inventario uuid)
returns table(item_id uuid, item_nome text, item_codigo text, unidade text, contado boolean,
  quantidade_contada integer, saldo_sistema_contagem integer, saldo_antes integer, diferenca integer,
  saldo_depois integer, valor_unitario numeric, valor_diferenca numeric, valor_final numeric, linhas integer)
language plpgsql stable security definer
set search_path = public, pg_temp
as $f$
begin
  if coalesce(public.fn_almox_inventario_papel(), '') not in ('admin', 'gestao') then
    raise exception 'Só o gestor do almoxarifado ou o administrador vê a conferência (saldo do sistema).';
  end if;
  if not exists (select 1 from public.almox_inventarios where id = p_inventario) then
    raise exception 'Inventário não encontrado.';
  end if;
  return query select * from public.fn_almox_inventario_calcular(p_inventario) order by 2;
end $f$;

-- -----------------------------------------------------------------------------
-- PEDIDOS PARADOS: pedidos do almox ainda em aberto (quem opera o almox ve).
-- Pedido de enfermagem fica de fora: e atendido pela Satelite Terreo.
-- -----------------------------------------------------------------------------
create or replace function public.almox_inventario_pedidos_parados(p_inventario uuid)
returns table(request_id uuid, request_number integer, status text, priority text, created_at timestamptz,
  setor text, solicitante text, itens integer, liberado boolean, liberado_por text, liberado_em timestamptz,
  motivo_liberacao text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $f$
begin
  if public.fn_almox_inventario_papel() is null then
    raise exception 'Só quem opera o almoxarifado vê os pedidos parados.';
  end if;
  return query
    select r.id, r.request_number, r.status, r.priority, r.created_at,
           d.name, u.full_name,
           (select count(*)::integer from public.request_items ri where ri.request_id = r.id),
           l.id is not null, lu.full_name, l.liberado_em, l.motivo
      from public.requests r
      left join public.departments d on d.id = r.department_id
      left join public.users u on u.id = r.requester_id
      left join public.almox_inventario_liberacoes l on l.request_id = r.id and l.inventario_id = p_inventario
      left join public.users lu on lu.id = l.liberado_por
     where r.type = 'warehouse'
       and r.status in ('pending', 'approved', 'processing')
       and not public.fn_is_pedido_enfermagem(r.id)
     order by r.created_at;
end $f$;

-- -----------------------------------------------------------------------------
-- FECHAR: ajusta saldos pela diferenca, refaz os lotes do ALMOX dos itens
-- contados, grava rastro (almox_movimentos + almox_item_edicoes), fotografia
-- por item (almox_inventario_resultado) e o resumo. Tudo numa transacao.
-- -----------------------------------------------------------------------------
create or replace function public.almox_inventario_fechar(p_inventario uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $f$
declare
  v_uid uuid := auth.uid();
  v_papel text := public.fn_almox_inventario_papel();
  v_user public.users;
  v_inv public.almox_inventarios;
  v_almox uuid;
  v_neg text;
  v_motivo text;
  r record;
  g record;
  v_lote uuid;
  v_mexeu boolean;
  v_com_lote boolean;
  v_resumo jsonb;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.'; end if;
  if v_papel is null or v_papel = 'operador' then
    raise exception 'Só o gestor do almoxarifado ou o administrador fecha o inventário.';
  end if;
  select * into v_user from public.users where id = v_uid;

  select * into v_inv from public.almox_inventarios where id = p_inventario for update;
  if v_inv.id is null then raise exception 'Inventário não encontrado.'; end if;
  if v_inv.status <> 'aberto' then
    raise exception 'Este inventário já está %.', case v_inv.status when 'fechado' then 'fechado' else 'cancelado' end;
  end if;
  select id into v_almox from public.stock_locations where code = 'ALMOX';
  if v_almox is null then raise exception 'Local ALMOX não encontrado.'; end if;

  -- Trava os itens envolvidos (ordem fixa: evita deadlock com entregas).
  perform 1 from public.warehouse_items w
   where w.is_active is true
      or exists (select 1 from public.almox_inventario_contagens c
                  where c.inventario_id = p_inventario and c.item_id = w.id)
   order by w.id
   for update;

  -- Nunca zera em silencio: saldo que ficaria negativo recusa o fechamento.
  select string_agg(format('"%s" (saldo agora %s, diferença %s)', x.item_nome, x.saldo_antes, x.diferenca), '; ')
    into v_neg
    from (select * from public.fn_almox_inventario_calcular(p_inventario) c where c.saldo_depois < 0
           order by c.item_nome limit 5) x;
  if v_neg is not null then
    raise exception 'Fechamento recusado: item ficaria com saldo negativo — %. Reconte esses itens.', v_neg;
  end if;

  v_motivo := 'Inventário de ' || to_char(v_inv.aberto_em at time zone 'America/Bahia', 'DD/MM/YYYY');

  -- Fecha primeiro: os bloqueios (gatilhos) deixam de valer para os ajustes abaixo.
  update public.almox_inventarios
     set status = 'fechado', fechado_por = v_uid, fechado_em = now()
   where id = p_inventario;

  insert into public.almox_inventario_resultado(inventario_id, item_id, item_nome, item_codigo, unidade,
    contado, quantidade_contada, saldo_sistema_contagem, saldo_antes, diferenca, saldo_depois,
    valor_unitario, valor_diferenca, valor_final, lotes)
  select p_inventario, c.item_id, c.item_nome, c.item_codigo, c.unidade,
         c.contado, c.quantidade_contada, c.saldo_sistema_contagem, c.saldo_antes, c.diferenca, c.saldo_depois,
         c.valor_unitario, c.valor_diferenca, c.valor_final,
         (select jsonb_agg(jsonb_build_object('lote', k.lote, 'validade', k.validade, 'quantidade', k.q)
                           order by k.validade nulls last, k.lote nulls first)
            from (select ct.lote, ct.validade, sum(ct.quantidade)::integer q
                    from public.almox_inventario_contagens ct
                   where ct.inventario_id = p_inventario and ct.item_id = c.item_id
                   group by ct.lote, ct.validade) k)
    from public.fn_almox_inventario_calcular(p_inventario) c;

  -- Ajuste de saldo + rastro
  for r in select * from public.almox_inventario_resultado
            where inventario_id = p_inventario and diferenca <> 0
            order by item_id
  loop
    update public.warehouse_items
       set current_stock = coalesce(current_stock, 0) + r.diferenca, updated_at = now()
     where id = r.item_id;

    insert into public.almox_movimentos(item_id, direcao, quantidade, origem, motivo, motivo_detalhe,
      referencia_id, saldo_antes, saldo_depois, observacao, realizado_por)
    values (r.item_id, case when r.diferenca > 0 then 'in' else 'out' end, abs(r.diferenca), 'inventario',
      v_motivo,
      case when r.contado
           then format('Inventário nº %s: contado %s, sistema na contagem %s', v_inv.numero, r.quantidade_contada, r.saldo_sistema_contagem)
           else format('Inventário nº %s: item não contado, saldo zerado (opção do inventário)', v_inv.numero) end,
      p_inventario, r.saldo_antes, r.saldo_antes + r.diferenca, v_inv.observacao, v_uid);

    -- Mesmo registro do Editar Item: a tela Movimentacao mostra o motivo.
    insert into public.almox_item_edicoes(item_id, item_nome, item_codigo, usuario_id, usuario_nome,
      usuario_perfil, motivo, alteracoes, entrada)
    values (r.item_id, r.item_nome, r.item_codigo, v_uid, v_user.full_name, v_user.role,
      v_motivo || ' (nº ' || v_inv.numero || '): '
        || case when r.contado
                then format('contado %s, sistema na contagem %s, diferença %s', r.quantidade_contada, r.saldo_sistema_contagem, r.diferenca)
                else 'item não contado, saldo zerado' end,
      jsonb_build_object('current_stock', jsonb_build_object('antes', r.saldo_antes, 'depois', r.saldo_antes + r.diferenca)),
      null);
  end loop;

  -- Lotes do ALMOX. Itens contados: os lotes passam a ser o que foi contado.
  -- Itens nao contados zerados: lotes do ALMOX zerados. (Linhas nao sao
  -- apagadas: lote ja usado em movimentacao fica no historico com 0.)
  for r in select * from public.almox_inventario_resultado
            where inventario_id = p_inventario
              and (contado or (v_inv.nao_contados = 'zerar' and diferenca <> 0))
            order by item_id
  loop
    update public.expiry_tracking set current_quantity = 0
     where item_id = r.item_id and location_id = v_almox and current_quantity <> 0;
    v_mexeu := found;

    v_com_lote := r.contado and exists (
      select 1 from public.almox_inventario_contagens ct
       where ct.inventario_id = p_inventario and ct.item_id = r.item_id
         and (ct.lote is not null or ct.validade is not null));

    if v_com_lote then
      -- Item com lote/validade na contagem: um lote por (lote, validade).
      -- Linha sem lote vira o lote "SEMLOTE" (padrao ja usado no sistema), para
      -- a soma dos lotes bater com o contado.
      for g in
        select coalesce(ct.lote, 'SEMLOTE') b, ct.validade v, sum(ct.quantidade)::integer q
          from public.almox_inventario_contagens ct
         where ct.inventario_id = p_inventario and ct.item_id = r.item_id
         group by 1, 2
        having sum(ct.quantidade) > 0
      loop
        v_lote := null;
        select e.id into v_lote from public.expiry_tracking e
         where e.item_id = r.item_id and e.location_id = v_almox
           and e.batch_number = g.b and e.expiry_date is not distinct from g.v
         order by e.created_at
         limit 1;
        if v_lote is not null then
          update public.expiry_tracking set current_quantity = g.q where id = v_lote;
        else
          insert into public.expiry_tracking(item_id, batch_number, expiry_date, initial_quantity,
            current_quantity, location_id, created_by)
          values (r.item_id, g.b, g.v, g.q, g.q, v_almox, v_uid);
        end if;
        v_mexeu := true;
      end loop;
    end if;

    -- Copia do ALMOX em item_stocks = soma dos lotes (como almox_editar_lotes).
    if v_mexeu then
      insert into public.item_stocks(item_id, item_type, location_id, quantity)
      values (r.item_id, 'warehouse', v_almox,
              coalesce((select sum(e.current_quantity) from public.expiry_tracking e
                         where e.item_id = r.item_id and e.location_id = v_almox), 0))
      on conflict (item_id, item_type, location_id)
      do update set quantity = excluded.quantity, updated_at = now();
    end if;
  end loop;

  select jsonb_build_object(
      'numero', v_inv.numero,
      'aberto_em', v_inv.aberto_em,
      'fechado_em', now(),
      'bloqueio', v_inv.bloqueio,
      'nao_contados', v_inv.nao_contados,
      'permite_liberacao_urgente', v_inv.permite_liberacao_urgente,
      'itens_total', count(*),
      'itens_contados', count(*) filter (where x.contado),
      'itens_nao_contados', count(*) filter (where not x.contado),
      'itens_nao_contados_zerados', count(*) filter (where not x.contado and x.diferenca <> 0),
      'itens_sem_diferenca', count(*) filter (where x.contado and x.diferenca = 0),
      'itens_com_sobra', count(*) filter (where x.diferenca > 0),
      'itens_com_falta', count(*) filter (where x.diferenca < 0),
      'qtd_sobra', coalesce(sum(x.diferenca) filter (where x.diferenca > 0), 0),
      'qtd_falta', coalesce(-sum(x.diferenca) filter (where x.diferenca < 0), 0),
      'valor_sobra', round(coalesce(sum(x.valor_diferenca) filter (where x.diferenca > 0), 0), 2),
      'valor_falta', round(coalesce(-sum(x.valor_diferenca) filter (where x.diferenca < 0), 0), 2),
      'valor_liquido', round(coalesce(sum(x.valor_diferenca), 0), 2),
      'valor_total_contado', round(coalesce(sum(x.quantidade_contada * x.valor_unitario) filter (where x.contado), 0), 2),
      'valor_estoque_final', round(coalesce(sum(x.valor_final), 0), 2),
      'itens_sem_preco', count(*) filter (where x.valor_unitario = 0 and (x.contado or x.saldo_depois > 0)),
      'linhas_contagem', (select count(*) from public.almox_inventario_contagens ct where ct.inventario_id = p_inventario),
      'liberacoes', (select count(*) from public.almox_inventario_liberacoes li where li.inventario_id = p_inventario))
    into v_resumo
    from public.almox_inventario_resultado x
   where x.inventario_id = p_inventario;

  update public.almox_inventarios set resumo = v_resumo where id = p_inventario;
  return v_resumo;
end $f$;

-- -----------------------------------------------------------------------------
-- CANCELAR: encerra sem mexer em saldo nem lote (contagens ficam no historico).
-- -----------------------------------------------------------------------------
create or replace function public.almox_inventario_cancelar(p_inventario uuid, p_motivo text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $f$
declare
  v_papel text := public.fn_almox_inventario_papel();
  v_inv public.almox_inventarios;
begin
  if auth.uid() is null then raise exception 'Usuário não autenticado.'; end if;
  if v_papel is null or v_papel = 'operador' then
    raise exception 'Só o gestor do almoxarifado ou o administrador cancela o inventário.';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo do cancelamento (mínimo 5 caracteres).';
  end if;
  select * into v_inv from public.almox_inventarios where id = p_inventario for update;
  if v_inv.id is null then raise exception 'Inventário não encontrado.'; end if;
  if v_inv.status <> 'aberto' then
    raise exception 'Este inventário já está %.', case v_inv.status when 'fechado' then 'fechado' else 'cancelado' end;
  end if;
  update public.almox_inventarios
     set status = 'cancelado', cancelado_por = auth.uid(), cancelado_em = now(),
         motivo_cancelamento = btrim(p_motivo)
   where id = p_inventario;
  return jsonb_build_object('ok', true, 'id', p_inventario);
end $f$;

-- Privilegios: so as RPCs sao chamaveis pelo navegador.
revoke all on function public.fn_almox_inventario_aberto() from public, anon, authenticated;
revoke all on function public.fn_almox_inventario_msg(public.almox_inventarios, text) from public, anon, authenticated;
revoke all on function public.fn_almox_inventario_papel() from public, anon, authenticated;
revoke all on function public.fn_almox_inventario_calcular(uuid) from public, anon, authenticated;
revoke all on function public.almox_inventario_status() from public, anon;
revoke all on function public.almox_inventario_abrir(text, boolean, text, text) from public, anon;
revoke all on function public.almox_inventario_salvar_item(uuid, uuid, jsonb) from public, anon;
revoke all on function public.almox_inventario_liberar_saida(uuid, uuid, text) from public, anon;
revoke all on function public.almox_inventario_previa(uuid) from public, anon;
revoke all on function public.almox_inventario_pedidos_parados(uuid) from public, anon;
revoke all on function public.almox_inventario_fechar(uuid) from public, anon;
revoke all on function public.almox_inventario_cancelar(uuid, text) from public, anon;
grant execute on function public.almox_inventario_status() to authenticated;
grant execute on function public.almox_inventario_abrir(text, boolean, text, text) to authenticated;
grant execute on function public.almox_inventario_salvar_item(uuid, uuid, jsonb) to authenticated;
grant execute on function public.almox_inventario_liberar_saida(uuid, uuid, text) to authenticated;
grant execute on function public.almox_inventario_previa(uuid) to authenticated;
grant execute on function public.almox_inventario_pedidos_parados(uuid) to authenticated;
grant execute on function public.almox_inventario_fechar(uuid) to authenticated;
grant execute on function public.almox_inventario_cancelar(uuid, text) to authenticated;
