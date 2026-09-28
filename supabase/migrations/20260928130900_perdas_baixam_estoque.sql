-- =============================================================================
-- PERDAS / INUTILIZACAO baixam o estoque (auditoria 28/09/2026 — A8, M8)
--
-- ANTES: a tela Perdas so gravava medication_losses; o estoque e o lote nao
-- mudavam (9 perdas, 1 de controlado). Lote era texto livre.
-- AGORA:
--   * registrar_perda: escolhe um LOTE existente do local; numa transacao
--     baixa o saldo do local e o lote (recusa insuficiente), grava a saida
--     (stock_movements, entra no livro de controlados) e a perda ligada a ela
--     (movement_id). Controlado exige documento (termo) e justificativa
--     (Portaria 344/98), com o criterio unico fn_item_controlado.
--   * excluir_perda (so administrador): se a perda baixou estoque, devolve
--     saldo e lote antes de apagar.
--   * Editar perda: so campos de texto (motivo/documento/observacao/
--     responsavel); item, local, lote e quantidade de perda que ja baixou
--     estoque ficam travados (gatilho).
-- DADOS: as 9 perdas antigas NAO sao lancadas no estoque (decisao do dono);
--   ficam com movement_id nulo.
-- =============================================================================

alter table public.medication_losses
  add column if not exists movement_id uuid references public.stock_movements(id),
  add column if not exists expiry_tracking_id uuid references public.expiry_tracking(id),
  add column if not exists chave uuid;
create unique index if not exists medication_losses_chave on public.medication_losses (chave) where chave is not null;

create or replace function public.registrar_perda(
  p_item_id uuid, p_local_id uuid, p_lote_id uuid, p_quantidade integer, p_motivo text,
  p_documento text default null, p_observacao text default null, p_responsavel_nome text default null,
  p_chave uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_uid uuid;
  v_prev jsonb;
  v_code text;
  v_nome text;
  v_price numeric;
  v_ctrl boolean;
  v_batch text;
  v_val date;
  v_reason text;
  v_mov uuid;
  v_id uuid;
begin
  v_uid := public.fn_saidas_exigir_operador('farmacia', array['gestor','manager','atendente','pharmacist']);
  v_prev := public.fn_saidas_reservar_chave(p_chave, 'registrar_perda');
  if v_prev is not null then return v_prev; end if;

  if p_item_id is null then raise exception 'Item e obrigatorio.'; end if;
  if p_local_id is null then raise exception 'Local de estoque e obrigatorio.'; end if;
  if p_lote_id is null then raise exception 'Escolha o lote (rastreabilidade).'; end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Quantidade deve ser um numero inteiro maior que zero.'; end if;
  if coalesce(btrim(p_motivo),'') = '' then raise exception 'Motivo e obrigatorio.'; end if;
  if coalesce(btrim(p_responsavel_nome),'') = '' then raise exception 'Responsavel e obrigatorio.'; end if;

  select code into v_code from public.stock_locations where id = p_local_id;
  if v_code is null or v_code = 'ALMOX' then raise exception 'Local de estoque invalido para medicamento.'; end if;
  select name, price into v_nome, v_price from public.pharmacy_items where id = p_item_id;
  if v_nome is null then raise exception 'Medicamento nao encontrado.'; end if;
  v_ctrl := public.fn_item_controlado(p_item_id);
  if v_ctrl and (coalesce(btrim(p_documento),'') = '' or coalesce(btrim(p_observacao),'') = '') then
    raise exception 'Medicamento controlado: numero do termo/ata de inutilizacao e justificativa tecnica sao obrigatorios (Portaria 344/98).';
  end if;

  perform public.fn_saidas_conferir_saldo(p_item_id, 'pharmacy', p_local_id, p_quantidade);
  -- lote do local; perda de lote vencido e permitida (a perda e a baixa dele)
  perform public.fn_saidas_consumir_lotes(p_item_id, p_local_id, p_quantidade, p_lote_id, true, 'perda: ' || p_motivo);
  select batch_number, expiry_date into v_batch, v_val from public.expiry_tracking where id = p_lote_id;

  v_reason := case lower(p_motivo) when 'vencimento' then 'vencimento'
                                   when 'quebra' then 'quebra' when 'avaria' then 'quebra'
                                   else 'outro' end;
  insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity, unit_cost,
    source_location_id, reason, reason_detail, expiry_tracking_id, performed_by, notes)
  values (p_item_id, 'pharmacy', 'SAIDA_AVULSA', 'out', p_quantidade, v_price, p_local_id, v_reason,
    'Perda: ' || p_motivo || coalesce(' — termo ' || nullif(btrim(p_documento),''), ''), p_lote_id, v_uid,
    nullif(btrim(coalesce(p_observacao,'')),''))
  returning id into v_mov;

  insert into public.medication_losses(item_id, item_nome, stock_location_id, batch_number, expiry_date, quantity,
    motivo, documento, observacao, is_controlado, responsavel_nome, created_by, movement_id, expiry_tracking_id, chave)
  values (p_item_id, v_nome, p_local_id, v_batch, v_val, p_quantidade, p_motivo,
    nullif(btrim(coalesce(p_documento,'')),''), nullif(btrim(coalesce(p_observacao,'')),''), v_ctrl,
    btrim(p_responsavel_nome), v_uid, v_mov, p_lote_id, p_chave)
  returning id into v_id;

  return public.fn_saidas_gravar_resultado(p_chave, jsonb_build_object('id', v_id, 'movement_id', v_mov));
