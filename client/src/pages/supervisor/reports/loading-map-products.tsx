import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowLeft, Search, Printer, Map as MapIcon, AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

type LoadingMapProductReportData = {
    section: string;
    products: {
        product: { erpCode: string; name: string; barcode: string; manufacturer: string; qtUnit: number | null };
        totalQuantity: number;
        totalExceptionQty?: number;
        orders: {
            erpOrderId: string;
            customerName: string;
            quantity: number;
            exceptionQty?: number;
            exceptionType?: string | null;
            exceptionObs?: string | null;
        }[];
    }[];
};

export default function LoadingMapProductsReport() {
    const { toast } = useToast();
    const [, navigate] = useLocation();
    const [loadCode, setLoadCode] = useState("");
    const [searchCode, setSearchCode] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);

    const { data: loadingMapData, isLoading } = useQuery<LoadingMapProductReportData[]>({
        queryKey: [`/api/reports/loading-map-by-product/${searchCode}`],
        enabled: searchCode.length > 0,
    });

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
                entityType: "loading_map_product",
                details: `Imprimiu Mapa de Carregamento Por Produto para o Cód. Pacote ${searchCode}`,
            });

            const now = new Date().toLocaleString("pt-BR");

            let bodyHtml = "";
            let totalGeneralProducts = 0;

            for (const sec of loadingMapData) {
                bodyHtml += `<tr class="section-row"><td colspan="5">Seção: ${sec.section.toUpperCase()}</td></tr>`;

                for (const prodItem of sec.products) {
                    const qtyFormatted = prodItem.totalQuantity % 1 === 0 ? prodItem.totalQuantity.toFixed(0) : prodItem.totalQuantity.toFixed(2).replace(".", ",");
                    totalGeneralProducts += prodItem.totalQuantity;

                    const totalExceptionQty = Number(prodItem.totalExceptionQty || 0);
                    const hasExc = totalExceptionQty > 0;
                    
                    bodyHtml += `<tr class="product-row${hasExc ? ' exc-row' : ''}">
                        <td>${prodItem.product?.erpCode || ""}</td>
                        <td><strong>${prodItem.product?.name || ""}</strong><br><span style="font-size:9px;color:#555">${prodItem.product?.manufacturer || "—"}</span></td>
                        <td class="mono" style="font-size:9px">${prodItem.product?.barcode || "—"}</td>
                        <td class="right-align"><strong>${qtyFormatted} un</strong>
                        ${hasExc ? `<br><span style="color:#c00; font-weight:bold; font-size:9px">⚠ ${totalExceptionQty} exc.</span>` : ''}
                        </td>
                    </tr>`;

                    if (prodItem.orders.length > 0) {
                        bodyHtml += `<tr class="orders-container"><td colspan="4">
                            <table class="inner-orders-table">
                                <thead>
                                    <tr>
                                        <th style="width:20%">Pedido</th>
                                        <th style="width:60%">Cliente</th>
                                        <th style="width:20%" class="right-align">Qtd</th>
                                    </tr>
                                </thead>
                                <tbody>`;
                        for (const o of prodItem.orders) {
                            const oQtyFmt = o.quantity % 1 === 0 ? o.quantity.toFixed(0) : o.quantity.toFixed(2).replace(".", ",");
                            const excQty = Number(o.exceptionQty || 0);
                            const htmlExc = excQty > 0 ? `<br><span style="color:#c00; font-size:8px">⚠ ${excQty} exc.</span>` : '';
                            bodyHtml += `<tr>
                                <td class="mono">${o.erpOrderId}</td>
                                <td>${o.customerName}</td>
                                <td class="right-align">${oQtyFmt} un${htmlExc}</td>
                            </tr>`;
                        }
                        bodyHtml += `</tbody></table></td></tr>`;
                    }
                }
            }

            const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Mapa por Produto - ${searchCode}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; margin: 12px 20px; font-size: 10px; color: #000; line-height: 1.2; }
