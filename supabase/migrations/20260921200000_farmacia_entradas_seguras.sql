-- FARMACIA: entradas seguras — rodada unica, completar NF, anular entrada e
-- aviso de entrada parecida. Mesma protecao do almoxarifado (20260921180000),
-- com codigo proprio da farmacia (regra do projeto: um modulo nao encosta no
-- outro).
--
-- ORIGEM: em 17/09/2026 a NF 1599 (3 curativos) foi gravada duas vezes com 1 s
-- de diferenca — duplo clique em "Registrar Entrada". O CAF ficou com 200 +
-- 50 + 5 a mais.
--
-- DIFERENCA PARA O ALMOX: na farmacia o saldo vem do LIVRO-RAZAO
-- (stock_movements; o gatilho atualiza item_stocks). Por isso anular uma
-- entrada e LANCAR um movimento AJUSTE de saida no livro — nunca apagar nem
-- editar. Item controlado aparece no Livro de Controlados, como deve.
--
-- O QUE FAZ:
--   1. fn_farmacia_opera_entradas / fn_farmacia_entrada_parecida.
--   2. registrar_entrada_farmacia: rodada (idempotencia), aviso de parecida,
--      NF pendente; grava rodada/local/lote. Gerada a partir de producao.
--   3. farmacia_completar_entrada: NF, datas, AFM, fornecedor na MESMA entrada.
--   4. farmacia_anular_entrada: AJUSTE de saida no livro + lote, com motivo.
--   5. Entradas antigas da farmacia: rodada, local e lote ligados ao movimento
--      ENTRADA_NF do mesmo instante (as 214 tem movimento correspondente).
--
-- ALMOXARIFADO: nada aqui o altera. Usa entrada_rodadas e as colunas de
-- stock_entries criadas em 20260921180000.

-- 1) Quem opera e entrada parecida ----------------------------------------------------
create or replace function public.fn_farmacia_opera_entradas()
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select exists (
    select 1 from public.users u
     where u.id = auth.uid() and coalesce(u.is_active, true)
       and u.role in ('administrador','admin','gestor','manager','atendente','pharmacist')
  )
$$;
revoke execute on function public.fn_farmacia_opera_entradas() from public, anon;
grant execute on function public.fn_farmacia_opera_entradas() to authenticated;

create or replace function public.fn_farmacia_entrada_parecida(
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
   where e.item_type = 'pharmacy'
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
revoke execute on function public.fn_farmacia_entrada_parecida(uuid, integer, text, text, uuid) from public, anon;
grant execute on function public.fn_farmacia_entrada_parecida(uuid, integer, text, text, uuid) to authenticated;

-- 2) registrar_entrada_farmacia -------------------------------------------------------
-- Parametros novos no fim, com default. DROP antes do CREATE para nao deixar
-- duas versoes (overload ambiguo no PostgREST).
drop function if exists public.registrar_entrada_farmacia(text, date, text, text, text, jsonb, text, text, date, text);
create function public.registrar_entrada_farmacia(
  p_invoice_number text, p_invoice_date date, p_afm_number text,
  p_supplier_cnpj text, p_supplier_name text, p_items jsonb,
  p_acquisition_type text default 'Compra', p_location_code text default null,
  p_delivery_date date default null, p_notes text default null,
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
  v_notes text := nullif(btrim(coalesce(p_notes,'')),'');
  -- Rodada: id unico da entrada inteira. O banco recusa a mesma rodada duas
  -- vezes (duplo clique da NF 1599, 17/09/2026).
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
  -- So estoques da farmacia. ALMOX nunca passa por aqui.
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
    v_batch := nullif(btrim(coalesce(it->>'batch_number','')),'');
    v_exp   := nullif(it->>'expiry_date','')::date;
    if v_item is null then raise exception 'Linha sem item.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade invalida em uma das linhas.'; end if;
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
end $function$;
revoke execute on function public.registrar_entrada_farmacia(text, date, text, text, text, jsonb, text, text, date, text, uuid, boolean, boolean) from public, anon;
grant execute on function public.registrar_entrada_farmacia(text, date, text, text, text, jsonb, text, text, date, text, uuid, boolean, boolean) to authenticated, service_role;

-- 3) Completar / corrigir entrada da farmacia (mesmo id, sem mexer em quantidade) -----
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
            v_antes, v_depois || jsonb_build_object('motivo', btrim(p_motivo)));

    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'Entrada nao encontrada.'; end if;
  return jsonb_build_object('entradas', v_n);
end $function$;
revoke execute on function public.farmacia_completar_entrada(uuid[], jsonb, text) from public, anon;
grant execute on function public.farmacia_completar_entrada(uuid[], jsonb, text) to authenticated;

