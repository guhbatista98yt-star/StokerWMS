import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import {
  ArrowLeft, Route as RouteIcon, Search, Filter, Printer, Package,
  Loader2, X, ChevronDown, ChevronUp,
} from "lucide-react";
import type { Order, Route } from "@shared/schema";
import { getCurrentWeekRange, isDateInRange } from "@/lib/date-utils";
import { format } from "date-fns";

export default function RouteOrdersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filterDateRange, setFilterDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());
  const [selectedRouteFilter, setSelectedRouteFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPickupPoint, setSelectedPickupPoint] = useState<string>("all");
  const [searchPackageCode, setSearchPackageCode] = useState("");
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [targetRouteId, setTargetRouteId] = useState<string>("");
  const [isPrinting, setIsPrinting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const { data: orders, isLoading: ordersLoading } = useQuery<Order[]>({
    queryKey: ["/api/orders"],
  });

  const { data: routes } = useQuery<Route[]>({
    queryKey: ["/api/routes"],
  });

  const { data: pickupPointsData } = useQuery<any[]>({
    queryKey: ["/api/pickup-points"],
  });

  const assignRouteMutation = useMutation({
    mutationFn: async ({ orderIds, routeId }: { orderIds: string[]; routeId: string }) => {
      const res = await apiRequest("POST", "/api/orders/assign-route", { orderIds, routeId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      setShowAssignDialog(false);
      setSelectedOrders([]);
      toast({ title: "Rotas atualizadas", description: `${selectedOrders.length} pedido(s) atribuído(s) à rota.` });
    },
    onError: () => {
      toast({ title: "Erro", description: "Falha ao atribuir rota", variant: "destructive" });
    },
  });

  const activeRoutes = useMemo(() => routes?.filter(r => r.active) || [], [routes]);

  const filteredOrders = useMemo(() => {
    if (!orders) return [];
    return orders.filter(order => {
      if (!isDateInRange(order.createdAt, filterDateRange)) return false;
      if (selectedRouteFilter !== "all") {
        if (selectedRouteFilter === "unassigned") { if (order.routeId) return false; }
        else { if (String(order.routeId) !== selectedRouteFilter) return false; }
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchId = searchQuery.includes(",")
          ? searchQuery.split(",").map(t => t.trim().toLowerCase()).filter(t => t).some(t => order.erpOrderId.toLowerCase().includes(t))
          : order.erpOrderId.toLowerCase().includes(q);
        if (!matchId && !order.customerName.toLowerCase().includes(q)) return false;
      }
      if (searchPackageCode.trim() && (order as any).loadCode !== searchPackageCode.trim()) return false;
      if (selectedPickupPoint !== "all") {
        const pp = String((order as any).pickupPoints || "");
        if (!pp.includes(selectedPickupPoint)) return false;
      }
      return true;
    });
  }, [orders, filterDateRange, selectedRouteFilter, searchQuery, searchPackageCode, selectedPickupPoint]);

  const isAssignmentRedundant = targetRouteId && selectedOrders.length > 0 &&
    selectedOrders.every(id => String(orders?.find(o => o.id === id)?.routeId) === targetRouteId);

  function handleSelectAll(checked: boolean) {
    setSelectedOrders(checked ? filteredOrders.map(o => o.id) : []);
  }

  function handleSelectOrder(orderId: string, checked: boolean) {
    setSelectedOrders(prev => checked ? [...prev, orderId] : prev.filter(id => id !== orderId));
  }

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      const idsToPrint = filteredOrders.map(o => o.id);
      if (idsToPrint.length === 0) return;
      const now = new Date().toLocaleString("pt-BR");
      const res = await apiRequest("POST", "/api/reports/route-orders-print", { orderIds: idsToPrint });
      const populatedOrders = await res.json();
      let bodyHtml = "";
      for (const order of populatedOrders) {
        const route = routes?.find(r => r.id === order.routeId);
        const routeLabel = route ? `${route.code} - ${route.name}` : "Sem Rota";
        const dateStr = format(new Date(order.createdAt), "dd/MM HH:mm");
        const value = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(order.totalValue || 0);
        bodyHtml += `<tr class="order-header">
          <td class="mono">${order.erpOrderId}</td><td>${dateStr}</td>
          <td>${order.customerName}<br><small>${order.customerCode || ""}</small></td>
          <td class="right">${value}</td>
          <td>${order.financialStatus === "faturado" ? "Liberado" : (order.financialStatus || "-")}</td>
          <td>${order.status}</td><td>${routeLabel}</td><td>${order.loadCode || "-"}</td>
        </tr>`;
        if (order.items?.length > 0) {
          bodyHtml += `<tr><td colspan="8" class="items-cell"><table class="inner-table"><thead><tr>
            <th style="width:15%">Cód. Produto</th><th style="width:15%">Cód. Barras</th>
            <th style="width:35%">Descrição</th><th style="width:15%" class="right">Qtd.</th>
            <th style="width:20%" class="right">Status</th></tr></thead><tbody>`;
          const sorted = [...order.items].sort((a: any, b: any) => (a.product?.name || "").localeCompare(b.product?.name || ""));
          for (const item of sorted) {
            bodyHtml += `<tr>
              <td class="mono">${item.product?.erpCode || "-"}</td>
              <td class="mono">${item.product?.barcode || "-"}</td>
              <td>${item.product?.name || "Desconhecido"}</td>
              <td class="right">${item.quantity}</td>
              <td class="right">${item.status || "pendente"}</td>
            </tr>`;
          }
          bodyHtml += `</tbody></table></td></tr>`;
        }
      }
      const filtersLine = [
        searchQuery && `Busca: ${searchQuery}`,
        searchPackageCode && `Pacote: ${searchPackageCode}`,
        selectedRouteFilter !== "all" && `Rota: ${selectedRouteFilter}`,
      ].filter(Boolean).join(" | ") || "Sem filtros";
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Gestão de Rotas</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;margin:10px 18px;font-size:10px;color:#000}
.header h1{font-size:15px;font-weight:bold;margin-bottom:2px}
.header .meta{font-size:9px;color:#555;margin-bottom:6px}
.spacer{border-bottom:2px solid #000;margin-bottom:4px}
table{width:100%;border-collapse:collapse}
th{background:#f0f0f0;border-top:2px solid #000;border-bottom:2px solid #000;padding:3px 5px;text-align:left;font-size:10px}
td{padding:2px 5px;font-size:10px;border-bottom:1px dashed #ddd;vertical-align:top}
td.mono{font-family:monospace;font-weight:bold}
td.right{text-align:right;text-transform:capitalize}
.order-header td{background:#f9f9f9;font-size:11px;padding:4px 5px;border-bottom:1px solid #ccc;font-weight:bold}
.items-cell{padding:0!important;border-bottom:2px solid #444!important}
.inner-table{margin:0;width:100%;border-left:10px solid #fff}
.inner-table th{background:transparent;border:none;border-bottom:1px solid #eee;padding:2px 5px;font-size:9px;color:#666}
.inner-table td{border-bottom:1px dashed #f0f0f0;padding:2px 5px;font-size:9px;color:#333}
@media print{body{margin:5mm 8mm}@page{size:portrait;margin:5mm}}
</style><script>window.onload=function(){window.print()}</script>
</head><body>
<div class="header">
  <h1>Gestão de Rotas — Pedidos & Produtos</h1>
  <div class="meta">Gerado: ${now} | ${filtersLine} | Total: ${filteredOrders.length} pedidos</div>
</div>
<div class="spacer"></div>
<table><thead><tr>
  <th>Nº Pedido</th><th>Data</th><th>Cliente</th><th style="text-align:right">Valor</th>
  <th>Fin.</th><th>Status</th><th>Rota</th><th>Pacote</th>
</tr></thead><tbody>${bodyHtml}</tbody></table>
</body></html>`;
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); }
    } finally { setIsPrinting(false); }
  };

  const hasFilters = searchQuery || searchPackageCode || selectedRouteFilter !== "all" || selectedPickupPoint !== "all";

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <Link href="/">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-semibold text-foreground leading-tight">Pedidos por Rota</h1>
          <p className="text-xs text-muted-foreground">Visualize e atribua rotas aos pedidos</p>
        </div>
        {selectedOrders.length > 0 && (
          <Button size="sm" className="h-8 gap-1.5 rounded-xl" onClick={() => setShowAssignDialog(true)}>
            <RouteIcon className="h-3.5 w-3.5" />
            Atribuir Rota ({selectedOrders.length})
          </Button>
        )}
        <Button variant="outline" size="icon" className="hidden sm:flex h-8 w-8 rounded-xl" onClick={handlePrint} disabled={isPrinting || filteredOrders.length === 0} title="Imprimir lista">
          {isPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
        </Button>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4 space-y-3">

        {/* Main search + date bar */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              data-testid="input-search-order"
              placeholder="Buscar pedido ou cliente... (separe por vírgula para múltiplos)"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-10 rounded-xl h-9"
            />
            {searchQuery && (
              <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearchQuery("")}>
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
          <DatePickerWithRange date={tempDateRange} onDateChange={setTempDateRange} className="w-full sm:w-auto" />
          <Button variant="secondary" className="h-9 px-4 rounded-xl shrink-0" onClick={() => setFilterDateRange(tempDateRange)}>
            Buscar
          </Button>
          <Button
            variant="outline"
            size="icon"
            className={`h-9 w-9 rounded-xl shrink-0 ${showFilters || hasFilters ? "bg-primary/10 border-primary/30 text-primary" : ""}`}
            onClick={() => setShowFilters(v => !v)}
            data-testid="button-toggle-filters"
          >
            <Filter className="h-4 w-4" />
          </Button>
        </div>

        {/* Expanded filters */}
        {showFilters && (
          <div className="flex flex-wrap gap-2 px-3 py-3 rounded-xl bg-muted/50 border border-border/50">
            <Select value={selectedRouteFilter} onValueChange={setSelectedRouteFilter}>
              <SelectTrigger className="w-[160px] h-8 text-xs rounded-xl" data-testid="select-route-filter">
                <SelectValue placeholder="Rota" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as Rotas</SelectItem>
                <SelectItem value="unassigned">Sem Rota</SelectItem>
                {activeRoutes.map(route => (
                  <SelectItem key={route.id} value={String(route.id)}>{route.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedPickupPoint} onValueChange={setSelectedPickupPoint}>
              <SelectTrigger className="w-[160px] h-8 text-xs rounded-xl" data-testid="select-pickup-filter">
                <SelectValue placeholder="Ponto de Retirada" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Pontos</SelectItem>
                {(pickupPointsData || []).map((pp: any) => (
                  <SelectItem key={pp.id} value={String(pp.id)}>{pp.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative">
              <Package className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                data-testid="input-package-code"
                placeholder="Código carga"
                value={searchPackageCode}
                onChange={e => setSearchPackageCode(e.target.value)}
                className="pl-8 h-8 w-[140px] text-xs rounded-xl"
              />
            </div>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground"
                onClick={() => { setSelectedRouteFilter("all"); setSelectedPickupPoint("all"); setSearchPackageCode(""); setSearchQuery(""); }}
              >
                <X className="h-3 w-3 mr-1" />Limpar filtros
              </Button>
            )}
          </div>
        )}

        {/* Summary bar */}
        {!ordersLoading && (
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-muted-foreground">
              {filteredOrders.length} pedido{filteredOrders.length !== 1 ? "s" : ""}
              {selectedOrders.length > 0 && <span className="text-primary font-medium"> · {selectedOrders.length} selecionado{selectedOrders.length !== 1 ? "s" : ""}</span>}
            </p>
            {selectedOrders.length > 0 && (
              <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setSelectedOrders([])}>
                Limpar seleção
              </button>
            )}
          </div>
        )}

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden">
          {ordersLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="text-center py-14 text-muted-foreground">
              <RouteIcon className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Nenhum pedido encontrado</p>
              <p className="text-sm mt-1">Tente ajustar os filtros de data ou rota</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={filteredOrders.length > 0 && selectedOrders.length === filteredOrders.length}
                      onCheckedChange={handleSelectAll}
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                  <TableHead className="w-[100px]">Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="hidden md:table-cell w-[120px]">Data</TableHead>
                  <TableHead className="hidden lg:table-cell w-[130px]">Rota</TableHead>
                  <TableHead className="hidden lg:table-cell w-[110px] text-right">Valor</TableHead>
                  <TableHead className="hidden md:table-cell w-[100px]">Financeiro</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map(order => {
                  const route = routes?.find(r => r.id === order.routeId);
                  const isSelected = selectedOrders.includes(order.id);
                  return (
                    <TableRow
                      key={order.id}
                      className={`cursor-pointer transition-colors select-none ${isSelected ? "bg-primary/5" : "hover:bg-muted/50"}`}
                      onClick={() => handleSelectOrder(order.id, !isSelected)}
                      data-testid={`row-order-${order.id}`}
                    >
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Checkbox checked={isSelected} onCheckedChange={checked => handleSelectOrder(order.id, !!checked)} />
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold">{order.erpOrderId}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate" title={order.customerName}>{order.customerName}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{format(new Date(order.createdAt), "dd/MM/yy HH:mm")}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {route ? (
                          <Badge variant="outline" className="text-xs border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:border-blue-800 dark:text-blue-300">{route.name}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Sem rota</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-right text-xs">
                        {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(order.totalValue)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="outline" className={`text-xs ${order.financialStatus === "faturado"
                          ? "border-green-200 bg-green-50 text-green-700 dark:bg-green-950/20 dark:border-green-800 dark:text-green-300"
                          : "border-yellow-200 bg-yellow-50 text-yellow-700 dark:bg-yellow-950/20 dark:border-yellow-800 dark:text-yellow-300"}`}>
                          {order.financialStatus === "faturado" ? "Liberado" : "Pendente"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs capitalize">{order.status}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {/* Assign Route Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Atribuir Rota em Lote</DialogTitle>
            <DialogDescription>
              Selecione a rota para aplicar aos {selectedOrders.length} pedido{selectedOrders.length !== 1 ? "s" : ""} selecionado{selectedOrders.length !== 1 ? "s" : ""}.
            </DialogDescription>
          </DialogHeader>
          <Select value={targetRouteId} onValueChange={setTargetRouteId}>
            <SelectTrigger data-testid="select-target-route">
              <SelectValue placeholder="Selecione uma rota" />
            </SelectTrigger>
            <SelectContent>
              {activeRoutes.map(route => (
                <SelectItem key={route.id} value={String(route.id)}>{route.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>Cancelar</Button>
            <Button
              onClick={() => assignRouteMutation.mutate({ orderIds: selectedOrders, routeId: targetRouteId })}
              disabled={!targetRouteId || assignRouteMutation.isPending || !!isAssignmentRedundant}
              data-testid="button-confirm-assign"
            >
              {assignRouteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