.header { margin-bottom: 8px; }
.header h1 { font-size: 16px; font-weight: bold; margin: 0 0 2px 0; }
.header .meta { font-size: 10px; color: #444; }
table { width: 100%; border-collapse: collapse; margin-top: 2px; }
th { border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 3px 5px; text-align: left; font-size: 10px; font-weight: bold; background: #f0f0f0; }
th.right-align, td.right-align { text-align: right; }
td { padding: 2px 5px; font-size: 10px; border-bottom: 1px dashed #ddd; vertical-align: middle; }
.section-row td { padding-top: 8px; padding-bottom: 4px; border-bottom: 2px solid #000; font-size: 12px; font-weight: bold; background: #fff !important; }
.product-row td { background: #f8f8f8; font-size: 11px; padding-top: 5px; padding-bottom: 5px; border-bottom: 1px solid #ccc; font-weight: bold; }
.exc-row td { background: #fff8f8; }
.orders-container { padding: 0 !important; border-bottom: 2px solid #333 !important; }
.orders-container td { padding: 0 !important; border: none; }
table.inner-orders-table { width: 95%; margin: 2px auto 6px auto; border-left: 2px solid #ddd; }
table.inner-orders-table th { background: transparent; border: none; border-bottom: 1px solid #ccc; font-size: 9px; padding: 2px; color: #555; }
table.inner-orders-table td { border-bottom: 1px dashed #eee; font-size: 9px; padding: 2px; color: #333; font-weight: normal; }
td.mono { font-family: monospace; font-weight: bold; }
@media print { body { margin: 5mm 8mm; } @page { size: portrait; margin: 5mm; } tr { page-break-inside: avoid; } }
</style>
<script>window.onload = function() { window.print(); }</script>
</head><body>
<div class="header">
  <h1>Mapa de Carregamento (Por Produto) — Pacote: ${searchCode}</h1>
  <div class="meta">Gerado em: ${now} &nbsp;|&nbsp; Total de Itens no Pacote: ${totalGeneralProducts} un</div>
</div>
<table>
  <thead>
    <tr>
      <th style="width:12%">Código</th>
      <th style="width:43%">Produto / Fornecedor</th>
      <th style="width:20%">Cód. Barras</th>
      <th style="width:10%" class="right-align">Qtd. Total</th>
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
        } catch (error) {
            console.error("Print error:", error);
            toast({ title: "Erro", description: "Falha ao imprimir", variant: "destructive" });
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="min-h-screen bg-background">
            <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/supervisor/reports")}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-base font-semibold text-foreground leading-tight">Mapa de Carregamento por Produto</h1>
                    <p className="text-xs text-muted-foreground">Produtos agrupados por pacote e seção</p>
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
                                <CardTitle>Resultado para o Pacote: {searchCode}</CardTitle>
                                <CardDescription>Pré-visualização do agrupamento por produto.</CardDescription>
                            </div>
                            <Button onClick={handlePrint} disabled={!loadingMapData || loadingMapData.length === 0 || isGenerating} className="hidden sm:inline-flex bg-green-600 hover:bg-green-700">
                                {isGenerating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Printer className="h-4 w-4 mr-2" />}
                                Imprimir Relatório
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {isLoading ? (
                                <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
                            ) : loadingMapData && loadingMapData.length > 0 ? (
                                <div className="space-y-6">
                                    {loadingMapData.map((sec, idx) => (
                                        <div key={idx} className="border rounded-md p-4">
                                            <h3 className="text-lg font-bold border-b pb-2 mb-4 text-primary">
                                                Seção: {sec.section.toUpperCase()}
                                            </h3>
                                            <div className="space-y-6">
                                                {sec.products.map((prodItem, pidx) => (
                                                    <div key={pidx} className="border-l-4 border-l-slate-300 pl-4 mb-4">
                                                        <div className="flex justify-between items-start mb-2 bg-slate-50 p-2 rounded">
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <span className="font-mono text-muted-foreground text-sm">{prodItem.product?.erpCode}</span>
                                                                    <span className="font-bold text-gray-800">{prodItem.product?.name}</span>
                                                                </div>
                                                                <div className="flex gap-4 mt-0.5 flex-wrap">
                                                                    {prodItem.product?.manufacturer && (
                                                                        <span className="text-xs text-muted-foreground">{prodItem.product.manufacturer}</span>
                                                                    )}
                                                                    {prodItem.product?.barcode && (
                                                                        <span className="text-xs font-mono text-muted-foreground">{prodItem.product.barcode}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-col items-end shrink-0 ml-4">
                                                                <div className="font-bold text-green-700 text-lg">{prodItem.totalQuantity} un</div>
                                                                {Number(prodItem.totalExceptionQty || 0) > 0 && (
                                                                    <div className="text-red-600 text-sm font-bold flex items-center gap-1 mt-1">
                                                                        <AlertTriangle className="h-4 w-4" />
                                                                        {Number(prodItem.totalExceptionQty)} exc.
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {prodItem.orders.length > 0 && (
                                                            <div className="pl-4 space-y-1">
                                                                <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">Pedidos:</div>
                                                                {prodItem.orders.map((o, oidx) => (
                                                                    <div key={oidx} className="flex justify-between text-sm py-1 border-b border-dashed border-gray-100 last:border-0 hover:bg-muted/10">
                                                                        <div className="flex gap-4 flex-1">
                                                                            <span className="font-mono text-muted-foreground w-20">{o.erpOrderId}</span>
                                                                            <span className="truncate flex-1">{o.customerName}</span>
                                                                        </div>
                                                                        <div className="font-semibold text-muted-foreground w-24 flex flex-col items-end">
                                                                            <span>{o.quantity} un</span>
                                                                            {Number(o.exceptionQty || 0) > 0 && (
                                                                                <span className="text-red-500 text-xs flex items-center gap-1 mt-0.5" title={o.exceptionType || "Exceção"}>
                                                                                    <AlertTriangle className="h-3 w-3" />
                                                                                    {Number(o.exceptionQty)} exc.
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    <MapIcon className="h-12 w-12 mx-auto mb-4 opacity-20" />
                                    <p>Nenhum dado encontrado para o código de pacote <strong>{searchCode}</strong>.</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
