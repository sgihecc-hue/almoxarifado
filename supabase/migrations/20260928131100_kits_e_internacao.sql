-- =============================================================================
-- KITS e INTERNACAO (auditoria 28/09/2026 — itens baixos / duplo clique)
--   * kit_definir_itens: a tela apagava a composicao e depois inseria; se o
--     insert falhasse o kit ficava VAZIO. Agora e uma transacao so.
--   * patient_admissions: duplo clique em "Internar" criava duas internacoes
--     abertas. Indice unico parcial: uma internacao aberta por paciente
--     (conferido em 28/09: nenhum paciente com duas abertas hoje).
-- =============================================================================

create or replace function public.kit_definir_itens(p_kit_id uuid, p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  it jsonb;
  v_qtd integer;
  v_n integer := 0;
begin
  perform public.fn_saidas_exigir_operador('farmacia', array['gestor','manager']);
  perform 1 from public.kits where id = p_kit_id for update;
  if not found then raise exception 'Kit nao encontrado.'; end if;
  if jsonb_typeof(coalesce(p_itens,'[]'::jsonb)) <> 'array' then raise exception 'Lista de itens invalida.'; end if;

  delete from public.kit_items where kit_id = p_kit_id;
  for it in select value from jsonb_array_elements(coalesce(p_itens,'[]'::jsonb))
  loop
    begin v_qtd := (it->>'quantity')::integer; exception when others then raise exception 'Quantidade invalida em um item do kit.'; end;
    if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade invalida em um item do kit.'; end if;
    insert into public.kit_items(kit_id, item_type, warehouse_item_id, quantity, unit)
    values (p_kit_id, 'warehouse', (it->>'item_id')::uuid, v_qtd, nullif(btrim(coalesce(it->>'unit','')),''));
    v_n := v_n + 1;
  end loop;
  update public.kits set updated_at = now() where id = p_kit_id;
  return jsonb_build_object('kit_id', p_kit_id, 'itens', v_n);
end $f$;
revoke execute on function public.kit_definir_itens(uuid, jsonb) from public, anon;
grant execute on function public.kit_definir_itens(uuid, jsonb) to authenticated;

create unique index if not exists patient_admissions_uma_aberta
  on public.patient_admissions (patient_id) where discharge_date is null;
