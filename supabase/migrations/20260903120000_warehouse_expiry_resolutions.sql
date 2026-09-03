-- "Marcar como Resolvido" em Itens a Vencer sempre falhava para o
-- ALMOXARIFADO com "registro referenciado em outro cadastro" (FK 23503).
--
-- Causa: a view v_itens_a_vencer usa warehouse_items.id como
-- expiry_tracking_id pra dar uma linha por lote de material (o almoxarifado
-- nao tem tabela propria de lote, so guarda validade no proprio item). O
-- botao gravava esse id em expiry_alert_resolutions.expiry_tracking_id, cuja
-- FK exige que o id exista em expiry_tracking — o que nunca acontece pra um
-- item de almoxarifado. expiry_alert_resolutions esta com 0 linhas no banco
-- inteiro: nunca funcionou pra ninguem.
--
-- Fix: tabela PROPRIA do almoxarifado, com FK para warehouse_items. Nao
-- muda uma linha sequer de expiry_alert_resolutions nem do fluxo da
-- farmacia — so cria algo novo, exclusivo do material.

create table public.warehouse_expiry_resolutions (
  id uuid primary key default gen_random_uuid(),
  warehouse_item_id uuid not null references public.warehouse_items(id),
  color_band text not null,
  resolved_by uuid not null,
  resolved_at timestamptz not null default now(),
  unique (warehouse_item_id, color_band)
);

alter table public.warehouse_expiry_resolutions enable row level security;

create policy "warehouse_expiry_res_read" on public.warehouse_expiry_resolutions
  for select to authenticated using (true);

create policy "warehouse_expiry_res_write" on public.warehouse_expiry_resolutions
  for insert to authenticated with check (true);
