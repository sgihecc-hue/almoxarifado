-- ALMOXARIFADO: entradas seguras — rodada unica, completar NF, anular entrada,
-- aviso de entrada parecida e trava contra duplo clique.
--
-- ORIGEM (21/09/2026): mascara cirurgica com 10.650 no sistema e ~650 na
-- prateleira. A compra da NF 30641 (10.000 un) chegou antes da nota, foi
-- lancada sem NF em 18/08 e, quando a nota chegou (28/08), a unica tela com
-- campo de NF — "Registrar nova entrada", na edicao do item — criou uma
-- SEGUNDA entrada e somou de novo. O sistema nao tinha como completar uma
-- entrada existente. Na farmacia, a NF 1599 foi gravada duas vezes com 1s de
-- diferenca (duplo clique). A varredura achou outros suspeitos.
--
-- O QUE ESTA MIGRATION FAZ (so material / item_type='warehouse'):
--   1. stock_entries ganha: entry_group_id (rodada), location_id,
--      expiry_tracking_id, nf_pendente, anulada_* e completada_*.
--   2. entrada_rodadas: a mesma rodada nao e aceita duas vezes (idempotencia).
--   3. fn_almox_entrada_parecida: mesmo item com mesmo lote+quantidade, ou
--      mesma NF, nos ultimos 30 dias -> a gravacao pede confirmacao.
--   4. registrar_entrada_nf e almox_editar_item: gravam a rodada, o local, o
--      lote, marcam NF pendente e fazem as duas checagens acima. Corpos
--      gerados a partir de producao; so as adicoes mudam.
--   5. almox_completar_entrada: completa/corrige NF, fornecedor, datas e preco
--      NA MESMA entrada (mesmo id), sem mexer na quantidade.
--   6. almox_anular_entrada: desfaz uma entrada lancada por engano (devolve o
--      saldo do local e do lote), com motivo; a linha fica marcada, nunca apagada.
--   7. Entradas antigas: rodada, local e lote preenchidos quando da pra ter
--      certeza; compra sem NF vira "NF pendente".
--
-- FARMACIA: nada aqui a altera. registrar_entrada_nf tem um ramo 'pharmacy'
-- que nenhuma tela usa mais (a farmacia grava por registrar_entrada_farmacia);
-- esse ramo segue identico e sem as checagens novas. As colunas novas de
-- stock_entries ficam nulas/false nas linhas da farmacia.

-- 1) Colunas novas -------------------------------------------------------------
alter table public.stock_entries
  add column if not exists entry_group_id uuid,
  add column if not exists location_id uuid references public.stock_locations(id),
  add column if not exists expiry_tracking_id uuid references public.expiry_tracking(id),
  add column if not exists nf_pendente boolean not null default false,
  add column if not exists anulada_em timestamptz,
  add column if not exists anulada_por uuid references public.users(id),
  add column if not exists anulada_motivo text,
  add column if not exists completada_em timestamptz,
  add column if not exists completada_por uuid references public.users(id);
create index if not exists stock_entries_group on public.stock_entries (entry_group_id);
create index if not exists stock_entries_item_data on public.stock_entries (item_id, created_at desc);

-- 2) Rodadas (idempotencia) ------------------------------------------------------
create table if not exists public.entrada_rodadas (
  id uuid primary key,
  item_type text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.entrada_rodadas enable row level security;
-- sem politicas: so as funcoes security definer escrevem.

-- 3) Quem opera entradas de material ---------------------------------------------
-- Atendente tambem pode completar e anular (decisao do Adonias, 21/09/2026).
create or replace function public.fn_almox_opera_entradas()
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select exists (
    select 1 from public.users u
     where u.id = auth.uid() and coalesce(u.is_active, true)
       and (u.role in ('administrador','admin','gestor','manager','atendente','warehouse_manager')
            or exists (select 1 from public.almox_permissoes_edicao p where p.user_id = u.id))
  )
$$;
revoke execute on function public.fn_almox_opera_entradas() from public, anon;
grant execute on function public.fn_almox_opera_entradas() to authenticated;

