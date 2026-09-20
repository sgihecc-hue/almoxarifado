-- FARMACIA: "Pagamento de emprestimo" na entrada e na saida + campo Observacao.
--
-- Pedido da farmacia (18/09/2026):
--   * Entrada por pagamento de emprestimo: eu emprestei, a outra unidade me
--     pagou devolvendo o medicamento.
--   * Saida por pagamento de emprestimo: eu peguei emprestado e estou pagando.
--   * Campo de observacao livre na entrada e na saida.
--
-- ISOLAMENTO DO ALMOXARIFADO (regra do projeto):
--   * registrar_entrada_nf NAO e alterada. Ela atende o almox (Nova Entrada e
--     entrada por leitor) e mexer na assinatura ja causou overload ambiguo
--     (ver 20260819120000). A farmacia passa a usar a funcao NOVA abaixo,
--     registrar_entrada_farmacia, que e o ramo 'pharmacy' de
--     registrar_entrada_nf (versao 20260819140000) + a observacao.
--   * registrar_saida_lote NAO e alterada: ja recebe p_notes. So o CHECK de
--     stock_movements.reason ganha um valor novo. stock_movements e o ledger da
--     farmacia; a saida do almox nao grava motivo ali.
--   * stock_entries.acquisition_type e texto livre (sem CHECK): o valor
--     'Pagamento de empréstimo' nao exige alteracao de tabela.

-- 1) Motivo de saida novo -----------------------------------------------------
alter table public.stock_movements
  drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements
  add constraint stock_movements_reason_check
  check (
    reason is null
    or reason = any (array[
      'emprestimo','devolucao_fornecedor','quebra','vencimento','outro',
      'obito_sem_reaproveitamento','defeito_fabricacao','embalagem_violada',
      'falha_fracionamento','doacao','permuta','consignado','troca_validade',
      'transferencia','ajuste_inventario','pagamento_emprestimo'
    ])
  );

-- 2) Entrada da farmacia com observacao ---------------------------------------
create or replace function public.registrar_entrada_farmacia(
  p_invoice_number text, p_invoice_date date, p_afm_number text,
  p_supplier_cnpj text, p_supplier_name text, p_items jsonb,
  p_acquisition_type text default 'Compra', p_location_code text default null,
  p_delivery_date date default null, p_notes text default null)
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
      delivery_date, created_by, notes)
    values (v_item, 'pharmacy', v_qty, coalesce(p_acquisition_type,'Compra'), v_inv, v_invdate,
      v_line_total, v_exp, v_afm, v_cnpj, v_supp, v_price, v_batch, v_delivdate, v_uid, v_notes);

    v_count := v_count + 1; v_total_qty := v_total_qty + v_qty; v_total_val := v_total_val + v_line_total;
  end loop;

  return jsonb_build_object('itens', v_count, 'quantidade_total', v_total_qty, 'valor_total', v_total_val, 'local', v_code);
end $function$;

revoke execute on function public.registrar_entrada_farmacia(text, date, text, text, text, jsonb, text, text, date, text) from public, anon;
grant execute on function public.registrar_entrada_farmacia(text, date, text, text, text, jsonb, text, text, date, text) to authenticated;
