-- Normaliza a leitura de suppliers e external_units.
--
-- Antes a policy de SELECT usava auth.role() = 'authenticated' com roles={public}.
-- Trocamos por "for select to authenticated using (true)": mesma permissao
-- efetiva, sem depender de auth.role(), e sem expor os dados ao papel anon
-- (fornecedor/CNPJ nao devem ser legiveis sem login).
--
-- Obs: o dropdown de Fornecedor vazio na Nova Entrada NAO era RLS — era o
-- frontend mapeando external_units.nome (a coluna correta e "name"), o que
-- estourava o sort e zerava a lista inteira. Corrigido em nf-entry.tsx.

revoke select on public.suppliers from anon;
revoke select on public.external_units from anon;

drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
  for select to authenticated using (true);

drop policy if exists external_units_select on public.external_units;
create policy external_units_select on public.external_units
  for select to authenticated using (true);
