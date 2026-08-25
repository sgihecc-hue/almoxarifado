-- LIVRO DE MOVIMENTACAO DO ALMOXARIFADO (leitura)
--
-- O almoxarifado nao usa stock_movements: o saldo dele vive em
-- warehouse_items.current_stock e e alterado por varios caminhos (gatilho de
-- entrega, entrada por NF, saida direta, estorno, correcao de inventario e
-- edicao direta). Nenhum desses caminhos escrevia um "movimento", e por isso
-- ninguem conseguia responder "para onde foi o estoque".
--
-- O dado, porem, JA EXISTE: o gatilho audit_warehouse_items_changes grava em
-- audit_logs o estado ANTES e DEPOIS de cada alteracao, com autor e horario,
-- desde 01/07/2026. Faltava traduzir isso para linguagem de estoque.
--
-- Esta view NAO cria gatilho novo, NAO altera saldo e NAO toca em nenhum fluxo
-- existente. E leitura pura sobre o que ja e gravado — risco zero de regressao.
--
-- Limite conhecido: a auditoria registra QUEM e QUANDO, mas nao POR QUE. O
-- motivo e inferido pela proximidade com pedidos e entradas (coluna origem).
-- PERMISSAO — decisao deliberada, leia antes de mudar:
-- audit_logs so pode ser lida por administrador (a tabela guarda alteracoes de
-- TODAS as tabelas, incluindo pacientes e consentimentos LGPD). Com
-- security_invoker=on esta view devolvia ZERO linhas para atendente e gestor,
-- que sao justamente quem precisa consultar movimentacao.
--
-- Por isso a view roda com a permissao do DONO (sem security_invoker) e o
-- controle de acesso fica AQUI DENTRO: ela filtra table_name='warehouse_items',
-- entao expoe apenas movimentacao de material — nada de paciente, nada de LGPD
-- — e ainda exige que o usuario tenha papel de operacao.
-- NAO troque isto por security_invoker=on sem antes liberar audit_logs, ou a
-- tela volta a abrir vazia.
create or replace view public.v_almox_movimentacao as
select
  a.id,
  a.created_at                                          as data,
  a.record_id                                           as item_id,
  wi.name                                               as item,
  wi.code                                               as codigo,
  wi.unit                                               as unidade,
  (a.old_data->>'current_stock')::numeric               as saldo_antes,
  (a.new_data->>'current_stock')::numeric               as saldo_depois,
  (a.new_data->>'current_stock')::numeric
    - (a.old_data->>'current_stock')::numeric           as delta,
  case
    when (a.new_data->>'current_stock')::numeric
       > (a.old_data->>'current_stock')::numeric then 'entrada'
    else 'saida'
  end                                                   as tipo,
  coalesce(a.changed_by, a.user_id)                     as usuario_id,
  u.full_name                                           as usuario,
  -- Origem provavel: casa o horario da alteracao com o que aconteceu no mesmo
  -- minuto. E uma pista, nao um vinculo — por isso o nome "provavel".
  case
    when exists (
      select 1 from public.stock_entries e
       where e.item_id = a.record_id and e.item_type = 'warehouse'
         and e.created_at between a.created_at - interval '2 minutes'
                              and a.created_at + interval '2 minutes'
    ) then 'entrada por nota/inventario'
    when exists (
      select 1 from public.request_items ri
        join public.requests r on r.id = ri.request_id
       where ri.warehouse_item_id = a.record_id
         and r.updated_at between a.created_at - interval '2 minutes'
                              and a.created_at + interval '2 minutes'
    ) then 'atendimento de solicitacao'
    else 'ajuste direto no cadastro'
  end                                                   as origem_provavel
from public.audit_logs a
left join public.warehouse_items wi on wi.id = a.record_id
left join public.users u on u.id = coalesce(a.changed_by, a.user_id)
where a.table_name = 'warehouse_items'
  and a.old_data is not null
  and a.new_data is not null
  and (a.old_data->>'current_stock') is distinct from (a.new_data->>'current_stock')
  -- Papeis de operacao. Solicitante nao ve movimentacao de estoque.
  and exists (
    select 1 from public.users me
     where me.id = auth.uid()
       and me.role in ('administrador','admin','gestor','manager',
                       'atendente','warehouse_manager','pharmacist')
  );

grant select on public.v_almox_movimentacao to authenticated;

comment on view public.v_almox_movimentacao is
  'Livro de movimentacao do almoxarifado, derivado de audit_logs. Leitura pura: nao altera saldo nem cria gatilho. Cobre de 01/07/2026 em diante, que e quando a auditoria comecou.';
