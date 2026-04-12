import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Search, Printer, Map as MapIcon, AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

type LoadingMapItem = {
    product: { erpCode: string; name: string; barcode: string; manufacturer: string; qtUnit: number | null };
    quantity: number;
    exceptionQty: number;
    exceptionType: string | null;
    exceptionObs: string | null;
};
type LoadingMapSection = { section: string; items: LoadingMapItem[] };
type LoadingMapCustomer = {
    customerName: string; customerCode: string | null; erpOrderId: string; totalValue: number; totalProducts: number; sections: LoadingMapSection[];
    volumeInfo?: { sacola: number; caixa: number; saco: number; avulso: number; totalVolumes: number } | null;
};

const exceptionTypeLabels: Record<string, string> = {
    nao_encontrado: "Não Encontrado",
    avariado: "Avariado",
    vencido: "Vencido",
};

type SimpleOrder = { id: string; erpOrderId: string };
type OrderVolume = { orderId: string; sacola: number; caixa: number; saco: number; avulso: number; totalVolumes: number };

export default function LoadingMapReport() {
    const [, navigate] = useLocation();
    const { toast } = useToast();
    const [loadCode, setLoadCode] = useState("");
    const [searchCode, setSearchCode] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);

    const { data: loadingMapData, isLoading } = useQuery<LoadingMapCustomer[]>({
        queryKey: [`/api/reports/loading-map/${searchCode}`],
        enabled: searchCode.length > 0,
    });

    // Busca volumes e orders para cruzamento
    const { data: allOrders } = useQuery<SimpleOrder[]>({ queryKey: ["/api/orders"] });
    const { data: allVolumes } = useQuery<OrderVolume[]>({ queryKey: ["/api/order-volumes"] });

    // Map erpOrderId -> volume (eficiente: dois Maps O(n), lookup O(1))
    const volumeByErp = useMemo(() => {
        const idToErp = new Map<string, string>(); // orderId -> erpOrderId
        allOrders?.forEach(o => idToErp.set(o.id, o.erpOrderId));
        const map = new Map<string, OrderVolume>();
        allVolumes?.forEach(v => {
            const erpId = idToErp.get(v.orderId);
            if (erpId) map.set(erpId, v);
        });
        return map;
    }, [allOrders, allVolumes]);

    const handleSearch = () => {
        if (!loadCode.trim()) {
            toast({ title: "Informe um código", variant: "destructive" });
            return;
        }
        setSearchCode(loadCode.trim());
    };

    const handlePrint = async () => {
        if (!loadingMapData || loadingMapData.length === 0) return;
        setIsGenerating(true);
        try {
            await apiRequest("POST", "/api/audit-logs", {
                action: "print_report",
                entityType: "loading_map",
                details: `Imprimiu Mapa de Carregamento para o Cód. Pacote ${searchCode}`,
            });

            const now = new Date().toLocaleString("pt-BR");

            let bodyHtml = "";
            for (const customer of loadingMapData) {
                const totalValueFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(customer.totalValue);
                const vol = volumeByErp.get(customer.erpOrderId);
                const volInfo = vol ? `Vol: ${vol.totalVolumes} (${[vol.sacola > 0 ? `Sacola:${vol.sacola}` : '', vol.caixa > 0 ? `Caixa:${vol.caixa}` : '', vol.saco > 0 ? `Saco:${vol.saco}` : '', vol.avulso > 0 ? `Avulso:${vol.avulso}` : ''].filter(Boolean).join(' ')})` : "Sem volume";
                bodyHtml += `<tr class="customer-row"><td colspan="7">
                    <strong>${customer.customerCode ? `[${customer.customerCode}] ` : ""}${customer.customerName}</strong>
                    <br><span style="font-size: 10px; font-weight: normal;">Pedido: ${customer.erpOrderId} | Valor: ${totalValueFmt} | Itens: ${customer.totalProducts} | ${volInfo}</span>
                </td></tr>`;

                for (const section of customer.sections) {
                    bodyHtml += `<tr class="section-row"><td colspan="7">&nbsp;&nbsp;Seção: ${section.section}</td></tr>`;

                    for (const item of section.items) {
                        const qtyFormatted = item.quantity % 1 === 0 ? item.quantity.toFixed(0) : item.quantity.toFixed(2).replace(".", ",");
                        const exceptionQty = Number(item.exceptionQty || 0);
                        const hasExc = exceptionQty > 0;
                        const excLabel = item.exceptionType ? (exceptionTypeLabels[item.exceptionType] || item.exceptionType) : "";
                        const excCell = hasExc
                            ? `<span style="color:#c00;font-weight:bold;">⚠ ${exceptionQty} un</span><br><small style="color:#888">${excLabel}${item.exceptionObs ? ` — ${item.exceptionObs}` : ""}</small>`
                            : `<span style="color:#4a7c59">✓</span>`;

                        bodyHtml += `<tr${hasExc ? ' class="exc-row"' : ""}>
                            <td>${item.product?.erpCode || ""}</td>
                            <td>${item.product?.name || ""}</td>
                            <td>${item.product?.barcode || ""}</td>
                            <td>${item.product?.manufacturer || ""}</td>
                            <td class="right-align"><strong>${qtyFormatted}</strong></td>
                            <td class="right-align">${excCell}</td>
                        </tr>`;
                    }
                }
            }

            const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Mapa de Carregamento - ${searchCode}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; margin: 12px 20px; font-size: 10px; color: #000; line-height: 1.2; }
.header { margin-bottom: 8px; }
.header h1 { font-size: 16px; font-weight: bold; margin: 0 0 2px 0; }
.header .meta { font-size: 10px; color: #444; }
.sub-header { display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 3px; margin-bottom: 4px; font-size: 10px; font-weight: bold; }
table { width: 100%; border-collapse: collapse; margin-top: 2px; }
th { border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 3px 5px; text-align: left; font-size: 10px; font-weight: bold; background: #f0f0f0; }
th.right-align, td.right-align { text-align: right; }
td { padding: 2px 5px; font-size: 10px; border-bottom: 1px dashed #ddd; vertical-align: top; }
.customer-row td { padding-top: 10px; padding-bottom: 4px; border-bottom: 2px solid #000; font-size: 12px; font-weight: bold; background: #f8f8f8 !important; }
.section-row td { padding-top: 6px; padding-bottom: 2px; border-bottom: 1px solid #bbb; font-size: 10px; font-style: italic; color: #444; }
.exc-row td { background: #fff8f8; }
@media print { body { margin: 5mm 8mm; } @page { size: portrait; margin: 5mm; } tr { page-break-inside: avoid; } }
</style>
<script>window.onload = function() { window.print(); }</script>
</head><body>
<div class="header">
  <h1>Mapa de Carregamento — Pacote/Carga: ${searchCode}</h1>
  <div class="meta">Gerado em: ${now}</div>
</div>
<table>
  <thead>
    <tr>
      <th style="width:10%">Código</th>
      <th style="width:38%">Produto</th>
      <th style="width:16%">Cód. Barras</th>
      <th style="width:13%">Fabricante</th>
      <th style="width:9%" class="right-align">Qtd.</th>
      <th style="width:14%" class="right-align">Exceção</th>
    </tr>
  </thead>
  <tbody>${bodyHtml}</tbody>
</table>
</body></html>`;

            const printWindow = window.open("", "_blank");
            if (printWindow) {
                printWindow.document.write(html);
                printWindow.document.close();
            }
            toast({ title: "Relatório gerado!", description: "Impressão iniciada." });
        } catch {
            toast({ title: "Erro", description: "Falha ao imprimir", variant: "destructive" });
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="min-h-screen bg-background">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-card shrink-0">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/supervisor/reports")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <h1 className="text-base font-semibold text-foreground leading-tight">Mapa de Carregamento</h1>
                        <p className="text-xs text-muted-foreground">Lista de produtos por pacote/carga</p>
                    </div>
                </div>
            </div>

            <div className="p-6 max-w-5xl mx-auto space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Filtrar por Pacote/Carga</CardTitle>
                        <CardDescription>
                            Digite o código de 4 dígitos gerado durante o lançamento da separação.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex gap-4 items-end">
                            <div className="space-y-2 w-48">
                                <label className="text-sm font-medium">Cód. Pacote/Carga</label>
                                <Input
                                    placeholder="Ex: 8841"
                                    value={loadCode}
                                    onChange={e => setLoadCode(e.target.value)}
                                    onKeyDown={e => e.key === "Enter" && handleSearch()}
                                />
                            </div>
                            <Button onClick={handleSearch} disabled={isLoading}>
                                {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                                Buscar Dados
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {searchCode && (
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Resultado para: {searchCode}</CardTitle>
                                <CardDescription>Pré-visualização do mapa de carregamento.</CardDescription>
                            </div>
                            <Button onClick={handlePrint} disabled={!loadingMapData || loadingMapData.length === 0 || isGenerating} className="hidden sm:inline-flex bg-green-600 hover:bg-green-700">
                                {isGenerating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Printer className="h-4 w-4 mr-2" />}
                                Imprimir Mapa
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {isLoading ? (
                                <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
                            ) : loadingMapData && loadingMapData.length > 0 ? (
                                <div className="space-y-6">
                                    {loadingMapData.map((customer, idx) => (
                                        <div key={idx} className="border rounded-md p-4">
                                            <h3 className="text-lg font-bold border-b pb-2 mb-4 sm:flex justify-between items-center space-y-2 sm:space-y-0">
                                                <span>{customer.customerCode ? `[${customer.customerCode}] ` : ""}{customer.customerName}</span>
                                                <div className="text-sm font-normal text-muted-foreground flex flex-wrap gap-3 items-center">
                                                    <span>Pedido: <strong className="text-foreground">{customer.erpOrderId}</strong></span>
                                                    <span>Valor: <strong className="text-foreground">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(customer.totalValue)}</strong></span>
                                                    <span>Itens: <strong className="text-foreground">{customer.totalProducts}</strong></span>
                                                    {volumeByErp.get(customer.erpOrderId) ? (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                                                            {volumeByErp.get(customer.erpOrderId)!.totalVolumes} vol
                                                            <span className="font-normal text-blue-500">
                                                                ({[
                                                                    volumeByErp.get(customer.erpOrderId)!.sacola > 0 && `S:${volumeByErp.get(customer.erpOrderId)!.sacola}`,
                                                                    volumeByErp.get(customer.erpOrderId)!.caixa > 0 && `C:${volumeByErp.get(customer.erpOrderId)!.caixa}`,
                                                                    volumeByErp.get(customer.erpOrderId)!.saco > 0 && `Sa:${volumeByErp.get(customer.erpOrderId)!.saco}`,
                                                                    volumeByErp.get(customer.erpOrderId)!.avulso > 0 && `A:${volumeByErp.get(customer.erpOrderId)!.avulso}`,
                                                                ].filter(Boolean).join(' ')})
                                                            </span>
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground italic">sem volume</span>
                                                    )}
                                                </div>
                                            </h3>
                                            <div className="space-y-4">
                                                {customer.sections.map((sec, sidx) => (
                                                    <div key={sidx} className="pl-4 border-l-2 border-primary/20">
                                                        <h4 className="font-semibold text-muted-foreground mb-2">Seção: {sec.section}</h4>
                                                        <div className="space-y-1">
                                                            {sec.items.map((item, iidx) => (
                                                                <div key={iidx} className={`flex justify-between text-sm py-1.5 px-2 border-b border-dashed border-gray-100 last:border-0 rounded ${item.exceptionQty > 0 ? "bg-red-50" : "hover:bg-muted/30"}`}>
                                                                    <div className="flex gap-4 flex-1">
                                                                        <span className="font-mono text-muted-foreground w-20 shrink-0">{item.product?.erpCode}</span>
                                                                        <span className="flex-1 truncate">{item.product?.name}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-3">
                                                                        <span className="font-bold">{item.quantity} un</span>
                                                                        {Number(item.exceptionQty || 0) > 0 ? (
                                                                            <div className="flex items-center gap-1">
                                                                                <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                                                                                <span className="text-red-600 text-xs font-semibold">{Number(item.exceptionQty)} exc.</span>
                                                                                <Badge variant="outline" className="text-[10px] border-red-300 text-red-600 bg-red-50 px-1">
                                                                                    {exceptionTypeLabels[item.exceptionType || ""] || item.exceptionType}
                                                                                </Badge>
                                                                                {item.exceptionObs && (
                                                                                    <span className="text-[10px] text-muted-foreground truncate max-w-[100px]" title={item.exceptionObs}>
                                                                                        {item.exceptionObs}
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        ) : (
                                                                            <span className="text-xs text-green-600">OK</span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    <MapIcon className="h-12 w-12 mx-auto mb-4 opacity-20" />
                                    <p>Nenhum dado encontrado para o código <strong>{searchCode}</strong>.</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
