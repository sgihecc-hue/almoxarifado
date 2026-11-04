-- Planilha de funcionarios (Rafaela 04/11/2026): o campo "Quem retirou" da
-- entrega do almox buscava so nos usuarios do sistema. Quem nao tem login
-- (enfermeiros, tecnicos, fisio...) passa a ficar em public.employees e a
-- busca olha as duas tabelas. requests.received_by_employee_id continua
-- apontando para users; para quem vem de employees grava-se so a matricula
-- em received_by_employee_matricula.

drop function if exists public.lookup_employee_by_matricula(text);
create function public.lookup_employee_by_matricula(mat text)
returns table(id uuid, full_name text, matricula text, cargo text, department_name text, origem text)
language sql stable security definer set search_path to ''
as $$
  select * from (
    select u.id, u.full_name, u.matricula, u.role::text,
           (select d.name from public.departments d where d.id = u.department_id), 'usuario'
      from public.users u where u.matricula = btrim(mat)
    union all
    select e.id, e.full_name, e.matricula, e.cargo,
           (select d.name from public.departments d where d.id = e.department_id), 'funcionario'
      from public.employees e
     where e.matricula = btrim(mat) and e.is_active
       and not exists (select 1 from public.users u where u.matricula = e.matricula)
  ) x
  limit 1
$$;
grant execute on function public.lookup_employee_by_matricula(text) to anon, authenticated;

