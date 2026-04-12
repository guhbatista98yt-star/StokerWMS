import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, MapPin, Printer, Package } from "lucide-react";
import { useLocation } from "wouter";

export default function WmsAddressesReportPage() {
  const [, navigate] = useLocation();
  const { companyId } = useAuth();
  const [typeFilter, setTypeFilter] = useState("all");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["report-wms-addresses", companyId, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.append("type", typeFilter);
      const res = await apiRequest("GET", `/api/reports/wms-addresses?${params}`);
      return res.json();
    },
    enabled: !!companyId,
  });

  const addresses = data?.addresses || [];
  const summary = data?.summary || {};

  const typeLabels: Record<string, string> = {
    standard: "Padrão",
    picking: "Picking",
    recebimento: "Recebimento",
    expedicao: "Expedição",
  };

  const esc = (str: string) => {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  };

  const handlePrint = () => {
    const w = window.open("", "_blank", "width=800,height=600");
    if (!w) return;
    w.document.write(`
      <html><head><title>Relatório de Endereços WMS</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 15mm; font-size: 11px; }
        h1 { font-size: 16px; border-bottom: 2px solid #000; padding-bottom: 5px; }
        .summary { display: flex; gap: 20px; margin: 10px 0; font-size: 12px; }
        .summary span { font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
        th { background: #f5f5f5; font-weight: bold; }
        .occupied { background: #e3f2fd; }
        .inactive { background: #f5f5f5; color: #999; }
        @media print { body { padding: 10mm; } }
      </style></head><body>
        <h1>Relatório de Endereços WMS</h1>
        <div class="summary">
          <div>Total: <span>${summary.total || 0}</span></div>
          <div>Ativos: <span>${summary.active || 0}</span></div>
          <div>Ocupados: <span>${summary.occupied || 0}</span></div>
          <div>Livres: <span>${summary.empty || 0}</span></div>
          <div>Inativos: <span>${summary.inactive || 0}</span></div>
          <div>Taxa Ocupação: <span>${summary.occupancyRate || 0}%</span></div>
        </div>
        <table>
          <thead><tr>
            <th>Código</th><th>Bairro</th><th>Rua</th><th>Bloco</th><th>Nível</th>
            <th>Tipo</th><th>Status</th><th>Pallet</th><th>Qtd. Itens</th>
          </tr></thead>
          <tbody>
            ${addresses.map((a: any) => `
              <tr class="${!a.active ? 'inactive' : a.occupied ? 'occupied' : ''}">
                <td><strong>${esc(a.code)}</strong></td>
                <td>${esc(a.bairro)}</td>
                <td>${esc(a.rua)}</td>
                <td>${esc(a.bloco)}</td>
                <td>${esc(a.nivel)}</td>
                <td>${esc(typeLabels[a.type] || a.type)}</td>
                <td>${a.active ? (a.occupied ? "Ocupado" : "Livre") : "Inativo"}</td>
                <td>${a.palletCode ? esc(a.palletCode) : "—"}</td>
                <td>${a.palletItemCount || "—"}</td>
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
            <h1 className="text-base font-semibold text-foreground leading-tight">Endereços WMS</h1>
            <p className="text-xs text-muted-foreground">Ocupação e status dos endereços</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handlePrint} disabled={addresses.length === 0} data-testid="button-print-addresses" className="hidden sm:inline-flex">
          <Printer className="h-4 w-4 mr-2" /> Imprimir
        </Button>
      </div>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Tipo</label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-36" data-testid="select-type-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="standard">Padrão</SelectItem>
                <SelectItem value="picking">Picking</SelectItem>
                <SelectItem value="recebimento">Recebimento</SelectItem>
                <SelectItem value="expedicao">Expedição</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {summary.total !== undefined && (
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <div className="text-center p-3 rounded-lg bg-muted/30 border">
              <p className="text-xl font-bold">{summary.total}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Total</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-green-50 border border-green-200">
              <p className="text-xl font-bold text-green-700">{summary.active}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Ativos</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-blue-50 border border-blue-200">
              <p className="text-xl font-bold text-blue-700">{summary.occupied}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Ocupados</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/30 border">
              <p className="text-xl font-bold">{summary.empty}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Livres</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/30 border">
              <p className="text-xl font-bold text-muted-foreground">{summary.inactive}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Inativos</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-xl font-bold text-primary">{summary.occupancyRate}%</p>
              <p className="text-[10px] text-muted-foreground uppercase">Ocupação</p>
            </div>
          </div>
        )}

        {summary.byType && summary.byType.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {summary.byType.map((t: any) => (
              <Badge key={t.type} variant="outline" className="text-xs px-3 py-1">{t.label}: {t.count}</Badge>
            ))}
          </div>
        )}

        {isError ? (
          <div className="text-center py-12 text-destructive">
            <MapPin className="h-12 w-12 mx-auto mb-4 opacity-60" />
            <p>Erro ao carregar relatório de endereços. Tente novamente.</p>
          </div>
        ) : isLoading ? (
          <div className="text-center py-12"><Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground" /></div>
        ) : addresses.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <MapPin className="h-12 w-12 mx-auto mb-4 opacity-40" />
            <p>Nenhum endereço encontrado</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-2 px-3 font-medium">Código</th>
                  <th className="text-left py-2 px-3 font-medium">Bairro</th>
                  <th className="text-left py-2 px-3 font-medium">Rua</th>
                  <th className="text-left py-2 px-3 font-medium">Bloco</th>
                  <th className="text-left py-2 px-3 font-medium">Nível</th>
                  <th className="text-left py-2 px-3 font-medium">Tipo</th>
                  <th className="text-center py-2 px-3 font-medium">Status</th>
                  <th className="text-left py-2 px-3 font-medium">Pallet</th>
                  <th className="text-right py-2 px-3 font-medium">Qtd</th>
                </tr>
              </thead>
              <tbody>
                {addresses.map((addr: any) => (
                  <tr key={addr.id} className={`border-b hover:bg-muted/20 ${!addr.active ? "opacity-50" : ""}`} data-testid={`addr-row-${addr.id}`}>
                    <td className="py-2 px-3 font-mono font-semibold">{addr.code}</td>
                    <td className="py-2 px-3">{addr.bairro}</td>
                    <td className="py-2 px-3">{addr.rua}</td>
                    <td className="py-2 px-3">{addr.bloco}</td>
                    <td className="py-2 px-3">{addr.nivel}</td>
                    <td className="py-2 px-3">
                      <Badge variant="outline" className="text-[9px]">{typeLabels[addr.type] || addr.type}</Badge>
                    </td>
                    <td className="py-2 px-3 text-center">
                      {!addr.active ? (
                        <Badge variant="secondary" className="text-[9px]">Inativo</Badge>
                      ) : addr.occupied ? (
                        <Badge className="text-[9px] bg-blue-100 text-blue-800">Ocupado</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px]">Livre</Badge>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {addr.palletCode ? (
                        <span className="font-mono text-xs flex items-center gap-1">
                          <Package className="h-3 w-3 text-blue-500" />{addr.palletCode}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">{addr.palletItemCount || "—"}</td>
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
