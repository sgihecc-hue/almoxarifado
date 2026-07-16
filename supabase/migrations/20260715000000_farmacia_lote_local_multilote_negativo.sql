-- =====================================================================
-- FARMÁCIA — FA4 (lote x local), FA3 (multi-lote), FA5 (estoque negativo)
-- Aplicado em PRODUÇÃO e TESTE em 2026-07-15.
-- Contexto: a farmácia foi ZERADA (inventário será refeito), então não há
-- legado a reconciliar — os lotes remanescentes estão todos com qtd 0.
-- =====================================================================

-- ---------- FA4: lote passa a ter LOCAL ----------
-- Antes, expiry_tracking não tinha local: a lista de lotes era global por
-- item. Isso fazia (a) satélite mostrar lote do CAF, (b) soma dos lotes não
-- bater com o saldo, (c) item zerado ainda exibir lote.
ALTER TABLE public.expiry_tracking
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.stock_locations(id);

CREATE INDEX IF NOT EXISTS idx_expiry_tracking_item_local
  ON public.expiry_tracking(item_id, location_id);

-- Legados (todos zerados após o zeramento) vão pro CAF, onde a entrada por NF cai.
UPDATE public.expiry_tracking SET location_id = (SELECT id FROM stock_locations WHERE code='CAF')
 WHERE location_id IS NULL;

-- View expõe o local. location_id vai no FIM: CREATE OR REPLACE VIEW só
-- permite ACRESCENTAR colunas no final.
CREATE OR REPLACE VIEW public.v_itens_a_vencer AS
 SELECT et.id AS expiry_tracking_id, et.item_id, 'pharmacy'::text AS item_type,
    pi.name AS item_name, pi.medication_class, et.batch_number, et.expiry_date,
    et.current_quantity, pi.price AS unit_cost,
    round(et.current_quantity::numeric * COALESCE(pi.price, 0::numeric), 2) AS estimated_value,
    CASE WHEN et.expiry_date <= (CURRENT_DATE + '1 mon'::interval) THEN '1m'::text
         WHEN et.expiry_date <= (CURRENT_DATE + '3 mons'::interval) THEN '3m'::text
         ELSE '6m'::text END AS color_band,
    et.location_id
   FROM expiry_tracking et
     JOIN pharmacy_items pi ON pi.id = et.item_id
  WHERE et.current_quantity > 0 AND et.expiry_date > CURRENT_DATE
    AND et.expiry_date <= (CURRENT_DATE + '6 mons'::interval)
UNION ALL
 SELECT wi.id, wi.id, 'warehouse'::text,
    wi.name, NULL::text, wi.batch_number, wi.expiry_date,
    wi.current_stock, wi.price,
    round(wi.current_stock::numeric * COALESCE(wi.price, 0::numeric), 2),
    CASE WHEN wi.expiry_date <= (CURRENT_DATE + '1 mon'::interval) THEN '1m'::text
         WHEN wi.expiry_date <= (CURRENT_DATE + '3 mons'::interval) THEN '3m'::text
         ELSE '6m'::text END,
    NULL::uuid
   FROM warehouse_items wi
  WHERE wi.is_active = true AND wi.current_stock > 0 AND wi.expiry_date IS NOT NULL
    AND wi.expiry_date > CURRENT_DATE AND wi.expiry_date <= (CURRENT_DATE + '6 mons'::interval);

-- ---------- FA5: saída permite saldo NEGATIVO ----------
-- Antes o trigger dava erro quando não havia linha de saldo. Agora cria a
-- linha negativa: cobre o item que existe no físico mas não foi lançado.
-- Ao dar entrada depois, o negativo é compensado. A confirmação é na UI.
CREATE OR REPLACE FUNCTION public.fn_apply_stock_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  loc uuid;
BEGIN
  IF NEW.direction = 'out' THEN
    loc := NEW.source_location_id;
    INSERT INTO public.item_stocks (item_id, item_type, location_id, quantity)
    VALUES (NEW.item_id, NEW.item_type, loc, -NEW.quantity)
    ON CONFLICT (item_id, item_type, location_id)
    DO UPDATE SET quantity = public.item_stocks.quantity - NEW.quantity, updated_at = now();
  ELSE
    loc := NEW.target_location_id;
    INSERT INTO public.item_stocks (item_id, item_type, location_id, quantity)
    VALUES (NEW.item_id, NEW.item_type, loc, NEW.quantity)
    ON CONFLICT (item_id, item_type, location_id)
    DO UPDATE SET quantity = public.item_stocks.quantity + NEW.quantity, updated_at = now();
  END IF;
  RETURN NEW;
END $fn$;