-- Busca por nome nas duas tabelas, sem acento e sem diferenca de maiuscula.
create or replace function public.buscar_colaboradores(q text)
returns table(id uuid, full_name text, matricula text, cargo text, department_name text, origem text)
language sql stable security definer set search_path to ''
as $$
  with t as (
    select '%' || translate(lower(btrim(q)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') || '%' as p
  )
  select * from (
    select u.id, u.full_name, u.matricula, u.role::text,
           (select d.name from public.departments d where d.id = u.department_id), 'usuario'
      from public.users u, t
     where translate(lower(u.full_name), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like t.p
    union all
    select e.id, e.full_name, e.matricula, e.cargo,
           (select d.name from public.departments d where d.id = e.department_id), 'funcionario'
      from public.employees e, t
     where e.is_active
       and translate(lower(e.full_name), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like t.p
       and not exists (select 1 from public.users u where u.matricula = e.matricula)
  ) x
  order by 2
  limit 15
$$;
revoke execute on function public.buscar_colaboradores(text) from public, anon;
grant execute on function public.buscar_colaboradores(text) to authenticated;

-- Planilha de funcionarios da Rafaela (04/11/2026).
-- 1) Matricula nos usuarios que ja existem (achados pelo nome).
update public.users set matricula='18911' where id='4f3b6932-c88f-473c-8ea8-813ca88912a5';  -- antes: None
update public.users set matricula='12556' where id='e50073ec-fc91-4841-91c7-b940636bd900';  -- antes: None
update public.users set matricula='1427' where id='1be112ab-a1bd-4a86-8361-f31bf0fd5a3c';  -- antes: None
update public.users set matricula='17785' where id='802da1fc-9272-4583-a27e-d6cd406f06fa';  -- antes: None
update public.users set matricula='16955' where id='2def9466-aabc-458f-ba2e-b165daf0fa67';  -- antes: None
update public.users set matricula='19545' where id='c1477753-a3e9-4d15-a633-716d57cd518c';  -- antes: None
update public.users set matricula='1453' where id='851081da-5344-401c-ab4a-69a74ff77e01';  -- antes: None
update public.users set matricula='18975' where id='e60c1deb-93cf-4427-ab6c-1baa321af80e';  -- antes: None
update public.users set matricula='1390' where id='c7038d84-9639-44ee-8018-a2f6374bdb43';  -- antes: None
update public.users set matricula='1400' where id='bf28ca38-2537-4f8e-be84-41e88122d865';  -- antes: None
update public.users set matricula='1470' where id='bd0179c5-a2e6-459b-9437-ad4bf04e6d7d';  -- antes: None
update public.users set matricula='15781' where id='be9a2370-a49f-4856-b36d-25910b01e1eb';  -- antes: None
update public.users set matricula='15391' where id='085bb7eb-5ed1-4998-9477-a1f425b50cd3';  -- antes: None
update public.users set matricula='15688' where id='158b69b5-86d8-401f-a666-21fefd252bb2';  -- antes: None
update public.users set matricula='18540' where id='0344979c-fe07-41a2-964c-757635a3e241';  -- antes: None
update public.users set matricula='18554' where id='a9f0fedf-1aaf-4bc9-87ab-a58a602a5f24';  -- antes: None
update public.users set matricula='15001' where id='a9217f8e-9af6-42e2-b5b2-98cbb696ce7b';  -- antes: None
update public.users set matricula='14623' where id='96f761aa-c8b3-4037-bf4a-96805fd6637a';  -- antes: None
update public.users set matricula='16850' where id='2d4d9fdd-c6ff-4d78-9258-7fb982bab763';  -- antes: None
update public.users set matricula='7546' where id='c93a77b9-73fb-4fb3-ba73-f5b0ae4da776';  -- antes: 17889
update public.users set matricula='15388' where id='d79e0890-1c99-4b44-a8c8-3869b00e1912';  -- antes: None
update public.users set matricula='15066' where id='2de18dbd-a3ff-4e7b-b892-633570409f5e';  -- antes: None
update public.users set matricula='112833' where id='64a27580-4a98-451d-bb8e-37e0102b8d4f';  -- antes: 17828
update public.users set matricula='1975' where id='ce774abb-118f-42aa-b68e-b664fe5ab134';  -- antes: None
update public.users set matricula='18628' where id='95e7b81a-1014-4149-a0c4-aae9bc6ae2f0';  -- antes: None
update public.users set matricula='1397' where id='3b8dd353-e1d7-46a9-b9ab-4af28307ba42';  -- antes: None
update public.users set matricula='1458' where id='19dfdbe6-703b-4134-b50e-736167f2154c';  -- antes: None
update public.users set matricula='1432' where id='6fbc869c-72df-4784-a88f-286db2c5d577';  -- antes: None
update public.users set matricula='1455' where id='838a72ed-38a2-42ec-bbc8-87352a6fe02a';  -- antes: None
update public.users set matricula='15690' where id='918e5b92-fa1d-44ec-a01d-a9ae0c10be79';  -- antes: None
update public.users set matricula='18658' where id='bd28aa68-2b29-423d-8c37-02500f97a57c';  -- antes: None
update public.users set matricula='1398' where id='19d4b2c8-2a7a-4ca8-86ee-8916d82e72b3';  -- antes: None
update public.users set matricula='1421' where id='d0b3ed59-3ff6-4450-8769-94c7a199208b';  -- antes: None
update public.users set matricula='1982' where id='4da16b8f-f2f7-497b-bdda-9cef71e04890';  -- antes: None
update public.users set matricula='15549' where id='c2b20223-182f-4967-980f-30b7bde2a239';  -- antes: None
update public.users set matricula='17256' where id='41540ec1-cfcc-4e0b-b42a-28d7147ffb99';  -- antes: None
update public.users set matricula='1430' where id='b52a1036-2255-4ec6-8de5-c1986c63f167';  -- antes: None
update public.users set matricula='15200' where id='cf68057c-0014-402c-9f63-fa8face9dd44';  -- antes: None
update public.users set matricula='17564' where id='639b7cec-b8e4-4132-b8de-5cddc1f6507c';  -- antes: None
update public.users set matricula='18748' where id='00fe83c0-6d7e-4f14-88ed-9188273d709a';  -- antes: None
update public.users set matricula='15008' where id='9d9d4c55-0457-405f-9e96-bb16292ddcfc';  -- antes: None
update public.users set matricula='1508' where id='4847c1ba-5364-49ed-bd65-366ae0c0c80f';  -- antes: None
update public.users set matricula='18699' where id='ab2c7cbd-a586-4ca4-bcb7-b5f6511574f6';  -- antes: None
update public.users set matricula='17574' where id='a027567d-b5a5-4a84-8a28-21cc52d492f0';  -- antes: None
update public.users set matricula='1465' where id='160ea378-60b0-435b-aaca-09dbe9b1ae51';  -- antes: None
update public.users set matricula='1636' where id='c8a0d216-9980-46ef-b47c-19c6e5a75dbd';  -- antes: None
update public.users set matricula='1468' where id='ac6282c2-2fd4-434a-bc11-5e019b0329e0';  -- antes: None
update public.users set matricula='18347' where id='fb4865d2-760e-401a-9796-4a31f653ce64';  -- antes: None
update public.users set matricula='15551' where id='8ae6daa2-67bd-4990-9ef5-cdf131628b8d';  -- antes: None
update public.users set matricula='18914' where id='7ee9bd3e-1927-4c24-b0c2-9417d2c9fca8';  -- antes: None
update public.users set matricula='17944' where id='69894c87-6083-48a9-adf1-52a4fcc135b3';  -- antes: None
update public.users set matricula='18677' where id='c892f2a3-b3c5-4371-ba66-40116ccf2d35';  -- antes: None
update public.users set matricula='12997' where id='5f40038c-16bd-47b4-aff5-6c4596a9896a';  -- antes: None
update public.users set matricula='15397' where id='f4d7fc29-3ea2-42e4-b8f3-68e3657a0b48';  -- antes: None
update public.users set matricula='18655' where id='ea690eca-b2e4-4131-9b66-edf3978fa4b1';  -- antes: None
update public.users set matricula='15554' where id='2c854580-8671-4aff-ae9b-66789b3ec871';  -- antes: None
update public.users set matricula='15108' where id='943033d6-b5db-4f93-9798-972b7ccd6b26';  -- antes: None
update public.users set matricula='1476' where id='7ada3aaf-b549-4dab-bfec-f288ae256937';  -- antes: None
update public.users set matricula='15390' where id='aaadeed8-1a21-4a1c-98d7-52ffe89bd1b8';  -- antes: None
update public.users set matricula='1506' where id='6538e2db-a80f-46b1-84be-1872fbef500b';  -- antes: None
update public.users set matricula='1606' where id='5fc822cd-a130-423f-9481-0ad7c777b659';  -- antes: None
update public.users set matricula='15552' where id='11613f23-5265-4abd-8e8e-e3b906e3393f';  -- antes: None
update public.users set matricula='16761' where id='679f50b9-97d1-437f-a736-c6d4832b6ffa';  -- antes: None
update public.users set matricula='15553' where id='53feeaaa-114e-4512-989f-4e53dcd4ac77';  -- antes: None
update public.users set matricula='1605' where id='4154a7eb-c047-494f-bfe5-51acfd255d63';  -- antes: None
update public.users set matricula='1625' where id='6d197f37-41cc-43a4-808f-9fa1f9668bea';  -- antes: None

-- 2) Funcionarios sem login no sistema: ficam na tabela employees.
insert into public.employees(matricula, full_name, cargo, is_active) values
  ('7530', 'Dejanice Pereira da Silva', 'Assistente social', true),
  ('14832', 'Almir Oliveira Soares Neto', 'Enfermeiro (a) 40 H', true),
  ('191103', 'Camila Galvão dos Santos', 'Enfermeiro (a) 40 H', true),
  ('1498', 'Clarissa Campos Faria de Moura', 'Enfermeiro (a) 40 H', true),
  ('14881', 'Fernanda Rosa de Lima', 'Enfermeiro (a) 40 H', true),
  ('14847', 'Lorena Celestino dos Santos', 'Enfermeiro (a) 40 H', true),
  ('14821', 'Maria Carolina Cayres Mehmeri Gusmão', 'Enfermeiro (a) 40 H', true),
  ('1102', 'Marla Maria Bitencourt Pereira', 'Enfermeiro (a) 40 H', true),
  ('14831', 'Carlliany Patricia Onofre Silvino', 'Fisioterapeuta', true),
  ('7522', 'Flavia Diniz Gonçalves Santana', 'Fisioterapeuta', true),
  ('1796', 'Jessica Souza dos Santos Barbosa', 'Nutricionista', true),
  ('14598', 'Maria Cristina Jesus de Oliveira', 'Supervisão Administrativo', true),
  ('1478', 'Ana Karoline de Oliveira De Souza', 'Técnico de Enfermagem 36 h', true),
  ('15693', 'Barbara da Conceicao Pinto', 'Técnico de Enfermagem 36 h', true),
  ('1499', 'Cilena Lessa dos Santos', 'Técnico de Enfermagem 36 h', true),
  ('7645', 'Cirleia de Jesus Almeida', 'Técnico de Enfermagem 36 h', true),
  ('7688', 'Crisnaly de Oliveira Meireles', 'Técnico de Enfermagem 36 h', true),
  ('1012', 'Daniele da Silva Araujo', 'Técnico de Enfermagem 36 h', true),
  ('7523', 'Debora Cristina Santos Bispo', 'Técnico de Enfermagem 36 h', true),
  ('74291', 'Edivania Ferreira da Silva', 'Técnico de Enfermagem 36 h', true),
  ('18417', 'Eduardo Santos Franca Damasceno', 'Técnico de Enfermagem 36 h', true),
  ('191105', 'Iasmin Oliveira dos Santos', 'Técnico de Enfermagem 36 h', true),
  ('7524', 'Ingrid da Silva Mesquita Oliveira', 'Técnico de Enfermagem 36 h', true),
  ('91104', 'Isabele Campos Geambastiani Trindade', 'Técnico de Enfermagem 36 h', true),
  ('1009', 'Ione Santos de Souza', 'Técnico de Enfermagem 36 h', true),
  ('15697', 'Luciana Souto Conceicao', 'Técnico de Enfermagem 36 h', true),
  ('1108', 'Marcia Moreira Rangel', 'Técnico de Enfermagem 36 h', true),
  ('1010', 'Maria Conceição Nascimento da Silva', 'Técnico de Enfermagem 36 h', true),
  ('74292', 'Marinan Jesus de Oliveira', 'Técnico de Enfermagem 36 h', true),
  ('191102', 'Sandra Marli França Lima', 'Técnico de Enfermagem 36 h', true),
  ('1107', 'Suyanne Raianny da Silva Conceição', 'Técnico de Enfermagem 36 h', true),
  ('14281', 'Tairlane Souza dos Santos', 'Técnico de Enfermagem 36 h', true),
  ('74855', 'Uilma Maria Santana da Silva', 'Técnico de Enfermagem 36 h', true),
  ('14815', 'Vitoria Albuquerque Lima', 'Técnico de Enfermagem 36 h', true),
  ('1477', 'Viviane dos Santos Nascimento', 'Técnico de Enfermagem 36 h', true);
