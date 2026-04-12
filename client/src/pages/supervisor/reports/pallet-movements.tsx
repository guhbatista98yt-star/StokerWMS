import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { format } from "date-fns";
import { ArrowLeft, Loader2, ArrowRightLeft, Printer, Package, MapPin, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";

export default function PalletMovementsReportPage() {
  const [, navigate] = useLocation();
  const { companyId } = useAuth();
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const dateFrom = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "";
  const dateTo = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : "";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["report-pallet-movements", companyId, typeFilter, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.append("type", typeFilter);
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      const res = await apiRequest("GET", `/api/reports/pallet-movements?${params}`);
      return res.json();
    },
    enabled: !!companyId,
  });

  const movements = data?.movements || [];
  const summary = data?.summary || {};

  const movTypeLabels: Record<string, string> = {
    created: "Criado",
    allocated: "Alocação",
    transferred: "Transferência",
    split: "Divisão",
    cancelled: "Cancelamento",
    counted: "Contagem",
  };
  const movTypeColors: Record<string, string> = {
    created: "bg-green-100 text-green-800",
    allocated: "bg-blue-100 text-blue-800",
    transferred: "bg-purple-100 text-purple-800",
    split: "bg-orange-100 text-orange-800",
    cancelled: "bg-red-100 text-red-800",
    counted: "bg-yellow-100 text-yellow-800",
  };

  const esc = (str: string) => {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  };

  const handlePrint = () => {
    const w = window.open("", "_blank", "width=900,height=600");
    if (!w) return;
    w.document.write(`
      <html><head><title>Relatório de Movimentações</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 15mm; font-size: 10px; }
        h1 { font-size: 16px; border-bottom: 2px solid #000; padding-bottom: 5px; }
        .filters { color: #555; margin-bottom: 10px; font-size: 11px; }
        .summary { display: flex; gap: 15px; margin: 10px 0; font-size: 11px; }
        .summary span { font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { border: 1px solid #ccc; padding: 3px 6px; text-align: left; }
        th { background: #f5f5f5; font-weight: bold; }
        @media print { body { padding: 10mm; } }
      </style></head><body>
        <h1>Relatório de Movimentações de Pallets</h1>
        <div class="filters">
          ${dateFrom ? `De: ${dateFrom}` : ""} ${dateTo ? `Até: ${dateTo}` : ""} ${typeFilter !== "all" ? `Tipo: ${movTypeLabels[typeFilter] || typeFilter}` : ""}
        </div>
        <div class="summary">
          <div>Total: <span>${summary.totalMovements || 0}</span></div>
          ${(summary.byType || []).map((t: any) => `<div>${esc(t.label)}: <span>${t.count}</span></div>`).join("")}
        </div>
        <table>
          <thead><tr>
            <th>Data/Hora</th><th>Tipo</th><th>Pallet</th>
            <th>De</th><th>Para</th><th>Operador</th><th>Obs</th>
          </tr></thead>
          <tbody>
            ${movements.map((m: any) => `
              <tr>
                <td>${esc(new Date(m.createdAt).toLocaleString("pt-BR"))}</td>
                <td>${esc(movTypeLabels[m.movementType] || m.movementType)}</td>
                <td><strong>${esc(m.palletCode)}</strong></td>
                <td>${esc(m.fromAddressCode)}</td>
                <td>${esc(m.toAddressCode)}</td>
                <td>${esc(m.performedByName)}</td>
                <td>${esc(m.notes || "")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </body></html>
    `);
    w.document.close();
    setTimeout(() => w.print(), 300);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/supervisor/reports")} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-base font-semibold text-foreground leading-tight">Movimentações de Pallets</h1>
            <p className="text-xs text-muted-foreground">Histórico de movimentações</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handlePrint} disabled={movements.length === 0} data-testid="button-print-movements" className="hidden sm:inline-flex">
          <Printer className="h-4 w-4 mr-2" /> Imprimir
        </Button>
      </div>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Tipo</label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-40" data-testid="select-type-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="created">Criado</SelectItem>
                <SelectItem value="allocated">Alocação</SelectItem>
                <SelectItem value="transferred">Transferência</SelectItem>
                <SelectItem value="split">Divisão</SelectItem>
                <SelectItem value="cancelled">Cancelamento</SelectItem>
                <SelectItem value="counted">Contagem</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Período</label>
            <DatePickerWithRange date={dateRange} onDateChange={setDateRange} className="w-64" />
          </div>
        </div>

        {summary.totalMovements !== undefined && (
          <div className="flex flex-wrap gap-2">
            <div className="text-center px-4 py-2 rounded-lg bg-muted/30 border">
              <p className="text-lg font-bold">{summary.totalMovements}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Total</p>
            </div>
            {(summary.byType || []).map((t: any) => (
              <div key={t.type} className="text-center px-4 py-2 rounded-lg bg-muted/30 border">
                <p className="text-lg font-bold">{t.count}</p>
                <p className="text-[10px] text-muted-foreground uppercase">{t.label}</p>
              </div>
            ))}
          </div>
        )}

        {summary.byDay && summary.byDay.length > 0 && (
          <div className="p-3 rounded-lg border bg-muted/10">
            <p className="text-xs font-bold text-muted-foreground uppercase mb-2">Movimentações por dia</p>
            <div className="flex gap-1 items-end h-16 overflow-x-auto">
              {summary.byDay.slice(0, 14).reverse().map((d: any) => {
                const maxCount = Math.max(...summary.byDay.map((dd: any) => dd.count));
                const height = maxCount > 0 ? Math.max(4, (d.count / maxCount) * 60) : 4;
                return (
                  <div key={d.date} className="flex flex-col items-center gap-1 min-w-[30px]" title={`${d.date}: ${d.count} mov.`}>
                    <span className="text-[8px] font-mono font-bold">{d.count}</span>
                    <div className="w-5 bg-primary/60 rounded-t" style={{ height: `${height}px` }} />
                    <span className="text-[7px] text-muted-foreground">{d.date.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {isError ? (
          <div className="text-center py-12 text-destructive">
            <ArrowRightLeft className="h-12 w-12 mx-auto mb-4 opacity-60" />
            <p>Erro ao carregar relatório de movimentações. Tente novamente.</p>
          </div>
        ) : isLoading ? (
          <div className="text-center py-12"><Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground" /></div>
        ) : movements.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <ArrowRightLeft className="h-12 w-12 mx-auto mb-4 opacity-40" />
            <p>Nenhuma movimentação encontrada</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-2 px-3 font-medium">Data/Hora</th>
                  <th className="text-left py-2 px-3 font-medium">Tipo</th>
                  <th className="text-left py-2 px-3 font-medium">Pallet</th>
                  <th className="text-left py-2 px-3 font-medium">De</th>
                  <th className="text-center py-2 px-3 font-medium"></th>
                  <th className="text-left py-2 px-3 font-medium">Para</th>
                  <th className="text-left py-2 px-3 font-medium">Operador</th>
                  <th className="text-left py-2 px-3 font-medium">Obs</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m: any) => (
                  <tr key={m.id} className="border-b hover:bg-muted/20" data-testid={`mov-row-${m.id}`}>
                    <td className="py-2 px-3 text-xs whitespace-nowrap">{new Date(m.createdAt).toLocaleString("pt-BR")}</td>
                    <td className="py-2 px-3">
                      <Badge className={`text-[9px] ${movTypeColors[m.movementType] || ""}`}>{movTypeLabels[m.movementType] || m.movementType}</Badge>
                    </td>
                    <td className="py-2 px-3 font-mono font-semibold flex items-center gap-1">
                      <Package className="h-3 w-3 text-primary" />{m.palletCode}
                    </td>
                    <td className="py-2 px-3">
                      {m.fromAddressCode !== "—" ? (
                        <span className="font-mono text-xs flex items-center gap-1"><MapPin className="h-3 w-3 text-muted-foreground" />{m.fromAddressCode}</span>
                      ) : "—"}
                    </td>
                    <td className="py-2 px-3 text-center">
                      {m.fromAddressCode !== "—" || m.toAddressCode !== "—" ? <ArrowRight className="h-3 w-3 text-muted-foreground mx-auto" /> : null}
                    </td>
                    <td className="py-2 px-3">
                      {m.toAddressCode !== "—" ? (
                        <span className="font-mono text-xs flex items-center gap-1"><MapPin className="h-3 w-3 text-primary" />{m.toAddressCode}</span>
                      ) : "—"}
                    </td>
                    <td className="py-2 px-3 text-xs">{m.performedByName}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground max-w-32 truncate">{m.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
