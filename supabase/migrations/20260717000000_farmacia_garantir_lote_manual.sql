-- Farmácia: criar/achar um lote manualmente na hora de atender/dispensar.
--
-- Contexto: depois de zerar o estoque para recontagem, NENHUM medicamento tem
-- lote cadastrado. No atendimento de solicitação (e na dispensação) o
-- farmacêutico precisa informar o lote físico que está separando — mas não há
-- lote pra escolher no dropdown. Esta RPC deixa ele DIGITAR o lote: cria o
-- registro em expiry_tracking (no CAF, saldo 0) e devolve o id, pra ser
-- ligado em request_item_lots. Como o item está zerado, a saída fica negativa
-- (consentida — FA5) e a recontagem depois acerta o saldo.
--
-- SECURITY DEFINER porque o cliente não insere direto em expiry_tracking
-- (mesmo padrão de registrar_entrada_nf). location_id fica null e o trigger
-- fn_expiry_tracking_default_local carimba o CAF.
create or replace function farmacia_garantir_lote(
  p_item_id uuid,
  p_batch_number text,
  p_expiry_date date default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caf uuid;
  v_id uuid;
  v_batch text := nullif(trim(p_batch_number), '');
begin
  if p_item_id is null then
    raise exception 'Item não informado';
  end if;
  if v_batch is null then
    raise exception 'Número do lote é obrigatório';
  end if;

  select id into v_caf from stock_locations where code = 'CAF' limit 1;

  -- Já existe esse lote (mesmo item, mesmo número) no CAF? reaproveita.
  select id into v_id
    from expiry_tracking
   where item_id = p_item_id
     and lower(trim(batch_number)) = lower(v_batch)
     and coalesce(location_id, v_caf) = v_caf
   limit 1;

  if v_id is not null then
    -- completa a validade se veio agora e estava vazia
    if p_expiry_date is not null then
      update expiry_tracking
         set expiry_date = p_expiry_date
       where id = v_id and expiry_date is null;
    end if;
    return v_id;
  end if;

  insert into expiry_tracking(
    item_id, location_id, batch_number, expiry_date,
    initial_quantity, current_quantity, created_by
  ) values (
    p_item_id, v_caf, v_batch, p_expiry_date,
    0, 0, auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

grant execute on function farmacia_garantir_lote(uuid, text, date) to authenticated;