-- 4) Entrada parecida ----------------------------------------------------------------
-- Parecida = mesmo item, nao anulada, nos ultimos 30 dias, e
--   (mesmo LOTE preenchido + mesma quantidade)  ou  (mesma NF valida).
-- So lote preenchido conta: duas entradas de 100 luvas sem lote sao comuns.
create or replace function public.fn_almox_entrada_parecida(
  p_item uuid, p_qty integer, p_batch text, p_nf text, p_excluir_grupo uuid)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select jsonb_build_object(
           'entrada_id', e.id, 'data', e.created_at, 'quantidade', e.quantity,
           'nf', e.invoice_number, 'lote', e.batch_number,
           'por', (select full_name from public.users where id = e.created_by),
           'motivo', case
             when nullif(btrim(coalesce(p_nf,'')),'') is not null
                  and btrim(p_nf) not in ('—','-','SN','S/N')
                  and btrim(e.invoice_number) = btrim(p_nf) then 'mesma_nf'
             else 'mesmo_lote_quantidade' end)
    from public.stock_entries e
   where e.item_type = 'warehouse'
     and e.item_id = p_item
     and e.anulada_em is null
     and e.created_at > now() - interval '30 days'
     and (p_excluir_grupo is null or e.entry_group_id is distinct from p_excluir_grupo)
     and (
       (nullif(btrim(coalesce(p_batch,'')),'') is not null
         and upper(btrim(e.batch_number)) = upper(btrim(p_batch))
         and e.quantity = p_qty)
       or (nullif(btrim(coalesce(p_nf,'')),'') is not null
         and btrim(p_nf) not in ('—','-','SN','S/N')
         and btrim(e.invoice_number) = btrim(p_nf))
     )
   order by e.created_at desc
   limit 1
$$;
revoke execute on function public.fn_almox_entrada_parecida(uuid, integer, text, text, uuid) from public, anon;
grant execute on function public.fn_almox_entrada_parecida(uuid, integer, text, text, uuid) to authenticated;

