import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/contexts/auth'
import { ProtectedRoute } from '@/components/protected-route'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { Login } from '@/pages/login'
import { Register } from '@/pages/register'
import { MainLayout } from '@/pages/main-layout'
import { MyRequests } from '@/pages/my-requests'
import { PharmacyItems } from '@/pages/inventory/pharmacy-items'
import { WarehouseItems } from '@/pages/inventory/warehouse-items'
import { ItemDetails } from '@/pages/inventory/item-details'
import { RequestDetails } from '@/pages/requests/request-details'
import { RequestInbox } from '@/pages/requests/inbox'
import { RequestProcessing } from '@/pages/requests/processing'
import { RequestHistory } from '@/pages/requests/history'
import { RequestPending } from '@/pages/requests/pending'
import { NewRequest } from '@/pages/new-request'
import { Profile } from '@/pages/profile'
import { ProfileAdvanced } from '@/pages/profile-advanced'
import { TablesOverview } from '@/pages/tables-overview'
import { DepartmentsTable } from '@/pages/tables-overview/components/departments-table'
import { UsersAdvanced } from '@/pages/users-advanced'
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

const queryClient = new QueryClient()

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
            <AuthProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/tv/warehouse" element={<WarehouseTVDashboard />} />
                <Route path="/tv/warehouse/history" element={<TVHistory type="warehouse" />} />
                <Route path="/tv/warehouse/:id" element={<TVRequestDetail type="warehouse" />} />
                <Route path="/tv/pharmacy" element={<PharmacyTVDashboard />} />
                <Route path="/tv/pharmacy/history" element={<TVHistory type="pharmacy" />} />
                <Route path="/tv/pharmacy/:id" element={<TVRequestDetail type="pharmacy" />} />
                <Route path="/" element={
                  <ProtectedRoute>
                    <MainLayout>
                      <Dashboard />
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
              <Route path="/inventory/warehouse" element={
                <ProtectedRoute>
                  <MainLayout>
                    <WarehouseItems />
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
              
              {/* Settings Routes */}
              <Route path="/settings" element={
                <ProtectedRoute>
                  <MainLayout>
                    <Settings />
                  </MainLayout>
                </ProtectedRoute>
              } />
              </Routes>
            </AuthProvider>
          </BrowserRouter>
        </Suspense>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}