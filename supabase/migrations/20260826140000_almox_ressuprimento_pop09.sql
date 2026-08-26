-- POP.ALMXEPRO.09 — Calculo de ponto de ressuprimento e estoque minimo.
--
-- Traduz as cinco formulas do POP para uma view, por item do almoxarifado:
--   CDM (consumo diario medio) = consumo semanal / 7
--   Consumo mensal             = CDM * 30
--   Ponto de ressuprimento     = CDM * prazo de reposicao (lead time)
--   Estoque minimo (seguranca) = CDM * 45 dias de cobertura
--   Qtd. estimada de compra    = CDM * 90 dias de horizonte
--
-- DE ONDE VEM O CONSUMO — decisao deliberada, leia antes de mudar:
-- somam-se os dois canais pelos quais material realmente SAI do almoxarifado:
--   1) pedido atendido  (request_items de requests entregues)
--   2) saida direta     (warehouse_dispatch_items)
-- Entrada por nota e ajuste de cadastro ficam de fora de proposito. Ajuste nao
-- e consumo: contar as correcoes de inventario como saida inflaria o CDM e o
-- hospital passaria a comprar demais.
--
-- Os pedidos aparecem como 'delivered' ate 01/07/2026 e como 'completed' dai em
-- diante — os dois status contam, senao o historico some no meio.
--
-- JANELA: 8 semanas COMPLETAS. O POP exige "periodo representativo (minimo 4
-- semanas)"; 8 absorve melhor os picos. A semana corrente fica de fora de
-- proposito: esta pela metade e puxaria o CDM para baixo.
--
-- LEAD TIME: warehouse_items.lead_time_days quando preenchido; senao 30 dias,
-- o prazo do exemplo do POP. A coluna e a fonte oficial (vem do Setor de
-- Compras) — preencher la ja corrige o item, sem mexer nesta view.
--
-- PERMISSAO: roda com direito do dono e filtra papel no corpo, como
-- v_almox_movimentacao. E de proposito: o indicador de compra tem de ser o
-- MESMO para todo mundo que o consulta. Com security_invoker, a RLS de
-- requests faria cada usuario ver um CDM diferente, conforme os pedidos que
-- enxerga — e o numero de compra deixaria de ser confiavel.

create or replace view public.v_almox_ressuprimento as
with periodo as (
  select date_trunc('week', now())                          as fim,
         date_trunc('week', now()) - interval '8 weeks'     as ini
),
consumo as (
  select item_id, sum(qtd) as unidades from (
    -- 1) material entregue em pedido
    select ri.warehouse_item_id as item_id,
           coalesce(ri.supplied_quantity, ri.delivered_quantity, 0)::numeric as qtd
    from public.request_items ri
    join public.requests r on r.id = ri.request_id
    cross join periodo p
    where r.type = 'warehouse'
      and r.status in ('delivered','completed')
      and ri.warehouse_item_id is not null
      and r.updated_at >= p.ini and r.updated_at < p.fim
    union all
    -- 2) saida direta
    select di.item_id, di.quantity::numeric
    from public.warehouse_dispatch_items di
    join public.warehouse_dispatches d on d.id = di.dispatch_id
    cross join periodo p
    where d.created_at >= p.ini and d.created_at < p.fim
  ) t
  where item_id is not null
  group by item_id
)
select
  wi.id            as item_id,
  wi.name          as item,
  wi.code          as codigo,
  wi.unit          as unidade,
  wi.current_stock as saldo_atual,
  coalesce(c.unidades, 0)                    as consumo_periodo,
  round(coalesce(c.unidades, 0) / 8.0,  2)   as consumo_semanal,
  round(coalesce(c.unidades, 0) / 56.0, 2)   as cdm,
  ceil(coalesce(c.unidades, 0) / 56.0 * 30)  as consumo_mensal,
  coalesce(nullif(wi.lead_time_days, 0), 30) as prazo_reposicao,
  ceil(coalesce(c.unidades, 0) / 56.0
       * coalesce(nullif(wi.lead_time_days, 0), 30))  as ponto_ressuprimento,
  ceil(coalesce(c.unidades, 0) / 56.0 * 45)  as estoque_minimo,
  ceil(coalesce(c.unidades, 0) / 56.0 * 90)  as compra_estimada_90d,
  -- Dias que o saldo cobre no ritmo atual. null quando nao houve consumo:
  -- item parado nao tem previsao, e "infinito" so confundiria a leitura.
  case when coalesce(c.unidades, 0) > 0
       then round(wi.current_stock / (c.unidades / 56.0), 1) end as dias_de_cobertura,
  -- O gatilho de compra do POP (passo 10) e o PONTO DE RESSUPRIMENTO.
  -- O minimo de 45 dias e meta de cobertura, nao alarme: como 45 > lead time
  -- na maioria dos itens, alertar pelo minimo deixaria quase tudo vermelho o
  -- tempo todo e o aviso perderia o sentido.
  case
    when coalesce(c.unidades, 0) = 0 then 'sem consumo'
    when wi.current_stock <= 0       then 'zerado'
    when wi.current_stock <= ceil(c.unidades / 56.0
         * coalesce(nullif(wi.lead_time_days, 0), 30)) then 'comprar'
    else 'ok'
  end as situacao,
  -- Avisa que o prazo veio do padrao do POP, e nao de Compras. A tela usa isto
  -- para marcar que o numero ainda precisa ser confirmado.
  (coalesce(wi.lead_time_days, 0) = 0) as prazo_padrao
from public.warehouse_items wi
left join consumo c on c.item_id = wi.id
where wi.is_active
  and exists (
    select 1 from public.users me
    where me.id = auth.uid()
      and me.role in ('administrador','admin','gestor','manager',
                      'atendente','warehouse_manager','pharmacist')
  );

grant select on public.v_almox_ressuprimento to authenticated;

comment on view public.v_almox_ressuprimento is
  'POP.ALMXEPRO.09: CDM, ponto de ressuprimento, estoque minimo e compra '
  'estimada por item do almoxarifado. Consumo = 8 semanas completas de '
  'pedidos atendidos + saidas diretas.';
