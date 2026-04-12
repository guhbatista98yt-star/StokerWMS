import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { format } from "date-fns";
import { ArrowLeft, Loader2, ClipboardList, Calendar, AlertTriangle, CheckCircle, XCircle, Printer, ChevronDown, ChevronUp } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

export default function CountingCyclesReportPage() {
  const [, navigate] = useLocation();
  const { companyId } = useAuth();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [expandedCycle, setExpandedCycle] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: "approve" | "reject"; cycleId: string } | null>(null);

  const approveMutation = useMutation({
    mutationFn: async (cycleId: string) => {
      const res = await apiRequest("POST", `/api/counting-cycles/${cycleId}/approve`);
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Erro ao aprovar"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-counting-cycles"] });
      queryClient.invalidateQueries({ queryKey: ["counting-cycles"] });
      toast({ title: "Ciclo aprovado com sucesso! Estoque ajustado." });
      setConfirmAction(null);
    },
    onError: (e: Error) => { toast({ title: "Erro", description: e.message, variant: "destructive" }); setConfirmAction(null); },
  });

  const rejectMutation = useMutation({
    mutationFn: async (cycleId: string) => {
      const res = await apiRequest("POST", `/api/counting-cycles/${cycleId}/reject`, { notes: "Rejeitado pelo supervisor" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Erro ao rejeitar"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-counting-cycles"] });
      queryClient.invalidateQueries({ queryKey: ["counting-cycles"] });
      toast({ title: "Ciclo rejeitado" });
      setConfirmAction(null);
    },
    onError: (e: Error) => { toast({ title: "Erro", description: e.message, variant: "destructive" }); setConfirmAction(null); },
  });

  const dateFrom = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "";
  const dateTo = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : "";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["report-counting-cycles", companyId, statusFilter, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      const res = await apiRequest("GET", `/api/reports/counting-cycles?${params}`);
      return res.json();
    },
    enabled: !!companyId,
  });

  const cycles = data?.cycles || [];
  const summary = data?.summary || {};

  const statusLabels: Record<string, string> = {
    pendente: "Pendente",
    em_andamento: "Em Andamento",
    concluido: "Concluído",
    aprovado: "Aprovado",
    rejeitado: "Rejeitado",
  };
  const statusColors: Record<string, string> = {
    pendente: "bg-yellow-100 text-yellow-800",
    em_andamento: "bg-blue-100 text-blue-800",
    concluido: "bg-green-100 text-green-800",
    aprovado: "bg-emerald-100 text-emerald-800",
    rejeitado: "bg-red-100 text-red-800",
  };
  const typeLabels: Record<string, string> = {
    por_endereco: "Por Endereço",
    por_produto: "Por Produto",
    por_pallet: "Por Pallet",
  };

  const esc = (str: string) => {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  };

  const handlePrint = (cycle: any) => {
    const w = window.open("", "_blank", "width=800,height=600");
    if (!w) return;
    w.document.write(`
      <html><head><title>Relatório Contagem ${esc(cycle.id.slice(0, 8))}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 15mm; font-size: 11px; }
        h1 { font-size: 16px; border-bottom: 2px solid #000; padding-bottom: 5px; }
        .meta { color: #555; margin-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
        th { background: #f5f5f5; font-weight: bold; }
        .divergent { background: #fff3cd; }
        .summary { margin-top: 15px; font-size: 10px; color: #777; }
        @media print { body { padding: 10mm; } }
      </style></head><body>
        <h1>Relatório de Contagem #${esc(cycle.id.slice(0, 8))}</h1>
        <div class="meta">
          <p>Tipo: ${esc(typeLabels[cycle.type] || cycle.type)} | Status: ${esc(statusLabels[cycle.status] || cycle.status)}</p>
          <p>Criado por: ${esc(cycle.createdByName)} em ${esc(new Date(cycle.createdAt).toLocaleString("pt-BR"))}</p>
          ${cycle.approvedByName !== "—" ? `<p>Aprovado por: ${esc(cycle.approvedByName)} em ${esc(cycle.approvedAt ? new Date(cycle.approvedAt).toLocaleString("pt-BR") : "—")}</p>` : ""}
          ${cycle.notes ? `<p>Observações: ${esc(cycle.notes)}</p>` : ""}
        </div>
        <table>
          <thead><tr>
            <th>Endereço</th><th>Produto</th><th>Código ERP</th>
            <th>Esperado</th><th>Contado</th><th>Divergência</th>
            <th>Contado por</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${(cycle.items || []).map((i: any) => `
              <tr class="${i.status === 'divergente' ? 'divergent' : ''}">
                <td>${esc(i.addressCode)}</td>
                <td>${esc(i.productName)}</td>
                <td>${esc(i.productErpCode)}</td>
                <td>${i.expectedQty ?? "—"}</td>
                <td>${i.countedQty ?? "—"}</td>
                <td>${i.divergencePct !== null ? esc(String(Math.round(Number(i.divergencePct) * 100) / 100)) + "%" : "—"}</td>
                <td>${esc(i.countedByName)}</td>
                <td>${esc(statusLabels[i.status] || i.status)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div class="summary">
          Total: ${cycle.totalItems} itens | Contados: ${cycle.countedItems} | Divergentes: ${cycle.divergentItems}
          ${cycle.avgDivergencePct > 0 ? ` | Divergência média: ${cycle.avgDivergencePct}%` : ""}
        </div>
      </body></html>
    `);
    w.document.close();
    setTimeout(() => w.print(), 300);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/supervisor/reports")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-base font-semibold text-foreground leading-tight">Ciclos de Contagem</h1>
          <p className="text-xs text-muted-foreground">Contagens com divergências e status de aprovação</p>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Status</label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36" data-testid="select-status-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="em_andamento">Em Andamento</SelectItem>
                <SelectItem value="concluido">Concluído</SelectItem>
                <SelectItem value="aprovado">Aprovado</SelectItem>
                <SelectItem value="rejeitado">Rejeitado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Período</label>
            <DatePickerWithRange date={dateRange} onDateChange={setDateRange} className="w-64" />
          </div>
        </div>

        {summary.totalCycles !== undefined && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="text-center p-3 rounded-lg bg-muted/30 border">
              <p className="text-xl font-bold">{summary.totalCycles}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Total Ciclos</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200">
              <p className="text-xl font-bold text-green-700">{summary.byStatus?.aprovado || 0}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Aprovados</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200">
              <p className="text-xl font-bold text-yellow-700">{summary.totalDivergent || 0}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Itens Divergentes</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200">
              <p className="text-xl font-bold text-blue-700">{summary.totalItemsCounted || 0}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Itens Contados</p>
            </div>
          </div>
        )}

        {isError ? (
          <div className="text-center py-12 text-destructive">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-60" />
            <p>Erro ao carregar relatório de contagens. Tente novamente.</p>
          </div>
        ) : isLoading ? (
          <div className="text-center py-12"><Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground" /></div>
        ) : cycles.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <ClipboardList className="h-12 w-12 mx-auto mb-4 opacity-40" />
            <p>Nenhum ciclo de contagem encontrado</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cycles.map((cycle: any) => (
              <Card key={cycle.id} className={`${cycle.divergentItems > 0 ? "border-l-4 border-l-amber-400" : ""}`} data-testid={`cycle-row-${cycle.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-sm font-mono">#{cycle.id.slice(0, 8)}</CardTitle>
                      <Badge className={statusColors[cycle.status] || ""}>{statusLabels[cycle.status] || cycle.status}</Badge>
                      <Badge variant="outline" className="text-[10px]">{typeLabels[cycle.type] || cycle.type}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      {cycle.status === "concluido" && (
                        <>
                          <Button size="sm" className="h-7 text-[11px]" onClick={() => setConfirmAction({ type: "approve", cycleId: cycle.id })} data-testid={`button-approve-${cycle.id}`}>
                            <CheckCircle className="h-3 w-3 mr-1" /> Aprovar
                          </Button>
                          <Button size="sm" variant="destructive" className="h-7 text-[11px]" onClick={() => setConfirmAction({ type: "reject", cycleId: cycle.id })} data-testid={`button-reject-${cycle.id}`}>
                            <XCircle className="h-3 w-3 mr-1" /> Rejeitar
                          </Button>
                        </>
                      )}
                      <Button variant="outline" size="sm" onClick={() => handlePrint(cycle)} data-testid={`button-print-${cycle.id}`} className="hidden sm:inline-flex">
                        <Printer className="h-3 w-3 mr-1" /> Imprimir
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setExpandedCycle(expandedCycle === cycle.id ? null : cycle.id)}>
                        {expandedCycle === cycle.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground mb-2">
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(cycle.createdAt).toLocaleString("pt-BR")}</span>
                    <span>Criado por: {cycle.createdByName}</span>
                    <span>{cycle.totalItems} itens</span>
                    <span>{cycle.countedItems} contados</span>
                    {cycle.divergentItems > 0 && (
                      <span className="text-amber-600 font-semibold flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />{cycle.divergentItems} divergentes ({cycle.avgDivergencePct}%)
                      </span>
                    )}
                    {cycle.approvedByName !== "—" && (
                      <span className="flex items-center gap-1">
                        <CheckCircle className="h-3 w-3 text-green-600" /> Aprovado por: {cycle.approvedByName}
                      </span>
                    )}
                  </div>

                  {expandedCycle === cycle.id && cycle.items && cycle.items.length > 0 && (
                    <div className="mt-3 border-t pt-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b text-muted-foreground">
                              <th className="text-left py-1 px-2">Endereço</th>
                              <th className="text-left py-1 px-2">Produto</th>
                              <th className="text-left py-1 px-2">ERP</th>
                              <th className="text-right py-1 px-2">Esperado</th>
                              <th className="text-right py-1 px-2">Contado</th>
                              <th className="text-right py-1 px-2">Div.%</th>
                              <th className="text-left py-1 px-2">Contado por</th>
                              <th className="text-left py-1 px-2">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cycle.items.map((item: any, idx: number) => (
                              <tr key={idx} className={`border-b last:border-0 ${item.status === "divergente" ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}>
                                <td className="py-1 px-2 font-mono">{item.addressCode}</td>
                                <td className="py-1 px-2 max-w-48 truncate">{item.productName}</td>
                                <td className="py-1 px-2 font-mono">{item.productErpCode}</td>
                                <td className="py-1 px-2 text-right font-mono">{item.expectedQty ?? "—"}</td>
                                <td className="py-1 px-2 text-right font-mono font-bold">{item.countedQty ?? "—"}</td>
                                <td className={`py-1 px-2 text-right font-mono ${item.divergencePct && Math.abs(Number(item.divergencePct)) > 5 ? "text-red-600 font-bold" : ""}`}>
                                  {item.divergencePct !== null ? `${Math.round(Number(item.divergencePct) * 100) / 100}%` : "—"}
                                </td>
                                <td className="py-1 px-2">{item.countedByName}</td>
                                <td className="py-1 px-2">
                                  <Badge className={`text-[8px] ${statusColors[item.status] || ""}`}>{statusLabels[item.status] || item.status}</Badge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <AlertDialog open={!!confirmAction} onOpenChange={open => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.type === "approve" ? "Aprovar Ciclo de Contagem" : "Rejeitar Ciclo de Contagem"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === "approve"
                ? "Ao aprovar, o estoque será ajustado conforme os valores contados. Esta ação não pode ser desfeita."
                : "Ao rejeitar, o ciclo será marcado como rejeitado e nenhum ajuste será feito no estoque."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-action">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className={confirmAction?.type === "reject" ? "bg-red-600 hover:bg-red-700 text-white" : ""}
              onClick={() => {
                if (!confirmAction) return;
                if (confirmAction.type === "approve") approveMutation.mutate(confirmAction.cycleId);
                else rejectMutation.mutate(confirmAction.cycleId);
              }}
              disabled={approveMutation.isPending || rejectMutation.isPending}
              data-testid="button-confirm-action"
            >
              {(approveMutation.isPending || rejectMutation.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {confirmAction?.type === "approve" ? "Confirmar Aprovação" : "Confirmar Rejeição"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
