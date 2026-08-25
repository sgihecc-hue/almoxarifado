import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/contexts/auth'
import { ThemeProvider } from '@/contexts/theme'
import { ModuleProvider } from '@/contexts/module'
import { ProtectedRoute } from '@/components/protected-route'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { Login } from '@/pages/login'
import { Register } from '@/pages/register'
import { MainLayout } from '@/pages/main-layout'
import { MyRequests } from '@/pages/my-requests'
import { PharmacyItems } from '@/pages/inventory/pharmacy-items'
import { StockLocationItems } from '@/pages/inventory/stock-location-items'
import { WarehouseItems } from '@/pages/inventory/warehouse-items'
import { EtiquetasAlmox } from '@/pages/almox/etiquetas'
import { AlmoxMovimentacao } from '@/pages/almox/movimentacao'
import { SaidasFarmacia } from '@/pages/farmacia/saidas'
import { NfEntry } from '@/pages/inventory/nf-entry'
import { NfEntryWarehouse } from '@/pages/inventory/nf-entry-warehouse'
import { SaidaBatch } from '@/pages/inventory/saida-batch'
import { ItemDetails } from '@/pages/inventory/item-details'
import { RequestDetails } from '@/pages/requests/request-details'
import { RequestInbox } from '@/pages/requests/inbox'
import { RequestProcessing } from '@/pages/requests/processing'
import { RequestHistory } from '@/pages/requests/history'
import { RequestPending } from '@/pages/requests/pending'
import { ReceiptConfirmation } from '@/pages/requests/receipt-confirmation'
import { NewRequest } from '@/pages/new-request'
import { Profile } from '@/pages/profile'
import { ProfileAdvanced } from '@/pages/profile-advanced'
import { TablesOverview } from '@/pages/tables-overview'
import { DepartmentsTable } from '@/pages/tables-overview/components/departments-table'
import { UsersAdvanced } from '@/pages/users-advanced'
import { GestaoColaboradores } from '@/pages/gestao-colaboradores'
import { Settings } from '@/pages/settings'
import { PharmacyConsumptionReport } from '@/pages/reports/pharmacy-consumption'
import { AdminConsumptionManagement } from '@/pages/reports/admin-consumption'
import { WarehouseConsumptionReport } from '@/pages/reports/warehouse-consumption'
import { AdminWarehouseConsumptionManagement } from '@/pages/reports/admin-warehouse-consumption'
import { WarehouseTVDashboard } from '@/pages/dashboard/warehouse-tv-dashboard'
import { PharmacyTVDashboard } from '@/pages/dashboard/pharmacy-tv-dashboard'
import { TVRequestDetail } from '@/pages/dashboard/tv-request-detail'
import { TVHistory } from '@/pages/dashboard/tv-history'
import { Dashboard } from '@/pages/dashboard'
import { ModuleSelector } from '@/pages/module-selector'
import { PharmacyStockReport, WarehouseStockReport } from '@/pages/reports/stock-report'
import { StockExpiryReport } from '@/pages/reports/stock-expiry-report'
import { DispensationList } from '@/pages/dispensacao/index'
import { NewDispensation } from '@/pages/dispensacao/new'
import { DispensationDetails } from '@/pages/dispensacao/details'
import { PatientSelect } from '@/pages/dispensacao/patient-select'
import { PatientDischarge } from '@/pages/dispensacao/patient-discharge'
import { FilaAprovacaoFarmaceutica } from '@/pages/dispensacao/fila-aprovacao'
import { HistoricoDispensacoes } from '@/pages/dispensacao/historico'
import { WarehouseDispatchList } from '@/pages/saida-direta/index'
import { NewWarehouseDispatch } from '@/pages/saida-direta/new'
import { WarehouseDispatchDetailPage } from '@/pages/saida-direta/detail'
import { EstornoAlmox } from '@/pages/estoque/estorno-almox'
import { PharmacyCatalogo } from '@/pages/farmacia/catalogo'
import { HistoricoGlobal } from '@/pages/historico-global'
import { Fornecedores } from '@/pages/farmacia/fornecedores'
import { UnidadesExternas } from '@/pages/farmacia/unidades-externas'
import { UnidadesInternas } from '@/pages/farmacia/unidades-internas'
import { CarrosEmergencia } from '@/pages/farmacia/carros-emergencia'
import { Prescritores } from '@/pages/farmacia/prescritores'
import { Pacientes } from '@/pages/farmacia/pacientes'
import { IntervencaoFarmaceutica } from '@/pages/farmacia/intervencao-farmaceutica'
import { Antimicrobianos } from '@/pages/farmacia/antimicrobianos'
import { SaidaAvulsa } from '@/pages/estoque/saida-avulsa'
import { DevolucaoInterna } from '@/pages/estoque/devolucao'
import { Transferencia } from '@/pages/estoque/transferencia'
import { EmprestimosAbertos } from '@/pages/estoque/emprestimos'
import { VencimentosABaixar } from '@/pages/estoque/vencimentos'
import { FarmaciaMultiEstoqueReport } from '@/pages/reports/farmacia-multi-estoque'
import { MovementsReport } from '@/pages/reports/movimentacoes'
import { PharmacyLoansList } from '@/pages/farmacia/movimentacoes/index'
import { NewPharmacyLoan } from '@/pages/farmacia/movimentacoes/new'
import { PharmacyLoanDetail } from '@/pages/farmacia/movimentacoes/detail'
import { LoansPendencias } from '@/pages/farmacia/movimentacoes/pendencias'
import { ChangePassword } from '@/pages/change-password'
import { LivroControlados } from '@/pages/farmacia/livro-controlados'
import { Talidomida } from '@/pages/farmacia/talidomida'
import { Perdas } from '@/pages/farmacia/perdas'
import { NotificacaoReceita } from '@/pages/farmacia/notificacao-receita'
import { BMPO } from '@/pages/farmacia/bmpo'
import { MovimentacaoDiaria } from '@/pages/farmacia/movimentacao-diaria'
import { ConsentGate } from '@/components/lgpd/consent-gate'
import { useModule } from '@/contexts/module'
import { ModuleLayout } from '@/components/module-layout-wrapper'

