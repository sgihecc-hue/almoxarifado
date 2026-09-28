-- =============================================================================
-- Entradas de estoque e edicao de item (auditoria de 28/09/2026)
--
-- C1  "Fui editar um lancamento e criou uma entrada nova": o Editar Item do
--     almox tinha uma secao que REGISTRAVA ENTRADA (almox_editar_item com
--     p_entrada). Todas as 22 entradas de material desde 21/09 vieram por ali
--     (86 no total). A secao saiu da tela; aqui a funcao passa a RECUSAR
--     p_entrada (assinatura mantida para nao quebrar quem ainda tiver a tela
--     antiga aberta). Entrada e so pela Nova Entrada; correcao, pela tela
--     Entradas. Some junto a dupla contagem de M4 (entrada + "Estoque Atual"
--     novo na mesma gravacao).
-- C2  invoice_total_value = "valor total da NF" informado pelo usuario. As
--     funcoes de editar/completar entrada deixam de recalcular (sobrescreviam
--     com qtd*preco da linha); o usuario pode mudar o campo explicitamente.
--     O valor da LINHA e sempre quantity*unit_price. Dados ja gravados NAO
--     sao alterados aqui.
-- A1  registrar_entrada_estoque (usada so pelo "Adicionar Estoque", sem rodada,
--     sem local, lote procurado em qualquer local) fica desativada: o dialogo
--     agora usa registrar_entrada_nf / registrar_entrada_farmacia.
--     As politicas de INSERT/UPDATE/DELETE direto em stock_entries saem: toda
--     gravacao passa por funcao SECURITY DEFINER (tela antiga em cache que
--     inseria direto do navegador passa a receber erro em vez de gravar meia
--     entrada).
-- A3  Quantidade acima de 100.000 por linha e recusada (codigo de barras lido
--     dentro do campo de quantidade virava 12 milhoes).
-- A5  Trocar o lote (ou reduzir) de uma entrada cujo lote ja teve saida deixava
--     o lote negativo. Agora recusa com mensagem.
-- A6  Lote procurado sem normalizar (maiuscula/espaco) criava lote duplicado.
--     Normaliza igual ao gatilho antes de procurar.
-- A7  Validade sem conferencia na farmacia (0026-10-30, 2001). A regra do almox
--     (ano entre 2015 e hoje+30) passa a valer para os dois catalogos e para
--     stock_entries; so confere quando a validade MUDA (editar outro campo de
--     um registro antigo com data torta nao e bloqueado).
-- M2  Preco vazio na edicao = nao mudar (antes gravava 0).
-- Baixos: NF repetida comparada so pelos digitos ("NF 31613" = "31613");
--     unidade nao pode ser trocada se o item ja tem movimentacao/saldo.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------
-- Chave de comparacao de NF: so os digitos, sem zero a esquerda. Sem digitos,
-- o texto em maiuscula sem espacos. Marcadores de "sem NF" viram null.
create or replace function public.fn_nf_chave(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $f$
  select case
    when p is null or btrim(p) in ('', '—', '-', 'SN', 'S/N') then null
    when regexp_replace(p, '\D', '', 'g') <> ''
      then nullif(ltrim(regexp_replace(p, '\D', '', 'g'), '0'), '')
    else upper(regexp_replace(btrim(p), '\s+', '', 'g'))
  end
$f$;

-- Lote como os gatilhos fn_normaliza_lote_* gravam: maiuscula, sem espacos.
create or replace function public.fn_lote_normalizado(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $f$
  select nullif(regexp_replace(upper(btrim(coalesce(p, ''))), '\s+', '', 'g'), '')
$f$;

-- ---------------------------------------------------------------------------
-- Aviso de entrada parecida (mesma NF pelos digitos, ou mesmo lote+qtd)
-- ---------------------------------------------------------------------------
create or replace function public.fn_almox_entrada_parecida(p_item uuid, p_qty integer, p_batch text, p_nf text, p_excluir_grupo uuid)
returns jsonb
language sql
stable security definer
set search_path = public, pg_temp
as $f$
  select jsonb_build_object(
           'entrada_id', e.id, 'data', e.created_at, 'quantidade', e.quantity,
           'nf', e.invoice_number, 'lote', e.batch_number,
           'por', (select full_name from public.users where id = e.created_by),
           'motivo', case
             when public.fn_nf_chave(p_nf) is not null
                  and public.fn_nf_chave(e.invoice_number) = public.fn_nf_chave(p_nf) then 'mesma_nf'
             else 'mesmo_lote_quantidade' end)
    from public.stock_entries e
   where e.item_type = 'warehouse'
     and e.item_id = p_item
     and e.anulada_em is null
     and e.created_at > now() - interval '30 days'
     and (p_excluir_grupo is null or e.entry_group_id is distinct from p_excluir_grupo)
     and (
       (public.fn_lote_normalizado(p_batch) is not null
         and public.fn_lote_normalizado(e.batch_number) = public.fn_lote_normalizado(p_batch)
         and e.quantity = p_qty)
       or (public.fn_nf_chave(p_nf) is not null
         and public.fn_nf_chave(e.invoice_number) = public.fn_nf_chave(p_nf))
     )
   order by e.created_at desc
   limit 1
$f$;

create or replace function public.fn_farmacia_entrada_parecida(p_item uuid, p_qty integer, p_batch text, p_nf text, p_excluir_grupo uuid)
returns jsonb
language sql
stable security definer
set search_path = public, pg_temp
as $f$
  select jsonb_build_object(
           'entrada_id', e.id, 'data', e.created_at, 'quantidade', e.quantity,
           'nf', e.invoice_number, 'lote', e.batch_number,
           'por', (select full_name from public.users where id = e.created_by),
           'motivo', case
             when public.fn_nf_chave(p_nf) is not null
                  and public.fn_nf_chave(e.invoice_number) = public.fn_nf_chave(p_nf) then 'mesma_nf'
             else 'mesmo_lote_quantidade' end)
    from public.stock_entries e
   where e.item_type = 'pharmacy'
     and e.item_id = p_item
     and e.anulada_em is null
     and e.created_at > now() - interval '30 days'
     and (p_excluir_grupo is null or e.entry_group_id is distinct from p_excluir_grupo)
     and (
       (public.fn_lote_normalizado(p_batch) is not null
         and public.fn_lote_normalizado(e.batch_number) = public.fn_lote_normalizado(p_batch)
         and e.quantity = p_qty)
       or (public.fn_nf_chave(p_nf) is not null
         and public.fn_nf_chave(e.invoice_number) = public.fn_nf_chave(p_nf))
     )
   order by e.created_at desc
   limit 1
$f$;

-- ---------------------------------------------------------------------------
-- C1/M4: almox_editar_item nao registra mais entrada
-- ---------------------------------------------------------------------------
create or replace function public.almox_editar_item(p_item_id uuid, p_campos jsonb, p_motivo text, p_entrada jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
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
  v_id         uuid;
begin
  if v_uid is null then
    raise exception 'Usuario nao autenticado.';
  end if;
  -- Entrada pelo Editar Item foi o que criou lancamentos "sem querer" (quem ia
  -- corrigir um lancamento acabava somando outro). Agora so pela Nova Entrada.
  if p_entrada is not null and jsonb_typeof(p_entrada) <> 'null' then
    raise exception 'O Editar Item nao registra mais entrada de estoque. Para lancar uma NF use "Nova Entrada" (Almoxarifado > Nova Entrada); para corrigir uma entrada ja lancada use "Entradas". Nada foi gravado.';
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

  insert into public.almox_item_edicoes (
    item_id, item_nome, item_codigo, usuario_id, usuario_nome, usuario_perfil,
    motivo, alteracoes, entrada)
  values (
    p_item_id, v_new.name, v_new.code, v_uid, v_user.full_name, v_user.role,
    btrim(p_motivo), v_diff, null)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'alteracoes', v_diff);
end $f$;

-- ---------------------------------------------------------------------------
-- C2: completar entrada (almox) — nao recalcula o valor total da NF
-- ---------------------------------------------------------------------------
create or replace function public.almox_completar_entrada(p_entry_ids uuid[], p_dados jsonb, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
declare
  v_uid uuid := auth.uid();
  v_user public.users%rowtype;
  e public.stock_entries%rowtype;
  v_permitidos text[] := array['invoice_number','invoice_date','delivery_date','afm_number',
                               'supplier_name','supplier_cnpj','unit_price','invoice_total_value'];
  v_k text;
  v_nf text;
  v_outra jsonb;
  v_antes jsonb; v_depois jsonb; v_diff jsonb;
  v_n integer := 0;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  if not public.fn_almox_opera_entradas() then raise exception 'Sem permissao para completar entradas.'; end if;
  select * into v_user from public.users where id = v_uid;
  perform set_config('app.entrada_obs', coalesce(p_motivo, ''), true);
  if p_entry_ids is null or array_length(p_entry_ids, 1) is null then raise exception 'Nenhuma entrada selecionada.'; end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then raise exception 'Dados invalidos.'; end if;
  for v_k in select jsonb_object_keys(p_dados) loop
    if not (v_k = any (v_permitidos) or v_k = 'confirmar') then
      raise exception 'Campo nao pode ser alterado por aqui: %. Quantidade, lote e item nao mudam — se estiverem errados, anule a entrada e lance de novo.', v_k;
    end if;
  end loop;
  if nullif(btrim(coalesce(p_dados->>'unit_price','')), '') is not null and (p_dados->>'unit_price')::numeric < 0 then
    raise exception 'Preco unitario nao pode ser negativo.';
  end if;
  if nullif(btrim(coalesce(p_dados->>'invoice_total_value','')), '') is not null and (p_dados->>'invoice_total_value')::numeric < 0 then
    raise exception 'Valor total da NF nao pode ser negativo.';
  end if;

  v_nf := nullif(btrim(coalesce(p_dados->>'invoice_number','')), '');
  if v_nf in ('—','-','SN','S/N') then v_nf := null; end if;

  for e in select * from public.stock_entries where id = any (p_entry_ids) for update
  loop
    if e.item_type <> 'warehouse' then raise exception 'Entrada de farmacia: use a tela da farmacia.'; end if;
    if e.anulada_em is not null then raise exception 'Entrada ja anulada nao pode ser completada.'; end if;

    if public.fn_nf_chave(v_nf) is not null and not coalesce((p_dados->>'confirmar')::boolean, false) then
      v_outra := null;
      select jsonb_build_object('entrada_id', o.id, 'data', o.created_at, 'quantidade', o.quantity, 'nf', o.invoice_number)
        into v_outra
        from public.stock_entries o
       where o.item_type = 'warehouse' and o.item_id = e.item_id and o.anulada_em is null
         and o.id <> all (p_entry_ids) and public.fn_nf_chave(o.invoice_number) = public.fn_nf_chave(v_nf)
       limit 1;
      if v_outra is not null then
        raise exception 'NF_JA_USADA:%', v_outra::text;
      end if;
    end if;

    v_antes := jsonb_build_object(
      'invoice_number', e.invoice_number, 'invoice_date', e.invoice_date, 'delivery_date', e.delivery_date,
      'afm_number', e.afm_number, 'supplier_name', e.supplier_name, 'supplier_cnpj', e.supplier_cnpj,
      'unit_price', e.unit_price, 'invoice_total_value', e.invoice_total_value);

    update public.stock_entries s set
      invoice_number = case when p_dados ? 'invoice_number' then coalesce(v_nf, '—') else s.invoice_number end,
      invoice_date   = case when p_dados ? 'invoice_date' then coalesce(nullif(p_dados->>'invoice_date','')::date, s.invoice_date) else s.invoice_date end,
      delivery_date  = case when p_dados ? 'delivery_date' then nullif(p_dados->>'delivery_date','')::date else s.delivery_date end,
      afm_number     = case when p_dados ? 'afm_number' then coalesce(nullif(btrim(p_dados->>'afm_number'),''), '—') else s.afm_number end,
      supplier_name  = case when p_dados ? 'supplier_name' then coalesce(nullif(btrim(p_dados->>'supplier_name'),''), s.supplier_name) else s.supplier_name end,
      supplier_cnpj  = case when p_dados ? 'supplier_cnpj' then coalesce(nullif(btrim(p_dados->>'supplier_cnpj'),''), s.supplier_cnpj) else s.supplier_cnpj end,
      unit_price     = case when p_dados ? 'unit_price' then coalesce(nullif(btrim(p_dados->>'unit_price'),'')::numeric, s.unit_price) else s.unit_price end,
      -- Valor total da NF: so muda se o usuario mandou o campo.
      invoice_total_value = case when p_dados ? 'invoice_total_value'
                                 then nullif(btrim(coalesce(p_dados->>'invoice_total_value','')), '')::numeric
                                 else s.invoice_total_value end,
      nf_pendente    = case when p_dados ? 'invoice_number' then (v_nf is null) else s.nf_pendente end,
      completada_em  = now(),
      completada_por = v_uid
     where s.id = e.id
    returning jsonb_build_object(
      'invoice_number', s.invoice_number, 'invoice_date', s.invoice_date, 'delivery_date', s.delivery_date,
      'afm_number', s.afm_number, 'supplier_name', s.supplier_name, 'supplier_cnpj', s.supplier_cnpj,
      'unit_price', s.unit_price, 'invoice_total_value', s.invoice_total_value) into v_depois;

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
end $f$;

-- ---------------------------------------------------------------------------
-- C2/A5/A6/M2: editar entrada (almox)
-- ---------------------------------------------------------------------------
create or replace function public.almox_editar_entrada(p_entry_id uuid, p_dados jsonb, p_obs text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
declare
  v_uid uuid := auth.uid();
  v_user public.users%rowtype;
  e public.stock_entries%rowtype;
  v_permitidos text[] := array['quantity','batch_number','expiry_date','unit_price','invoice_number','invoice_date',
                               'delivery_date','afm_number','supplier_name','supplier_cnpj','invoice_total_value','confirmar'];
  v_k text;
  v_almox uuid;
  v_nome text; v_codigo text;
  v_qtd integer; v_delta integer;
  v_lote text; v_val date; v_preco numeric; v_nf text;
  v_mudou_lote boolean;
  v_saldo numeric;
  v_saldo_lote numeric;
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
  if v_qtd > 100000 then
    raise exception 'Quantidade % parece errada (codigo de barras lido no campo?). O maximo por linha e 100.000.', v_qtd;
  end if;
  v_delta := v_qtd - e.quantity;
  -- Lote normalizado igual ao gatilho (maiuscula, sem espacos).
  v_lote  := case when p_dados ? 'batch_number' then public.fn_lote_normalizado(p_dados->>'batch_number') else e.batch_number end;
  v_val   := case when p_dados ? 'expiry_date' then nullif(p_dados->>'expiry_date','')::date else e.expiry_date end;
  -- Preco vazio = nao mudar (antes gravava 0).
  v_preco := case when p_dados ? 'unit_price' and nullif(btrim(coalesce(p_dados->>'unit_price','')), '') is not null
                  then (p_dados->>'unit_price')::numeric else e.unit_price end;
  if v_preco < 0 then raise exception 'Preco unitario nao pode ser negativo.'; end if;
  if nullif(btrim(coalesce(p_dados->>'invoice_total_value','')), '') is not null and (p_dados->>'invoice_total_value')::numeric < 0 then
    raise exception 'Valor total da NF nao pode ser negativo.';
  end if;
  v_nf    := case when p_dados ? 'invoice_number' then nullif(btrim(coalesce(p_dados->>'invoice_number','')), '') else e.invoice_number end;
  if v_nf in ('—','-','SN','S/N') then v_nf := null; end if;
  v_mudou_lote := coalesce(public.fn_lote_normalizado(v_lote), '') <> coalesce(public.fn_lote_normalizado(e.batch_number), '');

  if (v_delta <> 0 or v_mudou_lote) and e.location_id is null then
    raise exception 'A entrada de "%" e antiga e nao registrou o estoque onde entrou: quantidade e lote nao podem ser editados aqui. Acerte pelo ajuste de estoque, com contagem.', v_nome;
  end if;

  -- NF que ja esta em outra entrada do mesmo item (comparada pelos digitos)
  if p_dados ? 'invoice_number' and public.fn_nf_chave(v_nf) is not null
     and public.fn_nf_chave(v_nf) is distinct from public.fn_nf_chave(e.invoice_number)
     and not coalesce((p_dados->>'confirmar')::boolean, false) then
    select jsonb_build_object('entrada_id', o.id, 'data', o.created_at, 'quantidade', o.quantity, 'nf', o.invoice_number)
      into v_outra from public.stock_entries o
     where o.item_type = 'warehouse' and o.item_id = e.item_id and o.anulada_em is null
       and o.id <> e.id and public.fn_nf_chave(o.invoice_number) = public.fn_nf_chave(v_nf) limit 1;
    if v_outra is not null then raise exception 'NF_JA_USADA:%', v_outra::text; end if;
  end if;

  -- Lote da entrada: se parte ja saiu, nao da para trocar o lote nem tirar
  -- mais do que sobrou (o lote ficava negativo).
  if e.expiry_tracking_id is not null and (v_mudou_lote or v_delta < 0) then
    select current_quantity into v_saldo_lote from public.expiry_tracking where id = e.expiry_tracking_id for update;
    if v_mudou_lote and coalesce(v_saldo_lote, 0) < e.quantity then
      raise exception 'Parte deste lote ja saiu: o lote % tem % e a entrada foi de %. Nao da para trocar o lote desta entrada; ajuste pela movimentacao.', coalesce(e.batch_number, 's/n'), coalesce(v_saldo_lote, 0), e.quantity;
    end if;
    if not v_mudou_lote and coalesce(v_saldo_lote, 0) + v_delta < 0 then
      raise exception 'Parte deste lote ja saiu: o lote % tem so % e a reducao pedida e de %. Ajuste pela movimentacao.', coalesce(e.batch_number, 's/n'), coalesce(v_saldo_lote, 0), -v_delta;
    end if;
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
         where item_id = e.item_id and location_id = e.location_id
           and public.fn_lote_normalizado(batch_number) = v_lote
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
    -- Valor total da NF: nunca recalculado; so muda se o usuario mandou.
    invoice_total_value = case when p_dados ? 'invoice_total_value'
                               then nullif(btrim(coalesce(p_dados->>'invoice_total_value','')), '')::numeric
                               else s.invoice_total_value end,
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

  insert into public.almox_item_edicoes (item_id, item_nome, item_codigo, usuario_id, usuario_nome, usuario_perfil, motivo, alteracoes, entrada)
  values (e.item_id, v_nome, v_codigo, v_uid, v_user.full_name, v_user.role,
    'Entrada de ' || to_char(e.created_at at time zone 'America/Bahia', 'DD/MM/YYYY') || ' editada' || coalesce(': ' || nullif(btrim(p_obs), ''), ''),
    jsonb_build_object('entrada_editada', jsonb_build_object('quantidade', jsonb_build_object('antes', e.quantity, 'depois', v_qtd),
                                                           'lote', jsonb_build_object('antes', e.batch_number, 'depois', v_lote))),
    jsonb_build_object('entrada_id', e.id, 'diferenca', v_delta));

  return jsonb_build_object('diferenca', v_delta, 'quantidade', v_qtd);
end $f$;

-- ---------------------------------------------------------------------------
-- C2: completar entrada (farmacia)
-- ---------------------------------------------------------------------------
create or replace function public.farmacia_completar_entrada(p_entry_ids uuid[], p_dados jsonb, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
declare
  v_uid uuid := auth.uid();
  e public.stock_entries%rowtype;
  v_permitidos text[] := array['invoice_number','invoice_date','delivery_date','afm_number',
                               'supplier_name','supplier_cnpj','unit_price','invoice_total_value'];
  v_k text;
  v_nf text;
  v_outra jsonb;
  v_antes jsonb; v_depois jsonb;
  v_n integer := 0;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  if not public.fn_farmacia_opera_entradas() then raise exception 'Sem permissao para completar entradas da farmacia.'; end if;
  perform set_config('app.entrada_obs', coalesce(p_motivo, ''), true);
  if p_entry_ids is null or array_length(p_entry_ids, 1) is null then raise exception 'Nenhuma entrada selecionada.'; end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then raise exception 'Dados invalidos.'; end if;
  for v_k in select jsonb_object_keys(p_dados) loop
    if not (v_k = any (v_permitidos) or v_k = 'confirmar') then
      raise exception 'Campo nao pode ser alterado por aqui: %. Quantidade, lote e item nao mudam — se estiverem errados, anule a entrada e lance de novo.', v_k;
    end if;
  end loop;
  if nullif(btrim(coalesce(p_dados->>'unit_price','')), '') is not null and (p_dados->>'unit_price')::numeric < 0 then
    raise exception 'Preco unitario nao pode ser negativo.';
  end if;
  if nullif(btrim(coalesce(p_dados->>'invoice_total_value','')), '') is not null and (p_dados->>'invoice_total_value')::numeric < 0 then
    raise exception 'Valor total da NF nao pode ser negativo.';
  end if;

  v_nf := nullif(btrim(coalesce(p_dados->>'invoice_number','')), '');
  if v_nf in ('—','-','SN','S/N') then v_nf := null; end if;

  for e in select * from public.stock_entries where id = any (p_entry_ids) for update
  loop
    if e.item_type <> 'pharmacy' then raise exception 'Entrada de material: use a tela do almoxarifado.'; end if;
    if e.anulada_em is not null then raise exception 'Entrada ja anulada nao pode ser completada.'; end if;

    if public.fn_nf_chave(v_nf) is not null and not coalesce((p_dados->>'confirmar')::boolean, false) then
      v_outra := null;
      select jsonb_build_object('entrada_id', o.id, 'data', o.created_at, 'quantidade', o.quantity, 'nf', o.invoice_number)
        into v_outra
        from public.stock_entries o
       where o.item_type = 'pharmacy' and o.item_id = e.item_id and o.anulada_em is null
         and o.id <> all (p_entry_ids) and public.fn_nf_chave(o.invoice_number) = public.fn_nf_chave(v_nf)
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
      unit_price     = case when p_dados ? 'unit_price' then coalesce(nullif(btrim(p_dados->>'unit_price'),'')::numeric, s.unit_price) else s.unit_price end,
      invoice_total_value = case when p_dados ? 'invoice_total_value'
                                 then nullif(btrim(coalesce(p_dados->>'invoice_total_value','')), '')::numeric
                                 else s.invoice_total_value end,
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
end $f$;

-- ---------------------------------------------------------------------------
-- C2/A5/M2: editar entrada (farmacia)
-- ---------------------------------------------------------------------------
create or replace function public.farmacia_editar_entrada(p_entry_id uuid, p_dados jsonb, p_obs text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
declare
  v_uid uuid := auth.uid();
  e public.stock_entries%rowtype;
  v_permitidos text[] := array['quantity','batch_number','expiry_date','unit_price','invoice_number','invoice_date',
                               'delivery_date','afm_number','supplier_name','supplier_cnpj','invoice_total_value','confirmar'];
  v_k text;
  v_nome text;
  v_qtd integer; v_delta integer;
  v_lote text; v_val date; v_preco numeric; v_nf text;
  v_mudou_lote boolean;
  v_saldo numeric;
  v_saldo_lote numeric;
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
  if v_qtd > 100000 then
    raise exception 'Quantidade % parece errada (codigo de barras lido no campo?). O maximo por linha e 100.000.', v_qtd;
  end if;
  v_delta := v_qtd - e.quantity;
  v_lote  := case when p_dados ? 'batch_number' then public.fn_lote_normalizado(p_dados->>'batch_number') else e.batch_number end;
  v_val   := case when p_dados ? 'expiry_date' then nullif(p_dados->>'expiry_date','')::date else e.expiry_date end;
  v_preco := case when p_dados ? 'unit_price' and nullif(btrim(coalesce(p_dados->>'unit_price','')), '') is not null
                  then (p_dados->>'unit_price')::numeric else e.unit_price end;
  if v_preco < 0 then raise exception 'Preco unitario nao pode ser negativo.'; end if;
  if nullif(btrim(coalesce(p_dados->>'invoice_total_value','')), '') is not null and (p_dados->>'invoice_total_value')::numeric < 0 then
    raise exception 'Valor total da NF nao pode ser negativo.';
  end if;
  v_nf    := case when p_dados ? 'invoice_number' then nullif(btrim(coalesce(p_dados->>'invoice_number','')), '') else e.invoice_number end;
  if v_nf in ('—','-','SN','S/N') then v_nf := null; end if;
  v_mudou_lote := coalesce(public.fn_lote_normalizado(v_lote), '') <> coalesce(public.fn_lote_normalizado(e.batch_number), '');

  if (v_delta <> 0 or v_mudou_lote) and e.location_id is null then
    raise exception 'A entrada de "%" nao registrou o estoque onde entrou: quantidade e lote nao podem ser editados aqui. Acerte pelo ajuste de estoque, com contagem.', v_nome;
  end if;
  if v_mudou_lote and v_lote is null then
    raise exception 'Medicamento precisa de lote. Informe o lote correto.';
  end if;

  if p_dados ? 'invoice_number' and public.fn_nf_chave(v_nf) is not null
     and public.fn_nf_chave(v_nf) is distinct from public.fn_nf_chave(e.invoice_number)
     and not coalesce((p_dados->>'confirmar')::boolean, false) then
    select jsonb_build_object('entrada_id', o.id, 'data', o.created_at, 'quantidade', o.quantity, 'nf', o.invoice_number)
      into v_outra from public.stock_entries o
     where o.item_type = 'pharmacy' and o.item_id = e.item_id and o.anulada_em is null
       and o.id <> e.id and public.fn_nf_chave(o.invoice_number) = public.fn_nf_chave(v_nf) limit 1;
    if v_outra is not null then raise exception 'NF_JA_USADA:%', v_outra::text; end if;
  end if;

  -- Lote da entrada: se parte ja saiu, nao da para trocar o lote nem tirar
  -- mais do que sobrou (o lote ficava negativo).
  if e.expiry_tracking_id is not null and (v_mudou_lote or v_delta < 0) then
    select current_quantity into v_saldo_lote from public.expiry_tracking where id = e.expiry_tracking_id for update;
    if v_mudou_lote and coalesce(v_saldo_lote, 0) < e.quantity then
      raise exception 'Parte deste lote ja saiu: o lote % tem % e a entrada foi de %. Nao da para trocar o lote desta entrada; ajuste pela movimentacao.', coalesce(e.batch_number, 's/n'), coalesce(v_saldo_lote, 0), e.quantity;
    end if;
    if not v_mudou_lote and coalesce(v_saldo_lote, 0) + v_delta < 0 then
      raise exception 'Parte deste lote ja saiu: o lote % tem so % e a reducao pedida e de %. Ajuste pela movimentacao.', coalesce(e.batch_number, 's/n'), coalesce(v_saldo_lote, 0), -v_delta;
    end if;
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
     where item_id = e.item_id and location_id = e.location_id and public.fn_lote_normalizado(batch_number) = v_lote
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
    invoice_total_value = case when p_dados ? 'invoice_total_value'
                               then nullif(btrim(coalesce(p_dados->>'invoice_total_value','')), '')::numeric
                               else s.invoice_total_value end,
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
end $f$;

-- ---------------------------------------------------------------------------
-- A3/A6: Nova Entrada (almox e SAT_T) — lote normalizado, teto de quantidade
-- ---------------------------------------------------------------------------
create or replace function public.registrar_entrada_nf(p_item_type text, p_invoice_number text, p_invoice_date date, p_afm_number text, p_supplier_cnpj text, p_supplier_name text, p_items jsonb, p_acquisition_type text default 'Compra'::text, p_location_code text default null::text, p_delivery_date date default null::date, p_entry_group_id uuid default null::uuid, p_confirmar_parecida boolean default false, p_nf_pendente boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
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
  v_delivdate date := p_delivery_date;
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
  v_pend := coalesce(p_nf_pendente, false)
    or (coalesce(p_acquisition_type,'Compra') = 'Compra' and coalesce(v_inv,'—') in ('—','-','SN','S/N'));

  for it in select value from jsonb_array_elements(p_items)
  loop
    v_item  := (it->>'item_id')::uuid;
    v_qty   := (it->>'quantity')::integer;
    v_price := coalesce((it->>'unit_price')::numeric, 0);
    -- Lote como o gatilho grava (maiuscula, sem espacos): sem isso "abc 1"
    -- nao achava "ABC1" e criava um segundo lote igual.
    v_batch := public.fn_lote_normalizado(it->>'batch_number');
    v_exp   := nullif(it->>'expiry_date','')::date;
    if v_item is null then raise exception 'Linha sem item.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade invalida em uma das linhas.'; end if;
    if v_qty > 100000 then
      raise exception 'Quantidade % parece errada (codigo de barras lido no campo?). O maximo por linha e 100.000.', v_qty;
    end if;
    if v_price < 0 then raise exception 'Preco unitario nao pode ser negativo.'; end if;
    v_line_total := round(v_qty * v_price, 2);

    if p_item_type = 'warehouse' and not coalesce(p_confirmar_parecida, false) then
      v_parecida := public.fn_almox_entrada_parecida(v_item, v_qty, v_batch, v_inv, v_group);
      if v_parecida is not null then
        raise exception 'ENTRADA_PARECIDA:%', v_parecida::text;
      end if;
    end if;

    -- Lote POR LOCAL (item + lote + local).
    v_lot := null;
    if v_batch is not null then
      select id into v_lot from public.expiry_tracking
       where item_id = v_item and location_id = v_loc and public.fn_lote_normalizado(batch_number) = v_batch
       order by created_at limit 1;
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
      update public.warehouse_items set current_stock = current_stock + v_qty, updated_at = now() where id = v_item;
    else
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
end $f$;

-- ---------------------------------------------------------------------------
-- A3/A6: Nova Entrada da farmacia
-- ---------------------------------------------------------------------------
create or replace function public.registrar_entrada_farmacia(p_invoice_number text, p_invoice_date date, p_afm_number text, p_supplier_cnpj text, p_supplier_name text, p_items jsonb, p_acquisition_type text default 'Compra'::text, p_location_code text default null::text, p_delivery_date date default null::date, p_notes text default null::text, p_entry_group_id uuid default null::uuid, p_confirmar_parecida boolean default false, p_nf_pendente boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
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
  v_delivdate date := p_delivery_date;
  v_notes text := nullif(btrim(coalesce(p_notes,'')),'');
  v_group uuid := coalesce(p_entry_group_id, gen_random_uuid());
  v_parecida jsonb;
  v_pend boolean;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Entrada sem itens.'; end if;

  select role into v_role from public.users where id = v_uid;
  if coalesce(v_role,'') not in ('administrador','gestor','atendente','admin','manager','pharmacist','warehouse_manager') then
    raise exception 'Sem permissao para registrar entrada.';
  end if;

  v_code := coalesce(nullif(btrim(coalesce(p_location_code,'')),''), 'CAF');
  if v_code not in ('CAF','SAT_1','SAT_2','SAT_T') then
    raise exception 'Local % nao e estoque de farmacia.', v_code;
  end if;
  select id into v_loc from public.stock_locations where code = v_code;
  if v_loc is null then raise exception 'Local % nao encontrado.', v_code; end if;

  if p_entry_group_id is not null then
    begin
      insert into public.entrada_rodadas(id, item_type, created_by) values (p_entry_group_id, 'pharmacy', v_uid);
    exception when unique_violation then
      raise exception 'ENTRADA_JA_REGISTRADA: esta entrada ja foi gravada (clique duplo ou reenvio). Nada foi somado de novo.';
    end;
  end if;
  v_pend := coalesce(p_nf_pendente, false)
    or (coalesce(p_acquisition_type,'Compra') = 'Compra' and coalesce(v_inv,'—') in ('—','-','SN','S/N'));

  for it in select value from jsonb_array_elements(p_items)
  loop
    v_item  := (it->>'item_id')::uuid;
    v_qty   := (it->>'quantity')::integer;
    v_price := coalesce((it->>'unit_price')::numeric, 0);
    -- Lote como o gatilho grava: sem isso "abc 1" nao achava "ABC1" e criava
    -- um segundo lote igual no mesmo estoque.
    v_batch := public.fn_lote_normalizado(it->>'batch_number');
    v_exp   := nullif(it->>'expiry_date','')::date;
    if v_item is null then raise exception 'Linha sem item.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade invalida em uma das linhas.'; end if;
    if v_qty > 100000 then
      raise exception 'Quantidade % parece errada (codigo de barras lido no campo?). O maximo por linha e 100.000.', v_qty;
    end if;
    if v_price < 0 then raise exception 'Preco unitario nao pode ser negativo.'; end if;
    if not exists (select 1 from public.pharmacy_items where id = v_item) then
      raise exception 'Item % nao e medicamento da farmacia.', v_item;
    end if;
    v_line_total := round(v_qty * v_price, 2);

    if not coalesce(p_confirmar_parecida, false) then
      v_parecida := public.fn_farmacia_entrada_parecida(v_item, v_qty, v_batch, v_inv, v_group);
      if v_parecida is not null then
        raise exception 'ENTRADA_PARECIDA:%', v_parecida::text;
      end if;
    end if;

    v_lot := null;
    if v_batch is not null then
      select id into v_lot from public.expiry_tracking
       where item_id = v_item and location_id = v_loc and public.fn_lote_normalizado(batch_number) = v_batch
       order by created_at limit 1;
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

    insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity, unit_cost,
      target_location_id, expiry_tracking_id, performed_by, notes)
    values (v_item, 'pharmacy', 'ENTRADA_NF', 'in', v_qty, v_price, v_loc, v_lot, v_uid,
      'Entrada (' || coalesce(p_acquisition_type,'Compra') || ')' || coalesce(' NF ' || v_inv, '')
        || coalesce(' · Obs: ' || v_notes, ''));

    insert into public.stock_entries(item_id, item_type, quantity, acquisition_type, invoice_number, invoice_date,
      invoice_total_value, expiry_date, afm_number, supplier_cnpj, supplier_name, unit_price, batch_number,
      delivery_date, created_by, notes, entry_group_id, location_id, expiry_tracking_id, nf_pendente)
    values (v_item, 'pharmacy', v_qty, coalesce(p_acquisition_type,'Compra'), v_inv, v_invdate,
      v_line_total, v_exp, v_afm, v_cnpj, v_supp, v_price, v_batch, v_delivdate, v_uid, v_notes,
      v_group, v_loc, v_lot, v_pend);

    v_count := v_count + 1; v_total_qty := v_total_qty + v_qty; v_total_val := v_total_val + v_line_total;
  end loop;

  return jsonb_build_object('itens', v_count, 'quantidade_total', v_total_qty, 'valor_total', v_total_val, 'local', v_code, 'rodada', v_group);
end $f$;

-- ---------------------------------------------------------------------------
-- A1: registrar_entrada_estoque desativada (sem rodada, sem escolha de local,
-- lote procurado em qualquer local). Assinatura mantida.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_entrada_estoque(p_item_id uuid, p_item_type text, p_quantity integer, p_invoice_number text, p_invoice_date date, p_afm_number text, p_supplier_cnpj text, p_supplier_name text, p_unit_price numeric default 0, p_invoice_total_value numeric default 0, p_acquisition_type text default 'Compra'::text, p_batch_number text default null::text, p_expiry_date date default null::date, p_delivery_date date default null::date, p_notes text default null::text, p_location_code text default null::text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  raise exception 'Esta forma de entrada foi desativada. Use "Nova Entrada" do estoque (ou atualize a pagina): ela registra NF, lote, local e evita lancamento em dobro. Nada foi gravado.';
end $f$;

-- ---------------------------------------------------------------------------
-- A7: validade conferida nos dois catalogos e em stock_entries
-- (o nome da funcao ficou "_almox" para nao mexer no gatilho existente)
-- ---------------------------------------------------------------------------
create or replace function public.fn_valida_validade_almox()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $f$
declare
  v_piso date := date '2015-01-01';
  v_teto date := (current_date + interval '30 years')::date;
begin
  if new.expiry_date is null then
    return new;
  end if;
  -- So confere quando a validade muda: registro antigo com data torta nao
  -- trava a edicao de outro campo (as funcoes regravam a coluna sem mudar).
  if tg_op = 'UPDATE' and new.expiry_date is not distinct from old.expiry_date then
    return new;
  end if;
  if new.expiry_date < v_piso or new.expiry_date > v_teto then
    raise exception
      'Validade % parece digitada errada. Confira o ano — o sistema aceita de % ate %.',
      to_char(new.expiry_date, 'DD/MM/YYYY'),
      to_char(v_piso, 'DD/MM/YYYY'),
      to_char(v_teto, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;
  return new;
end $f$;

drop trigger if exists trg_valida_validade_entrada on public.stock_entries;
create trigger trg_valida_validade_entrada
  before insert or update of expiry_date on public.stock_entries
  for each row execute function public.fn_valida_validade_almox();

-- ---------------------------------------------------------------------------
-- Unidade nao pode ser trocada em item com movimentacao ou saldo: as
-- quantidades antigas ficariam lidas na unidade nova.
-- ---------------------------------------------------------------------------
create or replace function public.fn_bloqueia_troca_unidade()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
declare
  v_tem boolean;
begin
  if new.unit is not distinct from old.unit then
    return new;
  end if;
  v_tem := coalesce(old.current_stock, 0) <> 0
    or exists (select 1 from public.stock_entries where item_id = old.id)
    or exists (select 1 from public.stock_movements where item_id = old.id)
    or exists (select 1 from public.expiry_tracking where item_id = old.id)
    or exists (select 1 from public.item_stocks where item_id = old.id and quantity <> 0)
    or exists (select 1 from public.warehouse_dispatch_items where item_id = old.id)
    or exists (select 1 from public.warehouse_consumption_entries where item_id = old.id)
    or exists (select 1 from public.consumption_entries where item_id = old.id)
    or exists (select 1 from public.pharmacy_dispensation_items where item_id = old.id)
    or exists (select 1 from public.loan_items where item_id = old.id)
    or exists (select 1 from public.stock_transfer_items where item_id = old.id)
    or exists (select 1 from public.stock_return_items where item_id = old.id)
    or exists (select 1 from public.material_receipts where item_id = old.id)
    or exists (select 1 from public.medication_losses where item_id = old.id);
  if v_tem then
    raise exception 'A unidade de "%" nao pode ser trocada (% -> %): o item ja tem movimentacao ou saldo, e as quantidades antigas passariam a ser lidas na unidade nova. Se a unidade esta errada, cadastre um item novo com a unidade certa.',
      old.name, old.unit, new.unit
      using errcode = 'check_violation';
  end if;
  return new;
end $f$;

drop trigger if exists trg_bloqueia_troca_unidade on public.warehouse_items;
create trigger trg_bloqueia_troca_unidade
  before update of unit on public.warehouse_items
  for each row execute function public.fn_bloqueia_troca_unidade();

drop trigger if exists trg_bloqueia_troca_unidade on public.pharmacy_items;
create trigger trg_bloqueia_troca_unidade
  before update of unit on public.pharmacy_items
  for each row execute function public.fn_bloqueia_troca_unidade();

-- ---------------------------------------------------------------------------
-- A1: sem gravacao direta em stock_entries pelo navegador. Toda escrita vem
-- das funcoes SECURITY DEFINER (registrar_entrada_*, *_editar_entrada,
-- *_completar_entrada, *_anular_entrada). Leitura continua liberada.
-- ---------------------------------------------------------------------------
drop policy if exists "Managers can insert stock entries" on public.stock_entries;
drop policy if exists "Managers can update stock entries" on public.stock_entries;
drop policy if exists "Admins can delete stock entries" on public.stock_entries;
