-- Troca de unidade de item com saldo/movimentacao: liberada para gestor e
-- administrador (Rafaela 19/11: nao conseguia corrigir unidades de
-- fornecimento erradas, ex. saco para obito "pacote com 20" em UND).
-- A quantidade NAO e convertida; a tela avisa antes de salvar e a troca fica
-- no historico de edicao do item. Demais perfis continuam bloqueados.
create or replace function public.fn_bloqueia_troca_unidade()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tem boolean;
begin
  if new.unit is not distinct from old.unit then
    return new;
  end if;
  if exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('gestor', 'administrador')) then
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
    raise exception 'A unidade de "%" nao pode ser trocada (% -> %): o item ja tem movimentacao ou saldo. So gestor ou administrador pode corrigir a unidade.',
      old.name, old.unit, new.unit
      using errcode = 'check_violation';
  end if;
  return new;
end $function$;
