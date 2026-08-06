import {
  Building2,
  ClipboardList,
  UserCircle,
  LayoutDashboard,
  Settings,
  Users,
  FileText,
  BarChart3,
  InboxIcon,
  CheckSquare,
  History,
  AlertCircle,
  ListChecks,
  Database,
  Pill,
  Package2,
  Tv,
  Syringe,
  PackageMinus,
  Undo2,
  ArrowRightLeft,
  Handshake,
  CalendarX,
  Stethoscope,
  UsersRound,
  CalendarClock,
  Clock,
  BookOpen,
  Shield,
  PackageCheck,
  Barcode,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { PharmacyStock } from './stock-locations'

export type SidebarModule = 'farmacia' | 'almoxarifado' | 'shared' | 'admin'

export interface SidebarItem {
  name: string
  icon: LucideIcon
  href: string
  show: (flags: VisibilityFlags) => boolean
  submenu?: { name: string; href: string; icon: LucideIcon }[]
}

export interface SidebarSection {
  title: string
  module: SidebarModule
  items: SidebarItem[]
}

export interface VisibilityFlags {
  isAdmin: boolean
  isManager: boolean
  isAtendente: boolean
  isEnfermagem: boolean
  canManageRequests: boolean
}

export function buildSidebarSections(ctx?: { pharmacyStock?: PharmacyStock | null }): SidebarSection[] {
  // Estoque de farmácia é escolhido no topo; a sidebar mostra só o estoque atual.
  const stock = ctx?.pharmacyStock ?? null
  // Dispensação só ocorre nas farmácias satélites — não no CAF.
  const isSat = !!stock && stock.code !== 'CAF'
  // Cadastros (medicamentos, fornecedores, prescritores...) são centralizados:
  // só aparecem no CAF. Satélite opera com o cadastro feito lá.
  const isCaf = !!stock && stock.code === 'CAF'
  return [
    // --- PRINCIPAL: dashboard + painéis de TV numa seção só, compacta ---
    {
      title: 'Início',
      module: 'shared',
      items: [
        { name: 'Dashboard', icon: LayoutDashboard, href: '/', show: (f) => !f.isEnfermagem },
      ],
    },
    {
      title: 'Início',
      module: 'farmacia',
      items: [
        { name: 'Painel TV', icon: Tv, href: '/tv/pharmacy', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
      ],
    },
    {
      title: 'Início',
      module: 'almoxarifado',
      items: [
        { name: 'Painel TV', icon: Tv, href: '/tv/warehouse', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
      ],
    },
    // --- SOLICITAÇÕES: separado por modulo pra permitir divergencia.
    //     Farmacia usa titulo "Solicitações" e item "Solicitações" (sem
    //     "Minhas"). Almox mantem "Minhas Solicitações" pra nao quebrar
    //     o hábito dos usuarios que ja conhecem esse fluxo. ---
    {
      title: 'Solicitações',
      module: 'farmacia',
      items: [
        { name: 'Solicitações', icon: ClipboardList, href: '/requests', show: () => true },
        { name: 'Nova Solicitação', icon: ListChecks, href: '/requests/new', show: () => true },
        { name: 'Confirmar Recebimento', icon: PackageCheck, href: '/requests/receipt-confirmation', show: () => true },
        // "Caixa de Entrada" e "Em Processamento" removidas da FARMÁCIA a
        // pedido do usuário — o atendimento é feito por "Solicitações". As
        // equivalentes do ALMOXARIFADO (/almox/requests/*) continuam, porque
        // lá o fluxo é sequencial (aprovar → processar → entregar).
        { name: 'Histórico', icon: History, href: '/requests/history', show: (f) => f.canManageRequests },
        { name: 'Pendências', icon: AlertCircle, href: '/requests/pending', show: (f) => f.canManageRequests },
      ],
    },
    {
      title: 'Solicitações',
      module: 'almoxarifado',
      items: [
        // Paths /almox/* para as telas filtrarem só solicitações 'warehouse'
        // (o path indica o módulo mesmo para atendente, que não tem activeModule).
        { name: 'Minhas Solicitações', icon: ClipboardList, href: '/almox/requests', show: () => true },
        { name: 'Nova Solicitação', icon: ListChecks, href: '/requests/new', show: () => true },
        { name: 'Confirmar Recebimento', icon: PackageCheck, href: '/requests/receipt-confirmation', show: () => true },
        { name: 'Caixa de Entrada', icon: InboxIcon, href: '/almox/requests/inbox', show: (f) => f.canManageRequests },
        { name: 'Em Processamento', icon: CheckSquare, href: '/almox/requests/processing', show: (f) => f.canManageRequests },
        { name: 'Histórico', icon: History, href: '/almox/requests/history', show: (f) => f.canManageRequests },
        { name: 'Pendências', icon: AlertCircle, href: '/almox/requests/pending', show: (f) => f.canManageRequests },
      ],
    },
    // --- ESTOQUE ---
    {
      title: 'Estoque',
      module: 'farmacia',
      items: stock
        ? [{ name: stock.label, icon: Building2, href: `/inventory/stock/${stock.id}`, show: (f) => f.isManager || f.isAdmin || f.isAtendente }]
        : [],
    },
    {
      title: 'Estoque',
      module: 'almoxarifado',
      items: [
        { name: 'Almoxarifado', icon: Package2, href: '/inventory/warehouse', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
        { name: 'Etiquetas (código de barras)', icon: Barcode, href: '/almox/etiquetas', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
      ],
    },
    // --- OPERAÇÕES: separado por modulo. Farmacia NAO ve "Quebras e
    //     Avarias" (essas passam a ser tratadas por outro fluxo — Perdas).
    //     Almox mantem tudo, incluindo Quebras/Avarias.
    {
      title: 'Operações',
      module: 'farmacia',
      items: [
        { name: 'Devoluções', icon: Undo2, href: '/estoque/devolucao', show: () => true },
        { name: 'Empréstimos', icon: Handshake, href: '/estoque/emprestimos', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
        { name: 'Vencimentos', icon: CalendarX, href: '/estoque/vencimentos', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
      ],
    },
    {
      title: 'Operações',
      module: 'almoxarifado',
      items: [
        { name: 'Quebras e Avarias', icon: PackageMinus, href: '/estoque/saida-avulsa', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
        { name: 'Devoluções', icon: Undo2, href: '/estoque/devolucao', show: () => true },
        { name: 'Estorno', icon: Undo2, href: '/almox/estoque/estorno', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
        { name: 'Empréstimos', icon: Handshake, href: '/estoque/emprestimos', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
        // Usa o path /almox/* para a tela de vencimentos saber que é o módulo
        // almoxarifado e filtrar só itens 'warehouse' (evita mostrar farmácia).
        { name: 'Vencimentos', icon: CalendarX, href: '/almox/estoque/vencimentos', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
      ],
    },
    {
      title: 'Operações',
      module: 'farmacia',
      items: [
        { name: 'Movimentações', icon: ArrowRightLeft, href: '/farmacia/movimentacoes', show: (f) => f.canManageRequests },
        { name: 'Nova Movimentação', icon: ListChecks, href: '/farmacia/movimentacoes/new', show: (f) => f.canManageRequests },
        { name: 'Pendências', icon: Clock, href: '/farmacia/movimentacoes/pendencias', show: (f) => f.canManageRequests },
      ],
    },
    {
      title: 'Operações',
      module: 'almoxarifado',
      items: [
        { name: 'Movimentações', icon: ArrowRightLeft, href: '/almoxarifado/movimentacoes', show: (f) => f.canManageRequests },
        { name: 'Nova Movimentação', icon: ListChecks, href: '/almoxarifado/movimentacoes/new', show: (f) => f.canManageRequests },
        { name: 'Pendências', icon: Clock, href: '/almoxarifado/movimentacoes/pendencias', show: (f) => f.canManageRequests },
        { name: 'Saída Direta', icon: Package2, href: '/saida-direta', show: (f) => f.canManageRequests },
        { name: 'Nova Saída Direta', icon: ListChecks, href: '/saida-direta/new', show: (f) => f.canManageRequests },
      ],
    },
    // --- DISPENSAÇÃO (só satélites de farmácia).
    //     "Nova Dispensação" removido do menu — a entrada e por
    //     "Dispensações" (botao "+ Nova" la dentro). Ter duas portas
    //     confundia e podia gerar dispensacoes em fluxos diferentes.
    {
      title: 'Dispensação',
      module: 'farmacia',
      items: [
        { name: 'Dispensações', icon: Syringe, href: '/dispensacao', show: (f) => isSat && f.canManageRequests },
        { name: 'Histórico', icon: History, href: '/dispensacao/historico', show: (f) => isSat && f.canManageRequests },
      ],
    },
    // --- CADASTROS (farmácia) ---
    {
      title: 'Cadastros',
      module: 'farmacia',
      // Seção inteira só no CAF (ver isCaf).
      items: [
        // "Catálogo" -> "Medicamentos" (ícone de comprimido): o nome antigo não
        // dizia do que era o catálogo. A rota segue /farmacia/catalogo.
        { name: 'Medicamentos', icon: Pill, href: '/farmacia/catalogo', show: (f) => isCaf && f.canManageRequests },
        { name: 'Fornecedores', icon: Building2, href: '/farmacia/fornecedores', show: (f) => isCaf && f.canManageRequests },
        { name: 'Unidades Externas', icon: Building2, href: '/farmacia/unidades-externas', show: (f) => isCaf && f.canManageRequests },
        { name: 'Prescritores', icon: Stethoscope, href: '/farmacia/prescritores', show: (f) => isCaf && f.canManageRequests },
        { name: 'Pacientes', icon: UsersRound, href: '/farmacia/pacientes', show: (f) => isCaf && f.canManageRequests },
        // Gestor ajusta setor e nível (Solicitante/Atendente/Farmacêutico) dos colaboradores.
        { name: 'Colaboradores', icon: Users, href: '/colaboradores', show: (f) => isCaf && (f.isManager || f.isAdmin) },
      ],
    },
    // --- CONTROLADOS + CCIH (farmacia — regulatório junto pra reduzir secoes) ---
    {
      title: 'Controlados e CCIH',
      module: 'farmacia',
      items: [
        { name: 'Livro de Controlados', icon: BookOpen, href: '/farmacia/livro-controlados', show: (f) => f.canManageRequests },
        { name: 'BMPO', icon: BarChart3, href: '/farmacia/bmpo', show: (f) => f.canManageRequests },
        { name: 'Perdas', icon: PackageMinus, href: '/farmacia/perdas', show: (f) => f.canManageRequests },
        { name: 'Antimicrobianos', icon: Shield, href: '/farmacia/antimicrobianos', show: (f) => f.canManageRequests },
        { name: 'Intervenção Farmacêutica', icon: Stethoscope, href: '/farmacia/intervencao-farmaceutica', show: (f) => f.canManageRequests },
      ],
    },
    // --- RELATÓRIOS: dois blocos SEPARADOS por titulo — assim quando o
    //     usuario ainda nao escolheu modulo (activeModule=null), os dois
    //     aparecem sem se misturarem (mergeSectionsByTitle so funde blocos
    //     com o MESMO titulo). Antes ambos eram "Relatorios" e os itens
    //     de farm+almox viravam uma lista bagunçada.
    {
      title: 'Relatórios · Farmácia',
      module: 'farmacia',
      items: [
        { name: 'Estoque', icon: Pill, href: '/reports/pharmacy-stock', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
        { name: 'Consumo', icon: BarChart3, href: '/reports/pharmacy-consumption', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
        { name: 'Gestão de Consumo', icon: FileText, href: '/reports/pharmacy-admin-consumption', show: (f) => f.isAdmin },
        { name: 'Multi-Estoque', icon: BarChart3, href: '/reports/farmacia-multi-estoque', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
        { name: 'Validade', icon: CalendarClock, href: '/reports/stock-expiry?type=pharmacy', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
        { name: 'Movimentações', icon: BarChart3, href: '/reports/movimentacoes?type=pharmacy', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
        // Relatório de dispensações por dia. Aparece em qualquer estoque; a
        // própria tela orienta a escolher um satélite (é onde há dispensação).
        { name: 'Movimentação Diária', icon: CalendarClock, href: '/farmacia/movimentacao-diaria', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
      ],
    },
    {
      title: 'Relatórios · Almoxarifado',
      module: 'almoxarifado',
      items: [
        { name: 'Estoque', icon: Package2, href: '/reports/warehouse-stock', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
        { name: 'Consumo', icon: BarChart3, href: '/reports/warehouse-consumption', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
        { name: 'Gestão de Consumo', icon: FileText, href: '/reports/warehouse-admin-consumption', show: (f) => f.isAdmin },
        { name: 'Validade', icon: CalendarClock, href: '/reports/stock-expiry?type=warehouse', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
        { name: 'Movimentações', icon: BarChart3, href: '/reports/movimentacoes?type=warehouse', show: (f) => f.isManager || f.isAdmin || f.isAtendente },
      ],
    },
    // --- ADMIN + CONFIG (no fim) ---
    {
      title: 'Administração',
      module: 'admin',
      items: [
        { name: 'Usuários', icon: Users, href: '/users-advanced', show: (f) => f.isAdmin },
        {
          name: 'Tabelas', icon: Database, href: '/tables', show: (f) => f.isAdmin,
          submenu: [{ name: 'Setores', href: '/tables/departments', icon: Building2 }],
        },
        { name: 'Histórico Global', icon: History, href: '/historico-global', show: (f) => f.isAdmin },
      ],
    },
    {
      title: 'Conta',
      module: 'shared',
      items: [
        { name: 'Meu Perfil', icon: UserCircle, href: '/profile', show: () => true },
        { name: 'Configurações', icon: Settings, href: '/settings', show: (f) => !f.isEnfermagem },
      ],
    },
  ]
}