-- 5) registrar_entrada_nf (Nova Entrada do almox e entrada por leitor) -----------------
-- Parametros novos no fim, com default: chamadas antigas continuam valendo.
-- DROP antes do CREATE: sem isso ficariam duas versoes e o PostgREST nao
-- saberia qual chamar (ja aconteceu — ver 20260819120000).
drop function if exists public.registrar_entrada_nf(text, text, date, text, text, text, jsonb, text, text, date);
create function public.registrar_entrada_nf(
  p_item_type text, p_invoice_number text, p_invoice_date date, p_afm_number text,
  p_supplier_cnpj text, p_supplier_name text, p_items jsonb,
  p_acquisition_type text default 'Compra', p_location_code text default null,
  p_delivery_date date default null,
  p_entry_group_id uuid default null,
  p_confirmar_parecida boolean default false,
  p_nf_pendente boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$

declare
  v_uid uuid := auth.uid();
  v_role text; v_code text; v_loc uuid;
  it jsonb; v_item uuid; v_qty integer; v_price numeric; v_batch text; v_exp date; v_lot uuid;
  v_line_total numeric; v_count integer := 0; v_total_qty integer := 0; v_total_val numeric := 0;
  v_afm text := coalesce(nullif(btrim(coalesce(p_afm_number,'')),''), 'N/I');
  v_cnpj text := coalesce(nullif(btrim(coalesce(p_supplier_cnpj,'')),''), '00.000.000/0000-00');
  v_supp text := coalesce(nullif(btrim(coalesce(p_supplier_name,'')),''), 'Nao informado');
  v_inv text := nullif(btrim(coalesce(p_invoice_number,'')),'');
  v_invdate date := coalesce(p_invoice_date, current_date);
  v_delivdate date := p_delivery_date;  -- pode ser null
  -- Rodada: id unico da entrada inteira (todas as linhas). Vem da tela; o
  -- banco recusa a mesma rodada duas vezes (duplo clique / reenvio).
  v_group uuid := coalesce(p_entry_group_id, gen_random_uuid());
  v_parecida jsonb;
  v_pend boolean;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  if p_item_type not in ('pharmacy','warehouse') then raise exception 'item_type invalido: %', p_item_type; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Entrada sem itens.'; end if;

  select role into v_role from public.users where id = v_uid;
  if coalesce(v_role,'') not in ('administrador','gestor','atendente','admin','manager','pharmacist','warehouse_manager') then
    raise exception 'Sem permissao para registrar entrada.';
  end if;

  v_code := coalesce(nullif(btrim(coalesce(p_location_code,'')),''),
                     case when p_item_type='pharmacy' then 'CAF' else 'ALMOX' end);
  select id into v_loc from public.stock_locations where code = v_code;
  if v_loc is null then raise exception 'Local % nao encontrado.', v_code; end if;

  if p_entry_group_id is not null then
    begin
      insert into public.entrada_rodadas(id, item_type, created_by) values (p_entry_group_id, p_item_type, v_uid);
    exception when unique_violation then
      raise exception 'ENTRADA_JA_REGISTRADA: esta entrada ja foi gravada (clique duplo ou reenvio). Nada foi somado de novo.';
    end;
  end if;
  -- Compra sem NF entra marcada como NF pendente: a nota e completada depois
  -- na MESMA entrada, em vez de lancar outra (causa da duplicidade da mascara).
  v_pend := coalesce(p_nf_pendente, false)
    or (coalesce(p_acquisition_type,'Compra') = 'Compra' and coalesce(v_inv,'—') in ('—','-','SN','S/N'));

  for it in select value from jsonb_array_elements(p_items)
  loop
    v_item  := (it->>'item_id')::uuid;
    v_qty   := (it->>'quantity')::integer;
    v_price := coalesce((it->>'unit_price')::numeric, 0);
    v_batch := nullif(btrim(coalesce(it->>'batch_number','')),'');
    v_exp   := nullif(it->>'expiry_date','')::date;
    if v_item is null then raise exception 'Linha sem item.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade invalida em uma das linhas.'; end if;
    v_line_total := round(v_qty * v_price, 2);

    -- Material: avisa entrada parecida (mesmo lote e quantidade, ou mesma NF,
    -- nos ultimos 30 dias). A tela mostra e so grava se a pessoa confirmar.
    if p_item_type = 'warehouse' and not coalesce(p_confirmar_parecida, false) then
      v_parecida := public.fn_almox_entrada_parecida(v_item, v_qty, v_batch, v_inv, v_group);
      if v_parecida is not null then
        raise exception 'ENTRADA_PARECIDA:%', v_parecida::text;
      end if;
    end if;

    v_lot := null;
    if v_batch is not null then
      select id into v_lot from public.expiry_tracking
       where item_id = v_item and batch_number = v_batch and location_id = v_loc limit 1;
      if v_lot is null then
        insert into public.expiry_tracking(item_id, batch_number, expiry_date, initial_quantity,
          current_quantity, created_by, invoice_number, invoice_date, afm_number, supplier_cnpj,
          supplier_name, invoice_total_value, location_id)
        values (v_item, v_batch, v_exp, v_qty, v_qty, v_uid, v_inv, v_invdate, v_afm, v_cnpj,
          v_supp, v_line_total, v_loc)
        returning id into v_lot;
      else
        update public.expiry_tracking
           set current_quantity = current_quantity + v_qty,
               initial_quantity = initial_quantity + v_qty,
               expiry_date = coalesce(expiry_date, v_exp)
         where id = v_lot;
      end if;
    end if;

    if p_item_type = 'pharmacy' then
      insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity, unit_cost,
        target_location_id, expiry_tracking_id, performed_by, notes)
      values (v_item, 'pharmacy', 'ENTRADA_NF', 'in', v_qty, v_price, v_loc, v_lot, v_uid,
        'Entrada (' || coalesce(p_acquisition_type,'Compra') || ')' || coalesce(' NF ' || v_inv, ''));
    elsif v_code = 'ALMOX' then
      -- Almoxarifado: saldo global, como sempre foi.
      update public.warehouse_items set current_stock = current_stock + v_qty, updated_at = now() where id = v_item;
    else
      -- Satelite de material (SAT_T): o saldo e POR LOCAL. Antes caia no ramo
      -- acima e somava no total global — o numero do almoxarifado — enquanto a
      -- tela do satelite, que le item_stocks, seguia mostrando o saldo antigo.
      insert into public.item_stocks(item_id, item_type, location_id, quantity)
      values (v_item, 'warehouse', v_loc, v_qty)
      on conflict (item_id, item_type, location_id)
      do update set quantity = public.item_stocks.quantity + excluded.quantity,
                    updated_at = now();
    end if;

    insert into public.stock_entries(item_id, item_type, quantity, acquisition_type, invoice_number, invoice_date,
      invoice_total_value, expiry_date, afm_number, supplier_cnpj, supplier_name, unit_price, batch_number,
      delivery_date, created_by, entry_group_id, location_id, expiry_tracking_id, nf_pendente)
    values (v_item, p_item_type, v_qty, coalesce(p_acquisition_type,'Compra'), v_inv, v_invdate,
      v_line_total, v_exp, v_afm, v_cnpj, v_supp, v_price, v_batch, v_delivdate, v_uid,
      v_group, v_loc, v_lot, v_pend);

    v_count := v_count + 1; v_total_qty := v_total_qty + v_qty; v_total_val := v_total_val + v_line_total;
  end loop;

  return jsonb_build_object('itens', v_count, 'quantidade_total', v_total_qty, 'valor_total', v_total_val, 'local', v_code, 'rodada', v_group);