-- 4) Anular entrada da farmacia (AJUSTE de saida no livro-razao) --------------------
create or replace function public.farmacia_anular_entrada(p_entry_ids uuid[], p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  e public.stock_entries%rowtype;
  v_saldo numeric;
  v_nome text;
  v_mov uuid;
  v_n integer := 0; v_total integer := 0;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;
  if not public.fn_farmacia_opera_entradas() then raise exception 'Sem permissao para anular entradas da farmacia.'; end if;
  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Informe o motivo da anulacao (minimo 10 caracteres).';
  end if;
  if p_entry_ids is null or array_length(p_entry_ids, 1) is null then raise exception 'Nenhuma entrada selecionada.'; end if;

  for e in select * from public.stock_entries where id = any (p_entry_ids) order by created_at for update
  loop
    if e.item_type <> 'pharmacy' then raise exception 'Entrada de material: use a tela do almoxarifado.'; end if;
    if e.anulada_em is not null then raise exception 'Uma das entradas ja estava anulada.'; end if;
    select name into v_nome from public.pharmacy_items where id = e.item_id;
    if e.location_id is null then
      raise exception 'A entrada de "%" nao registrou o estoque onde entrou. Acerte pelo ajuste de estoque, com contagem.', v_nome;
    end if;

    select quantity into v_saldo from public.item_stocks
     where item_id = e.item_id and item_type = 'pharmacy' and location_id = e.location_id for update;
    if coalesce(v_saldo, 0) < e.quantity then
      raise exception 'Nao da para anular a entrada de "%": o saldo do estoque (%) e menor que a entrada (%) — parte ja saiu. Acerte pelo ajuste de estoque, com contagem.', v_nome, coalesce(v_saldo,0), e.quantity;
    end if;

    -- Saida no livro-razao; o gatilho abate item_stocks. O livro nunca e editado.
    insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity, unit_cost,
      source_location_id, expiry_tracking_id, performed_by, notes)
    values (e.item_id, 'pharmacy', 'AJUSTE', 'out', e.quantity, e.unit_price, e.location_id,
      e.expiry_tracking_id, v_uid,
      'Anulacao da entrada de ' || to_char(e.created_at at time zone 'America/Bahia', 'DD/MM/YYYY HH24:MI')
        || coalesce(' NF ' || nullif(btrim(e.invoice_number), ''), '') || ': ' || btrim(p_motivo))
    returning id into v_mov;

    if e.expiry_tracking_id is not null then
      update public.expiry_tracking
         set current_quantity = coalesce(current_quantity, 0) - e.quantity,
             initial_quantity = greatest(coalesce(initial_quantity, 0) - e.quantity, 0)
       where id = e.expiry_tracking_id;
    end if;

    update public.stock_entries
       set anulada_em = now(), anulada_por = v_uid, anulada_motivo = btrim(p_motivo), nf_pendente = false
     where id = e.id;

    insert into public.audit_logs (table_name, record_id, user_id, action, entity_type, entity_id, old_data, new_data)
    values ('stock_entries', e.id, v_uid, 'ANULAR_ENTRADA', 'pharmacy', e.item_id,
            to_jsonb(e), jsonb_build_object('motivo', btrim(p_motivo), 'movimento_ajuste', v_mov,
              'saldo_antes', v_saldo, 'saldo_depois', v_saldo - e.quantity));

    v_n := v_n + 1; v_total := v_total + e.quantity;
  end loop;

  if v_n = 0 then raise exception 'Entrada nao encontrada.'; end if;
  return jsonb_build_object('entradas', v_n, 'quantidade', v_total);
end $function$;
revoke execute on function public.farmacia_anular_entrada(uuid[], text) from public, anon;
grant execute on function public.farmacia_anular_entrada(uuid[], text) to authenticated;

-- 5) Entradas antigas da farmacia -----------------------------------------------------
update public.stock_entries
   set entry_group_id = md5(coalesce(created_by::text, '-') || '|' || created_at::text)::uuid
 where item_type = 'pharmacy' and entry_group_id is null;

-- Local e lote: o movimento ENTRADA_NF do mesmo item no mesmo instante.
-- Com o mesmo item duas vezes na rodada (lotes diferentes), casa pelo lote.
update public.stock_entries e
   set location_id = m.target_location_id, expiry_tracking_id = m.expiry_tracking_id
  from public.stock_movements m
  left join public.expiry_tracking t on t.id = m.expiry_tracking_id
 where e.item_type = 'pharmacy' and e.location_id is null
   and m.item_type = 'pharmacy' and m.movement_type = 'ENTRADA_NF' and m.direction = 'in'
   and m.item_id = e.item_id and m.performed_at = e.created_at
   and m.quantity = e.quantity
   and upper(btrim(coalesce(t.batch_number, ''))) = upper(btrim(coalesce(e.batch_number, '')));

update public.stock_entries
   set nf_pendente = true
 where item_type = 'pharmacy' and acquisition_type = 'Compra' and anulada_em is null
   and coalesce(nullif(btrim(invoice_number), ''), '—') in ('—','-','SN','S/N');
