-- 05/10/2026: cada estoque e separado, garantido NO BANCO (abaixo de qualquer tela
-- ou funcao). Pedido do Adonias depois do caso dos pedidos entre satelites que
-- saiam da CAF. Todo movimento de estoque (stock_movements) passa por aqui:
--   1) movimento com lote: o lote TEM que estar no mesmo estoque do movimento
--      (saida: estoque de origem; entrada: estoque de destino);
--   2) movimento de pedido da farmacia: a saida TEM que ser do estoque de origem
--      do pedido (setor solicitado) e a entrada no estoque de quem pediu.
create or replace function public.fn_trava_estoque_separado()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_lote_loc uuid; v_lote text; v_mov_loc uuid;
  v_req record; v_nome_a text; v_nome_b text;
begin
  v_mov_loc := case when new.direction = 'out' then new.source_location_id else new.target_location_id end;

  if new.expiry_tracking_id is not null and v_mov_loc is not null then
    select location_id, batch_number into v_lote_loc, v_lote from public.expiry_tracking where id = new.expiry_tracking_id;
    if v_lote_loc is distinct from v_mov_loc then
      select name into v_nome_a from public.stock_locations where id = v_lote_loc;
      select name into v_nome_b from public.stock_locations where id = v_mov_loc;
      raise exception 'Estoques separados: o lote % pertence a % e o movimento e de %. Cada estoque so movimenta os proprios lotes.',
        coalesce(v_lote, '?'), coalesce(v_nome_a, '?'), coalesce(v_nome_b, '?');
    end if;
  end if;

  if new.request_id is not null then
    select type, source_location_id, target_location_id, request_number into v_req from public.requests where id = new.request_id;
    if v_req.type = 'pharmacy' and v_req.source_location_id is not null then
      if new.direction = 'out' and new.source_location_id is distinct from v_req.source_location_id then
        select name into v_nome_a from public.stock_locations where id = v_req.source_location_id;
        select name into v_nome_b from public.stock_locations where id = new.source_location_id;
        raise exception 'Estoques separados: o pedido #% sai de %, mas o movimento tentou tirar de %.',
          v_req.request_number, coalesce(v_nome_a, '?'), coalesce(v_nome_b, '?');
      end if;
      if new.direction = 'in' and v_req.target_location_id is not null and new.target_location_id is distinct from v_req.target_location_id then
        select name into v_nome_a from public.stock_locations where id = v_req.target_location_id;
        select name into v_nome_b from public.stock_locations where id = new.target_location_id;
        raise exception 'Estoques separados: o pedido #% entra em %, mas o movimento tentou colocar em %.',
          v_req.request_number, coalesce(v_nome_a, '?'), coalesce(v_nome_b, '?');
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trava_estoque_separado on public.stock_movements;
create trigger trg_trava_estoque_separado
  before insert on public.stock_movements
  for each row execute function public.fn_trava_estoque_separado();