end $function$;
grant execute on function public.registrar_entrada_nf(text, text, date, text, text, text, jsonb, text, text, date, uuid, boolean, boolean)
  to anon, authenticated, service_role;

-- 6) almox_editar_item (entrada pela edicao do item) — mesma assinatura ------------------
create or replace function public.almox_editar_item(
  p_item_id uuid, p_campos jsonb, p_motivo text, p_entrada jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid        uuid := auth.uid();
  v_user       public.users%rowtype;
  v_old        public.warehouse_items%rowtype;
  v_new        public.warehouse_items%rowtype;
  v_permitidos text[] := array['code','barcode','name','description','category','unit',
                               'min_stock','lead_time_days','avg_daily_consumption','current_stock',
                               'batch_number','expiry_date','last_purchase_price','reference_price'];
  v_k          text;
  v_diff       jsonb := '{}'::jsonb;
  v_qtd        int;
  v_id         uuid;
  v_group      uuid;
  v_parecida   jsonb;
  v_inv        text;
  v_batch      text;
  v_pend       boolean;
  v_almox      uuid;
begin
  if v_uid is null then
    raise exception 'Usuario nao autenticado.';
  end if;
  select * into v_user from public.users where id = v_uid;
  if not found or v_user.is_active is false then
    raise exception 'Usuario inativo ou inexistente.';
  end if;
  if not (v_user.role in ('administrador','admin','gestor')
          or exists (select 1 from public.almox_permissoes_edicao p where p.user_id = v_uid)) then
    raise exception 'Sem permissao para editar itens do almoxarifado.';
  end if;
  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Informe o motivo da alteracao (minimo 10 caracteres).';
  end if;
  if p_campos is null or jsonb_typeof(p_campos) <> 'object' then
    raise exception 'Campos invalidos.';
  end if;
  for v_k in select jsonb_object_keys(p_campos) loop
    if not (v_k = any (v_permitidos)) then
      raise exception 'Campo nao pode ser editado por aqui: %', v_k;
    end if;
  end loop;

  select * into v_old from public.warehouse_items where id = p_item_id for update;
  if not found then
    raise exception 'Item do almoxarifado nao encontrado.';
  end if;

  v_new := jsonb_populate_record(v_old, p_campos);
  if length(btrim(coalesce(v_new.name, ''))) < 3 then
    raise exception 'Nome deve ter no minimo 3 caracteres.';
  end if;
  if coalesce(v_new.current_stock, 0) < 0 then
    raise exception 'Estoque atual nao pode ser negativo.';
  end if;

  if p_entrada is not null then
    v_qtd := nullif(p_entrada->>'quantity', '')::int;
    if v_qtd is null or v_qtd <= 0 then
      raise exception 'Quantidade da entrada deve ser maior que zero.';
    end if;
    if coalesce(p_entrada->>'acquisition_type', '') = '' then
      raise exception 'Selecione o tipo de aquisicao da nova entrada.';
    end if;

    -- Rodada (idempotencia): o mesmo envio nao soma duas vezes.
    v_group := nullif(p_entrada->>'entry_group_id', '')::uuid;
    if v_group is not null then
      begin
        insert into public.entrada_rodadas(id, item_type, created_by) values (v_group, 'warehouse', v_uid);
      exception when unique_violation then
        raise exception 'ENTRADA_JA_REGISTRADA: esta entrada ja foi gravada (clique duplo ou reenvio). Nada foi somado de novo.';
      end;
    else
      v_group := gen_random_uuid();
    end if;

    v_inv := nullif(btrim(coalesce(p_entrada->>'invoice_number', '')), '');
    if v_inv in ('—','-','SN','S/N') then v_inv := null; end if;
    v_batch := nullif(btrim(coalesce(p_entrada->>'batch_number', '')), '');

    if not coalesce((p_entrada->>'confirmar_parecida')::boolean, false) then
      v_parecida := public.fn_almox_entrada_parecida(p_item_id, v_qtd, v_batch, v_inv, v_group);
      if v_parecida is not null then
        raise exception 'ENTRADA_PARECIDA:%', v_parecida::text;
      end if;
    end if;

    v_pend := coalesce((p_entrada->>'nf_pendente')::boolean, false)
      or (p_entrada->>'acquisition_type' = 'Compra' and v_inv is null);
    select id into v_almox from public.stock_locations where code = 'ALMOX';
    v_new.current_stock := coalesce(v_new.current_stock, 0) + v_qtd;
  end if;

  foreach v_k in array v_permitidos loop
    if to_jsonb(v_old)->v_k is distinct from to_jsonb(v_new)->v_k then
      v_diff := v_diff || jsonb_build_object(v_k,
        jsonb_build_object('antes', to_jsonb(v_old)->v_k, 'depois', to_jsonb(v_new)->v_k));
    end if;
  end loop;
  if v_diff = '{}'::jsonb then
    raise exception 'Nenhuma alteracao para salvar.';
  end if;

  update public.warehouse_items set
    code = v_new.code, barcode = v_new.barcode, name = v_new.name,
    description = v_new.description, category = v_new.category, unit = v_new.unit,
    min_stock = v_new.min_stock, lead_time_days = v_new.lead_time_days,
    avg_daily_consumption = v_new.avg_daily_consumption, current_stock = v_new.current_stock,
    batch_number = v_new.batch_number, expiry_date = v_new.expiry_date,
    last_purchase_price = v_new.last_purchase_price, reference_price = v_new.reference_price
  where id = p_item_id;

  if p_entrada is not null then
    insert into public.stock_entries (
      item_id, item_type, quantity, acquisition_type, invoice_number, invoice_date,
      invoice_total_value, unit_price, afm_number, supplier_cnpj, supplier_name,
      batch_number, expiry_date, notes, created_by,
      entry_group_id, location_id, nf_pendente)
    values (
      p_item_id, 'warehouse', v_qtd, p_entrada->>'acquisition_type',
      coalesce(nullif(btrim(p_entrada->>'invoice_number'), ''), '—'),
      coalesce(nullif(p_entrada->>'invoice_date', '')::date, current_date),
      coalesce(nullif(p_entrada->>'invoice_total_value', '')::numeric, 0),
      coalesce(nullif(p_entrada->>'unit_price', '')::numeric, 0),
      coalesce(nullif(btrim(p_entrada->>'afm_number'), ''), '—'),
      coalesce(nullif(btrim(p_entrada->>'supplier_cnpj'), ''), '00.000.000/0000-00'),
      coalesce(nullif(btrim(p_entrada->>'supplier_name'), ''), 'Entrada via edicao do item'),
      nullif(btrim(p_entrada->>'batch_number'), ''),
      nullif(p_entrada->>'expiry_date', '')::date,
      'Entrada registrada na edicao do item. Motivo: ' || btrim(p_motivo),
      v_uid,
      v_group, v_almox, v_pend);
  end if;

  insert into public.almox_item_edicoes (
    item_id, item_nome, item_codigo, usuario_id, usuario_nome, usuario_perfil,
    motivo, alteracoes, entrada)
  values (
    p_item_id, v_new.name, v_new.code, v_uid, v_user.full_name, v_user.role,
    btrim(p_motivo), v_diff, p_entrada)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'alteracoes', v_diff);