-- ---------- FA3: multi-lote + abate do lote ----------
-- A RPC passa a ler request_item_lots (N lotes por item), com fallback pro
-- lote único legado. BÔNUS: agora ABATE a quantidade do lote — antes isso
-- nunca acontecia, o que era parte da razão dos lotes não baterem com o saldo.
-- FA2: usa supplied_quantity (o que de fato saiu); item com 0 é pulado.
CREATE OR REPLACE FUNCTION public.confirmar_recebimento_solicitacao(p_request_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $fn$
declare
  v_status text; v_type text; v_dept_id uuid; v_dept text;
  v_caf uuid; v_target uuid; v_uid uuid := auth.uid();
  ri record; lt record;
  v_qty integer; v_moved integer := 0; v_tem_lotes boolean;
begin
  if v_uid is null then raise exception 'Usuario nao autenticado.'; end if;

  select status, type, department_id into v_status, v_type, v_dept_id
    from public.requests where id = p_request_id for update;
  if not found then raise exception 'Solicitacao nao encontrada.'; end if;
  if v_status <> 'delivered' then
    raise exception 'Solicitacao nao esta aguardando recebimento (status atual: %).', v_status;
  end if;

  if v_type = 'pharmacy' then
    select id into v_caf from public.stock_locations where code = 'CAF';
    select lower(name) into v_dept from public.departments where id = v_dept_id;
    if v_dept ~* 'sat.?lite' then
      if v_dept ~* 't.rreo' then select id into v_target from public.stock_locations where code='SAT_T';
      elsif v_dept ~ '1' then select id into v_target from public.stock_locations where code='SAT_1';
      elsif v_dept ~ '2' then select id into v_target from public.stock_locations where code='SAT_2';
      end if;
    end if;

    for ri in
      select id, pharmacy_item_id, quantity, approved_quantity, supplied_quantity, expiry_tracking_id
        from public.request_items
       where request_id = p_request_id and item_type = 'pharmacy' and pharmacy_item_id is not null
    loop
      v_qty := coalesce(ri.supplied_quantity, ri.approved_quantity, ri.quantity);
      if v_qty is null or v_qty <= 0 then continue; end if;

      select exists(select 1 from public.request_item_lots where request_item_id = ri.id and quantity > 0)
        into v_tem_lotes;

      if v_tem_lotes then
        for lt in select expiry_tracking_id, quantity from public.request_item_lots
                   where request_item_id = ri.id and quantity > 0
        loop
          insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
            source_location_id, request_id, performed_by, notes, expiry_tracking_id)
          values (ri.pharmacy_item_id, 'pharmacy', 'SOLICITACAO', 'out', lt.quantity,
            v_caf, p_request_id, v_uid, 'Atendimento de solicitacao (lote)', lt.expiry_tracking_id);

          if v_target is not null then
            insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
              target_location_id, request_id, performed_by, notes, expiry_tracking_id)
            values (ri.pharmacy_item_id, 'pharmacy', 'SOLICITACAO', 'in', lt.quantity,
              v_target, p_request_id, v_uid, 'Recebimento em satelite (lote)', lt.expiry_tracking_id);
          end if;

          if lt.expiry_tracking_id is not null then
            update public.expiry_tracking set current_quantity = greatest(current_quantity - lt.quantity, 0)
             where id = lt.expiry_tracking_id;
          end if;
          v_moved := v_moved + 1;
        end loop;
      else
        insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
          source_location_id, request_id, performed_by, notes, expiry_tracking_id)
        values (ri.pharmacy_item_id, 'pharmacy', 'SOLICITACAO', 'out', v_qty,
          v_caf, p_request_id, v_uid, 'Atendimento de solicitacao', ri.expiry_tracking_id);

        if v_target is not null then
          insert into public.stock_movements(item_id, item_type, movement_type, direction, quantity,
            target_location_id, request_id, performed_by, notes, expiry_tracking_id)
          values (ri.pharmacy_item_id, 'pharmacy', 'SOLICITACAO', 'in', v_qty,
            v_target, p_request_id, v_uid, 'Recebimento em satelite', ri.expiry_tracking_id);
        end if;

        if ri.expiry_tracking_id is not null then
          update public.expiry_tracking set current_quantity = greatest(current_quantity - v_qty, 0)
           where id = ri.expiry_tracking_id;
        end if;
        v_moved := v_moved + 1;
      end if;
    end loop;
  end if;

  update public.requests
     set status='completed', received_at=now(), received_by=v_uid,
         receipt_notes=nullif(btrim(coalesce(p_notes,'')),''),
         completed_at=now(), completed_by=v_uid, needs_receipt_confirmation=false
   where id = p_request_id;

  return jsonb_build_object('request_id', p_request_id, 'type', v_type,
    'target_location_id', v_target, 'items_movimentados', v_moved);
end
$fn$;
