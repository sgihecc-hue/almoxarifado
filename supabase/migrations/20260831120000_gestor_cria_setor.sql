-- Gestor passa a criar e editar setor (departments).
--
-- Motivo: a coordenação do Almoxarifado deixou de ser 'administrador' e virou
-- 'gestor' (31/08). Criar setor era exclusivo de administrador, e cadastrar
-- setor é rotina de coordenação, não de administração do sistema.
--
-- EXCLUIR continua só com administrador: apagar setor desvincula os usuários
-- daquele setor e é irreversível pela tela.
--
-- ATENÇÃO — não é mudança de um módulo só: `departments` é compartilhada por
-- farmácia e almoxarifado, então isto vale para TODO gestor dos dois lados.
--
-- Somente ALTER de policy. Nenhum dado é lido, alterado ou apagado.

drop policy if exists "Admins can insert departments" on public.departments;
create policy "Admins can insert departments" on public.departments
  for insert to authenticated
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = any (array['admin', 'administrador', 'gestor', 'manager'])
    )
  );

drop policy if exists "Admins can update departments" on public.departments;
create policy "Admins can update departments" on public.departments
  for update to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = any (array['admin', 'administrador', 'gestor', 'manager'])
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = any (array['admin', 'administrador', 'gestor', 'manager'])
    )
  );

-- DELETE fica como está (só admin/administrador) — de propósito.