end $function$;

-- 7) Completar / corrigir entrada (mesmo id, sem mexer em quantidade) -----------------
-- p_dados: invoice_number, invoice_date, delivery_date, afm_number,
--          supplier_name, supplier_cnpj, unit_price, confirmar (bool)
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
  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Informe o motivo (minimo 10 caracteres).';
  end if;
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
           'Entrada de ' || to_char(e.created_at at time zone 'America/Bahia', 'DD/MM/YYYY') || ' completada: ' || btrim(p_motivo),
           jsonb_build_object('entrada_completada', v_diff),
           jsonb_build_object('entrada_id', e.id, 'quantidade', e.quantity)
      from public.warehouse_items w where w.id = e.item_id;

    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'Entrada nao encontrada.'; end if;
  return jsonb_build_object('entradas', v_n);
end $function$;
revoke execute on function public.almox_completar_entrada(uuid[], jsonb, text) from public, anon;
grant execute on function public.almox_completar_entrada(uuid[], jsonb, text) to authenticated;

-- 8) Anular entrada ------------------------------------------------------------------
-- Devolve a quantidade do LOCAL onde a entrada foi creditada (almox central =
-- warehouse_items.current_stock; satelite = item_stocks) e do lote, quando
-- houver. Recusa se o saldo atual for menor que a entrada (material ja saiu):
-- nesse caso o acerto e pelo ajuste de estoque, com contagem.
create or replace function public.almox_anular_entrada(p_entry_ids uuid[], p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_user public.users%rowtype;
  e public.stock_entries%rowtype;
  v_almox uuid;
  v_saldo integer;
  v_nome text; v_codigo text;
  v_n integer := 0; v_total integer := 0;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  if not public.fn_almox_opera_entradas() then raise exception 'Sem permissao para anular entradas.'; end if;
  select * into v_user from public.users where id = v_uid;
  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Informe o motivo da anulacao (minimo 10 caracteres).';
  end if;
  if p_entry_ids is null or array_length(p_entry_ids, 1) is null then raise exception 'Nenhuma entrada selecionada.'; end if;
  select id into v_almox from public.stock_locations where code = 'ALMOX';

  for e in select * from public.stock_entries where id = any (p_entry_ids) order by created_at for update
  loop
    if e.item_type <> 'warehouse' then raise exception 'Entrada de farmacia: use a tela da farmacia.'; end if;
    if e.anulada_em is not null then raise exception 'Uma das entradas ja estava anulada.'; end if;
    select name, code into v_nome, v_codigo from public.warehouse_items where id = e.item_id;
    if e.location_id is null then
      raise exception 'A entrada de "%" e antiga e nao registrou o estoque onde entrou. Acerte pelo ajuste de estoque, com contagem.', v_nome;
    end if;

    if e.location_id = v_almox then
      select current_stock into v_saldo from public.warehouse_items where id = e.item_id for update;
      if coalesce(v_saldo, 0) < e.quantity then
        raise exception 'Nao da para anular a entrada de "%": o saldo atual (%) e menor que a entrada (%) — parte ja saiu. Acerte pelo ajuste de estoque, com contagem.', v_nome, coalesce(v_saldo,0), e.quantity;
      end if;
      update public.warehouse_items set current_stock = current_stock - e.quantity, updated_at = now() where id = e.item_id;
    else
      select quantity into v_saldo from public.item_stocks
       where item_id = e.item_id and item_type = 'warehouse' and location_id = e.location_id for update;
      if coalesce(v_saldo, 0) < e.quantity then
        raise exception 'Nao da para anular a entrada de "%": o saldo do local (%) e menor que a entrada (%) — parte ja saiu. Acerte pelo ajuste de estoque, com contagem.', v_nome, coalesce(v_saldo,0), e.quantity;
      end if;
      update public.item_stocks set quantity = quantity - e.quantity, updated_at = now()
       where item_id = e.item_id and item_type = 'warehouse' and location_id = e.location_id;
    end if;

    if e.expiry_tracking_id is not null then
      update public.expiry_tracking
         set current_quantity = coalesce(current_quantity, 0) - e.quantity,
             initial_quantity = greatest(coalesce(initial_quantity, 0) - e.quantity, 0)
       where id = e.expiry_tracking_id;
    end if;

    update public.stock_entries
       set anulada_em = now(), anulada_por = v_uid, anulada_motivo = btrim(p_motivo), nf_pendente = false
     where id = e.id;

    insert into public.almox_item_edicoes (item_id, item_nome, item_codigo, usuario_id, usuario_nome, usuario_perfil, motivo, alteracoes, entrada)
    values (e.item_id, v_nome, v_codigo, v_uid, v_user.full_name, v_user.role,
      'Entrada de ' || to_char(e.created_at at time zone 'America/Bahia', 'DD/MM/YYYY') || ' anulada: ' || btrim(p_motivo),
      jsonb_build_object('saldo', jsonb_build_object('antes', v_saldo, 'depois', v_saldo - e.quantity)),
      jsonb_build_object('entrada_id', e.id, 'quantidade', -e.quantity, 'nf', e.invoice_number));

    v_n := v_n + 1; v_total := v_total + e.quantity;
  end loop;

  if v_n = 0 then raise exception 'Entrada nao encontrada.'; end if;
  return jsonb_build_object('entradas', v_n, 'quantidade', v_total);
end $function$;
revoke execute on function public.almox_anular_entrada(uuid[], text) from public, anon;
grant execute on function public.almox_anular_entrada(uuid[], text) to authenticated;

-- 9) Entradas antigas de material ----------------------------------------------------
-- Rodada: linhas gravadas na mesma transacao tem o mesmo created_at e autor.
update public.stock_entries
   set entry_group_id = md5(coalesce(created_by::text, '-') || '|' || created_at::text)::uuid
 where item_type = 'warehouse' and entry_group_id is null;

