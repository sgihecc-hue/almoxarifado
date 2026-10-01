-- 01/10/2026: registro INTERNO dos erros que o usuario ve na tela (pedido do
-- Adonias). Antes, quando alguem dizia "tentei lancar e deu erro", nao havia
-- rastro: o banco desfaz a gravacao e nao loga erro (log_min_messages=fatal).
-- O app grava aqui toda mensagem de erro mostrada (getErrorMessage), erro de
-- tela (ErrorBoundary) e erro solto do navegador. Usuario nao ve nada; so
-- administrador le (e nos, via banco).
create table if not exists public.app_erros (
  id bigserial primary key,
  criado_em timestamptz not null default now(),
  usuario_id uuid default auth.uid(),
  tipo text not null default 'mensagem' check (tipo in ('mensagem','tela','navegador')),
  rota text check (length(rota) <= 500),
  mensagem_usuario text check (length(mensagem_usuario) <= 1000),
  mensagem_tecnica text check (length(mensagem_tecnica) <= 4000),
  codigo text check (length(codigo) <= 100),
  detalhe jsonb,
  navegador text check (length(navegador) <= 500)
);
create index if not exists app_erros_criado on public.app_erros (criado_em desc);
create index if not exists app_erros_usuario on public.app_erros (usuario_id, criado_em desc);

alter table public.app_erros enable row level security;
drop policy if exists app_erros_insert on public.app_erros;
create policy app_erros_insert on public.app_erros for insert to anon, authenticated
  with check (usuario_id is null or usuario_id = auth.uid());
drop policy if exists app_erros_select on public.app_erros;
create policy app_erros_select on public.app_erros for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('administrador','admin')));
revoke all on public.app_erros from anon, authenticated;
grant insert on public.app_erros to anon, authenticated;
grant select on public.app_erros to authenticated;
grant usage on sequence public.app_erros_id_seq to anon, authenticated;

-- Leitura rapida para o suporte: ultimos erros com nome do usuario.
create or replace view public.v_app_erros as
select e.id, e.criado_em at time zone 'America/Bahia' as quando, u.full_name as usuario, u.role as perfil,
       e.tipo, e.rota, e.mensagem_usuario, e.mensagem_tecnica, e.codigo, e.detalhe
  from public.app_erros e left join public.users u on u.id = e.usuario_id;
revoke all on public.v_app_erros from anon, authenticated;
