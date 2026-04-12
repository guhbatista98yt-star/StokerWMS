import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth, useSessionQueryKey } from "@/lib/auth";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import {
  ArrowLeft,
  Search,
  Filter,
  Route as RouteIcon,
  Package,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Send,
  Eye,
  SlidersHorizontal,
  X,
  Printer,
  ClipboardCheck,
  CheckSquare,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { OrderDetailsDialog } from "@/components/orders/order-details-dialog";
import type { Order, Route } from "@shared/schema";
import { getCurrentWeekRange, isDateInRange } from "@/lib/date-utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useSSE } from "@/hooks/use-sse";
import { SortableTableHead, SortState, sortData, toggleSort } from "@/components/ui/sortable-table-head";

export default function OrdersPage() {
  const { user, companyId } = useAuth();
  const isAdmin = user?.role === "administrador";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // --- FILTERS STATE ---
  const [searchOrderId, setSearchOrderId] = useState(""); // 1. Busca por Pedido (Numérico Exato)
  const [searchLoadCode, setSearchLoadCode] = useState(""); // 8. Busca por Código Carga/Pacote
  const [filterDateRange, setFilterDateRange] = useState<DateRange | undefined>(getCurrentWeekRange()); // 2. Período
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());

  const [financialStatusFilter, setFinancialStatusFilter] = useState<string>("all"); // 3. Status Financeiro
  const [pickingStatusFilter, setPickingStatusFilter] = useState<string[]>([]); // 4. Status Separação (Multi)
  const [routeFilter, setRouteFilter] = useState<string>("all"); // 5. Rota
  const [priorityFilter, setPriorityFilter] = useState<string>("all"); // 6. Prioridade
  const [launchedFilter, setLaunchedFilter] = useState<string>("all"); // 7. Lançado (Sim/Não/Todos)

  // --- UI STATE ---
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [showRouteDialog, setShowRouteDialog] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<string>("");
  const [viewOrderId, setViewOrderId] = useState<string | null>(null);
  const [showExpandedFilters, setShowExpandedFilters] = useState(false);
  const [syncingInBackground, setSyncingInBackground] = useState(false);
  const [sort, setSort] = useState<SortState | null>({ key: "createdAt", direction: "desc" });
  const handleSort = useCallback((key: string) => setSort(prev => toggleSort(prev, key)), []);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // --- QUERIES ---
  const ordersQueryKey = useSessionQueryKey(["/api/orders"]);
  const routesQueryKey = useSessionQueryKey(["/api/routes"]);

  type OrderVolume = { orderId: string; sacola: number; caixa: number; saco: number; avulso: number; totalVolumes: number };
  type OrderWithExtras = Order & { hasExceptions?: boolean; itemsCount?: number; totalItems?: number; pickedItems?: number };

  const { data: orders, isLoading: ordersLoading, refetch } = useQuery<OrderWithExtras[]>({
    queryKey: ordersQueryKey,
  });

  const { data: routes } = useQuery<Route[]>({
    queryKey: routesQueryKey,
  });

  const { data: allVolumes } = useQuery<OrderVolume[]>({
    queryKey: ["/api/order-volumes"],
  });

  // Map orderId -> volume info for fast lookup
  const volumeMap = useMemo(() => {
    const map = new Map<string, OrderVolume>();
    allVolumes?.forEach(v => map.set(v.orderId, v));
    return map;
  }, [allVolumes]);

  // --- SSE REAL-TIME UPDATES ---
  const handleSSEMessage = useCallback((type: string, _data: unknown) => {
    queryClient.invalidateQueries({ queryKey: ordersQueryKey });

    if (type === 'route_updated') {
      queryClient.invalidateQueries({ queryKey: routesQueryKey });
    }

    if (type === 'exception_created') {
      toast({
        title: "Nova Exceção",
        description: `Exceção registrada no pedido ${data.orderId}`,
        variant: "destructive"
      });
    }

    if (type === 'sync_finished') {
      setSyncingInBackground(false);
      queryClient.invalidateQueries({ queryKey: ordersQueryKey });
      queryClient.invalidateQueries({ queryKey: routesQueryKey });
      if (data?.success) {
        toast({ title: "Sincronização concluída", description: "Pedidos e dados atualizados com sucesso." });
      } else {
        toast({ title: "Sincronização falhou", description: data?.error || "Erro ao sincronizar com o servidor.", variant: "destructive" });
      }
    }
  }, [queryClient, ordersQueryKey, routesQueryKey, toast]);

  useSSE('/api/sse', ['picking_update', 'lock_acquired', 'lock_released', 'picking_started', 'item_picked', 'exception_created', 'picking_finished', 'conference_started', 'conference_finished', 'route_updated', 'orders_launched', 'orders_relaunched', 'work_units_unlocked', 'orders_launch_cancelled', 'work_unit_created', 'sync_finished'], handleSSEMessage);

  // --- MUTATIONS ---
  const syncMutation = useMutation({
    mutationFn: async () => {
      // Non-blocking: server starts sync in background and responds immediately (202)
      const res = await apiRequest("POST", "/api/sync");
      // 202 = started, 200 = already running (both are fine, not errors)
      if (res.status === 500) {
        const data = await res.json();
        throw new Error(data.error || "Falha ao iniciar sincronização");
      }
      return res.json();
    },
    onSuccess: (data) => {
      // Immediately refresh what's already in the DB (fast)
      refetch();
      queryClient.invalidateQueries({ queryKey: routesQueryKey });
      // Mark background sync as running — will be cleared by SSE sync_finished event
      if (data?.running) {
        setSyncingInBackground(true);
        toast({ title: "Sincronizando...", description: "Buscando dados atualizados. Os pedidos serão recarregados em instantes." });
      }
    },
    onError: (error: Error) => {
      setSyncingInBackground(false);
      toast({ title: "Erro", description: error.message || "Erro ao sincronizar.", variant: "destructive" });
    },
  });

  const assignRouteMutation = useMutation({
    mutationFn: async ({ orderIds, routeId }: { orderIds: string[]; routeId: string }) => {
      const res = await apiRequest("POST", "/api/orders/assign-route", { orderIds, routeId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ordersQueryKey });
      setShowRouteDialog(false);
      toast({ title: "Rota atribuída", description: "Pedidos atualizados." });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message || "Falha ao atribuir rota", variant: "destructive" }),
  });

  const setPriorityMutation = useMutation({
    mutationFn: async ({ orderIds, priority }: { orderIds: string[]; priority: number }) => {
      const res = await apiRequest("POST", "/api/orders/set-priority", { orderIds, priority });
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ordersQueryKey });
      setSelectedOrders([]);
      toast({ title: "Prioridade atualizada", description: `Prioridade ${variables.priority > 0 ? "Alta" : "Normal"} definida.` });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message || "Falha ao definir prioridade", variant: "destructive" }),
  });

  const forceStatusMutation = useMutation({
    mutationFn: async ({ orderIds, status }: { orderIds: string[]; status: string }) => {
      const res = await apiRequest("POST", "/api/orders/force-status", { orderIds, status });
      const text = await res.text();
      let body: any = {};
      try { body = JSON.parse(text); } catch { /* res was HTML */ }
      if (!res.ok) {
        throw new Error(body.details || body.error || `Erro HTTP ${res.status}`);
      }
      if (body.skipped?.length) {
        toast({ title: "Parcial", description: `Pulados: ${body.skipped.join("; ")}`, variant: "default" });
      }
      return body;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ordersQueryKey });
      setSelectedOrders([]);
      const label = variables.status === "separado" ? "Separado" : "Conferido";
      if (data.updated > 0) {
        toast({ title: `Status: ${label}`, description: `${data.updated} pedido(s) atualizado(s).` });
      }
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const launchMutation = useMutation({
    mutationFn: async ({ orderIds }: { orderIds: string[] }) => {
      const res = await apiRequest("POST", "/api/orders/launch", { orderIds });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.details || err.error || "Erro ao lançar");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ordersQueryKey });
      setSelectedOrders([]);
      toast({ title: "Sucesso", description: "Pedidos lançados para separação." });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" })
  });

  const recountMutation = useMutation({
    mutationFn: async ({ orderIds }: { orderIds: string[] }) => {
      const res = await apiRequest("POST", "/api/orders/relaunch", { orderIds });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ordersQueryKey });
      setSelectedOrders([]);
      toast({ title: "Recontagem", description: "Recontagem autorizada." });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message || "Falha ao solicitar recontagem", variant: "destructive" }),
  });

  const cancelLaunchMutation = useMutation({
    mutationFn: async ({ orderIds }: { orderIds: string[] }) => {
      const res = await apiRequest("POST", "/api/orders/cancel-launch", { orderIds });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.details || err.error || "Erro ao cancelar lançamento");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ordersQueryKey });
      setSelectedOrders([]);
      toast({ title: "Sucesso", description: "Lançamento cancelado com sucesso." });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" })
  });

  const handlePrint = async () => {
    try {
      await apiRequest("POST", "/api/audit-logs", {
        action: "print_report",
        entityType: "orders_report",
        details: `Imprimiu relatório de pedidos com filtros aplicados.`,
      });
    } catch {
      // Falha no log de auditoria não interrompe a impressão
    }

    const now = format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR });
    const ordersToprint = filteredOrders;

    const filtersLine = [
      filterDateRange?.from && `Período: ${format(filterDateRange.from, "dd/MM/yyyy")} a ${filterDateRange.to ? format(filterDateRange.to, "dd/MM/yyyy") : format(new Date(), "dd/MM/yyyy")}`,
      searchLoadCode && `Carga/Pacote: ${searchLoadCode}`,
      searchOrderId && `Busca: ${searchOrderId}`,
      financialStatusFilter !== "all" && `Financeiro: ${financialStatusFilter}`,
      launchedFilter !== "all" && `Lançado: ${launchedFilter === "yes" ? "Sim" : "Não"}`,
    ].filter(Boolean).join(" | ");

    let bodyHtml = "";
    for (const order of ordersToprint) {
      const route = routes?.find(r => r.id === order.routeId);
      const routeLabel = route ? route.code : "-";
      const dateStr = format(new Date(order.createdAt), "dd/MM HH:mm");
      const finStatus = order.financialStatus === "faturado" ? "LIBERADO" : (order.financialStatus || "-").toUpperCase();
      const finColor = order.financialStatus === "faturado" ? "#155724" : "#856404";
      const finBg = order.financialStatus === "faturado" ? "#d4edda" : "#fff3cd";
      const value = order.totalValue ? `R$ ${Number(order.totalValue).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "-";
      const itemsStr = `${order.pickedItems || 0}/${order.totalItems || 0}`;
      const loadCode = (order as any).loadCode || "-";
      const priority = (order as any).priority > 0 ? "ALTA" : "Normal";
      const launchedAt = order.launchedAt ? format(new Date(order.launchedAt), "dd/MM HH:mm") : "-";

      bodyHtml += `<tr>
        <td class="mono bold">${order.erpOrderId}</td>
        <td class="nowrap">${dateStr}</td>
        <td>${order.customerName}<br><small class="dim">${order.customerCode || ""}</small></td>
        <td class="right mono">${value}</td>
        <td class="center">${itemsStr}</td>
        <td class="center"><span style="background:${finBg};color:${finColor};padding:1px 5px;border-radius:3px;font-size:9px;font-weight:bold">${finStatus}</span></td>
        <td class="center">${order.status}</td>
        <td class="center mono">${loadCode}</td>
        <td class="center">${routeLabel}</td>
        <td class="center">${priority}</td>
        <td class="center nowrap">${launchedAt}</td>
      </tr>`;
    }

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Relatório de Pedidos</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; margin: 10px 15px; font-size: 9px; color: #000; }
.header { margin-bottom: 6px; }
.header h1 { font-size: 14px; font-weight: bold; }
.header .meta { font-size: 8px; color: #555; margin-top: 2px; }
.filters { font-size: 8px; color: #333; background: #f5f5f5; padding: 3px 6px; border-radius: 2px; margin: 4px 0 6px; }
table { width: 100%; border-collapse: collapse; }
th { background: #e8e8e8; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 3px 4px; font-size: 9px; font-weight: bold; }
td { padding: 2px 4px; font-size: 9px; border-bottom: 1px solid #e0e0e0; vertical-align: middle; }
td.mono { font-family: monospace; }
td.bold { font-weight: bold; }
td.right { text-align: right; }
td.center { text-align: center; }
td.nowrap { white-space: nowrap; }
small.dim { color: #888; font-size: 8px; }
@media print { body { margin: 5mm 6mm; } @page { size: landscape; margin: 5mm; } tr { page-break-inside: avoid; } }
</style>
<script>window.onload = function() { window.print(); }</script>
</head><body>
<div class="header">
  <h1>Relatório de Pedidos</h1>
  <div class="meta">Gerado em: ${now} &nbsp;|&nbsp; Total: ${ordersToprint.length} pedidos</div>
</div>
<div class="filters"><strong>Filtros:</strong> ${filtersLine || "Nenhum filtro ativo"}</div>
<table>
  <thead><tr>
    <th>Nº Pedido</th><th>Data</th><th>Cliente</th><th style="text-align:right">Valor (R$)</th>
    <th style="text-align:center">Itens</th><th style="text-align:center">Fin.</th>
    <th style="text-align:center">Status</th><th style="text-align:center">Pacote</th>
    <th style="text-align:center">Rota</th><th style="text-align:center">Prior.</th><th style="text-align:center">Lançado</th>
  </tr></thead>
  <tbody>${bodyHtml}</tbody>
</table>
</body></html>`;

    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };


  // Helper para busca múltipla por vírgula
  const processMultipleOrderSearch = (searchValue: string, orderCode: string): boolean => {
    if (!searchValue.trim()) return true;
    if (searchValue.includes(',')) {
      const terms = searchValue.split(',').map(t => t.trim().toLowerCase()).filter(t => t);
      return terms.some(term => orderCode.toLowerCase().includes(term));
    }
    return orderCode.toLowerCase().includes(searchValue.toLowerCase());
  };

  // --- FILTERING LOGIC ---
  const filteredOrders = useMemo(() => {
    if (!orders) return [];

    return orders.filter((order) => {
      // 1. Search (Multiple Order IDs with comma)
      if (searchOrderId && !processMultipleOrderSearch(searchOrderId, order.erpOrderId)) {
        return false;
      }

      // 2. Date Range — skipped when searching by load code
      const trimmedLoadCode = searchLoadCode.trim();
      if (!trimmedLoadCode && !isDateInRange(order.createdAt, filterDateRange)) return false;

      // 8. Load Code (case-insensitive, trim)
      if (trimmedLoadCode && !(order.loadCode || "").toString().toLowerCase().includes(trimmedLoadCode.toLowerCase())) return false;

      // 3. Financial Status
      if (financialStatusFilter !== "all") {
        // Map UI values to backend values if needed, assumes mismatch handled or 1:1
        // Backend: 'faturado' (Paid/Released), 'pendente', others? 
        // Let's assume 'faturado' = Pago/Liberado
        if (financialStatusFilter === "pago" && order.financialStatus !== "faturado") return false;
        if (financialStatusFilter === "pendente" && order.financialStatus === "faturado") return false;
        if (financialStatusFilter === "bloqueado" && order.financialStatus !== "bloqueado") return false; // assuming 'bloqueado' exists
      }

      // 4. Picking Status (Multi-select logic potentially, realized as single select in UI for simplicity first or custom multi)
      // Implementation: Check if PickingStatusFilter (array) includes order.status. If empty, all.
      // We will implement simpler single select for now to match UI library unless strictly multi
      // Specification says "Multi-select". 
      // check if status is in array.
      if (pickingStatusFilter.length > 0) {
        if (!pickingStatusFilter.includes(order.status)) return false;
      }

      // 5. Route
      if (routeFilter !== "all") {
        if (routeFilter === "unassigned") {
          if (order.routeId) return false;
        } else {
          if (String(order.routeId) !== routeFilter) return false;
        }
      }

      // 6. Priority
      if (priorityFilter !== "all") {
        const isHigh = order.priority > 0;
        if (priorityFilter === "high" && !isHigh) return false;
        if (priorityFilter === "normal" && isHigh) return false;
      }

      // 7. Launched
      if (launchedFilter !== "all") {
        const isLaunched = order.isLaunched;
        if (launchedFilter === "yes" && !isLaunched) return false;
        if (launchedFilter === "no" && isLaunched) return false;
      }


      return true;



      return true;
    });
  }, [orders, searchOrderId, filterDateRange, financialStatusFilter, pickingStatusFilter, routeFilter, priorityFilter, launchedFilter, companyId]);

  // Sort filtered results
  const sortedOrders = useMemo(() => sortData(filteredOrders, sort, (order, key) => {
    switch (key) {
      case "erpOrderId": return order.erpOrderId;
      case "createdAt": return new Date(order.createdAt).getTime();
      case "customerName": return order.customerName ?? "";
      case "totalValue": return Number(order.totalValue ?? 0);
      case "totalItems": return order.totalItems ?? 0;
      case "financialStatus": return order.financialStatus ?? "";
      case "status": return order.status ?? "";
      case "loadCode": return order.loadCode ?? "";
      case "priority": return order.priority ?? 0;
      case "isLaunched": return order.isLaunched ? 1 : 0;
      default: return null;
    }
  }), [filteredOrders, sort]);

  // Pagination logic
  const totalPages = Math.ceil(sortedOrders.length / pageSize);
  const paginatedOrders = sortedOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleSelectOrder = (id: string, checked: boolean) => {
    setSelectedOrders(prev => checked ? [...prev, id] : prev.filter(oId => oId !== id));
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectedOrders(checked ? sortedOrders.map(o => o.id) : []);
  };

  // --- ACTIONS HELPERS ---
  const handleAssignRoute = () => {
    if (!selectedRoute) return toast({ title: "Erro", description: "Selecione uma rota", variant: "destructive" });
    assignRouteMutation.mutate({ orderIds: selectedOrders, routeId: selectedRoute });
  };

  // Check if there are launched orders eligible for cancellation
  const selectedLaunchedOrders = useMemo(() => {
    if (!orders || selectedOrders.length === 0) return [];
    // "conferido" and "em_conferencia" incluídos
    const allowedStatuses = ["pendente", "em_separacao", "separado", "em_conferencia", "conferido"];
    return orders.filter(o =>
      selectedOrders.includes(o.id) &&
      o.isLaunched &&
      allowedStatuses.includes(o.status)
    );
  }, [orders, selectedOrders]);

  const hasLaunchedOrdersToCancel = selectedLaunchedOrders.length > 0;

  // Bug 2/3: Pedidos elegíveis para "Separar Total" — apenas pendente e em_separacao
  const selectedForSeparadoTotal = useMemo(() => {
    if (!orders || selectedOrders.length === 0) return [];
    const allowed = ["pendente", "em_separacao"];
    return orders.filter(o => selectedOrders.includes(o.id) && o.isLaunched && allowed.includes(o.status));
  }, [orders, selectedOrders]);

  // Bug 2/3: Pedidos elegíveis para "Conferir Total" — apenas separado e em_conferencia
  const selectedForConferidoTotal = useMemo(() => {
    if (!orders || selectedOrders.length === 0) return [];
    const allowed = ["separado", "em_conferencia"];
    return orders.filter(o => selectedOrders.includes(o.id) && o.isLaunched && allowed.includes(o.status));
  }, [orders, selectedOrders]);

  const statusOptions = [
    { value: 'pendente', label: 'Pendente a Separar' },
    { value: 'em_separacao', label: 'Em Separação' },
    { value: 'separado', label: 'Separado' },
    { value: 'em_conferencia', label: 'Em Conferência' },
    { value: 'conferido', label: 'Conferido' },
  ];

  return (
    <div className="min-h-screen bg-background print:bg-white">
      <div className="print:hidden">
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Voltar">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-base font-semibold text-foreground leading-tight">Gerenciamento de Pedidos</h1>
              <p className="text-xs text-muted-foreground">Painel Supervisor</p>
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" onClick={handlePrint} className="hidden sm:inline-flex px-2 sm:px-3" title="Imprimir">
              <Printer className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Imprimir</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending || syncingInBackground}
              className="px-2 sm:px-3"
              title={syncingInBackground ? "Sincronizando em segundo plano..." : "Sincronizar com servidor"}
            >
              <RefreshCw className={`h-4 w-4 sm:mr-2 ${(syncMutation.isPending || syncingInBackground) ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">
                {syncMutation.isPending ? "Iniciando..." : syncingInBackground ? "Sincronizando..." : "Sincronizar"}
              </span>
            </Button>
          </div>
        </div>
      </div>

      <main className="max-w-[1600px] mx-auto px-4 py-6 space-y-4 print:p-0 print:m-0 print:max-w-none">

        {/* Printable Header - Only visible when printing */}
        <div className="hidden print:block mb-4 pt-4">
          <h1 className="text-2xl font-bold">Relatório de Pedidos</h1>
          <p className="text-sm text-gray-500">Impresso em: {format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
          <div className="text-xs text-gray-800 mt-2 p-2 border border-gray-200 rounded">
            <strong>Filtros:</strong>{' '}
            {filterDateRange?.from && `Período: ${format(filterDateRange.from, 'dd/MM/yyyy')} a ${filterDateRange.to ? format(filterDateRange.to, 'dd/MM/yyyy') : format(new Date(), 'dd/MM/yyyy')} | `}
            {launchedFilter !== 'all' && `Lançado: ${launchedFilter === 'yes' ? 'Sim' : 'Não'} | `}
            {financialStatusFilter !== 'all' && `Financeiro: ${financialStatusFilter} | `}
            {searchOrderId && `Busca: ${searchOrderId} | `}
            {searchLoadCode && `Carga/Pacote: ${searchLoadCode} | `}
            Total Listado: {filteredOrders.length}
          </div>
        </div>

        {/* FILTERS PANEL */}
        {(() => {
          const activeSecondaryCount = [
            searchLoadCode ? 1 : 0,
            launchedFilter !== "all" ? 1 : 0,
            financialStatusFilter !== "all" ? 1 : 0,
            pickingStatusFilter.length > 0 ? 1 : 0,
            routeFilter !== "all" ? 1 : 0,
            priorityFilter !== "all" ? 1 : 0,
          ].reduce((a, b) => a + b, 0);

          return (
            <div className="bg-card border rounded-lg p-3 md:p-4 shadow-sm space-y-3 print:hidden">
              {/* Primary row — always visible */}
              <div className="flex gap-2 items-center">
                <div className="flex-1 relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Nº Pedido (separe múltiplos por vírgula)"
                    value={searchOrderId}
                    onChange={e => setSearchOrderId(e.target.value)}
                    className="pl-9"
                    data-testid="input-search-order"
                  />
                </div>

                {/* On md+: show Pacote/Carga inline */}
                <div className="hidden md:block w-[130px]">
                  <Input
                    placeholder="Pacote/Carga"
                    value={searchLoadCode}
                    onChange={e => setSearchLoadCode(e.target.value)}
                    data-testid="input-search-load-code"
                  />
                </div>

                {/* On md+: show Date Range inline */}
                <div className="hidden md:flex items-center gap-2">
                  <DatePickerWithRange date={tempDateRange} onDateChange={setTempDateRange} />
                  <Button variant="secondary" size="sm" onClick={() => setFilterDateRange(tempDateRange)}>
                    Buscar
                  </Button>
                </div>

                {/* Filter toggle button — shown on mobile only, hidden on md+ */}
                <Button
                  variant="outline"
                  size="sm"
                  className="md:hidden shrink-0 relative"
                  onClick={() => setShowExpandedFilters(v => !v)}
                  data-testid="button-toggle-filters"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  {activeSecondaryCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center bg-primary text-primary-foreground text-[9px] font-bold rounded-full">
                      {activeSecondaryCount}
                    </span>
                  )}
                </Button>

                <span className="hidden md:inline text-xs text-muted-foreground shrink-0 ml-1">{filteredOrders.length} pedidos</span>
              </div>

              {/* Secondary filters — on mobile: collapsible; on md+: always visible */}
              <div className={`${showExpandedFilters ? "block" : "hidden"} md:block space-y-3`}>
                {/* Mobile-only: Pacote/Carga + Date Range */}
                <div className="flex flex-wrap gap-2 items-end md:hidden">
                  <div className="flex-1 min-w-[120px] space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Pacote/Carga</label>
                    <Input
                      placeholder="Cód. 4 dígitos"
                      value={searchLoadCode}
                      onChange={e => setSearchLoadCode(e.target.value)}
                    />
                  </div>
                  <div className="w-full space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Período de Importação</label>
                    <div className="flex items-center gap-2">
                      <DatePickerWithRange date={tempDateRange} onDateChange={setTempDateRange} className="flex-1" />
                      <Button variant="secondary" size="sm" onClick={() => setFilterDateRange(tempDateRange)}>
                        Buscar
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Strict filters row */}
                <div className="flex flex-wrap gap-2 items-center pt-2 md:pt-0 border-t md:border-t">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground shrink-0">
                    <Filter className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Filtros Estritos:</span>
                    <span className="sm:hidden">Filtros:</span>
                  </div>

                  {/* Lançado? */}
                  <div className="w-[110px]">
                    <Select value={launchedFilter} onValueChange={setLaunchedFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Lançado?" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Lançado: Todos</SelectItem>
                        <SelectItem value="yes">Lançado: Sim</SelectItem>
                        <SelectItem value="no">Lançado: Não</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Financial */}
                  <div className="w-[140px]">
                    <Select value={financialStatusFilter} onValueChange={setFinancialStatusFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Financeiro" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos (Fin.)</SelectItem>
                        <SelectItem value="pago">Liberado/Pago</SelectItem>
                        <SelectItem value="pendente">Pendente</SelectItem>
                        <SelectItem value="bloqueado">Bloqueado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Picking Status */}
                  <div className="w-[170px]">
                    <Select value={pickingStatusFilter[0] || "all"} onValueChange={(val) => setPickingStatusFilter(val === "all" ? [] : [val])}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Status Sep." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os Status</SelectItem>
                        {statusOptions.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Route */}
                  <div className="w-[150px]">
                    <Select value={routeFilter} onValueChange={setRouteFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Rota" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas Rotas</SelectItem>
                        <SelectItem value="unassigned">Sem Rota</SelectItem>
                        {routes?.filter(r => r.active).map(r => (
                          <SelectItem key={r.id} value={String(r.id)}>{r.code} - {r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Priority */}
                  <div className="w-[120px]">
                    <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Prioridade" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="high">Alta / Vips</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="ml-auto hidden md:block">
                    <span className="text-xs text-muted-foreground">{filteredOrders.length} pedidos encontrados</span>
                  </div>
                </div>

                {/* Mobile count */}
                <div className="flex justify-between items-center md:hidden pt-1">
                  <span className="text-xs text-muted-foreground">{filteredOrders.length} pedidos encontrados</span>
                  {activeSecondaryCount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-muted-foreground hover:text-destructive px-2"
                      onClick={() => {
                        setSearchLoadCode("");
                        setLaunchedFilter("all");
                        setFinancialStatusFilter("all");
                        setPickingStatusFilter([]);
                        setRouteFilter("all");
                        setPriorityFilter("all");
                      }}
                    >
                      <X className="h-3 w-3 mr-1" /> Limpar filtros
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* BULK ACTIONS */}
        {selectedOrders.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-lg animate-in fade-in slide-in-from-top-2 print:hidden">
            <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
            <span className="text-sm font-medium">{selectedOrders.length} selecionados</span>
            <div className="h-4 w-px bg-border mx-1 hidden sm:block" />

            <Button size="sm" variant="outline" onClick={() => setShowRouteDialog(true)}>
              <RouteIcon className="h-4 w-4 mr-2" /> Atribuir Rota
            </Button>

            {/* Launch Button */}
            {selectedOrders.every(id => {
              const o = orders?.find(order => order.id === id);
              return o && !["separado", "em_separacao", "em_conferencia", "a_conferir", "conferido"].includes(o.status);
            }) && (
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => launchMutation.mutate({ orderIds: selectedOrders })} disabled={launchMutation.isPending}>
                <Send className="h-4 w-4 mr-2" /> Lançar para Separação
              </Button>
            )}

            {/* Optional: Priority / Recount */}
            <Button size="sm" variant="ghost" onClick={() => setPriorityMutation.mutate({ orderIds: selectedOrders, priority: 1 })}>
              <AlertTriangle className="h-4 w-4 mr-2" /> Priorizar
            </Button>

            {/* Force Status Buttons — Admin Only, status-aware */}
            {isAdmin && (
              <>
                {selectedForSeparadoTotal.length > 0 && (
                  <>
                    <div className="h-4 w-px bg-border mx-1" />
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-blue-400 text-blue-700 hover:bg-blue-50"
                      onClick={() => forceStatusMutation.mutate({ orderIds: selectedForSeparadoTotal.map(o => o.id), status: "separado" })}
                      disabled={forceStatusMutation.isPending}
                    >
                      <ClipboardCheck className="h-4 w-4 mr-2" /> Separar Total
                    </Button>
                  </>
                )}
                {selectedForConferidoTotal.length > 0 && (
                  <>
                    {selectedForSeparadoTotal.length === 0 && <div className="h-4 w-px bg-border mx-1" />}
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-green-500 text-green-700 hover:bg-green-50"
                      onClick={() => forceStatusMutation.mutate({ orderIds: selectedForConferidoTotal.map(o => o.id), status: "conferido" })}
                      disabled={forceStatusMutation.isPending}
                    >
                      <CheckSquare className="h-4 w-4 mr-2" /> Conferir Total
                    </Button>
                  </>
                )}
              </>
            )}

            {/* Cancel Launch Button - Only show for launched orders with allowed status */}
            {hasLaunchedOrdersToCancel && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => cancelLaunchMutation.mutate({ orderIds: selectedLaunchedOrders.map(o => o.id) })}
                disabled={cancelLaunchMutation.isPending}
              >
                <X className="h-4 w-4 mr-2" /> Cancelar Lançamento
              </Button>
            )}
          </div>
        )}

        {/* ORDER TABLE */}
        <div className="bg-card border rounded-lg shadow-sm overflow-hidden print:border-0 print:shadow-none print:overflow-visible">
          <Table className="print:w-full [&_th]:px-2 [&_th]:py-2 [&_td]:px-2 [&_td]:py-1.5 sm:[&_th]:px-4 sm:[&_th]:py-3 sm:[&_td]:px-4 sm:[&_td]:py-2">
            <TableHeader>
              <TableRow className="bg-muted/50 print:bg-transparent">
                <TableHead className="w-[32px] sm:w-[40px] print:hidden">
                  <Checkbox
                    checked={sortedOrders.length > 0 && selectedOrders.length === sortedOrders.length}
                    onCheckedChange={(c) => handleSelectAll(!!c)}
                  />
                </TableHead>
                <SortableTableHead label="Pedido" sortKey="erpOrderId" sort={sort} onSort={handleSort} className="font-bold text-primary print:text-black" />
                <SortableTableHead label="Data" sortKey="createdAt" sort={sort} onSort={handleSort} className="hidden lg:table-cell" />
                <SortableTableHead label="Cliente" sortKey="customerName" sort={sort} onSort={handleSort} />
                <SortableTableHead label="Valor (R$)" sortKey="totalValue" sort={sort} onSort={handleSort} className="hidden xl:table-cell" />
                <SortableTableHead label="Itens" sortKey="totalItems" sort={sort} onSort={handleSort} className="hidden lg:table-cell" />
                <SortableTableHead label="Fin." sortKey="financialStatus" sort={sort} onSort={handleSort} className="hidden md:table-cell" />
                <SortableTableHead label={<><span className="hidden sm:inline">Status Sep./Conf.</span><span className="sm:hidden">Status</span></>} sortKey="status" sort={sort} onSort={handleSort} />
                <TableHead className="hidden xl:table-cell">Vol.</TableHead>
                <SortableTableHead label="Pacote" sortKey="loadCode" sort={sort} onSort={handleSort} className="hidden xl:table-cell" />
                <TableHead className="hidden lg:table-cell">Rota</TableHead>
                <SortableTableHead label="Prioridade" sortKey="priority" sort={sort} onSort={handleSort} className="hidden xl:table-cell" />
                <SortableTableHead label="Lançado" sortKey="isLaunched" sort={sort} onSort={handleSort} className="hidden lg:table-cell" />
                <TableHead className="w-[36px] sm:w-[50px] print:hidden"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordersLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={12}><Skeleton className="h-10 w-full" /></TableCell></TableRow>
                ))
              ) : paginatedOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="h-32 text-center text-muted-foreground">Nenhum pedido encontrado com os filtros atuais.</TableCell>
                </TableRow>
              ) : (
                paginatedOrders.map(order => {
                  const route = routes?.find(r => r.id === order.routeId);
                  return (
                    <TableRow key={order.id} className="hover:bg-muted/30 cursor-pointer print:break-inside-avoid" onClick={() => handleSelectOrder(order.id, !selectedOrders.includes(order.id))}>
                      <TableCell className="print:hidden" onClick={e => e.stopPropagation()}>
                        <Checkbox checked={selectedOrders.includes(order.id)} onCheckedChange={c => handleSelectOrder(order.id, !!c)} />
                      </TableCell>
                      <TableCell className="font-mono font-bold text-xs sm:text-sm">
                        <div className="flex flex-col">
                          <span>{order.erpOrderId}</span>
                          <span className="text-[10px] text-muted-foreground font-normal lg:hidden">
                            {format(new Date(order.createdAt), "dd/MM HH:mm")}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden lg:table-cell">{format(new Date(order.createdAt), "dd/MM HH:mm")}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-xs sm:text-sm truncate max-w-[90px] sm:max-w-[140px] md:max-w-[180px]" title={order.customerName}>{order.customerName}</span>
                          <span className="text-[10px] text-muted-foreground">{order.customerCode || '-'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm hidden xl:table-cell">
                        {order.totalValue ? `R$ ${order.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-'}
                      </TableCell>
                      <TableCell className="text-center hidden lg:table-cell">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-[10px] font-medium text-muted-foreground">
                            {order.pickedItems || 0}/{order.totalItems || 0}
                          </span>
                          <Progress
                            value={order.totalItems ? ((order.pickedItems || 0) / order.totalItems) * 100 : 0}
                            className="h-1.5 w-16"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase
                                        ${order.financialStatus === 'faturado' ? 'bg-green-100 text-green-700 print:border print:border-green-700' : 'bg-yellow-100 text-yellow-700 print:border print:border-yellow-700'}`}>
                          {order.financialStatus === 'faturado' ? 'Liberado' : order.financialStatus}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={order.status} hasExceptions={order.hasExceptions} />
                      </TableCell>
                      <TableCell className="text-center hidden xl:table-cell">
                        {volumeMap.get(order.id) ? (
                          <span className="inline-flex items-center justify-center h-6 min-w-[1.75rem] px-1.5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                            {volumeMap.get(order.id)!.totalVolumes}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        {order.loadCode ? <span className="font-mono text-xs font-bold bg-purple-50 text-purple-700 px-2 py-0.5 rounded print:border print:border-purple-700">{order.loadCode}</span> : <span className="text-muted-foreground text-xs">-</span>}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {route ? (
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-xs bg-blue-50 text-blue-700 px-1 rounded print:border print:border-blue-700">{route.code}</span>
                          </div>
                        ) : <span className="text-muted-foreground text-xs">-</span>}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        {order.priority > 0 ? <Badge variant="destructive" className="text-[10px] print:border print:border-red-700">Alta</Badge> : <span className="text-[10px] text-muted-foreground">Normal</span>}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {order.isLaunched ? (
                          <div className="flex flex-col items-center">
                            <CheckCircle2 className="h-4 w-4 text-green-500 mb-0.5" />
                            {order.launchedAt && (
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                {format(new Date(order.launchedAt), "dd/MM HH:mm")}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="h-2 w-2 rounded-full bg-slate-300 block mx-auto" title="Não lançado" />
                        )}
                      </TableCell>
                      <TableCell className="print:hidden" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" onClick={() => setViewOrderId(order.id)}>
                          <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* PAGINATION */}
        <div className="flex items-center justify-between border-t pt-4">
          <div className="text-xs text-muted-foreground">
            Página {currentPage} de {totalPages || 1}
          </div>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>«</Button>
            <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>‹</Button>
            <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>›</Button>
          </div>
        </div>

      </main>

      {/* DIALOGS */}
      <Dialog open={showRouteDialog} onOpenChange={setShowRouteDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Atribuir Rota</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Select value={selectedRoute} onValueChange={setSelectedRoute}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {routes?.filter(r => r.active).map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={handleAssignRoute} disabled={assignRouteMutation.isPending} className="w-full">Confirmar</Button>
          </div>
        </DialogContent>
      </Dialog>

      <OrderDetailsDialog orderId={viewOrderId} open={!!viewOrderId} onOpenChange={(o) => !o && setViewOrderId(null)} />
    </div>
  );
}