-- Local certo: edicao do item e cadastro inicial somam no almox central.
update public.stock_entries
   set location_id = (select id from public.stock_locations where code = 'ALMOX')
 where item_type = 'warehouse' and location_id is null
   and (notes ilike 'Entrada registrada na edi%' or notes ilike 'Estoque inicial registrado no cadastro%');

-- Nova Entrada: o lote nasce na mesma transacao -> local e lote exatos.
update public.stock_entries e
   set location_id = t.location_id, expiry_tracking_id = t.id
  from public.expiry_tracking t
 where e.item_type = 'warehouse' and e.location_id is null and e.notes is null
   and t.item_id = e.item_id and t.created_at = e.created_at
   and upper(btrim(coalesce(t.batch_number,''))) = upper(btrim(coalesce(e.batch_number,'')));

-- Nova Entrada que somou num lote que ja existia: so quando o lote e unico.
update public.stock_entries e
   set location_id = t.location_id, expiry_tracking_id = t.id
  from public.expiry_tracking t
 where e.item_type = 'warehouse' and e.location_id is null and e.notes is null
   and nullif(btrim(coalesce(e.batch_number,'')),'') is not null
   and t.item_id = e.item_id
   and upper(btrim(t.batch_number)) = upper(btrim(e.batch_number))
   and (select count(*) from public.expiry_tracking t2
         where t2.item_id = e.item_id and upper(btrim(t2.batch_number)) = upper(btrim(e.batch_number))) = 1;

-- Compra de material sem NF: vira pendencia para completar.
update public.stock_entries
   set nf_pendente = true
 where item_type = 'warehouse' and acquisition_type = 'Compra' and anulada_em is null
   and coalesce(nullif(btrim(invoice_number), ''), '—') in ('—','-','SN','S/N');
