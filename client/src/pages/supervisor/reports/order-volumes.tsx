import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ArrowLeft, PackageOpen, ShoppingBag, Archive, Box, Tag } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface OrderVolume {
    id: string;
    orderId: string;
    erpOrderId: string;
    sacola: number;
    caixa: number;
    saco: number;
    avulso: number;
    totalVolumes: number;
    createdAt: string;
    updatedAt: string;
    customerName?: string;
    address?: string;
    addressNumber?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    routeCode?: string;
    routeName?: string;
    companyName?: string;
}

const e = (s?: string | null) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function buildReimpressaoHtml(vol: OrderVolume): string {
    const dt = vol.createdAt ? new Date(vol.createdAt) : new Date();
    const dateStr = format(dt, "dd/MM/yyyy", { locale: ptBR });
    const timeStr = format(dt, "HH:mm",      { locale: ptBR });

    const routeDisplay = e(vol.routeName || vol.routeCode) || "";
    const sender   = e(vol.companyName) || "";
    const addrLine = [vol.address, vol.addressNumber ? `nº ${vol.addressNumber}` : ""].filter(Boolean).join(", ");
    const neighLine = e(vol.neighborhood || "");
    const cityLine  = e([vol.city, vol.state].filter(Boolean).join(" - "));
    const orderId   = e(vol.erpOrderId);
    const orderLen  = String(vol.erpOrderId).length;
    const orderFs   = orderLen > 7 ? 26 : orderLen > 5 ? 32 : 36;

    const allCounts = [
        { label: "ROTA",   val: routeDisplay || "—" },
        { label: "SACOLA", val: vol.sacola  },
        { label: "CAIXA",  val: vol.caixa   },
        { label: "SACO",   val: vol.saco    },
        { label: "AVULSO", val: vol.avulso  },
    ];

    const countBoxes = allCounts.map(c =>
        `<div class="count-box${c.label === "ROTA" ? " count-box-rota" : ""}"><div class="count-lbl">${c.label}</div><div class="${c.label === "ROTA" ? "count-val-sm" : "count-val"}">${c.val}</div></div>`
    ).join("");

    const labels = Array.from({ length: vol.totalVolumes }, (_, i) => {
        const volNum = i + 1;
        const qrData = encodeURIComponent(`VOL:${vol.erpOrderId}:${volNum}/${vol.totalVolumes}`);
        return `
<div class="page-wrap">
<div class="label">
  <div class="top-bar">
    <div class="top-left">
      <div class="sec-lbl">PEDIDO</div>
      <div class="order-num" style="font-size:${orderFs}px;line-height:1">${orderId}</div>
    </div>
    <div class="top-right">
      <div class="sec-lbl">VOLUME</div>
      <div class="vol-wrap"><span class="vol-num">${volNum}</span><span class="vol-denom">/${vol.totalVolumes}</span></div>
    </div>
  </div>
  <div class="body-row">
    <div class="dest-col">
      <div class="dest-info">
        <div class="dest-tag">&#128100; Destinatário</div>
        <div class="dest-name">${e(vol.customerName) || "—"}</div>
        ${addrLine  ? `<div class="dest-addr">${e(addrLine)}</div>` : ""}
        ${neighLine ? `<div class="dest-addr">${neighLine}</div>` : ""}
        ${cityLine  ? `<div class="dest-city">${cityLine}</div>` : ""}
        ${sender    ? `<div class="sender-block"><div class="sender-tag">Remetente</div><div class="sender-name">${sender}</div></div>` : ""}
      </div>
      <div class="count-strip">${countBoxes}</div>
    </div>
    <div class="qr-col">
      <div class="qr-wrap">
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${qrData}&qzone=1&format=png"
             width="80" height="80" alt="QR" onerror="this.style.display='none'" />
      </div>
    </div>
  </div>
</div>
<div class="date-row">${dateStr} às ${timeStr}</div>
</div>`;
    }).join("");

    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<style>
@page { size: 100mm 70mm landscape; margin: 1.5mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #000; }

.page-wrap { display: flex; flex-direction: column; width: 97mm; page-break-after: always; }
.page-wrap:last-child { page-break-after: avoid; }

.label { width: 97mm; height: 61mm; border: 2px solid #000; border-radius: 3mm; display: flex; flex-direction: column; overflow: hidden; background: #fff; }

/* TOPO */
.top-bar { background: #000; color: #fff; display: flex; flex-shrink: 0; height: 22mm; }
.top-left  { flex: 1; padding: 3px 7px; border-right: 2px solid rgba(255,255,255,.25); display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
.top-right { width: 32mm; padding: 3px 7px; display: flex; flex-direction: column; justify-content: center; }
.sec-lbl   { font-size: 6.5px; font-weight: bold; letter-spacing: .8px; color: rgba(255,255,255,.5); line-height: 1; text-transform: uppercase; margin-bottom: 1px; }
.order-num { font-weight: 900; line-height: 1; letter-spacing: -0.5px; color: #fff; white-space: nowrap; }
.vol-wrap  { display: flex; align-items: baseline; gap: 1px; line-height: 1; }
.vol-num   { font-size: 34px; font-weight: 900; color: #fff; letter-spacing: -0.5px; }
.vol-denom { font-size: 22px; font-weight: 700; color: rgba(255,255,255,.65); }

/* CORPO */
.body-row  { flex: 1; display: flex; overflow: hidden; }
.dest-col  { flex: 1; padding: 5px 6px 4px; display: flex; flex-direction: column; border-right: 1.5px solid #bbb; overflow: hidden; }
.dest-info { flex: 1; overflow: hidden; }
.dest-tag  { font-size: 7px; font-weight: bold; letter-spacing: .5px; color: #555; text-transform: uppercase; margin-bottom: 2px; }
.dest-name { font-size: 11px; font-weight: 900; line-height: 1.2; text-transform: uppercase; margin-bottom: 2px; }
.dest-addr { font-size: 8.5px; color: #222; line-height: 1.3; }
.dest-city { font-size: 8.5px; color: #000; font-weight: 700; line-height: 1.3; }
.sender-block { margin-top: 3px; border-top: 1px dashed #ddd; padding-top: 2px; }
.sender-tag   { font-size: 6px; font-weight: bold; color: #777; letter-spacing: .4px; text-transform: uppercase; }
.sender-name  { font-size: 8px; font-weight: 700; color: #222; }

.count-strip { display: flex; gap: 2px; border-top: 1px solid #ccc; padding-top: 3px; margin-top: 2px; flex-shrink: 0; }
.count-box   { flex: 1; border: 1px solid #888; border-radius: 2px; text-align: center; padding: 2px 1px; overflow: hidden; }
.count-box-rota { flex: 1.4; }
.count-lbl   { font-size: 6.5px; font-weight: bold; color: #444; letter-spacing: .2px; }
.count-val   { font-size: 13px; font-weight: 900; line-height: 1.1; }
.count-val-sm { font-size: 8px; font-weight: 900; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.qr-col  { width: 32mm; flex-shrink: 0; display: flex; align-items: center; justify-content: center; padding: 5px; }
.qr-wrap { border: 1.5px solid #ccc; padding: 2px; line-height: 0; }

/* Data abaixo da etiqueta */
.date-row { text-align: right; font-size: 8.5px; font-weight: bold; color: #333; padding-top: 2px; padding-right: 1mm; }
</style>
<script>window.onload = function() { window.print(); }</script>
</head><body>${labels}</body></html>`;
}

export default function OrderVolumesReport() {
    const [, navigate] = useLocation();
    const { toast } = useToast();
    const [printingId, setPrintingId] = useState<string | null>(null);

    const { data: volumes, isLoading } = useQuery<OrderVolume[]>({
        queryKey: ["/api/order-volumes"],
    });

    const handlePrint = (vol: OrderVolume) => {
        setPrintingId(vol.id);
        const html = buildReimpressaoHtml(vol);
        const win = window.open("", "_blank");
        if (win) {
            win.document.write(html);
            win.document.close();
            toast({ title: "Etiquetas geradas!", description: `${vol.totalVolumes} etiqueta(s) do pedido ${vol.erpOrderId}.` });
        }
        setPrintingId(null);
    };

    const formatDate = (dateStr: string) => {
        try { return format(new Date(dateStr), "dd/MM/yyyy HH:mm", { locale: ptBR }); }
        catch { return dateStr; }
    };

    return (
        <div className="min-h-screen bg-background">
            <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/supervisor/reports")}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-base font-semibold text-foreground leading-tight">Etiquetas de Volume</h1>
                    <p className="text-xs text-muted-foreground">Reimpressão de etiquetas geradas na conferência</p>
                </div>
            </div>

            <div className="p-6 max-w-4xl mx-auto">
                {isLoading ? (
                    <div className="flex justify-center p-12">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : !volumes || volumes.length === 0 ? (
                    <Card>
                        <CardContent className="flex flex-col items-center py-12 text-muted-foreground">
                            <PackageOpen className="h-12 w-12 mb-4 opacity-20" />
                            <p>Nenhuma etiqueta de volume gerada ainda.</p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-3">
                        {volumes.map(vol => (
                            <Card key={vol.id} className="border border-orange-100 dark:border-orange-900/30">
                                <CardContent className="p-4">
                                    <div className="flex items-center justify-between gap-4 flex-wrap">
                                        <div className="space-y-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono font-bold text-base">{vol.erpOrderId}</span>
                                                <span className="px-2 py-0.5 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded text-xs font-semibold">
                                                    {vol.totalVolumes} vol
                                                </span>
                                                {vol.routeCode && (
                                                    <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded text-xs">
                                                        Rota {vol.routeCode}
                                                    </span>
                                                )}
                                            </div>
                                            {vol.customerName && (
                                                <div className="text-sm font-medium text-foreground">{vol.customerName}</div>
                                            )}
                                            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                                {vol.sacola > 0 && <span><ShoppingBag className="inline h-3 w-3 mr-0.5" />Sacola: {vol.sacola}</span>}
                                                {vol.caixa > 0 && <span><Box className="inline h-3 w-3 mr-0.5" />Caixa: {vol.caixa}</span>}
                                                {vol.saco > 0 && <span><Archive className="inline h-3 w-3 mr-0.5" />Saco: {vol.saco}</span>}
                                                {vol.avulso > 0 && <span><Tag className="inline h-3 w-3 mr-0.5" />Avulso: {vol.avulso}</span>}
                                            </div>
                                            <div className="text-xs text-muted-foreground">Gerado em: {formatDate(vol.createdAt)}</div>
                                        </div>
                                        <Button
                                            size="sm"
                                            className="bg-orange-600 hover:bg-orange-700 text-white shrink-0"
                                            onClick={() => handlePrint(vol)}
                                            disabled={printingId === vol.id}
                                            data-testid={`btn-reprint-${vol.id}`}
                                        >
                                            {printingId === vol.id
                                                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                : <PackageOpen className="h-4 w-4 mr-2" />
                                            }
                                            Reimprimir
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