const queryClient = new QueryClient()

function DashboardOrSelector() {
  const { activeModule, isModuleUser, isPharmacyStockUser, activeStock } = useModule()
  // Gestor/admin: escolhem primeiro o módulo (Farmácia/Almoxarifado).
  if (isModuleUser && !activeModule) return <ModuleSelector />
  // Farmacêutico / atendente de farmácia: entram direto na escolha do estoque
  // (CAF/Satélites), sem card de Almoxarifado.
  if (isPharmacyStockUser && !activeStock) return <ModuleSelector pharmacyOnly />
  return <Dashboard />
}

// Loading fallback component
function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto mb-4" />
        <p className="text-gray-500">Carregando aplicação...</p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={<LoadingFallback />}>
          <BrowserRouter>
            <ThemeProvider>
            <AuthProvider>
            <ModuleProvider>
            <ConsentGate>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/change-password" element={<ChangePassword />} />
                <Route path="/tv/warehouse" element={<WarehouseTVDashboard />} />
                <Route path="/tv/warehouse/history" element={<TVHistory type="warehouse" />} />
                <Route path="/tv/warehouse/:id" element={<TVRequestDetail type="warehouse" />} />
                <Route path="/tv/pharmacy" element={<PharmacyTVDashboard />} />
                <Route path="/tv/pharmacy/history" element={<TVHistory type="pharmacy" />} />
                <Route path="/tv/pharmacy/:id" element={<TVRequestDetail type="pharmacy" />} />
                <Route path="/" element={
                  <ProtectedRoute>
                    <MainLayout>
                      <DashboardOrSelector />
                    </MainLayout>
                  </ProtectedRoute>
                } />
              
                {/* Inventory Routes */}
                <Route path="/inventory/pharmacy" element={
                  <ProtectedRoute>
                    <MainLayout>
                      <PharmacyItems />
                    </MainLayout>
                  </ProtectedRoute>
                } />
              <Route path="/inventory/stock/:locationId" element={
                <ProtectedRoute>
                  <MainLayout>
                    <StockLocationItems />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/inventory/warehouse" element={
                <ProtectedRoute>
                  <MainLayout>
                    <WarehouseItems />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/almox/etiquetas" element={
                <ProtectedRoute>
                  <MainLayout>
                    <EtiquetasAlmox />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/almox/movimentacao" element={
                <ProtectedRoute>
                  <MainLayout>
                    <AlmoxMovimentacao />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/saidas" element={
                <ProtectedRoute>
                  <MainLayout>
                    <SaidasFarmacia />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/inventory/pharmacy/nf-entry" element={
                <ProtectedRoute>
                  <MainLayout>
                    <NfEntry type="pharmacy" />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/inventory/warehouse/nf-entry" element={
                <ProtectedRoute>
                  <MainLayout>
                    <NfEntryWarehouse />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/inventory/pharmacy/saida-lote" element={
                <ProtectedRoute>
                  <MainLayout>
                    <SaidaBatch type="pharmacy" />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/inventory/warehouse/saida-lote" element={
                <ProtectedRoute>
                  <MainLayout>
                    <SaidaBatch type="warehouse" />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/inventory/pharmacy/:id" element={
                <ProtectedRoute>
                  <MainLayout>
                    <ItemDetails />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/inventory/warehouse/:id" element={
                <ProtectedRoute>
                  <MainLayout>
                    <ItemDetails />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/inventory/pharmacy/:id/edit" element={
                <ProtectedRoute>
                  <MainLayout>
                    <ItemDetails />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/inventory/warehouse/:id/edit" element={
                <ProtectedRoute>
                  <MainLayout>
                    <ItemDetails />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/inventory/pharmacy/:id/delete" element={
                <ProtectedRoute>
                  <MainLayout>
                    <ItemDetails />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/inventory/warehouse/:id/delete" element={
                <ProtectedRoute>
                  <MainLayout>
                    <ItemDetails />
                  </MainLayout>
                </ProtectedRoute>
              } />
              
              {/* User Request Routes */}
              <Route path="/requests" element={
                <ProtectedRoute>
                  <MainLayout>
                    <MyRequests />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/requests/new" element={
                <ProtectedRoute>
                  <MainLayout>
                    <NewRequest />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/requests/:id" element={
                <ProtectedRoute>
                  <MainLayout>
                    <RequestDetails />
                  </MainLayout>
                </ProtectedRoute>
              } />
              
              {/* Request Management Routes */}
              <Route path="/requests/inbox" element={
                <ProtectedRoute>
                  <MainLayout>
                    <RequestInbox />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/requests/processing" element={
                <ProtectedRoute>
                  <MainLayout>
                    <RequestProcessing />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/requests/history" element={
                <ProtectedRoute>
                  <MainLayout>
                    <RequestHistory />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/requests/pending" element={
                <ProtectedRoute>
                  <MainLayout>
                    <RequestPending />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/requests/receipt-confirmation" element={
                <ProtectedRoute>
                  <MainLayout>
                    <ReceiptConfirmation />
                  </MainLayout>
                </ProtectedRoute>
              } />
              
              {/* Profile Routes */}
              <Route path="/profile" element={
                <ProtectedRoute>
                  <MainLayout>
                    <Profile />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/profile/advanced" element={
                <ProtectedRoute>
                  <MainLayout>
                    <ProfileAdvanced />
                  </MainLayout>
                </ProtectedRoute>
              } />

              {/* Users Routes */}
              <Route path="/users-advanced" element={
                <ProtectedRoute>
                  <MainLayout>
                    <UsersAdvanced />
                  </MainLayout>
                </ProtectedRoute>
              } />
              {/* Gestão de colaboradores (gestor) — ajuste de setor e nível */}
              <Route path="/colaboradores" element={
                <ProtectedRoute>
                  <MainLayout>
                    <GestaoColaboradores />
                  </MainLayout>
                </ProtectedRoute>
              } />

              {/* Tables Management Routes */}
              <Route path="/tables" element={
                <ProtectedRoute>
                  <MainLayout>
                    <TablesOverview />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/tables/departments" element={
                <ProtectedRoute>
                  <MainLayout>
                    <DepartmentsTable />
                  </MainLayout>
                </ProtectedRoute>
              } />
              
              {/* Reports Routes */}
              <Route path="/reports/pharmacy-consumption" element={
                <ProtectedRoute>
                  <MainLayout>
                    <PharmacyConsumptionReport />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/reports/pharmacy-admin-consumption" element={
                <ProtectedRoute>
                  <MainLayout>
                    <AdminConsumptionManagement />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/reports/warehouse-consumption" element={
                <ProtectedRoute>
                  <MainLayout>
                    <WarehouseConsumptionReport />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/reports/warehouse-admin-consumption" element={
                <ProtectedRoute>
                  <MainLayout>
                    <AdminWarehouseConsumptionManagement />
                  </MainLayout>
                </ProtectedRoute>
              } />
              
              {/* Stock Report Routes */}
              <Route path="/reports/pharmacy-stock" element={
                <ProtectedRoute>
                  <MainLayout>
                    <PharmacyStockReport />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/reports/warehouse-stock" element={
                <ProtectedRoute>
                  <MainLayout>
                    <WarehouseStockReport />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/reports/stock-expiry" element={
                <ProtectedRoute>
                  <MainLayout>
                    <StockExpiryReport />
                  </MainLayout>
                </ProtectedRoute>
              } />

              {/* Dispensacao Routes */}
              <Route path="/dispensacao" element={
                <ProtectedRoute>
                  <MainLayout>
                    <DispensationList />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/dispensacao/paciente" element={
                <ProtectedRoute>
                  <MainLayout>
                    <PatientSelect />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/dispensacao/new" element={
                <ProtectedRoute>
                  <MainLayout>
                    <NewDispensation />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/dispensacao/paciente/:id/alta" element={
                <ProtectedRoute>
                  <MainLayout>
                    <PatientDischarge />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/dispensacao/fila-aprovacao" element={
                <ProtectedRoute>
                  <MainLayout>
                    <FilaAprovacaoFarmaceutica />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/dispensacao/historico" element={
                <ProtectedRoute>
                  <MainLayout>
                    <HistoricoDispensacoes />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/dispensacao/:id" element={
                <ProtectedRoute>
                  <MainLayout>
                    <DispensationDetails />
                  </MainLayout>
                </ProtectedRoute>
              } />

              {/* Saída Direta - Almoxarifado */}
              <Route path="/saida-direta" element={
                <ProtectedRoute>
                  <MainLayout>
                    <WarehouseDispatchList />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/saida-direta/new" element={
                <ProtectedRoute>
                  <MainLayout>
                    <NewWarehouseDispatch />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/saida-direta/:id" element={
                <ProtectedRoute>
                  <MainLayout>
                    <WarehouseDispatchDetailPage />
                  </MainLayout>
                </ProtectedRoute>
              } />

              {/* Cadastros da Farmacia */}
              <Route path="/farmacia/catalogo" element={
                <ProtectedRoute>
                  <MainLayout>
                    <PharmacyCatalogo />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/fornecedores" element={
                <ProtectedRoute>
                  <MainLayout>
                    <Fornecedores />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/unidades-externas" element={
                <ProtectedRoute>
                  <MainLayout>
                    <UnidadesExternas />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/unidades-internas" element={
                <ProtectedRoute>
                  <MainLayout>
                    <UnidadesInternas />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/carros-emergencia" element={
                <ProtectedRoute>
                  <MainLayout>
                    <CarrosEmergencia />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/prescritores" element={
                <ProtectedRoute>
                  <MainLayout>
                    <Prescritores />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/pacientes" element={
                <ProtectedRoute>
                  <MainLayout>
                    <Pacientes />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/intervencao-farmaceutica" element={
                <ProtectedRoute>
                  <MainLayout>
                    <IntervencaoFarmaceutica />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/antimicrobianos" element={
                <ProtectedRoute>
                  <MainLayout>
                    <Antimicrobianos />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/livro-controlados" element={
                <ProtectedRoute>
                  <MainLayout>
                    <LivroControlados />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/talidomida" element={
                <ProtectedRoute>
                  <MainLayout>
                    <Talidomida />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/perdas" element={
                <ProtectedRoute>
                  <MainLayout>
                    <Perdas />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/notificacao-receita" element={
                <ProtectedRoute>
                  <MainLayout>
                    <NotificacaoReceita />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/bmpo" element={
                <ProtectedRoute>
                  <MainLayout>
                    <BMPO />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/movimentacao-diaria" element={
                <ProtectedRoute>
                  <MainLayout>
                    <MovimentacaoDiaria />
                  </MainLayout>
                </ProtectedRoute>
              } />

              {/* Estoque - Operacoes (multi-estoque) */}
              <Route path="/estoque/saida-avulsa" element={
                <ProtectedRoute>
                  <MainLayout>
                    <SaidaAvulsa />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/estoque/devolucao" element={
                <ProtectedRoute>
                  <MainLayout>
                    <DevolucaoInterna />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/estoque/transferencia" element={
                <ProtectedRoute>
                  <MainLayout>
                    <Transferencia />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/estoque/emprestimos" element={
                <ProtectedRoute>
                  <MainLayout>
                    <EmprestimosAbertos />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/estoque/vencimentos" element={
                <ProtectedRoute>
                  <MainLayout>
                    <VencimentosABaixar />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/reports/farmacia-multi-estoque" element={
                <ProtectedRoute>
                  <MainLayout>
                    <FarmaciaMultiEstoqueReport />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/reports/movimentacoes" element={
                <ProtectedRoute>
                  <MainLayout>
                    <MovementsReport />
                  </MainLayout>
                </ProtectedRoute>
              } />

              {/* Farmácia: Movimentações entre unidades */}
              <Route path="/farmacia/movimentacoes" element={
                <ProtectedRoute>
                  <MainLayout>
                    <PharmacyLoansList scope="pharmacy" />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/movimentacoes/new" element={
                <ProtectedRoute>
                  <MainLayout>
                    <NewPharmacyLoan scope="pharmacy" />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/movimentacoes/pendencias" element={
                <ProtectedRoute>
                  <MainLayout>
                    <LoansPendencias scope="pharmacy" />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/almoxarifado/movimentacoes/pendencias" element={
                <ProtectedRoute>
                  <MainLayout>
                    <LoansPendencias scope="warehouse" />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/movimentacoes/:id" element={
                <ProtectedRoute>
                  <MainLayout>
                    <PharmacyLoanDetail />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/farmacia/movimentacoes/:id/imprimir" element={
                <ProtectedRoute>
                  <PharmacyLoanDetail printMode />
                </ProtectedRoute>
              } />

              {/* Almoxarifado: Movimentações entre unidades */}
              <Route path="/almoxarifado/movimentacoes" element={
                <ProtectedRoute>
                  <MainLayout>
                    <PharmacyLoansList scope="warehouse" />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/almoxarifado/movimentacoes/new" element={
                <ProtectedRoute>
                  <MainLayout>
                    <NewPharmacyLoan scope="warehouse" />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/almoxarifado/movimentacoes/:id" element={
                <ProtectedRoute>
                  <MainLayout>
                    <PharmacyLoanDetail />
                  </MainLayout>
                </ProtectedRoute>
              } />
              <Route path="/almoxarifado/movimentacoes/:id/imprimir" element={
                <ProtectedRoute>
                  <PharmacyLoanDetail printMode />
                </ProtectedRoute>
              } />

              {/* Histórico Global (admin) */}
              <Route path="/historico-global" element={
                <ProtectedRoute>
                  <MainLayout>
                    <HistoricoGlobal />
                  </MainLayout>
                </ProtectedRoute>
              } />

              {/* Settings Routes */}
              <Route path="/settings" element={
                <ProtectedRoute>
                  <MainLayout>
                    <Settings />
                  </MainLayout>
                </ProtectedRoute>
              } />

              {/* ===== Module-prefixed routes (admin/gestor) ===== */}

              {/* Farmácia module */}
              <Route path="/farmacia" element={<ModuleLayout module="farmacia" />}>
                <Route path="dashboard" element={<Dashboard module="farmacia" />} />
                <Route path="inventory" element={<PharmacyItems />} />
                <Route path="inventory/nf-entry" element={<NfEntry type="pharmacy" />} />
                <Route path="inventory/saida-lote" element={<SaidaBatch type="pharmacy" />} />
                <Route path="inventory/:id" element={<ItemDetails />} />
                <Route path="inventory/:id/edit" element={<ItemDetails />} />
                <Route path="inventory/:id/delete" element={<ItemDetails />} />
                <Route path="dispensacao" element={<DispensationList />} />
                <Route path="dispensacao/paciente" element={<PatientSelect />} />
                <Route path="dispensacao/paciente/:id/alta" element={<PatientDischarge />} />
                <Route path="dispensacao/new" element={<NewDispensation />} />
                <Route path="dispensacao/fila-aprovacao" element={<FilaAprovacaoFarmaceutica />} />
                <Route path="dispensacao/historico" element={<HistoricoDispensacoes />} />
                <Route path="dispensacao/:id" element={<DispensationDetails />} />
                <Route path="cadastros/catalogo" element={<PharmacyCatalogo />} />
                <Route path="cadastros/fornecedores" element={<Fornecedores />} />
                <Route path="cadastros/unidades-externas" element={<UnidadesExternas />} />
                <Route path="cadastros/unidades-internas" element={<UnidadesInternas />} />
                <Route path="cadastros/prescritores" element={<Prescritores />} />
                <Route path="cadastros/pacientes" element={<Pacientes />} />
                <Route path="intervencao-farmaceutica" element={<IntervencaoFarmaceutica />} />
                <Route path="antimicrobianos" element={<Antimicrobianos />} />
                <Route path="movimentacoes" element={<PharmacyLoansList scope="pharmacy" />} />
                <Route path="movimentacoes/new" element={<NewPharmacyLoan scope="pharmacy" />} />
                <Route path="movimentacoes/:id" element={<PharmacyLoanDetail />} />
                <Route path="requests" element={<MyRequests />} />
                <Route path="requests/new" element={<NewRequest />} />
                <Route path="requests/inbox" element={<RequestInbox />} />
                <Route path="requests/processing" element={<RequestProcessing />} />
                <Route path="requests/history" element={<RequestHistory />} />
                <Route path="requests/pending" element={<RequestPending />} />
                <Route path="requests/receipt-confirmation" element={<ReceiptConfirmation />} />
                <Route path="requests/:id" element={<RequestDetails />} />
                <Route path="estoque/saida-avulsa" element={<SaidaAvulsa />} />
                <Route path="estoque/devolucao" element={<DevolucaoInterna />} />
                <Route path="estoque/transferencia" element={<Transferencia />} />
                <Route path="estoque/emprestimos" element={<EmprestimosAbertos />} />
                <Route path="estoque/vencimentos" element={<VencimentosABaixar />} />
                <Route path="reports/pharmacy-stock" element={<PharmacyStockReport />} />
                <Route path="reports/pharmacy-consumption" element={<PharmacyConsumptionReport />} />
                <Route path="reports/pharmacy-admin-consumption" element={<AdminConsumptionManagement />} />
                <Route path="reports/farmacia-multi-estoque" element={<FarmaciaMultiEstoqueReport />} />
                <Route path="reports/stock-expiry" element={<StockExpiryReport />} />
                <Route path="reports/movimentacoes" element={<MovementsReport />} />
              </Route>

              {/* Almoxarifado module */}
              <Route path="/almox" element={<ModuleLayout module="almoxarifado" />}>
                <Route path="dashboard" element={<Dashboard module="almoxarifado" />} />
                <Route path="inventory" element={<WarehouseItems />} />
                <Route path="inventory/nf-entry" element={<NfEntryWarehouse />} />
                <Route path="inventory/saida-lote" element={<SaidaBatch type="warehouse" />} />
                <Route path="inventory/:id" element={<ItemDetails />} />
                <Route path="inventory/:id/edit" element={<ItemDetails />} />
                <Route path="inventory/:id/delete" element={<ItemDetails />} />
                <Route path="saida-direta" element={<WarehouseDispatchList />} />
                <Route path="saida-direta/new" element={<NewWarehouseDispatch />} />
                <Route path="saida-direta/:id" element={<WarehouseDispatchDetailPage />} />
                <Route path="movimentacoes" element={<PharmacyLoansList scope="warehouse" />} />
                <Route path="movimentacoes/new" element={<NewPharmacyLoan scope="warehouse" />} />
                <Route path="movimentacoes/:id" element={<PharmacyLoanDetail />} />
                <Route path="requests" element={<MyRequests />} />
                <Route path="requests/new" element={<NewRequest />} />
                <Route path="requests/inbox" element={<RequestInbox />} />
                <Route path="requests/processing" element={<RequestProcessing />} />
                <Route path="requests/history" element={<RequestHistory />} />
                <Route path="requests/pending" element={<RequestPending />} />
                <Route path="requests/receipt-confirmation" element={<ReceiptConfirmation />} />
                <Route path="requests/:id" element={<RequestDetails />} />
                <Route path="estoque/saida-avulsa" element={<SaidaAvulsa />} />
                <Route path="estoque/devolucao" element={<DevolucaoInterna />} />
                <Route path="estoque/transferencia" element={<Transferencia />} />
                <Route path="estoque/emprestimos" element={<EmprestimosAbertos />} />
                <Route path="estoque/vencimentos" element={<VencimentosABaixar />} />
                <Route path="estoque/estorno" element={<EstornoAlmox />} />
                <Route path="reports/warehouse-stock" element={<WarehouseStockReport />} />
                <Route path="reports/warehouse-consumption" element={<WarehouseConsumptionReport />} />
                <Route path="reports/warehouse-admin-consumption" element={<AdminWarehouseConsumptionManagement />} />
                <Route path="reports/stock-expiry" element={<StockExpiryReport />} />
                <Route path="reports/movimentacoes" element={<MovementsReport />} />
              </Route>

              </Routes>
            </ConsentGate>
            </ModuleProvider>
            </AuthProvider>
            </ThemeProvider>
          </BrowserRouter>
        </Suspense>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
