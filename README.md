# SGI-HECC — Gestão de Insumos (Farmácia + Almoxarifado)

Sistema de estoque, dispensação e pedidos entre setores do **Hospital Estadual Costa dos Coqueiros (HECC / FESF-SUS)**. Dois módulos — **Farmácia** e **Almoxarifado** — mais o **Pedido de Enfermagem** (kits e avulsos por paciente) e os registros regulatórios da farmácia (Portaria 344/98, CCIH).

## Stack

- **Frontend:** React 18 + TypeScript + Vite, Tailwind + shadcn/ui (Radix), React Router 6, React Query, react-hook-form + zod, Chart.js, xlsx.
- **Backend:** Supabase — Postgres com RLS, Auth (PKCE) e Edge Functions. Toda regra que mexe em saldo roda em **funções RPC `SECURITY DEFINER`**, numa transação só. O navegador nunca grava saldo direto.
- **Deploy:** Vercel, a partir da branch `main` deste repositório (`sgihecc-hue/almoxarifado`). Headers de segurança e CSP em `vercel.json`.

## Rodando localmente

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc (checagem de tipos) + vite build
```

`.env` na raiz:

```
VITE_SUPABASE_URL=...        # URL do projeto Supabase
VITE_SUPABASE_ANON_KEY=...   # chave anon (pública)
```

## Acesso e navegação

- **Papéis** (`users.role`): `administrador`, `gestor`, `atendente`, `solicitante`. O setor do usuário também conta: setores de enfermagem (código `ENF*` e a lista `farmacia_setores_enfermagem`) veem o Pedido de Enfermagem e não veem Dashboard/Configurações.
- **Sem autocadastro:** usuários são criados pelo administrador (tela Usuários → Edge Function `admin-create-user`). Troca de senha obrigatória no primeiro acesso.
- **Seletor de módulo:** Farmácia → escolhe o estoque (**CAF**, **Satélite 1º Andar**, **Satélite 2º Andar**, **Satélite Térreo**); Almoxarifado → `/almox/dashboard`. O estoque ativo fica no topo, com troca rápida. Menu lateral: `src/lib/constants/sidebar-menu.ts`.
- **LGPD:** termo de consentimento no primeiro acesso; ficha de paciente só para farmácia, gestão e enfermagem (RLS).

## Modelo de estoque

| Local | O que guarda | Onde fica o saldo |
|---|---|---|
| CAF, SAT_1, SAT_2 | medicamentos (`pharmacy_items`) | `item_stocks` por local, movido pelo livro-razão `stock_movements` |
| SAT_T (Satélite Térreo) | **materiais** (`warehouse_items`) | `item_stocks` do SAT_T |
| ALMOX | materiais (`warehouse_items`) | `warehouse_items.current_stock` (saldo global) |

- IDs fixos dos locais: `src/lib/constants/stock-locations.ts`.
- **Farmácia:** `stock_movements` é o livro-razão imutável; gatilhos aplicam cada movimento em `item_stocks` e espelham o CAF em `pharmacy_items.current_stock`. Saída abate lote por **FEFO** (ou lote escolhido).
- **Almoxarifado:** o saldo muda por entrega de solicitação (gatilho sobre `supplied_quantity`), entrada, saída direta, estorno e edição auditável. O **livro de movimentação** é a view `v_almox_movimentacao`, montada a partir de `audit_logs`.
- **Lotes e validade:** `expiry_tracking`, com lote normalizado e validade conferida (recusa datas impossíveis).
- **Entradas** (`stock_entries`): lançadas em rodada única, com trava contra duplo clique e aviso de entrada repetida. Dá para completar a NF depois, **editar** (quantidade, lote, validade, preço) e **anular com justificativa**; tudo fica no histórico da entrada.

## Funcionalidades

### Farmácia
- **Estoque** do local ativo, com Nova Entrada e Registrar Saída em lote (motivo + destino: fornecedor, unidade externa ou setor).
- **Operações:** Saídas, Entradas, Devoluções (enviadas pela enfermagem, confirmadas pela farmácia), Empréstimos (inclusive pagamento), Vencimentos, Etiquetas de Lote (Code128), Movimentações entre estoques e Pendências.
- **Dispensação:** por **prescrição** (paciente + prescritor) ou por **requisição** (setor), a partir de qualquer estoque da farmácia. Hoje todas concluem direto; a fila de aprovação farmacêutica existe, mas está desligada em `criar_dispensacao`. Cancelar estorna o estoque. Inclui alta do paciente e Carros de Emergência.
- **Cadastros** (só no CAF): Medicamentos, Fornecedores, Unidades Externas e Internas, Prescritores, Pacientes, Colaboradores. **Kits** de enfermagem: gestor e administrador.
- **Controlados e CCIH:** Livro de Controlados, BMPO, Perdas, Antimicrobianos, Intervenção Farmacêutica. Telas de Talidomida e Notificação de Receita existem nas rotas, mas estão fora do menu.
- **Relatórios:** Estoque, Consumo (lê os movimentos reais), Devoluções, Consumo Enfermagem, Gestão de Consumo, Multi-Estoque, Validade, Movimentações, Movimentação Diária — com lote e validade e exportação `.xlsx`.

### Almoxarifado
- Estoque, Etiquetas (código de barras), **Entrada por Leitor**, Entradas, Movimentação, **Ressuprimento** (POP.ALMXEPRO.09: consumo diário médio, ponto de ressuprimento, estoque mínimo e compra sugerida).
- Solicitações em sequência: Caixa de Entrada → Em Processamento → entrega → Confirmar Recebimento; Histórico e Pendências. Atendimento com vários lotes por item.
- Operações: Quebras e Avarias, Devoluções, Estorno, Empréstimos, Vencimentos, Movimentações, Saída Direta.
- Relatórios: Estoque, Consumo, Gestão de Consumo, Validade, Movimentações.
- **Painel de TV** (`/tv/warehouse`), ativo das 7h às 18h. Liga/desliga e horário em `src/lib/constants/tv-panels.ts`.

### Pedido de Enfermagem
Os setores de enfermagem pedem **kits** e **materiais avulsos**, sempre por paciente. O pedido vai para a **Satélite Térreo**, que atende e dá baixa no próprio estoque (`criar_pedido_enfermagem` → `atender_pedido_enfermagem` / `recusar_pedido_enfermagem`). Desenho: `docs/superpowers/specs/2026-09-20-kits-enfermagem-design.md`.

### Administração
Usuários (administrador), Setores (gestor cria e edita; só administrador exclui), Histórico Global (administrador), Meu Perfil e Configurações.

## Banco de dados

- **Migrations:** `supabase/migrations/`, aplicadas em ordem. As mais recentes (a partir de 2026-06) documentam no cabeçalho o problema que resolvem.
- **Schema drift:** parte do schema de produção (tabelas e RPCs antigas) nunca foi versionada. Para ter o schema completo, use `supabase db pull` ou `pg_dump --schema-only` do projeto real.
- **Principais RPCs:** `registrar_entrada_nf`, `registrar_entrada_estoque`, `registrar_entrada_farmacia`, `registrar_saida_lote`, `criar_saida_material`, `farmacia_reverter_saida`, `criar_dispensacao`, `cancelar_dispensacao`, `confirmar_recebimento_solicitacao`, `confirmar_recebimento_material`, `farmacia_devolucao_enviar` / `_confirmar`, `estornar_estoque_almox`, `almox_editar_item`, `almox_editar_lotes`, `criar_pedido_enfermagem`, `atender_pedido_enfermagem`, `farmacia_movimentacao_diaria`, `warehouse_consumo_diario`.
- **Auditoria:** `audit_logs`, alimentada por gatilhos nas tabelas regulatórias e operacionais.
- **Edge Functions** em `supabase/functions/`.

## Estrutura

```
src/
  pages/          telas (uma pasta por área: farmacia, almox, estoque, dispensacao, requests, reports...)
  components/     componentes compartilhados e ui/ (shadcn)
  lib/services/   acesso ao Supabase por domínio (items, stock, requests, kits...)
  lib/constants/  menu, locais de estoque, setores, painéis de TV
  contexts/       auth, módulo ativo, tema
supabase/
  migrations/     SQL versionado
  functions/      Edge Functions
docs/             backlog, specs e resumos de rodadas
```

## Documentação

- `docs/BACKLOG.md` — pendências.
- `docs/superpowers/specs/` — especificações de funcionalidades.
- `PLANO_FARMACIA_V2.md` — plano da versão 2 da farmácia.
