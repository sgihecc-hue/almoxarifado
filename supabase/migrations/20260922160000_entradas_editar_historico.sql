-- ENTRADAS: editar tudo (quantidade, lote, validade, preco, nota), excluir com
-- justificativa, e HISTORICO por entrada.
--
-- Pedido do Adonias (22/09/2026): "possibilidade de reverter uma entrada
-- criada pela usuaria. Tanto editar quanto excluir. Tudo auditavel no
-- historico; a exclusao precisa de justificativa, a edicao nao."
--
--   - Excluir = anular (ja existia, 20260921180000 / 20260921200000): a entrada
--     nao some, fica marcada, e o saldo volta. Justificativa obrigatoria.
--   - Editar (NOVO): almox_editar_entrada / farmacia_editar_entrada. Quantidade
--     ajusta o estoque pela diferenca (recusa se a reducao passar do que ainda
--     ha — parte ja saiu); lote move a quantidade do lote antigo pro novo;
--     validade atualiza o lote. Observacao opcional.
--     Na farmacia todo ajuste de saldo vira movimento AJUSTE no livro-razao
--     (nunca editado); troca de lote = saida do lote antigo + entrada no novo,
--     pro Livro de Controlados seguir batendo por lote.
--   - Completar NF deixa de exigir motivo (e uma edicao).
--   - HISTORICO: entrada_historico, gravado por GATILHO em stock_entries — toda
--     alteracao de entrada fica registrada (quem, quando, antes/depois), venha
--     da tela que vier.
--
-- Cada modulo com suas funcoes (regra do projeto). A tabela de historico e o
-- gatilho sao comuns, como a propria stock_entries.

-- 1) Historico --------------------------------------------------------------------
create table if not exists public.entrada_historico (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.stock_entries(id) on delete cascade,
  item_type text not null,
  acao text not null check (acao in ('editada', 'anulada')),
  usuario_id uuid,
  usuario_nome text,
  feito_em timestamptz not null default now(),
  alteracoes jsonb not null default '{}'::jsonb,
  justificativa text
);
create index if not exists entrada_historico_entry on public.entrada_historico (entry_id, feito_em);
alter table public.entrada_historico enable row level security;
drop policy if exists "entrada_historico_read" on public.entrada_historico;
create policy "entrada_historico_read" on public.entrada_historico for select to authenticated using (true);

-- Campos que contam como alteracao (colunas tecnicas como rodada/local nao).
create or replace function public.fn_stock_entries_historico()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_campos text[] := array['quantity','batch_number','expiry_date','unit_price','invoice_total_value',
                           'invoice_number','invoice_date','delivery_date','afm_number',
                           'supplier_name','supplier_cnpj','acquisition_type'];
  v_k text;
  v_diff jsonb := '{}'::jsonb;
  v_uid uuid := auth.uid();
  v_acao text;
  v_just text;
begin
  foreach v_k in array v_campos loop
    if to_jsonb(OLD)->v_k is distinct from to_jsonb(NEW)->v_k then
      v_diff := v_diff || jsonb_build_object(v_k, jsonb_build_object('antes', to_jsonb(OLD)->v_k, 'depois', to_jsonb(NEW)->v_k));
    end if;
  end loop;

  if OLD.anulada_em is null and NEW.anulada_em is not null then
    v_acao := 'anulada';
    v_just := NEW.anulada_motivo;
  elsif v_diff <> '{}'::jsonb then
    v_acao := 'editada';
    v_just := nullif(btrim(coalesce(current_setting('app.entrada_obs', true), '')), '');
  else
    return NEW;  -- mudou so coluna tecnica: nada a registrar
  end if;

  insert into public.entrada_historico(entry_id, item_type, acao, usuario_id, usuario_nome, alteracoes, justificativa)
  values (NEW.id, NEW.item_type, v_acao, v_uid,
          (select full_name from public.users where id = v_uid), v_diff, v_just);
  return NEW;
end $function$;

drop trigger if exists trg_stock_entries_historico on public.stock_entries;
create trigger trg_stock_entries_historico
  after update on public.stock_entries
  for each row execute function public.fn_stock_entries_historico();

-- Historico do que ja aconteceu antes do gatilho (anulacoes e NF completadas
-- de 21/09): reconstruido das colunas anulada_*/completada_*.
insert into public.entrada_historico(entry_id, item_type, acao, usuario_id, usuario_nome, feito_em, alteracoes, justificativa)
select e.id, e.item_type, 'anulada', e.anulada_por, (select full_name from public.users where id = e.anulada_por),
       e.anulada_em, '{}'::jsonb, e.anulada_motivo
  from public.stock_entries e
 where e.anulada_em is not null
   and not exists (select 1 from public.entrada_historico h where h.entry_id = e.id and h.acao = 'anulada');

