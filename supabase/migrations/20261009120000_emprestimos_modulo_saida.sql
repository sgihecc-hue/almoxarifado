-- 09/10/2026: pedido da Rafaela. Emprestimo/doacao/permuta do ALMOXARIFADO passa
-- a dar saida no estoque ao salvar (via criar_saida_direta_almox) e a tela separa
-- os registros por modulo. Antes a tela so buscava itens da farmacia e nao baixava nada.
alter table public.loans add column if not exists modulo text not null default 'farmacia';
alter table public.loans add column if not exists saida_id uuid;
alter table public.loans drop constraint if exists loans_modulo_check;
alter table public.loans add constraint loans_modulo_check check (modulo in ('farmacia','almoxarifado'));
comment on column public.loans.saida_id is 'Saida Direta do almox (warehouse_dispatches.id) gerada ao salvar o emprestimo.';
