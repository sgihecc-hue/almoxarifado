# Kits e avulsos pela enfermagem — Satélite Térreo

Data: 20/09/2026. Pedido do Adonias.

## Problema

Os enfermeiros dos Postos vão passar a pedir **kits** (conjuntos fixos de material,
ex.: Kit Banho) e **materiais avulsos**, sempre dizendo **para qual paciente**.
Quem atende é a **Farmácia Satélite Térreo**, e o pedido precisa chegar para
quem estiver lá, como já chegam os pedidos de material hoje.

A lista de kits e a composição de cada um ainda não existem. Esta rodada entrega
a estrutura; os kits são cadastrados depois, pela tela de cadastro.

## Decisões

1. **Kit é fechado para quem pede, aberto para quem atende.** O enfermeiro pede
   "5 × Kit Banho". A satélite recebe os itens somados (5 × 2A = 10A, etc.).
2. **O pedido é gravado já somado** em `request_items`. A satélite separa, informa
   lote e dá baixa com a tela e as RPCs que já existem. Kits e pacientes ficam em
   tabelas próprias, ligadas ao pedido, e aparecem no detalhe.
3. **Kit é só material** (`warehouse_items`), que é o que a Satélite Térreo tem
   (131 itens com saldo, contra 12 medicamentos com 1 a 8 unidades).
   Medicamento continua saindo por **dispensação**, que é o fluxo com prescritor,
   fila de aprovação farmacêutica e Livro de Controlados. `kit_items` já nasce com
   `item_type`, então aceitar medicamento um dia é decisão de fluxo, não de schema.
4. **Paciente sempre**, vindo do cadastro que a farmácia já usa (`patients`, 148
   fichas, 91 internados). Cadastro na hora quando o paciente não existe. Um
   segundo cadastro de paciente criaria duas verdades para o mesmo nome.
   Puxar paciente por API do sistema do hospital fica para depois; `patients`
   ganha `external_id` desde já para a sincronização não virar retrabalho.
5. **Kit × paciente:** lista de pacientes com quantidade por paciente
   (João 2, Maria 1 = 3 kits). **Avulso:** paciente por linha.
6. **Fluxo:** pendente → aprovado → em separação → entregue. **Sem** confirmação
   de recebimento (`needs_receipt_confirmation = false`).
7. **Cadastro de kits:** gestor e administrador.
8. **Quem pede:** os setores já roteados para a Satélite Térreo por
   `departments.default_warehouse_location_id` — hoje Posto Térreo, 1º e 2º Andar.
   Não é preciso marcar "setor de enfermagem" em lugar nenhum.
9. **Quem atende:** quem estiver na Satélite Térreo. A caixa de entrada da
   farmácia, com a Satélite Térreo como estoque ativo, passa a listar os pedidos
   de material roteados para ela (hoje ela filtra só medicamento). Os pedidos
   seguem visíveis no módulo Almoxarifado como já são.

## Dados

Quatro tabelas novas. Nenhuma alteração nas existentes, exceto `patients.external_id`.

```
kits(id, name, description, is_active, created_by, created_at, updated_at)
kit_items(id, kit_id, item_type='warehouse', warehouse_item_id, pharmacy_item_id,
          quantity, unit)
request_kits(id, request_id, kit_id, kit_name, patient_id, patient_name, quantity)
request_item_patients(id, request_id, request_item_id, patient_id, patient_name,
                      quantity)
```

`kit_name` e `patient_name` são cópia do nome no momento do pedido: se o kit for
renomeado ou recomposto depois, o histórico continua contando o que foi pedido.

**RPC `criar_pedido_enfermagem`** (`SECURITY DEFINER`, transação única):
recebe kits com seus pacientes e avulsos com seus pacientes; valida o setor
(precisa estar roteado para a Satélite Térreo) e os itens; soma as quantidades por
item; grava `requests` (type `warehouse`, `source_location_id` = SAT_T,
`needs_receipt_confirmation` = false), `request_items`, `request_kits` e
`request_item_patients`. Devolve o número do pedido.

## Telas

1. **Cadastro de Kits** (gestor/administrador): lista, criar, editar, inativar;
   itens do kit com quantidade.
2. **Pedido de Enfermagem** (setores roteados para a Satélite Térreo):
   kits → pacientes com quantidade → avulsos com paciente por linha → resumo,
   mostrando o total por item que a satélite vai receber.
3. **Detalhe do pedido**: bloco "Kits e pacientes", só leitura, para a satélite.
4. **Caixa de entrada da farmácia**: lista os pedidos de material quando o estoque
   ativo é a Satélite Térreo.

## Isolamento do almoxarifado

Regra máxima do projeto. Nesta rodada:

- Nenhuma tabela, RPC ou tela do almoxarifado é alterada. Tudo que é novo são
  tabelas novas, uma RPC nova e telas novas.
- O fluxo de solicitação atual (`requestsService.create`) não é tocado; o pedido de
  enfermagem tem caminho próprio.
- A mudança na caixa de entrada fica condicionada a "módulo Farmácia com a
  Satélite Térreo como estoque ativo". O módulo Almoxarifado segue idêntico.

## Segurança e LGPD

- `kits` e `kit_items`: leitura para autenticado; escrita só gestor/administrador.
- `request_kits` e `request_item_patients`: leitura para quem já pode ver o pedido.
- Hoje a política de `patients` é `Authenticated users can manage patients [ALL]`,
  aberta para os 249 solicitantes. Antes de liberar a tela, restringir a enfermagem
  a ler e criar, sem apagar.

## Fases

1. **Esta rodada:** tabelas, RPC, cadastro de kits, tela de pedido, bloco no
   detalhe, caixa de entrada da satélite.
2. Relatório de consumo por paciente e por kit.
3. Paciente vindo por API do sistema do hospital, preenchendo `patients.external_id`.

## Fora de escopo

- Kit com medicamento.
- Paciente obrigatório para os outros setores que pedem à Satélite Térreo.
- Confirmação de recebimento pela enfermagem.
