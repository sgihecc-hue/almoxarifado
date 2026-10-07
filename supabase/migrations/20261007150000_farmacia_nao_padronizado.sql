-- 07/10/2026: pedido da Andressa. Marca explicita de medicamento NAO
-- padronizado (o campo padronizado=false e o padrao de 270 itens, entao nao
-- serve como marca). Na tela de estoque a linha do item fica laranja.
alter table public.pharmacy_items
  add column if not exists nao_padronizado boolean not null default false;

comment on column public.pharmacy_items.nao_padronizado is
  'Medicamento nao padronizado (marcado no cadastro). Destaque laranja na tela de estoque.';