end $f$;
revoke execute on function public.registrar_perda(uuid, uuid, uuid, integer, text, text, text, text, uuid) from public, anon;
grant execute on function public.registrar_perda(uuid, uuid, uuid, integer, text, text, text, text, uuid) to authenticated;

create or replace function public.excluir_perda(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_uid uuid;
  l record;
  m record;
begin
  v_uid := public.fn_saidas_exigir_operador('farmacia', array['__so_administrador__']);
  if coalesce(length(btrim(p_motivo)),0) < 3 then raise exception 'Informe o motivo da exclusao.'; end if;
  select * into l from public.medication_losses where id = p_id for update;
  if not found then raise exception 'Perda nao encontrada.'; end if;

  if l.movement_id is not null then
    select * into m from public.stock_movements where id = l.movement_id for update;
    if not exists (select 1 from public.stock_movements where linked_movement_id = m.id and movement_type = 'DEVOLUCAO_INT') then
      insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity, target_location_id,
        reason_detail, expiry_tracking_id, linked_movement_id, performed_by, notes)
      values (m.item_id, 'pharmacy', 'DEVOLUCAO_INT', 'in', m.quantity, m.source_location_id,
        'Exclusao de perda lancada', m.expiry_tracking_id, m.id, v_uid, btrim(p_motivo));
      if m.expiry_tracking_id is not null then
        update public.expiry_tracking set current_quantity = current_quantity + m.quantity where id = m.expiry_tracking_id;
      end if;
    end if;
  end if;
  delete from public.medication_losses where id = p_id;
  return jsonb_build_object('id', p_id, 'estoque_devolvido', l.movement_id is not null);
end $f$;
revoke execute on function public.excluir_perda(uuid, text) from public, anon;
grant execute on function public.excluir_perda(uuid, text) to authenticated;

-- Perda que ja baixou estoque: so texto pode mudar.
create or replace function public.fn_perda_trava_campos()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $f$
begin
  if old.movement_id is not null and (
       new.item_id is distinct from old.item_id
    or new.stock_location_id is distinct from old.stock_location_id
    or new.batch_number is distinct from old.batch_number
    or new.expiry_date is distinct from old.expiry_date
    or new.quantity is distinct from old.quantity
    or new.movement_id is distinct from old.movement_id
    or new.expiry_tracking_id is distinct from old.expiry_tracking_id) then
    raise exception 'Esta perda ja baixou o estoque: item, local, lote e quantidade nao podem ser alterados. Exclua (administrador) e lance de novo.';
  end if;
  return new;
end $f$;
drop trigger if exists trg_perda_trava_campos on public.medication_losses;
create trigger trg_perda_trava_campos before update on public.medication_losses
  for each row execute function public.fn_perda_trava_campos();

-- Gravacao nova so pela RPC; edicao de texto continua pela policy existente.
drop policy if exists losses_insert on public.medication_losses;
drop policy if exists losses_delete on public.medication_losses;
revoke insert, delete, truncate on public.medication_losses from anon, authenticated;
revoke update on public.medication_losses from anon;

-- Farmaceutico registra perda pela RPC e precisa ver a lista.
drop policy if exists losses_select on public.medication_losses;
create policy losses_select on public.medication_losses for select to authenticated
  using (auth_user_role() = any (array['administrador','gestor','atendente','pharmacist']));
