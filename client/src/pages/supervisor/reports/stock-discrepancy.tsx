import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, AlertTriangle, TrendingUp, TrendingDown, Package, MapPin, Printer, Loader2, Filter, ChevronDown, ChevronUp, Barcode, Hash } from "lucide-react";
import { useLocation } from "wouter";
import { StockLegend } from "@/components/wms/product-stock-info";

export default function StockDiscrepancyReportPage() {
  const [, navigate] = useLocation();
  const { companyId, companiesData } = useAuth();
  const [filter, setFilter] = useState("all_discrepancy");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const { data, isLoading, isError } = useQuery({
    queryKey: ["stock-discrepancy-report", companyId, filter],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/stock-discrepancy?filter=${filter}`);
      return res.json();
    },
    enabled: !!companyId,
  });

  const products = data?.products || [];
  const summary = data?.summary || {};

  const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filterOptions = [
    { value: "all_discrepancy", label: "Todas Divergências" },
    { value: "positive", label: "Excesso (WMS > Real)" },
    { value: "negative", label: "Falta (WMS < Real)" },
  ];

  const printReport = () => {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    const companyName = esc(companiesData?.find(c => c.id === companyId)?.name || "");
    const now = new Date().toLocaleString("pt-BR");

    w.document.write(`
      <html><head><title>Divergências de Estoque - ${companyName}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 15mm; margin: 0; font-size: 11px; color: #333; }
        h1 { font-size: 16px; margin-bottom: 4px; }
        .meta { color: #888; font-size: 10px; margin-bottom: 12px; }
        .summary { display: flex; gap: 20px; margin-bottom: 16px; padding: 8px 12px; background: #f5f5f5; border-radius: 6px; }
        .summary-item { }
        .summary-label { font-size: 9px; color: #888; text-transform: uppercase; }
        .summary-value { font-size: 14px; font-weight: bold; }
        .positive { color: #dc2626; }
        .negative { color: #d97706; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th { background: #f0f0f0; text-align: left; padding: 6px 8px; font-size: 10px; border-bottom: 2px solid #ddd; }
        td { padding: 5px 8px; border-bottom: 1px solid #eee; font-size: 10px; }
        tr.excess { background: #fef2f2; }
        tr.deficit { background: #fffbeb; }
        .mono { font-family: monospace; }
        .right { text-align: right; }
        .addr-list { font-size: 9px; color: #666; margin-top: 2px; }
        @media print { body { padding: 10mm; } }
      </style></head><body>
        <h1>Relatório de Divergências de Estoque</h1>
        <div class="meta">${companyName} · Gerado em ${now} · Filtro: ${filterOptions.find(f => f.value === filter)?.label}</div>
        <div class="summary">
          <div class="summary-item">
            <div class="summary-label">Total Produtos</div>
            <div class="summary-value">${summary.totalProducts || 0}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Com Excesso</div>
            <div class="summary-value positive">${summary.positiveCount || 0} (+${summary.totalPositiveUnits || 0} un)</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Com Falta</div>
            <div class="summary-value negative">${summary.negativeCount || 0} (${summary.totalNegativeUnits || 0} un)</div>
          </div>
        </div>
        <div style="font-size:9px;color:#888;margin-bottom:8px;">
          <strong>PALETT</strong> = Unidades em pallets &nbsp;|&nbsp; <strong>PICK</strong> = Unidades em gôndola/picking
        </div>
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Produto</th>
              <th>Seção</th>
              <th class="right">Real</th>
              <th class="right">PALETT</th>
              <th class="right">PICK</th>
              <th class="right">WMS Total</th>
              <th class="right">Diferença</th>
              <th>Endereços</th>
            </tr>
          </thead>
          <tbody>
            ${products.map((p: any) => `
              <tr class="${p.difference > 0 ? 'excess' : 'deficit'}">
                <td class="mono">${esc(p.erpCode || '')}</td>
                <td>${esc(p.name || '')}</td>
                <td>${esc(p.section || '')}</td>
                <td class="right mono">${p.totalStock}</td>
                <td class="right mono">${p.palletizedStock}</td>
                <td class="right mono">${p.pickingStock}</td>
                <td class="right mono">${p.wmsTotal}</td>
                <td class="right mono ${p.difference > 0 ? 'positive' : 'negative'}"><strong>${p.difference > 0 ? '+' : ''}${p.difference}</strong></td>
                <td class="addr-list">${(p.addresses || []).map((a: any) => `${esc(a.addressCode)}: ${a.quantity} (${esc(a.palletCode)})`).join('; ') || '—'}</td>
              </tr>
            `).join('')}
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
            <h1 className="text-base font-semibold text-foreground leading-tight">Divergências de Estoque</h1>
            <p className="text-xs text-muted-foreground">Diferença entre estoque real (ERP) e WMS paletizado</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={printReport} disabled={products.length === 0} data-testid="button-print-report" className="hidden sm:inline-flex">
          <Printer className="h-4 w-4 mr-2" /> Imprimir
        </Button>
      </div>

      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          {filterOptions.map(opt => (
            <Button
              key={opt.value}
              variant={filter === opt.value ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs rounded-lg"
              onClick={() => setFilter(opt.value)}
              data-testid={`filter-${opt.value}`}
            >
              {opt.label}
            </Button>
          ))}
          <div className="ml-auto">
            <StockLegend />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="text-center py-16 text-muted-foreground">
            <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
              <AlertTriangle className="h-7 w-7 text-red-500" />
            </div>
            <p className="text-sm font-medium text-red-600 dark:text-red-400">Erro ao carregar relatório</p>
            <p className="text-xs mt-1 opacity-70">Tente novamente mais tarde</p>
          </div>
        ) : (
          <>
            {summary && (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-border/50 bg-card p-4 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Total Divergências</p>
                  <p className="text-2xl font-bold mt-1" data-testid="text-total-discrepancies">{summary.totalProducts || 0}</p>
                </div>
                <div className="rounded-xl border border-red-200/60 dark:border-red-800/40 bg-red-50 dark:bg-red-950/20 p-4 text-center">
                  <p className="text-[10px] text-red-600 dark:text-red-400 uppercase font-semibold tracking-wider">Excesso (WMS &gt; Real)</p>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1" data-testid="text-positive-count">{summary.positiveCount || 0}</p>
                  <p className="text-xs text-red-500 dark:text-red-400 font-mono">+{summary.totalPositiveUnits || 0} un</p>
                </div>
                <div className="rounded-xl border border-amber-200/60 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 p-4 text-center">
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 uppercase font-semibold tracking-wider">Falta (WMS &lt; Real)</p>
                  <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1" data-testid="text-negative-count">{summary.negativeCount || 0}</p>
                  <p className="text-xs text-amber-500 dark:text-amber-400 font-mono">{summary.totalNegativeUnits || 0} un</p>
                </div>
              </div>
            )}

            {products.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-muted flex items-center justify-center">
                  <Package className="h-7 w-7 opacity-30" />
                </div>
                <p className="text-sm font-medium">Nenhuma divergência encontrada</p>
                <p className="text-xs mt-1 opacity-70">Todos os produtos estão com estoque correto</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-border/50 bg-card overflow-hidden divide-y divide-border/30">
                {products.map((p: any) => {
                  const isExpanded = expandedIds.has(p.id);
                  const isPositive = p.difference > 0;
                  return (
                    <div key={p.id} className={`${isPositive ? "border-l-[3px] border-l-red-400" : "border-l-[3px] border-l-amber-400"}`} data-testid={`row-discrepancy-${p.id}`}>
                      <button
                        className="w-full px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                        onClick={() => toggleExpand(p.id)}
                        data-testid={`button-expand-${p.id}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-sm leading-tight">{p.name}</h3>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px] text-muted-foreground">
                              <span className="flex items-center gap-0.5 font-mono font-semibold text-primary">
                                <Hash className="h-2.5 w-2.5" />{p.erpCode}
                              </span>
                              {p.barcode && (
                                <span className="flex items-center gap-0.5 font-mono">
                                  <Barcode className="h-2.5 w-2.5" />{p.barcode}
                                </span>
                              )}
                              <span>Seção: {p.section || "—"}</span>
                              {p.manufacturer && <span>Fab: {p.manufacturer}</span>}
                            </div>
                          </div>

                          <div className="shrink-0 text-right space-y-1">
                            <Badge variant="outline" className={`font-mono font-bold text-xs px-2 py-0.5 ${
                              isPositive
                                ? "border-red-300 text-red-600 bg-red-50 dark:border-red-700 dark:text-red-400 dark:bg-red-950/30"
                                : "border-amber-300 text-amber-600 bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:bg-amber-950/30"
                            }`} data-testid={`badge-diff-${p.id}`}>
                              {isPositive ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                              {isPositive ? "+" : ""}{p.difference} {p.unit}
                            </Badge>
                            <div className="flex items-center justify-end">
                              {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                            </div>
                          </div>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-3 space-y-2">
                          <div className="grid grid-cols-4 gap-2 text-center">
                            <div className="rounded-lg bg-muted/30 p-2">
                              <p className="text-[9px] text-muted-foreground uppercase font-semibold">Real</p>
                              <p className="font-mono font-bold text-sm">{p.totalStock}</p>
                            </div>
                            <div className="rounded-lg bg-violet-50 dark:bg-violet-950/30 p-2">
                              <p className="text-[9px] text-violet-600 dark:text-violet-400 uppercase font-semibold">PALETT</p>
                              <p className="font-mono font-bold text-sm text-violet-600 dark:text-violet-400">{p.palletizedStock}</p>
                            </div>
                            <div className="rounded-lg bg-orange-50 dark:bg-orange-950/30 p-2">
                              <p className="text-[9px] text-orange-600 dark:text-orange-400 uppercase font-semibold">PICK</p>
                              <p className="font-mono font-bold text-sm text-orange-600 dark:text-orange-400">{p.pickingStock}</p>
                            </div>
                            <div className={`rounded-lg p-2 ${isPositive ? "bg-red-50 dark:bg-red-950/30" : "bg-amber-50 dark:bg-amber-950/30"}`}>
                              <p className={`text-[9px] uppercase font-semibold ${isPositive ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>Diferença</p>
                              <p className={`font-mono font-bold text-sm ${isPositive ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                                {isPositive ? "+" : ""}{p.difference}
                              </p>
                            </div>
                          </div>

                          <div className={`rounded-lg p-2.5 text-[11px] font-medium ${
                            isPositive
                              ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200/60 dark:border-red-800/40"
                              : "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/40"
                          }`}>
                            <div className="flex items-start gap-1.5">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                              <div>
                                {isPositive ? (
                                  <>
                                    <p className="font-semibold">Excesso de {p.difference} {p.unit} no WMS</p>
                                    <p className="mt-0.5 opacity-80">Possível erro na paletização (quantidade informada a mais) ou estoque real desatualizado no ERP.</p>
                                  </>
                                ) : (
                                  <>
                                    <p className="font-semibold">Falta de {Math.abs(p.difference)} {p.unit} no WMS</p>
                                    <p className="mt-0.5 opacity-80">Produto pode estar faltando fisicamente ou quantidade informada incorretamente na paletização.</p>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {p.addresses && p.addresses.length > 0 && (
                            <div>
                              <p className="text-[9px] font-bold text-muted-foreground uppercase mb-1.5 flex items-center gap-0.5">
                                <MapPin className="h-2.5 w-2.5" /> Endereços ({p.addressCount})
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {p.addresses.map((addr: any, i: number) => (
                                  <div key={i} className="flex items-center gap-1 bg-muted/40 rounded-lg px-2 py-1 text-[11px] border border-border/30">
                                    <span className="font-bold">{addr.addressCode}</span>
                                    <span className="text-border">|</span>
                                    <span className="font-mono font-bold text-violet-600 dark:text-violet-400">{Number(addr.quantity).toLocaleString("pt-BR")}</span>
                                    <span className="text-[9px] text-muted-foreground">({addr.palletCode})</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="text-[10px] text-muted-foreground">
                            <span className="font-mono">Fórmula: Real ({p.totalStock}) - PALETT ({p.palletizedStock}) = PICK ({p.pickingStock}) | PALETT ({p.palletizedStock}) + PICK ({p.pickingStock}) = WMS ({p.wmsTotal}) | WMS ({p.wmsTotal}) - Real ({p.totalStock}) = Diferença ({isPositive ? "+" : ""}{p.difference})</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
