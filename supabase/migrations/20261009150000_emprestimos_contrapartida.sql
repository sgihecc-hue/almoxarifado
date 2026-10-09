-- 09/10/2026: termo de permuta (modelo da Rafaela) tem o bloco "Por:" com o que vem em troca.
alter table public.loans add column if not exists contrapartida text;
