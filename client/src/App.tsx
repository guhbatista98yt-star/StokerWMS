import { Switch, Route, Redirect } from "wouter";
import { Component, type ReactNode, type ErrorInfo } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md w-full rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-4">
            <p className="text-lg font-bold text-destructive">Ocorreu um erro inesperado</p>
            <p className="text-sm text-muted-foreground">{this.state.error.message}</p>
            <button
              className="text-sm underline text-muted-foreground hover:text-foreground"
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            >
              Recarregar página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

import LoginPage from "@/pages/login";
import CompanySelectPage from "@/pages/company-select";
import HomePage from "@/pages/home";
import OrdersPage from "@/pages/supervisor/orders";
import ExceptionsPage from "@/pages/supervisor/exceptions";
import AuditPage from "@/pages/supervisor/audit";
import UsersPage from "@/pages/supervisor/users";
import RoutesPage from "@/pages/supervisor/routes";
import RouteOrdersPage from "@/pages/supervisor/route-orders";
import ReportsPage from "@/pages/supervisor/reports";
import PickingListReportPage from "@/pages/supervisor/reports/picking-list";
import BadgeGeneration from "@/pages/supervisor/reports/badge-generation";
import LoadingMapReportPage from "@/pages/supervisor/reports/loading-map";
import LoadingMapProductsReportPage from "@/pages/supervisor/reports/loading-map-products";
import OrderVolumesReportPage from "@/pages/supervisor/reports/order-volumes";
import CountingCyclesReportPage from "@/pages/supervisor/reports/counting-cycles";
import WmsAddressesReportPage from "@/pages/supervisor/reports/wms-addresses";
import PalletMovementsReportPage from "@/pages/supervisor/reports/pallet-movements";
import StockDiscrepancyReportPage from "@/pages/supervisor/reports/stock-discrepancy";
import MappingStudioPage from "@/pages/supervisor/mapping-studio";
import SeparacaoPage from "@/pages/separacao/index";
import ConferenciaPage from "@/pages/conferencia/index";
import BalcaoPage from "@/pages/balcao/index";
import PickingPage from "@/pages/handheld/picking";
import FilaPedidosPage from "@/pages/fila-pedidos/index";
import EnderecosPage from "@/pages/wms/enderecos";
import RecebimentoPage from "@/pages/wms/recebimento";
import CheckinPage from "@/pages/wms/checkin";
import TransferenciaPage from "@/pages/wms/transferencia";
import RetiradaPage from "@/pages/wms/retirada";
import AdicaoPage from "@/pages/wms/adicao";
import ContagemPage from "@/pages/wms/contagem";
import ProdutosPage from "@/pages/wms/produtos";
import PermissoesPage from "@/pages/admin/permissoes";
import LimpezaPage from "@/pages/admin/limpeza";
import KpiDashboardPage from "@/pages/admin/kpi-dashboard";
import PrintAgentsPage from "@/pages/admin/print-agents";
import LabelTemplatesPage from "@/pages/admin/label-templates";
import LabelStudioPage from "@/pages/admin/label-studio";
import SeparationSettingsPage from "@/pages/supervisor/separation-settings";
import PrintSettingsPage from "@/pages/supervisor/print-settings";
import BarcodeManagementPage from "@/pages/supervisor/barcode-management";
import CodigosBarrasPage from "@/pages/wms/codigos-barras";
import NotFound from "@/pages/not-found";
import VolumeLabelPage from "@/pages/print/volume-label";
import PalletLabelPage from "@/pages/print/pallet-label";
import { Loader2 } from "lucide-react";

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(213,67%,22%)] via-[hsl(207,62%,35%)] to-[hsl(157,50%,28%)]">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-10 w-10 text-white animate-spin" />
        <p className="text-white/80">Carregando...</p>
      </div>
    </div>
  );
}

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const { user, companyId, allowedCompanies, status } = useAuth();

  if (status === "loading") {
    return <LoadingScreen />;
  }

  if (status === "unauthenticated") {
    return <Redirect to="/login" />;
  }

  if (!companyId && allowedCompanies.length > 1) {
    return <Redirect to="/select-company" />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Redirect to="/" />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();

  if (status === "loading") {
    return <LoadingScreen />;
  }

  if (status === "authenticated") {
    return <Redirect to="/" />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login">
        <PublicRoute>
          <LoginPage />
        </PublicRoute>
      </Route>

      <Route path="/select-company">
        <CompanySelectPage />
      </Route>

      <Route path="/">
        <ProtectedRoute>
          <HomePage />
        </ProtectedRoute>
      </Route>



      <Route path="/supervisor/orders">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <OrdersPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/exceptions">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <ExceptionsPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/audit">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <AuditPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/users">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <UsersPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/routes">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <RoutesPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/route-orders">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <RouteOrdersPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/reports">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <ReportsPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/reports/picking-list">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <PickingListReportPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/reports/loading-map">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <LoadingMapReportPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/reports/loading-map-products">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <LoadingMapProductsReportPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/reports/badge-generation">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <BadgeGeneration />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/reports/order-volumes">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <OrderVolumesReportPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/reports/counting-cycles">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <CountingCyclesReportPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/reports/wms-addresses">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <WmsAddressesReportPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/reports/pallet-movements">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <PalletMovementsReportPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/reports/stock-discrepancy">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <StockDiscrepancyReportPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/mapping-studio">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <MappingStudioPage />
        </ProtectedRoute>
      </Route>

      <Route path="/separacao">
        <ProtectedRoute allowedRoles={["separacao", "administrador"]}>
          <SeparacaoPage />
        </ProtectedRoute>
      </Route>

      <Route path="/conferencia">
        <ProtectedRoute allowedRoles={["supervisor", "conferencia", "administrador"]}>
          <ConferenciaPage />
        </ProtectedRoute>
      </Route>

      <Route path="/balcao">
        <ProtectedRoute allowedRoles={["supervisor", "balcao", "administrador"]}>
          <BalcaoPage />
        </ProtectedRoute>
      </Route>

      <Route path="/handheld/picking">
        <ProtectedRoute allowedRoles={["separacao", "administrador"]}>
          <PickingPage />
        </ProtectedRoute>
      </Route>

      <Route path="/fila-pedidos">
        <ProtectedRoute allowedRoles={["fila_pedidos", "supervisor", "administrador"]}>
          <FilaPedidosPage />
        </ProtectedRoute>
      </Route>

      <Route path="/wms/enderecos">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <EnderecosPage />
        </ProtectedRoute>
      </Route>

      <Route path="/wms/recebimento">
        <ProtectedRoute allowedRoles={["recebedor", "supervisor", "administrador"]}>
          <RecebimentoPage />
        </ProtectedRoute>
      </Route>

      <Route path="/wms/checkin">
        <ProtectedRoute allowedRoles={["empilhador", "supervisor", "administrador"]}>
          <CheckinPage />
        </ProtectedRoute>
      </Route>

      <Route path="/wms/transferencia">
        <ProtectedRoute allowedRoles={["empilhador", "supervisor", "administrador"]}>
          <TransferenciaPage />
        </ProtectedRoute>
      </Route>

      <Route path="/wms/retirada">
        <ProtectedRoute allowedRoles={["empilhador", "supervisor", "administrador"]}>
          <RetiradaPage />
        </ProtectedRoute>
      </Route>

      <Route path="/wms/adicao">
        <ProtectedRoute allowedRoles={["empilhador", "recebedor", "supervisor", "administrador"]}>
          <AdicaoPage />
        </ProtectedRoute>
      </Route>

      <Route path="/wms/contagem">
        <ProtectedRoute allowedRoles={["conferente_wms", "supervisor", "administrador"]}>
          <ContagemPage />
        </ProtectedRoute>
      </Route>

      <Route path="/wms/produtos">
        <ProtectedRoute allowedRoles={["recebedor", "empilhador", "conferente_wms", "supervisor", "administrador"]}>
          <ProdutosPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/permissoes">
        <ProtectedRoute allowedRoles={["administrador"]}>
          <PermissoesPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/limpeza">
        <ProtectedRoute allowedRoles={["administrador"]}>
          <LimpezaPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/print-agents">
        <ProtectedRoute allowedRoles={["administrador"]}>
          <PrintAgentsPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/label-templates">
        <ProtectedRoute allowedRoles={["administrador", "supervisor"]}>
          <LabelTemplatesPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/label-studio/:id">
        <ProtectedRoute allowedRoles={["administrador", "supervisor"]}>
          <LabelStudioPage />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/kpi-operadores">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <KpiDashboardPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/separation-settings">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <SeparationSettingsPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/print-settings">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <PrintSettingsPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/codigos-barras">
        <ProtectedRoute allowedRoles={["supervisor", "administrador"]}>
          <BarcodeManagementPage />
        </ProtectedRoute>
      </Route>

      <Route path="/wms/codigos-barras">
        <ProtectedRoute allowedRoles={["separacao", "conferencia", "balcao", "recebedor", "empilhador", "conferente_wms", "supervisor", "administrador"]}>
          <CodigosBarrasPage />
        </ProtectedRoute>
      </Route>

      {/* Páginas de impressão — sem sidebar, abertas em nova aba */}
      <Route path="/print/volume-label">
        <ProtectedRoute>
          <VolumeLabelPage />
        </ProtectedRoute>
      </Route>

      <Route path="/print/pallet-label">
        <ProtectedRoute>
          <PalletLabelPage />
        </ProtectedRoute>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <AuthProvider>
              <Toaster />
              <Router />
            </AuthProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