insert into public.entrada_historico(entry_id, item_type, acao, usuario_id, usuario_nome, feito_em, alteracoes, justificativa)
select e.id, e.item_type, 'editada', e.completada_por, (select full_name from public.users where id = e.completada_por),
       e.completada_em,
       coalesce((select ed.alteracoes->'entrada_completada' from public.almox_item_edicoes ed
                  where ed.entrada->>'entrada_id' = e.id::text order by ed.feito_em desc limit 1), '{}'::jsonb),
       'NF completada'
  from public.stock_entries e
 where e.completada_em is not null
   and not exists (select 1 from public.entrada_historico h where h.entry_id = e.id and h.acao = 'editada');

-- 2) Completar NF sem motivo obrigatorio ------------------------------------------
create or replace function public.almox_completar_entrada(
  p_entry_ids uuid[], p_dados jsonb, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_user public.users%rowtype;
  e public.stock_entries%rowtype;
  v_permitidos text[] := array['invoice_number','invoice_date','delivery_date','afm_number',
                               'supplier_name','supplier_cnpj','unit_price'];
  v_k text;
  v_nf text;
  v_outra jsonb;
  v_antes jsonb; v_depois jsonb; v_diff jsonb;
  v_n integer := 0;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  if not public.fn_almox_opera_entradas() then raise exception 'Sem permissao para completar entradas.'; end if;
  select * into v_user from public.users where id = v_uid;
  -- Motivo opcional desde 22/09/2026 (edicao nao exige justificativa). Vai
  -- pro historico da entrada como observacao.
  perform set_config('app.entrada_obs', coalesce(p_motivo, ''), true);
  if p_entry_ids is null or array_length(p_entry_ids, 1) is null then raise exception 'Nenhuma entrada selecionada.'; end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then raise exception 'Dados invalidos.'; end if;
  for v_k in select jsonb_object_keys(p_dados) loop
    if not (v_k = any (v_permitidos) or v_k = 'confirmar') then
      raise exception 'Campo nao pode ser alterado por aqui: %. Quantidade, lote e item nao mudam — se estiverem errados, anule a entrada e lance de novo.', v_k;
    end if;
  end loop;

  v_nf := nullif(btrim(coalesce(p_dados->>'invoice_number','')), '');
  if v_nf in ('—','-','SN','S/N') then v_nf := null; end if;

  for e in select * from public.stock_entries where id = any (p_entry_ids) for update
  loop
    if e.item_type <> 'warehouse' then raise exception 'Entrada de farmacia: use a tela da farmacia.'; end if;
    if e.anulada_em is not null then raise exception 'Entrada ja anulada nao pode ser completada.'; end if;

    -- A mesma NF ja esta em OUTRA entrada do mesmo item? Foi assim que a
    -- mascara duplicou. Avisa; so segue se confirmar (nota com 2 remessas).
    if v_nf is not null and not coalesce((p_dados->>'confirmar')::boolean, false) then
      v_outra := null;
      select jsonb_build_object('entrada_id', o.id, 'data', o.created_at, 'quantidade', o.quantity, 'nf', o.invoice_number)
        into v_outra
        from public.stock_entries o
       where o.item_type = 'warehouse' and o.item_id = e.item_id and o.anulada_em is null
         and o.id <> all (p_entry_ids) and btrim(o.invoice_number) = v_nf
       limit 1;
      if v_outra is not null then
        raise exception 'NF_JA_USADA:%', v_outra::text;
      end if;
    end if;

    v_antes := jsonb_build_object(
      'invoice_number', e.invoice_number, 'invoice_date', e.invoice_date, 'delivery_date', e.delivery_date,
      'afm_number', e.afm_number, 'supplier_name', e.supplier_name, 'supplier_cnpj', e.supplier_cnpj,
      'unit_price', e.unit_price);

    update public.stock_entries s set
      invoice_number = case when p_dados ? 'invoice_number' then coalesce(v_nf, '—') else s.invoice_number end,
      invoice_date   = case when p_dados ? 'invoice_date' then coalesce(nullif(p_dados->>'invoice_date','')::date, s.invoice_date) else s.invoice_date end,
      delivery_date  = case when p_dados ? 'delivery_date' then nullif(p_dados->>'delivery_date','')::date else s.delivery_date end,
      afm_number     = case when p_dados ? 'afm_number' then coalesce(nullif(btrim(p_dados->>'afm_number'),''), '—') else s.afm_number end,
      supplier_name  = case when p_dados ? 'supplier_name' then coalesce(nullif(btrim(p_dados->>'supplier_name'),''), s.supplier_name) else s.supplier_name end,
      supplier_cnpj  = case when p_dados ? 'supplier_cnpj' then coalesce(nullif(btrim(p_dados->>'supplier_cnpj'),''), s.supplier_cnpj) else s.supplier_cnpj end,
      unit_price     = case when p_dados ? 'unit_price' then coalesce(nullif(p_dados->>'unit_price','')::numeric, s.unit_price) else s.unit_price end,
      invoice_total_value = case when p_dados ? 'unit_price' and nullif(p_dados->>'unit_price','') is not null
                                 then round(s.quantity * (p_dados->>'unit_price')::numeric, 2) else s.invoice_total_value end,
      nf_pendente    = case when p_dados ? 'invoice_number' then (v_nf is null) else s.nf_pendente end,
      completada_em  = now(),
      completada_por = v_uid
     where s.id = e.id
    returning jsonb_build_object(
      'invoice_number', s.invoice_number, 'invoice_date', s.invoice_date, 'delivery_date', s.delivery_date,
      'afm_number', s.afm_number, 'supplier_name', s.supplier_name, 'supplier_cnpj', s.supplier_cnpj,
      'unit_price', s.unit_price) into v_depois;

    -- O lote criado por esta entrada guarda os dados da NF tambem.
    if e.expiry_tracking_id is not null and p_dados ? 'invoice_number' then
      update public.expiry_tracking set invoice_number = v_nf,
        invoice_date = coalesce(nullif(p_dados->>'invoice_date','')::date, invoice_date)
       where id = e.expiry_tracking_id;
    end if;

    select coalesce(jsonb_object_agg(k, jsonb_build_object('antes', v_antes->k, 'depois', v_depois->k)), '{}'::jsonb)
      into v_diff
      from jsonb_object_keys(v_depois) k
     where v_antes->k is distinct from v_depois->k;

    insert into public.almox_item_edicoes (item_id, item_nome, item_codigo, usuario_id, usuario_nome, usuario_perfil, motivo, alteracoes, entrada)
    select e.item_id, w.name, w.code, v_uid, v_user.full_name, v_user.role,
           'Entrada de ' || to_char(e.created_at at time zone 'America/Bahia', 'DD/MM/YYYY') || ' completada' || coalesce(': ' || nullif(btrim(p_motivo), ''), ''),
           jsonb_build_object('entrada_completada', v_diff),
           jsonb_build_object('entrada_id', e.id, 'quantidade', e.quantity)
      from public.warehouse_items w where w.id = e.item_id;

    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'Entrada nao encontrada.'; end if;
  return jsonb_build_object('entradas', v_n);
end $function$;

create or replace function public.farmacia_completar_entrada(
  p_entry_ids uuid[], p_dados jsonb, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  e public.stock_entries%rowtype;
  v_permitidos text[] := array['invoice_number','invoice_date','delivery_date','afm_number',
                               'supplier_name','supplier_cnpj','unit_price'];
  v_k text;
  v_nf text;
  v_outra jsonb;
  v_antes jsonb; v_depois jsonb;
  v_n integer := 0;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  if not public.fn_farmacia_opera_entradas() then raise exception 'Sem permissao para completar entradas da farmacia.'; end if;
  -- Motivo opcional desde 22/09/2026 (edicao nao exige justificativa). Vai
  -- pro historico da entrada como observacao.
  perform set_config('app.entrada_obs', coalesce(p_motivo, ''), true);
  if p_entry_ids is null or array_length(p_entry_ids, 1) is null then raise exception 'Nenhuma entrada selecionada.'; end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then raise exception 'Dados invalidos.'; end if;
  for v_k in select jsonb_object_keys(p_dados) loop
    if not (v_k = any (v_permitidos) or v_k = 'confirmar') then
      raise exception 'Campo nao pode ser alterado por aqui: %. Quantidade, lote e item nao mudam — se estiverem errados, anule a entrada e lance de novo.', v_k;
    end if;
  end loop;

  v_nf := nullif(btrim(coalesce(p_dados->>'invoice_number','')), '');
  if v_nf in ('—','-','SN','S/N') then v_nf := null; end if;

  for e in select * from public.stock_entries where id = any (p_entry_ids) for update
  loop
    if e.item_type <> 'pharmacy' then raise exception 'Entrada de material: use a tela do almoxarifado.'; end if;
    if e.anulada_em is not null then raise exception 'Entrada ja anulada nao pode ser completada.'; end if;

    if v_nf is not null and not coalesce((p_dados->>'confirmar')::boolean, false) then
      v_outra := null;
      select jsonb_build_object('entrada_id', o.id, 'data', o.created_at, 'quantidade', o.quantity, 'nf', o.invoice_number)
        into v_outra
        from public.stock_entries o
       where o.item_type = 'pharmacy' and o.item_id = e.item_id and o.anulada_em is null
         and o.id <> all (p_entry_ids) and btrim(o.invoice_number) = v_nf
       limit 1;
      if v_outra is not null then
        raise exception 'NF_JA_USADA:%', v_outra::text;
      end if;
    end if;

    v_antes := to_jsonb(e);

    update public.stock_entries s set
      invoice_number = case when p_dados ? 'invoice_number' then v_nf else s.invoice_number end,
      invoice_date   = case when p_dados ? 'invoice_date' then coalesce(nullif(p_dados->>'invoice_date','')::date, s.invoice_date) else s.invoice_date end,
      delivery_date  = case when p_dados ? 'delivery_date' then nullif(p_dados->>'delivery_date','')::date else s.delivery_date end,
      afm_number     = case when p_dados ? 'afm_number' then coalesce(nullif(btrim(p_dados->>'afm_number'),''), 'N/I') else s.afm_number end,
      supplier_name  = case when p_dados ? 'supplier_name' then coalesce(nullif(btrim(p_dados->>'supplier_name'),''), s.supplier_name) else s.supplier_name end,
      supplier_cnpj  = case when p_dados ? 'supplier_cnpj' then coalesce(nullif(btrim(p_dados->>'supplier_cnpj'),''), s.supplier_cnpj) else s.supplier_cnpj end,
      unit_price     = case when p_dados ? 'unit_price' then coalesce(nullif(p_dados->>'unit_price','')::numeric, s.unit_price) else s.unit_price end,
      invoice_total_value = case when p_dados ? 'unit_price' and nullif(p_dados->>'unit_price','') is not null
                                 then round(s.quantity * (p_dados->>'unit_price')::numeric, 2) else s.invoice_total_value end,
      nf_pendente    = case when p_dados ? 'invoice_number' then (v_nf is null) else s.nf_pendente end,
      completada_em  = now(),
      completada_por = v_uid
     where s.id = e.id
    returning to_jsonb(s) into v_depois;

    if e.expiry_tracking_id is not null and p_dados ? 'invoice_number' then
      update public.expiry_tracking set invoice_number = v_nf,
        invoice_date = coalesce(nullif(p_dados->>'invoice_date','')::date, invoice_date)
       where id = e.expiry_tracking_id;
    end if;

    insert into public.audit_logs (table_name, record_id, user_id, action, entity_type, entity_id, old_data, new_data)
    values ('stock_entries', e.id, v_uid, 'COMPLETAR_ENTRADA', 'pharmacy', e.item_id,
            v_antes, v_depois || jsonb_build_object('motivo', nullif(btrim(coalesce(p_motivo,'')), '')));

    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'Entrada nao encontrada.'; end if;
  return jsonb_build_object('entradas', v_n);
end $function$;

-- 3) Editar entrada de MATERIAL -------------------------------------------------------
-- p_dados: quantity, batch_number, expiry_date, unit_price, invoice_number,
--          invoice_date, delivery_date, afm_number, supplier_name,
--          supplier_cnpj, confirmar (bool — segue mesmo com NF ja usada)
create or replace function public.almox_editar_entrada(p_entry_id uuid, p_dados jsonb, p_obs text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_user public.users%rowtype;
  e public.stock_entries%rowtype;
  v_permitidos text[] := array['quantity','batch_number','expiry_date','unit_price','invoice_number','invoice_date',
                               'delivery_date','afm_number','supplier_name','supplier_cnpj','confirmar'];
  v_k text;
  v_almox uuid;
  v_nome text; v_codigo text;
  v_qtd integer; v_delta integer;
  v_lote text; v_val date; v_preco numeric; v_nf text;
  v_mudou_lote boolean;
  v_saldo numeric;
  v_lote_novo uuid;
  v_outra jsonb;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  if not public.fn_almox_opera_entradas() then raise exception 'Sem permissao para editar entradas.'; end if;
  select * into v_user from public.users where id = v_uid;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then raise exception 'Dados invalidos.'; end if;
  for v_k in select jsonb_object_keys(p_dados) loop
    if not (v_k = any (v_permitidos)) then raise exception 'Campo nao pode ser editado: %', v_k; end if;
  end loop;

  select * into e from public.stock_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entrada nao encontrada.'; end if;
  if e.item_type <> 'warehouse' then raise exception 'Entrada de farmacia: use a tela da farmacia.'; end if;
  if e.anulada_em is not null then raise exception 'Entrada anulada nao pode ser editada.'; end if;
  select name, code into v_nome, v_codigo from public.warehouse_items where id = e.item_id;
  select id into v_almox from public.stock_locations where code = 'ALMOX';

  v_qtd   := case when p_dados ? 'quantity' then (p_dados->>'quantity')::integer else e.quantity end;
  if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade deve ser maior que zero. Para desfazer a entrada, use Excluir.'; end if;
  v_delta := v_qtd - e.quantity;
  v_lote  := case when p_dados ? 'batch_number' then nullif(btrim(coalesce(p_dados->>'batch_number','')), '') else e.batch_number end;
  v_val   := case when p_dados ? 'expiry_date' then nullif(p_dados->>'expiry_date','')::date else e.expiry_date end;
  v_preco := case when p_dados ? 'unit_price' then coalesce(nullif(p_dados->>'unit_price','')::numeric, 0) else e.unit_price end;
  v_nf    := case when p_dados ? 'invoice_number' then nullif(btrim(coalesce(p_dados->>'invoice_number','')), '') else e.invoice_number end;
  if v_nf in ('—','-','SN','S/N') then v_nf := null; end if;
  v_mudou_lote := upper(coalesce(v_lote, '')) <> upper(coalesce(e.batch_number, ''));

  if (v_delta <> 0 or v_mudou_lote) and e.location_id is null then
    raise exception 'A entrada de "%" e antiga e nao registrou o estoque onde entrou: quantidade e lote nao podem ser editados aqui. Acerte pelo ajuste de estoque, com contagem.', v_nome;
  end if;

  -- NF que ja esta em outra entrada do mesmo item (caso da mascara)
  if p_dados ? 'invoice_number' and v_nf is not null and v_nf is distinct from nullif(btrim(e.invoice_number),'')
     and not coalesce((p_dados->>'confirmar')::boolean, false) then
    select jsonb_build_object('entrada_id', o.id, 'data', o.created_at, 'quantidade', o.quantity, 'nf', o.invoice_number)
      into v_outra from public.stock_entries o
     where o.item_type = 'warehouse' and o.item_id = e.item_id and o.anulada_em is null
       and o.id <> e.id and btrim(o.invoice_number) = v_nf limit 1;
    if v_outra is not null then raise exception 'NF_JA_USADA:%', v_outra::text; end if;
  end if;

  -- Saldo do local pela diferenca
  if v_delta <> 0 then
    if e.location_id = v_almox then
      select current_stock into v_saldo from public.warehouse_items where id = e.item_id for update;
      if coalesce(v_saldo, 0) + v_delta < 0 then
        raise exception 'Nao da para reduzir a entrada de "%" em %: o saldo atual e % — parte ja saiu. Acerte pelo ajuste de estoque, com contagem.', v_nome, -v_delta, coalesce(v_saldo,0);
      end if;
      update public.warehouse_items set current_stock = current_stock + v_delta, updated_at = now() where id = e.item_id;
    else
      select quantity into v_saldo from public.item_stocks
       where item_id = e.item_id and item_type = 'warehouse' and location_id = e.location_id for update;
      if coalesce(v_saldo, 0) + v_delta < 0 then
        raise exception 'Nao da para reduzir a entrada de "%" em %: o saldo do local e % — parte ja saiu. Acerte pelo ajuste de estoque, com contagem.', v_nome, -v_delta, coalesce(v_saldo,0);
      end if;
      update public.item_stocks set quantity = quantity + v_delta, updated_at = now()
       where item_id = e.item_id and item_type = 'warehouse' and location_id = e.location_id;
    end if;
  end if;

  -- Lote (so quando a entrada tem lote registrado)
  v_lote_novo := e.expiry_tracking_id;
  if e.expiry_tracking_id is not null then
    if v_mudou_lote then
      update public.expiry_tracking
         set current_quantity = coalesce(current_quantity,0) - e.quantity,
             initial_quantity = greatest(coalesce(initial_quantity,0) - e.quantity, 0)
       where id = e.expiry_tracking_id;
      v_lote_novo := null;
      if v_lote is not null then
        select id into v_lote_novo from public.expiry_tracking
         where item_id = e.item_id and location_id = e.location_id and upper(btrim(batch_number)) = upper(btrim(v_lote))
         order by created_at limit 1;
        if v_lote_novo is null then
          insert into public.expiry_tracking(item_id, location_id, batch_number, expiry_date, initial_quantity, current_quantity, created_by)
          values (e.item_id, e.location_id, v_lote, v_val, v_qtd, v_qtd, v_uid)
          returning id into v_lote_novo;
        else
          update public.expiry_tracking
             set current_quantity = coalesce(current_quantity,0) + v_qtd,
                 initial_quantity = coalesce(initial_quantity,0) + v_qtd,
                 expiry_date = coalesce(v_val, expiry_date)
           where id = v_lote_novo;
        end if;
      end if;
    else
      update public.expiry_tracking
         set current_quantity = coalesce(current_quantity,0) + v_delta,
             initial_quantity = greatest(coalesce(initial_quantity,0) + v_delta, 0),
             expiry_date = case when p_dados ? 'expiry_date' then v_val else expiry_date end
       where id = e.expiry_tracking_id;
    end if;
  end if;

  perform set_config('app.entrada_obs', coalesce(p_obs, ''), true);
  update public.stock_entries s set
    quantity = v_qtd,
    batch_number = v_lote,
    expiry_date = v_val,
    expiry_tracking_id = v_lote_novo,
    unit_price = v_preco,
    invoice_total_value = round(v_qtd * coalesce(v_preco, 0), 2),
    invoice_number = case when p_dados ? 'invoice_number' then coalesce(v_nf, '—') else s.invoice_number end,
    invoice_date   = case when p_dados ? 'invoice_date' then coalesce(nullif(p_dados->>'invoice_date','')::date, s.invoice_date) else s.invoice_date end,
    delivery_date  = case when p_dados ? 'delivery_date' then nullif(p_dados->>'delivery_date','')::date else s.delivery_date end,
    afm_number     = case when p_dados ? 'afm_number' then coalesce(nullif(btrim(p_dados->>'afm_number'),''), '—') else s.afm_number end,
    supplier_name  = case when p_dados ? 'supplier_name' then coalesce(nullif(btrim(p_dados->>'supplier_name'),''), s.supplier_name) else s.supplier_name end,
    supplier_cnpj  = case when p_dados ? 'supplier_cnpj' then coalesce(nullif(btrim(p_dados->>'supplier_cnpj'),''), s.supplier_cnpj) else s.supplier_cnpj end,
    nf_pendente    = (s.acquisition_type = 'Compra' and coalesce(case when p_dados ? 'invoice_number' then v_nf else nullif(btrim(s.invoice_number),'') end, '—') in ('—','-','SN','S/N')),
    completada_em  = now(),
    completada_por = v_uid
   where s.id = e.id;
  perform set_config('app.entrada_obs', '', true);

  -- Tambem no historico do ITEM (o que aparece na edicao do item).
  insert into public.almox_item_edicoes (item_id, item_nome, item_codigo, usuario_id, usuario_nome, usuario_perfil, motivo, alteracoes, entrada)
  values (e.item_id, v_nome, v_codigo, v_uid, v_user.full_name, v_user.role,
    'Entrada de ' || to_char(e.created_at at time zone 'America/Bahia', 'DD/MM/YYYY') || ' editada' || coalesce(': ' || nullif(btrim(p_obs), ''), ''),
    jsonb_build_object('entrada_editada', jsonb_build_object('quantidade', jsonb_build_object('antes', e.quantity, 'depois', v_qtd),
                                                           'lote', jsonb_build_object('antes', e.batch_number, 'depois', v_lote))),
    jsonb_build_object('entrada_id', e.id, 'diferenca', v_delta));

  return jsonb_build_object('diferenca', v_delta, 'quantidade', v_qtd);
end $function$;
revoke execute on function public.almox_editar_entrada(uuid, jsonb, text) from public, anon;
grant execute on function public.almox_editar_entrada(uuid, jsonb, text) to authenticated;

-- 4) Editar entrada da FARMACIA (ajustes pelo livro-razao) ---------------------------
create or replace function public.farmacia_editar_entrada(p_entry_id uuid, p_dados jsonb, p_obs text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  e public.stock_entries%rowtype;
  v_permitidos text[] := array['quantity','batch_number','expiry_date','unit_price','invoice_number','invoice_date',
                               'delivery_date','afm_number','supplier_name','supplier_cnpj','confirmar'];
  v_k text;
  v_nome text;
  v_qtd integer; v_delta integer;
  v_lote text; v_val date; v_preco numeric; v_nf text;
  v_mudou_lote boolean;
  v_saldo numeric;
  v_lote_novo uuid;
  v_outra jsonb;
  v_nota text;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  if not public.fn_farmacia_opera_entradas() then raise exception 'Sem permissao para editar entradas da farmacia.'; end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then raise exception 'Dados invalidos.'; end if;
  for v_k in select jsonb_object_keys(p_dados) loop
    if not (v_k = any (v_permitidos)) then raise exception 'Campo nao pode ser editado: %', v_k; end if;
  end loop;

  select * into e from public.stock_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entrada nao encontrada.'; end if;
  if e.item_type <> 'pharmacy' then raise exception 'Entrada de material: use a tela do almoxarifado.'; end if;
  if e.anulada_em is not null then raise exception 'Entrada anulada nao pode ser editada.'; end if;
  select name into v_nome from public.pharmacy_items where id = e.item_id;

  v_qtd   := case when p_dados ? 'quantity' then (p_dados->>'quantity')::integer else e.quantity end;
  if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade deve ser maior que zero. Para desfazer a entrada, use Excluir.'; end if;
  v_delta := v_qtd - e.quantity;
  -- Lote da farmacia e sempre em maiuscula e sem espaco (fn_normaliza_lote_farmacia).
  v_lote  := case when p_dados ? 'batch_number'
                  then nullif(regexp_replace(upper(btrim(coalesce(p_dados->>'batch_number',''))), '\s+', '', 'g'), '')
                  else e.batch_number end;
  v_val   := case when p_dados ? 'expiry_date' then nullif(p_dados->>'expiry_date','')::date else e.expiry_date end;
  v_preco := case when p_dados ? 'unit_price' then coalesce(nullif(p_dados->>'unit_price','')::numeric, 0) else e.unit_price end;
  v_nf    := case when p_dados ? 'invoice_number' then nullif(btrim(coalesce(p_dados->>'invoice_number','')), '') else e.invoice_number end;
  if v_nf in ('—','-','SN','S/N') then v_nf := null; end if;
  v_mudou_lote := upper(coalesce(v_lote, '')) <> upper(coalesce(e.batch_number, ''));

  if (v_delta <> 0 or v_mudou_lote) and e.location_id is null then
    raise exception 'A entrada de "%" nao registrou o estoque onde entrou: quantidade e lote nao podem ser editados aqui. Acerte pelo ajuste de estoque, com contagem.', v_nome;
  end if;
  if v_mudou_lote and v_lote is null then
    raise exception 'Medicamento precisa de lote. Informe o lote correto.';
  end if;

  if p_dados ? 'invoice_number' and v_nf is not null and v_nf is distinct from nullif(btrim(e.invoice_number),'')
     and not coalesce((p_dados->>'confirmar')::boolean, false) then
    select jsonb_build_object('entrada_id', o.id, 'data', o.created_at, 'quantidade', o.quantity, 'nf', o.invoice_number)
      into v_outra from public.stock_entries o
     where o.item_type = 'pharmacy' and o.item_id = e.item_id and o.anulada_em is null
       and o.id <> e.id and btrim(o.invoice_number) = v_nf limit 1;
    if v_outra is not null then raise exception 'NF_JA_USADA:%', v_outra::text; end if;
  end if;

  v_nota := 'Edicao da entrada de ' || to_char(e.created_at at time zone 'America/Bahia', 'DD/MM/YYYY HH24:MI')
            || coalesce(' NF ' || nullif(btrim(e.invoice_number), ''), '') || coalesce(': ' || nullif(btrim(p_obs), ''), '');

  if v_delta <> 0 or v_mudou_lote then
    select quantity into v_saldo from public.item_stocks
     where item_id = e.item_id and item_type = 'pharmacy' and location_id = e.location_id for update;
    if coalesce(v_saldo, 0) + v_delta < 0 then
      raise exception 'Nao da para reduzir a entrada de "%" em %: o saldo do estoque e % — parte ja saiu. Acerte pelo ajuste de estoque, com contagem.', v_nome, -v_delta, coalesce(v_saldo,0);
    end if;
  end if;

  v_lote_novo := e.expiry_tracking_id;
  if v_mudou_lote then
    -- Troca de lote: SAIDA do lote antigo (quantidade antiga) + ENTRADA no novo
    -- (quantidade nova), no livro. O saldo do estoque muda so pela diferenca.
    insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity, unit_cost,
      source_location_id, expiry_tracking_id, performed_by, notes)
    values (e.item_id, 'pharmacy', 'AJUSTE', 'out', e.quantity, e.unit_price, e.location_id, e.expiry_tracking_id, v_uid,
      v_nota || ' (lote ' || coalesce(e.batch_number, 's/n') || ' -> ' || v_lote || ')');
    if e.expiry_tracking_id is not null then
      update public.expiry_tracking
         set current_quantity = coalesce(current_quantity,0) - e.quantity,
             initial_quantity = greatest(coalesce(initial_quantity,0) - e.quantity, 0)
       where id = e.expiry_tracking_id;
    end if;
    select id into v_lote_novo from public.expiry_tracking
     where item_id = e.item_id and location_id = e.location_id and upper(btrim(batch_number)) = v_lote
     order by created_at limit 1;
    if v_lote_novo is null then
      insert into public.expiry_tracking(item_id, location_id, batch_number, expiry_date, initial_quantity, current_quantity, created_by)
      values (e.item_id, e.location_id, v_lote, v_val, v_qtd, v_qtd, v_uid)
      returning id into v_lote_novo;
    else
      update public.expiry_tracking
         set current_quantity = coalesce(current_quantity,0) + v_qtd,
             initial_quantity = coalesce(initial_quantity,0) + v_qtd,
             expiry_date = coalesce(v_val, expiry_date)
       where id = v_lote_novo;
    end if;
    insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity, unit_cost,
      target_location_id, expiry_tracking_id, performed_by, notes)
    values (e.item_id, 'pharmacy', 'AJUSTE', 'in', v_qtd, v_preco, e.location_id, v_lote_novo, v_uid,
      v_nota || ' (lote ' || coalesce(e.batch_number, 's/n') || ' -> ' || v_lote || ')');
  elsif v_delta <> 0 then
    insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity, unit_cost,
      source_location_id, target_location_id, expiry_tracking_id, performed_by, notes)
    values (e.item_id, 'pharmacy', 'AJUSTE', case when v_delta > 0 then 'in' else 'out' end, abs(v_delta), v_preco,
      case when v_delta < 0 then e.location_id end, case when v_delta > 0 then e.location_id end,
      e.expiry_tracking_id, v_uid, v_nota || ' (quantidade ' || e.quantity || ' -> ' || v_qtd || ')');
    if e.expiry_tracking_id is not null then
      update public.expiry_tracking
         set current_quantity = coalesce(current_quantity,0) + v_delta,
             initial_quantity = greatest(coalesce(initial_quantity,0) + v_delta, 0)
       where id = e.expiry_tracking_id;
    end if;
  end if;

  if p_dados ? 'expiry_date' and v_lote_novo is not null then
    update public.expiry_tracking set expiry_date = v_val where id = v_lote_novo;
  end if;

  perform set_config('app.entrada_obs', coalesce(p_obs, ''), true);
  update public.stock_entries s set
    quantity = v_qtd,
    batch_number = v_lote,
    expiry_date = v_val,
    expiry_tracking_id = v_lote_novo,
    unit_price = v_preco,
    invoice_total_value = round(v_qtd * coalesce(v_preco, 0), 2),
    invoice_number = case when p_dados ? 'invoice_number' then v_nf else s.invoice_number end,
    invoice_date   = case when p_dados ? 'invoice_date' then coalesce(nullif(p_dados->>'invoice_date','')::date, s.invoice_date) else s.invoice_date end,
    delivery_date  = case when p_dados ? 'delivery_date' then nullif(p_dados->>'delivery_date','')::date else s.delivery_date end,
    afm_number     = case when p_dados ? 'afm_number' then coalesce(nullif(btrim(p_dados->>'afm_number'),''), 'N/I') else s.afm_number end,
    supplier_name  = case when p_dados ? 'supplier_name' then coalesce(nullif(btrim(p_dados->>'supplier_name'),''), s.supplier_name) else s.supplier_name end,
    supplier_cnpj  = case when p_dados ? 'supplier_cnpj' then coalesce(nullif(btrim(p_dados->>'supplier_cnpj'),''), s.supplier_cnpj) else s.supplier_cnpj end,
    nf_pendente    = (s.acquisition_type = 'Compra' and coalesce(case when p_dados ? 'invoice_number' then v_nf else nullif(btrim(s.invoice_number),'') end, '—') in ('—','-','SN','S/N')),
    completada_em  = now(),
    completada_por = v_uid
   where s.id = e.id;
  perform set_config('app.entrada_obs', '', true);

  insert into public.audit_logs (table_name, record_id, user_id, action, entity_type, entity_id, old_data, new_data)
  values ('stock_entries', e.id, v_uid, 'EDITAR_ENTRADA', 'pharmacy', e.item_id, to_jsonb(e),
          jsonb_build_object('quantidade', v_qtd, 'lote', v_lote, 'validade', v_val, 'obs', p_obs));

  return jsonb_build_object('diferenca', v_delta, 'quantidade', v_qtd);
end $function$;
revoke execute on function public.farmacia_editar_entrada(uuid, jsonb, text) from public, anon;
grant execute on function public.farmacia_editar_entrada(uuid, jsonb, text) to authenticated;
