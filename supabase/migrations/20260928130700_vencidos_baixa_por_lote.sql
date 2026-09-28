-- =============================================================================
-- BAIXA DE VENCIDOS por lote (auditoria 28/09/2026 — A6)
--
-- ANTES: a tela "Itens a Vencer" (secao vencidos) fazia um laco no navegador
-- com uma saida por lote, SEMPRE do CAF (mesmo lote que esta na Satelite 1/2),
-- sem enviar o lote (o lote nao diminuia e podia ser baixado de novo) e sem
-- transacao (parou no meio = metade baixada).
-- AGORA:
--   * a view expiring_to_writeoff traz o local do lote (location_id/codigo);
--   * baixar_vencidos(lotes[], chave): tudo numa transacao; cada lote sai do
--     SEU local, abate o proprio lote ate zero, trava lote e saldo, recusa se
--     o saldo do local nao cobre, ignora lote que ja foi baixado (idempotente)
--     e confere papel/modulo farmacia.
-- =============================================================================

create or replace view public.expiring_to_writeoff with (security_invoker = on) as
 select et.id as expiry_tracking_id,
    et.item_id,
    'pharmacy'::text as item_type,
    et.batch_number,
    et.expiry_date,
    et.current_quantity,
    pi.name as item_name,
    pi.price as unit_cost,
    (et.current_quantity::numeric * pi.price) as estimated_loss,
    et.location_id,
    sl.code as location_code
   from public.expiry_tracking et
     join public.pharmacy_items pi on pi.id = et.item_id
     left join public.stock_locations sl on sl.id = et.location_id
  where et.expiry_date is not null and et.expiry_date < current_date and et.current_quantity > 0;

revoke insert, update, delete, truncate, references, trigger on public.expiring_to_writeoff from anon, authenticated;
revoke select on public.expiring_to_writeoff from anon;
grant select on public.expiring_to_writeoff to authenticated;

create or replace function public.baixar_vencidos(p_lotes uuid[], p_chave uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_uid uuid;
  v_prev jsonb;
  v_id uuid;
  e record;
  v_nome text;
  v_saldo integer;
  v_price numeric;
  v_lotes integer := 0;
  v_total integer := 0;
  v_ignorados integer := 0;
begin
  v_uid := public.fn_saidas_exigir_operador('farmacia');
  v_prev := public.fn_saidas_reservar_chave(p_chave, 'baixar_vencidos');
  if v_prev is not null then return v_prev; end if;
  if p_lotes is null or cardinality(p_lotes) = 0 then raise exception 'Selecione ao menos um lote.'; end if;

  foreach v_id in array p_lotes
  loop
    select et.*, sl.code as loc_code into e
      from public.expiry_tracking et left join public.stock_locations sl on sl.id = et.location_id
     where et.id = v_id
     for update of et;
    if not found then raise exception 'Lote nao encontrado.'; end if;
    select name, price into v_nome, v_price from public.pharmacy_items where id = e.item_id;
    if v_nome is null then raise exception 'O lote % nao e de medicamento da farmacia.', coalesce(e.batch_number,'(sem numero)'); end if;
    if e.location_id is null or e.loc_code = 'ALMOX' then
      raise exception 'O lote % de "%" esta sem estoque de farmacia definido.', coalesce(e.batch_number,'(sem numero)'), v_nome;
    end if;
    if e.expiry_date is null or e.expiry_date >= current_date then
      raise exception 'O lote % de "%" nao esta vencido.', coalesce(e.batch_number,'(sem numero)'), v_nome;
    end if;
    if coalesce(e.current_quantity, 0) <= 0 then
      v_ignorados := v_ignorados + 1;   -- ja baixado
      continue;
    end if;

    select quantity into v_saldo from public.item_stocks
     where item_id = e.item_id and item_type = 'pharmacy' and location_id = e.location_id
     for update;
    if coalesce(v_saldo, 0) < e.current_quantity then
      raise exception 'Saldo de "%" em % (%) e menor que o lote vencido % (%). Acerte o lote/saldo antes de baixar.',
        v_nome, e.loc_code, coalesce(v_saldo,0), coalesce(e.batch_number,'(sem numero)'), e.current_quantity;
    end if;

    insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity, unit_cost,
      source_location_id, reason, reason_detail, expiry_tracking_id, performed_by, notes)
    values (e.item_id, 'pharmacy', 'SAIDA_AVULSA', 'out', e.current_quantity, v_price,
      e.location_id, 'vencimento',
      'Lote ' || coalesce(e.batch_number,'(sem numero)') || ' | Venc: ' || to_char(e.expiry_date,'DD/MM/YYYY'),
      e.id, v_uid, 'Baixa em massa de itens vencidos');
    update public.expiry_tracking set current_quantity = 0 where id = e.id;

    v_lotes := v_lotes + 1;
    v_total := v_total + e.current_quantity;
  end loop;

  return public.fn_saidas_gravar_resultado(p_chave,
    jsonb_build_object('lotes', v_lotes, 'quantidade_total', v_total, 'ja_baixados', v_ignorados));
end $f$;
revoke execute on function public.baixar_vencidos(uuid[], uuid) from public, anon;
grant execute on function public.baixar_vencidos(uuid[], uuid) to authenticated;
